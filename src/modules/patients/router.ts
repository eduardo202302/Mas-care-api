import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { accessibleBranchIds } from '../../infra/branch-scope.js';
import { ApiError } from '../../infra/errors.js';
import { findAccessiblePatient, canAccessBranch, patientWhere } from '../../infra/patient-access.js';
import { paginate, resolvePaging } from '../../infra/pagination.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { randomBytes } from 'node:crypto';
import { record } from '../audit/record.js';
import { hashLinkToken } from '../webhooks/telegram.js';
import { customFilter, resolveCustomValues } from '../custom-properties/service.js';
import {
  activityInput, activityListQuery, caregiverInput, caregiverParams, caregiverPatch,
  consentInput, duplicateCheck, patientCreate, patientListQuery, patientParams, patientPatch,
} from '../../schemas/patient.js';
import { patientTransferListQuery, transferInput } from '../../schemas/transfer.js';

export const patientsRouter = Router();
patientsRouter.use(resolveTenant);

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};
const nonEmpty = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
const duplicateWhere = (input: { documentId?: string | null | undefined; phone?: string | null | undefined }): Prisma.PatientWhereInput => ({
  OR: [
    ...(input.documentId ? [{ documentId: input.documentId }] : []),
    ...(input.phone ? [{ phone: input.phone }] : []),
  ],
});
const assertResponsibleMember = async (tx: Prisma.TransactionClient, organizationId: string, userId?: string | null) => {
  if (!userId) return;
  const member = await tx.member.findFirst({ where: { organizationId, userId }, select: { id: true } });
  if (!member) throw new ApiError(400, 'INVALID_RESPONSIBLE_USER', 'Responsible user must belong to this organization');
};

const range = (from?: string, to?: string) => ({
  ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
  ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
});
/** Date filters on the patient list: creation, activity, next refill date and coverage end. */
function dateFilters(query: z.infer<typeof patientListQuery>): Prisma.PatientWhereInput {
  const has = (from?: string, to?: string) => Boolean(from || to);
  const and: Prisma.PatientWhereInput[] = [];
  if (has(query.created_from, query.created_to)) and.push({ createdAt: range(query.created_from, query.created_to) });
  if (has(query.activity_from, query.activity_to)) and.push({ activities: { some: { occurredAt: range(query.activity_from, query.activity_to) } } });
  if (has(query.expected_from, query.expected_to)) and.push({ treatments: { some: { cycles: { some: { closedAt: null, expectedOn: range(query.expected_from, query.expected_to) } } } } });
  if (has(query.coverage_from, query.coverage_to)) and.push({ treatments: { some: { coverageEndOn: range(query.coverage_from, query.coverage_to) } } });
  return and.length ? { AND: and } : {};
}

const patientSortMap: Record<string, string> = { created_at: 'createdAt', full_name: 'fullName', document_id: 'documentId', birth_date: 'birthDate' };
function patientOrder(sort?: string[]): Prisma.PatientOrderByWithRelationInput[] {
  if (!sort?.length) return [{ primaryBranchId: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }];
  return [{ primaryBranchId: 'asc' }, ...sort.map((part) => {
    const [field, dir] = part.split(':') as [string, 'asc' | 'desc'];
    return { [patientSortMap[field]!]: dir } as Prisma.PatientOrderByWithRelationInput;
  }), { id: 'desc' }];
}

patientsRouter.get('/', validateQuery(patientListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:read');
  const query = res.locals.validatedQuery as z.infer<typeof patientListQuery>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const filters: Prisma.PatientWhereInput = {
      archivedAt: query.archived ? { not: null } : null,
      ...(query.branchId ? { primaryBranchId: query.branchId } : {}),
      ...(query.responsibleUserId ? { responsibleUserId: query.responsibleUserId } : {}),
      ...dateFilters(query),
      ...(query.q ? { OR: [
        { fullName: { contains: query.q, mode: 'insensitive' } },
        { documentId: { contains: query.q, mode: 'insensitive' } },
        { phone: { contains: query.q } },
      ] } : {}),
    };
    const custom = await customFilter(tx, 'patient', query.cp_key, query.cp_value);
    const where = await patientWhere(tx, tenant, custom ? { AND: [filters, { customValues: custom }] } : filters);
    const page = await paginate(query, (args) => tx.patient.findMany({
      where,
      orderBy: patientOrder(query.sort),
      take: args.take,
      skip: args.skip,
      ...(args.cursor ? { cursor: { organizationId_id: { organizationId: tenant.organizationId, id: args.cursor } } } : {}),
    }), () => tx.patient.count({ where }));
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.list' });
    return page;
  });
  res.json(result);
});

patientsRouter.post('/check-duplicates', validateBody(duplicateCheck), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:write');
  const input = req.body as z.infer<typeof duplicateCheck>;
  const matches = await withTenant(tenant.organizationId, async (tx) => {
    const where = await patientWhere(tx, tenant, { ...duplicateWhere(input), archivedAt: null });
    const data = await tx.patient.findMany({
      where,
      select: { id: true, fullName: true, documentId: true, phone: true, primaryBranchId: true },
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.duplicates_check' });
    return data;
  });
  res.json({ data: matches });
});

patientsRouter.post('/', validateBody(patientCreate), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:write');
  const input = req.body as z.infer<typeof patientCreate>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    if (!await canAccessBranch(tx, tenant, input.primaryBranchId)) throw new ApiError(404, 'NOT_FOUND', 'Branch not found');
    await assertResponsibleMember(tx, tenant.organizationId, input.responsibleUserId);
    const possibleDuplicates = await tx.patient.findMany({
      where: await patientWhere(tx, tenant, { ...duplicateWhere(input), archivedAt: null }),
      select: { id: true, fullName: true, documentId: true, phone: true, primaryBranchId: true },
      take: 10,
    });
    const { birthDate, customValues, ...rest } = input;
    const resolvedValues = await resolveCustomValues(tx, 'patient', customValues, {}, 'create');
    const patient = await tx.patient.create({
      data: {
        ...nonEmpty(rest),
        ...(resolvedValues ? { customValues: resolvedValues } : {}),
        ...(birthDate !== undefined ? { birthDate: birthDate ? new Date(birthDate + 'T00:00:00.000Z') : null } : {}),
        organizationId: tenant.organizationId,
        createdBy: tenant.userId,
      } as Prisma.PatientUncheckedCreateInput,
    });
    await tx.activity.create({
      data: { organizationId: tenant.organizationId, patientId: patient.id, type: 'patient_created', body: '', authorId: tenant.userId },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.create', subjectId: patient.id });
    return { patient, possibleDuplicates };
  });
  res.status(201).json(result);
});

patientsRouter.get('/:id', validateParams(patientParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:read');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const patient = await withTenant(tenant.organizationId, async (tx) => {
    const row = await findAccessiblePatient(tx, tenant, id);
    if (row) await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.read', subjectId: id });
    return row;
  });
  if (!patient) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
  res.json(patient);
});

patientsRouter.patch('/:id', validateParams(patientParams), validateBody(patientPatch), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:write');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const input = req.body as z.infer<typeof patientPatch>;
  const patient = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findAccessiblePatient(tx, tenant, id, { archivedAt: null });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    if (input.primaryBranchId && !await canAccessBranch(tx, tenant, input.primaryBranchId)) {
      throw new ApiError(404, 'NOT_FOUND', 'Branch not found');
    }
    await assertResponsibleMember(tx, tenant.organizationId, input.responsibleUserId);
    const { birthDate, customValues, ...rest } = input;
    const resolvedValues = await resolveCustomValues(tx, 'patient', customValues, existing.customValues, 'patch');
    const updated = await tx.patient.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: {
        ...nonEmpty(rest),
        ...(resolvedValues ? { customValues: resolvedValues } : {}),
        ...(birthDate !== undefined ? { birthDate: birthDate ? new Date(birthDate + 'T00:00:00.000Z') : null } : {}),
      } as Prisma.PatientUncheckedUpdateInput,
    });
    await tx.activity.create({
      data: { organizationId: tenant.organizationId, patientId: id, type: 'patient_updated', body: '', authorId: tenant.userId },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.update', subjectId: id });
    return updated;
  });
  res.json(patient);
});

patientsRouter.post('/:id/archive', validateParams(patientParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:archive');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const patient = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findAccessiblePatient(tx, tenant, id, { archivedAt: null });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const archived = await tx.patient.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { archivedAt: new Date() },
    });
    await tx.activity.create({
      data: { organizationId: tenant.organizationId, patientId: id, type: 'patient_archived', body: '', authorId: tenant.userId },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.archive', subjectId: id });
    return archived;
  });
  res.json(patient);
});

patientsRouter.post('/:id/restore', validateParams(patientParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:archive');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const patient = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findAccessiblePatient(tx, tenant, id, { archivedAt: { not: null } });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const restored = await tx.patient.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { archivedAt: null },
    });
    await tx.activity.create({
      data: { organizationId: tenant.organizationId, patientId: id, type: 'patient_restored', body: '', authorId: tenant.userId },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.restore', subjectId: id });
    return restored;
  });
  res.json(patient);
});

patientsRouter.get('/:id/caregivers', validateParams(patientParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:read');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const data = await withTenant(tenant.organizationId, async (tx) => {
    if (!await findAccessiblePatient(tx, tenant, id)) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    return tx.patientCaregiver.findMany({ where: { patientId: id }, orderBy: { id: 'asc' } });
  });
  res.json({ data });
});

patientsRouter.post('/:id/caregivers', validateParams(patientParams), validateBody(caregiverInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:write');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const input = req.body as z.infer<typeof caregiverInput>;
  const caregiver = await withTenant(tenant.organizationId, async (tx) => {
    if (!await findAccessiblePatient(tx, tenant, id, { archivedAt: null })) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const created = await tx.patientCaregiver.create({ data: { ...input, organizationId: tenant.organizationId, patientId: id } });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.caregiver.create', subjectId: id });
    return created;
  });
  res.status(201).json(caregiver);
});

patientsRouter.patch('/:id/caregivers/:caregiverId', validateParams(caregiverParams), validateBody(caregiverPatch), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:write');
  const { id, caregiverId } = res.locals.validatedParams as z.infer<typeof caregiverParams>;
  const input = req.body as z.infer<typeof caregiverPatch>;
  const caregiver = await withTenant(tenant.organizationId, async (tx) => {
    if (!await findAccessiblePatient(tx, tenant, id, { archivedAt: null })) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const exists = await tx.patientCaregiver.findFirst({ where: { id: caregiverId, patientId: id } });
    if (!exists) throw new ApiError(404, 'NOT_FOUND', 'Caregiver not found');
    const updated = await tx.patientCaregiver.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id: caregiverId } },
      data: nonEmpty(input) as Prisma.PatientCaregiverUncheckedUpdateInput,
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.caregiver.update', subjectId: id });
    return updated;
  });
  res.json(caregiver);
});

patientsRouter.delete('/:id/caregivers/:caregiverId', validateParams(caregiverParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:write');
  const { id, caregiverId } = res.locals.validatedParams as z.infer<typeof caregiverParams>;
  await withTenant(tenant.organizationId, async (tx) => {
    if (!await findAccessiblePatient(tx, tenant, id, { archivedAt: null })) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const exists = await tx.patientCaregiver.findFirst({ where: { id: caregiverId, patientId: id } });
    if (!exists) throw new ApiError(404, 'NOT_FOUND', 'Caregiver not found');
    await tx.patientCaregiver.delete({ where: { organizationId_id: { organizationId: tenant.organizationId, id: caregiverId } } });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.caregiver.delete', subjectId: id });
  });
  res.status(204).end();
});

patientsRouter.post('/:id/consent', validateParams(patientParams), validateBody(consentInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:write');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const input = req.body as z.infer<typeof consentInput>;
  const consent = await withTenant(tenant.organizationId, async (tx) => {
    if (!await findAccessiblePatient(tx, tenant, id, { archivedAt: null })) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const recorded = await tx.patientConsent.create({
      data: { organizationId: tenant.organizationId, patientId: id, granted: input.granted, channel: input.channel, ...(input.evidence !== undefined ? { evidence: input.evidence } : {}), recordedBy: tenant.userId },
    });
    await tx.patient.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { reminderConsent: input.granted, reminderConsentAt: input.granted ? recorded.recordedAt : null },
    });
    await tx.activity.create({
      data: { organizationId: tenant.organizationId, patientId: id, type: 'consent_recorded', body: '', authorId: tenant.userId },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.consent.record', subjectId: id });
    return recorded;
  });
  res.status(201).json(consent);
});

patientsRouter.get('/:id/incidents', validateParams(patientParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:read');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const data = await withTenant(tenant.organizationId, async (tx) => {
    if (!await findAccessiblePatient(tx, tenant, id)) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const branchIds = await accessibleBranchIds(tx, tenant);
    if (branchIds !== null && branchIds.length === 0) return [];
    return tx.incident.findMany({
      where: {
        patientId: id,
        ...(branchIds === null ? {} : { branchId: { in: branchIds } }),
      },
      orderBy: [{ status: 'asc' }, { boardPosition: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: {
        branch: { select: { id: true, name: true, labelColor: true } },
        patient: { select: { id: true, fullName: true } },
        assignee: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
      },
    });
  });
  res.json({ data });
});

patientsRouter.get('/:id/activities', validateParams(patientParams), validateQuery(activityListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:read');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const query = res.locals.validatedQuery as z.infer<typeof activityListQuery>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    if (!await findAccessiblePatient(tx, tenant, id)) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const rows = await tx.activity.findMany({
      where: { patientId: id, ...(query.treatment_id ? { treatmentId: query.treatment_id } : {}) },
      include: { author: { select: { id: true, name: true } } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { organizationId_id: { organizationId: tenant.organizationId, id: query.cursor } }, skip: 1 } : {}),
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.activities.read', subjectId: id });
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return { data, nextCursor: hasMore ? data.at(-1)!.id : null };
  });
  res.json(result);
});

patientsRouter.post('/:id/activities', validateParams(patientParams), validateBody(activityInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:write');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const input = req.body as z.infer<typeof activityInput>;
  const activity = await withTenant(tenant.organizationId, async (tx) => {
    if (!await findAccessiblePatient(tx, tenant, id, { archivedAt: null })) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    if (input.treatmentId && !await tx.treatment.findFirst({ where: { id: input.treatmentId, patientId: id }, select: { id: true } })) {
      throw new ApiError(400, 'INVALID_TREATMENT', 'The treatment does not belong to this patient');
    }
    const created = await tx.activity.create({
      data: {
        organizationId: tenant.organizationId, patientId: id, authorId: tenant.userId, type: input.type, body: input.body, metadata: input.metadata as Prisma.InputJsonObject,
        ...(input.occurredOn ? { occurredAt: new Date(`${input.occurredOn}T12:00:00.000Z`) } : {}),
        ...(input.treatmentId ? { treatmentId: input.treatmentId } : {}),
      },
      include: { author: { select: { id: true, name: true } } },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.activity.create', subjectId: id });
    return created;
  });
  res.status(201).json(activity);
});

// --- Patient transfers (block 2) -------------------------------------------------
//
// Business rules decided here (no ambiguity left for later blocks):
// 1. "Current branch of the patient": `Patient.primaryBranchId` is the field that
//    represents it. Individual treatments carry their own `branchId` which can, in
//    practice, differ from the patient's primaryBranchId; the transfer therefore
//    moves BOTH the patient's primaryBranchId AND the branchId of every treatment
//    (and its open cycles) included in the transfer, so they stay consistent.
// 2. Transferable treatments by default (when `treatment_ids` is omitted): every
//    treatment belonging to the patient, in the FROM branch, with status 'active'.
//    Paused/finished treatments are left behind untouched — the pharmacy keeps no
//    obligation to deliver on them, so moving their branch has no operational
//    meaning. When `treatment_ids` is given explicitly, each id must still satisfy
//    the same two conditions (belongs to the patient, is in the FROM branch) and
//    additionally must have status 'active'; otherwise 400 INVALID_TREATMENT.
// 3. "Open cycle" for the cycles-moved count: RefillCycle rows with closedAt IS
//    NULL for that treatment (mirrors `openCycleFor` in treatments/router.ts).
// 4. Stock-out definition: MedicationStockMark.level === 'out_of_stock' for that
//    medication in the destination branch. A medication with NO stock mark at all
//    in the destination is treated as unknown/in-stock (no warning) — pharmacies
//    only mark medications when they actively know the state; absence of a row is
//    not evidence of a stock-out.
const transferIdempotencyKey = (req: Request): string | null => {
  const raw = req.header('idempotency-key')?.trim();
  if (!raw) return null;
  if (raw.length > 200) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be at most 200 characters');
  return raw;
};

type TransferTx = Prisma.TransactionClient;

async function medicationNameOf(tx: TransferTx, medicationId: string) {
  const medication = await tx.medication.findFirst({ where: { id: medicationId }, select: { brandName: true, genericName: true, activeIngredient: true, presentation: true } });
  return medication?.brandName ?? medication?.genericName ?? medication?.activeIngredient ?? medication?.presentation ?? medicationId;
}

function presentTransfer(transfer: Prisma.PatientTransferGetPayload<object>, idempotentReplay: boolean) {
  return {
    id: transfer.id,
    patient_id: transfer.patientId,
    from_branch_id: transfer.fromBranchId,
    to_branch_id: transfer.toBranchId,
    reason: transfer.reason,
    treatments_count: transfer.treatmentsCount,
    cycles_count: transfer.cyclesCount,
    created_at: transfer.createdAt,
    idempotent_replay: idempotentReplay,
    warnings: [] as Array<{ code: string; medication_id: string; medication_name: string; branch_id: string }>,
  };
}

patientsRouter.post('/:id/transfers', validateParams(patientParams), validateBody(transferInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patient:transfer');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const input = req.body as z.infer<typeof transferInput>;
  const key = transferIdempotencyKey(req);

  const result = await withTenant(tenant.organizationId, async (tx) => {
    const patient = await findAccessiblePatient(tx, tenant, id, { archivedAt: null });
    if (!patient) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const fromBranchId = patient.primaryBranchId;

    // Idempotency: runs BEFORE the branch/treatment checks below because a replay
    // sees the post-transfer state (patient already in the destination branch,
    // treatments already moved), which those checks would reject. Compares the
    // request to the stored transfer; 409 if the key was used for a different one.
    if (key) {
      const existing = await tx.patientTransfer.findFirst({ where: { idempotencyKey: key } });
      if (existing) {
        const existingLines = await tx.patientTransferTreatment.findMany({ where: { patientTransferId: existing.id }, select: { treatmentId: true } });
        const sameOperation = existing.patientId === id
          && existing.toBranchId === input.to_branch_id
          && existing.reason === input.reason
          && (!input.treatment_ids || JSON.stringify(existingLines.map((l) => l.treatmentId).sort()) === JSON.stringify([...input.treatment_ids].sort()));
        if (!sameOperation) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for a different transfer');
        }
        return { transfer: existing, idempotentReplay: true, warnings: [] as ReturnType<typeof presentTransfer>['warnings'] };
      }
    }

    const toBranch = await tx.branch.findFirst({ where: { id: input.to_branch_id, organizationId: tenant.organizationId } });
    if (!toBranch) throw new ApiError(404, 'NOT_FOUND', 'Destination branch not found');
    if (toBranch.archivedAt) throw new ApiError(409, 'BRANCH_ARCHIVED', 'Destination branch is archived');
    if (toBranch.id === fromBranchId) throw new ApiError(400, 'SAME_BRANCH', 'Destination branch must differ from the current branch');

    // Authorization scope: owner/admin may move between any two branches of the
    // organization. Any other role must have branch-membership access to BOTH the
    // origin and the destination branch (accessibleBranchIds === null means
    // owner/admin and is handled above by role; for everyone else we check both ids
    // are in their accessible set) — a pharmacist who only works at branch A cannot
    // pull a patient into, or push one out of, a branch they have no membership in.
    const accessible = await accessibleBranchIds(tx, tenant);
    if (accessible !== null) {
      if (!accessible.includes(fromBranchId) || !accessible.includes(toBranch.id)) {
        throw new ApiError(403, 'FORBIDDEN', 'You do not have access to the origin or destination branch');
      }
    }

    // Resolve transferable treatments (rule #2 above).
    const candidates = await tx.treatment.findMany({
      where: {
        patientId: id,
        branchId: fromBranchId,
        ...(input.treatment_ids ? { id: { in: input.treatment_ids } } : { status: 'active' }),
      },
    });
    if (input.treatment_ids) {
      if (candidates.length !== input.treatment_ids.length) {
        throw new ApiError(400, 'INVALID_TREATMENT', 'One or more treatment_ids do not belong to this patient in the current branch');
      }
      const notActive = candidates.filter((t) => t.status !== 'active');
      if (notActive.length > 0) {
        throw new ApiError(400, 'INVALID_TREATMENT', 'Only active treatments can be transferred');
      }
    }
    const treatmentIds = candidates.map((t) => t.id);

    const openCycles = treatmentIds.length
      ? await tx.refillCycle.findMany({ where: { treatmentId: { in: treatmentIds }, closedAt: null } })
      : [];
    const cyclesByTreatment = new Map<string, number>();
    for (const cycle of openCycles) {
      cyclesByTreatment.set(cycle.treatmentId, (cyclesByTreatment.get(cycle.treatmentId) ?? 0) + 1);
    }
    const cyclesCount = openCycles.length;

    // Stock-out warning on destination (rule #4 above). Skipped entirely when the
    // caller already confirmed it for this exact idempotent retry.
    if (!input.confirm_stock_warning && treatmentIds.length > 0) {
      const medicationIds = [...new Set(candidates.map((t) => t.medicationId))];
      const marks = await tx.medicationStockMark.findMany({
        where: { organizationId: tenant.organizationId, branchId: toBranch.id, medicationId: { in: medicationIds }, level: 'out_of_stock' },
      });
      if (marks.length > 0) {
        const warnings = await Promise.all(marks.map(async (mark) => ({
          code: 'STOCK_OUT_OF_STOCK_DEST',
          medication_id: mark.medicationId,
          medication_name: await medicationNameOf(tx, mark.medicationId),
          branch_id: toBranch.id,
        })));
        return { transfer: null, idempotentReplay: false, warnings };
      }
    }

    // Execute the actual transfer.
    if (treatmentIds.length > 0) {
      await tx.treatment.updateMany({ where: { id: { in: treatmentIds } }, data: { branchId: toBranch.id } });
      await tx.refillCycle.updateMany({ where: { treatmentId: { in: treatmentIds }, closedAt: null }, data: { branchId: toBranch.id, version: { increment: 1 } } });
    }
    await tx.patient.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { primaryBranchId: toBranch.id },
    });

    const fromBranch = await tx.branch.findFirst({ where: { id: fromBranchId }, select: { name: true } });
    const created = await tx.patientTransfer.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: id,
        fromBranchId,
        toBranchId: toBranch.id,
        reason: input.reason,
        treatmentsCount: treatmentIds.length,
        cyclesCount,
        createdByUserId: tenant.userId,
        idempotencyKey: key,
        treatments: {
          create: treatmentIds.map((treatmentId) => ({
            organizationId: tenant.organizationId,
            treatmentId,
            cyclesMovedCount: cyclesByTreatment.get(treatmentId) ?? 0,
          })),
        },
      },
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: id,
        type: 'transfer',
        body: `Traspasado de ${fromBranch?.name ?? fromBranchId} a ${toBranch.name}: ${input.reason}`,
        metadata: {
          patient_transfer_id: created.id,
          from_branch_id: fromBranchId,
          to_branch_id: toBranch.id,
          treatments_count: treatmentIds.length,
          cycles_count: cyclesCount,
        },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.transfer', subjectId: id });
    return { transfer: created, idempotentReplay: false, warnings: [] as ReturnType<typeof presentTransfer>['warnings'] };
  });

  if (!result.transfer) {
    res.status(200).json({ completed: false, warnings: result.warnings });
    return;
  }
  const presented = presentTransfer(result.transfer, result.idempotentReplay);
  res.status(result.idempotentReplay ? 200 : 201).json({ ...presented, completed: true });
});

patientsRouter.get('/:id/transfers', validateParams(patientParams), validateQuery(patientTransferListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:read');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const query = res.locals.validatedQuery as z.infer<typeof patientTransferListQuery>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    if (!await findAccessiblePatient(tx, tenant, id)) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const { page, rows, skip } = resolvePaging(query);
    const where: Prisma.PatientTransferWhereInput = { patientId: id };
    const [data, total] = await Promise.all([
      tx.patientTransfer.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: rows,
        skip,
        include: {
          fromBranch: { select: { id: true, name: true } },
          toBranch: { select: { id: true, name: true } },
          createdByUser: { select: { id: true, name: true } },
        },
      }),
      tx.patientTransfer.count({ where }),
    ]);
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.transfers.read', subjectId: id });
    return {
      data: data.map((row) => ({
        id: row.id,
        occurred_at: row.createdAt,
        from_branch: { id: row.fromBranch.id, name: row.fromBranch.name },
        to_branch: { id: row.toBranch.id, name: row.toBranch.name },
        reason: row.reason,
        treatments_count: row.treatmentsCount,
        cycles_count: row.cyclesCount,
        created_by: { id: row.createdByUser.id, name: row.createdByUser.name },
      })),
      total,
      page,
      rows,
    };
  });
  res.json(result);
});

/**
 * Duplicates the patient record only. Treatments, caregivers, consent, document
 * and phone are not copied: copying treatments would create duplicated refill
 * cycles, and a copied document or phone would trip duplicate detection.
 */
patientsRouter.post('/:id/duplicate', validateParams(patientParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:write');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const copy = await withTenant(tenant.organizationId, async (tx) => {
    const source = await findAccessiblePatient(tx, tenant, id);
    if (!source) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const created = await tx.patient.create({
      data: {
        organizationId: tenant.organizationId,
        createdBy: tenant.userId,
        primaryBranchId: source.primaryBranchId,
        fullName: `${source.fullName} (copia)`.slice(0, 160),
        birthDate: source.birthDate,
        address: source.address,
        zone: source.zone,
        preferredChannel: source.preferredChannel,
        careNotes: source.careNotes,
        responsibleUserId: source.responsibleUserId,
      } as Prisma.PatientUncheckedCreateInput,
    });
    await tx.activity.create({
      data: { organizationId: tenant.organizationId, patientId: created.id, type: 'patient_created', body: `Duplicado de ${source.fullName}`, authorId: tenant.userId },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.duplicate', subjectId: created.id, metadata: { sourceId: id } });
    return created;
  });
  res.status(201).json(copy);
});

const pauseInput = z.object({ paused: z.boolean(), reason: z.string().trim().max(500).nullable().optional() }).strict();

/** Pauses or resumes automatic notices for one patient. Pausing also cancels what was already waiting to go out. */
patientsRouter.patch('/:id/automation', validateParams(patientParams), validateBody(pauseInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:write');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const input = req.body as z.infer<typeof pauseInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    if (!await findAccessiblePatient(tx, tenant, id)) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const updated = await tx.patient.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { automationPaused: input.paused, automationPausedReason: input.paused ? (input.reason ?? null) : null },
      select: { id: true, automationPaused: true, automationPausedReason: true },
    });
    const cancelled = input.paused
      ? (await tx.outboxMessage.updateMany({ where: { patientId: id, status: 'pending' }, data: { status: 'cancelled', cancelledAt: new Date(), lastError: 'automation_paused' } })).count
      : 0;
    await tx.activity.create({
      data: { organizationId: tenant.organizationId, patientId: id, type: 'patient_updated', body: input.paused ? 'Avisos automáticos pausados' : 'Avisos automáticos reanudados', metadata: { automation_paused: input.paused }, authorId: tenant.userId },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: input.paused ? 'patient.automation.pause' : 'patient.automation.resume', subjectId: id, metadata: { cancelled } });
    return { ...updated, cancelled_messages: cancelled };
  });
  res.json(result);
});

const messagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().datetime().optional(),
}).strict();

/**
 * The conversation with a patient: automatic notices (with delivery state) and
 * their replies, newest first. Message text is sensitive, so it needs
 * `outbox:view` and every read is audited.
 */
patientsRouter.get('/:id/messages', validateParams(patientParams), validateQuery(messagesQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'outbox:view');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const query = res.locals.validatedQuery as z.infer<typeof messagesQuery>;
  const before = query.before ? new Date(query.before) : undefined;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    if (!await findAccessiblePatient(tx, tenant, id)) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const [sent, replies] = await Promise.all([
      tx.outboxMessage.findMany({
        where: { patientId: id, status: { notIn: ['dry_run'] }, ...(before ? { createdAt: { lt: before } } : {}) },
        include: { notice: true, template: { select: { name: true } } },
        orderBy: { createdAt: 'desc' }, take: query.limit + 1,
      }),
      tx.whatsappInbound.findMany({
        where: { patientId: id, ...(before ? { receivedAt: { lt: before } } : {}) },
        orderBy: { receivedAt: 'desc' }, take: query.limit + 1,
      }),
    ]);
    const items = [
      ...sent.map((row) => ({
        kind: 'notice' as const, id: row.id, at: row.sentAt ?? row.createdAt, status: row.notice?.status ?? row.status, channel: row.channel,
        attempt: row.attemptNumber, template: row.template.name, error: row.lastError,
      })),
      ...replies.map((row) => ({ kind: 'reply' as const, id: row.id, at: row.receivedAt, channel: row.channel, text: row.text, button: row.buttonPayload })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    const hasMore = items.length > query.limit;
    const page = items.slice(0, query.limit);
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.messages.read', subjectId: id });
    return { data: page, next_before: hasMore ? page.at(-1)!.at.toISOString() : null };
  });
  res.json(result);
});

// --- Telegram: the patient links their own chat with the organization bot ---------------------

/**
 * Creates a single-use link (valid 7 days) that staff give to the patient.
 * Opening it in Telegram links that chat to this patient, so nobody can link a
 * chat on the patient behalf. The link is shown once; only its hash is kept.
 */
patientsRouter.post('/:id/telegram-link', validateParams(patientParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:write');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    if (!await findAccessiblePatient(tx, tenant, id, { archivedAt: null })) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const account = await tx.telegramAccount.findFirst();
    if (!account) throw new ApiError(409, 'NO_TELEGRAM_BOT', 'La organización no tiene un bot de Telegram conectado');
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    await tx.telegramLinkToken.create({ data: { organizationId: tenant.organizationId, patientId: id, tokenHash: hashLinkToken(token), expiresAt, createdBy: tenant.userId } });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.telegram.link_created', subjectId: id });
    return { url: `https://t.me/${account.botUsername}?start=${token}`, expires_at: expiresAt };
  });
  res.status(201).json(result);
});

patientsRouter.get('/:id/telegram', validateParams(patientParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:read');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    if (!await findAccessiblePatient(tx, tenant, id)) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const [account, link] = await Promise.all([tx.telegramAccount.findFirst({ select: { id: true } }), tx.telegramLink.findFirst({ where: { patientId: id } })]);
    return { bot_connected: Boolean(account), linked: Boolean(link), linked_at: link?.linkedAt ?? null };
  });
  res.json(result);
});

patientsRouter.delete('/:id/telegram', validateParams(patientParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'patients:write');
  const { id } = res.locals.validatedParams as z.infer<typeof patientParams>;
  await withTenant(tenant.organizationId, async (tx) => {
    if (!await findAccessiblePatient(tx, tenant, id)) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    await tx.telegramLink.deleteMany({ where: { patientId: id } });
    await tx.telegramLinkToken.deleteMany({ where: { patientId: id, usedAt: null } });
    await tx.outboxMessage.updateMany({ where: { patientId: id, channel: 'telegram', status: 'pending' }, data: { status: 'cancelled', cancelledAt: new Date(), lastError: 'telegram_unlinked' } });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'patient.telegram.unlinked', subjectId: id });
  });
  res.status(204).end();
});
