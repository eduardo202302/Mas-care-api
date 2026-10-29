import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  calculateCoverageEndOn,
  deriveCoverage,
  subtractDays,
  type CoverageCycle,
} from '../../domain/coverage.js';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { canAccessBranch, findAccessiblePatient } from '../../infra/patient-access.js';
import { withTenant } from '../../infra/prisma.js';
import { findOrCreateSetting } from '../../infra/settings.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import { fireEvent } from '../automation/engine.js';
import { resolveCustomValues } from '../custom-properties/service.js';
import {
  defaultNoticeBody,
  normalizePhone,
  renderNoticeTemplate,
  waMeUrl,
} from '../../domain/notice.js';
import {
  deliveryInput,
  noticeLoggedInput,
  noticePreviewQuery,
} from '../../schemas/delivery.js';
import {
  coverageAdjustInput,
  prescriptionRenewInput,
  statusReasonInput,
  treatmentCreate,
  treatmentListQuery,
  treatmentParams,
  treatmentPatch,
} from '../../schemas/treatment.js';

export const treatmentsRouter = Router();
treatmentsRouter.use(resolveTenant);

type Tx = Prisma.TransactionClient;
type SettingsRow = Awaited<ReturnType<typeof settingFor>>;
type OpenCycle = Prisma.RefillCycleGetPayload<{ include: { _count: { select: { deliveries: true } } } }>;

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);
const nonEmpty = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

function settingFor(tx: Tx, organizationId: string) {
  return findOrCreateSetting(tx, organizationId);
}

async function branchScope(tx: Tx, tenant: NonNullable<Express.Request['tenant']>): Promise<Prisma.TreatmentWhereInput> {
  if (tenant.role === 'owner' || tenant.role === 'admin') return {};
  const memberships = await tx.branchMember.findMany({
    where: { organizationId: tenant.organizationId, userId: tenant.userId },
    select: { branchId: true },
  });
  return { branchId: { in: memberships.map(({ branchId }) => branchId) } };
}

async function findTreatment(
  tx: Tx,
  tenant: NonNullable<Express.Request['tenant']>,
  id: string,
  extra: Prisma.TreatmentWhereInput = {},
) {
  return tx.treatment.findFirst({
    where: { AND: [{ id, ...await branchScope(tx, tenant) }, extra] },
  });
}

async function openCycleFor(tx: Tx, treatmentId: string): Promise<OpenCycle | null> {
  return tx.refillCycle.findFirst({
    where: { treatmentId, closedAt: null },
    include: { _count: { select: { deliveries: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

function coverageCycle(cycle: OpenCycle | null): CoverageCycle {
  return cycle ? { status: cycle.status, hasDelivery: cycle._count.deliveries > 0 } : null;
}

function present(
  treatment: Prisma.TreatmentGetPayload<object>,
  cycle: OpenCycle | null,
  settings: SettingsRow,
  today = new Date(),
) {
  const coverage = deriveCoverage(
    {
      status: treatment.status,
      startDate: treatment.startDate,
      quantityPerCycle: treatment.quantityPerCycle.toString(),
      dosePerIntake: treatment.dosePerIntake.toString(),
      intakesPerDay: treatment.intakesPerDay.toString(),
      coverageEndOn: treatment.coverageEndOn,
      coverageManuallyAdjusted: treatment.coverageManuallyAdjusted,
      prescriptionExpiresOn: treatment.prescriptionExpiresOn,
    },
    coverageCycle(cycle),
    today,
    {
      dueSoonDays: settings.dueSoonDays,
      upcomingDays: settings.upcomingDays,
      prescriptionWarningDays: settings.prescriptionWarningDays,
    },
  );
  return {
    ...treatment,
    derived_status: coverage.status,
    days_remaining: coverage.daysRemaining,
    prescription_flag: coverage.prescriptionFlag,
  };
}

async function presentOne(tx: Tx, treatment: Prisma.TreatmentGetPayload<object>): Promise<ReturnType<typeof present>> {
  const settings = await settingFor(tx, treatment.organizationId);
  return present(treatment, await openCycleFor(tx, treatment.id), settings);
}

async function assertResponsibleMember(tx: Tx, organizationId: string, userId?: string | null) {
  if (!userId) return;
  const member = await tx.member.findFirst({ where: { organizationId, userId }, select: { id: true } });
  if (!member) throw new ApiError(400, 'INVALID_RESPONSIBLE_USER', 'Responsible user must belong to this organization');
}

async function assertMedication(tx: Tx, medicationId: string) {
  const medication = await tx.medication.findFirst({ where: { id: medicationId, archivedAt: null }, select: { id: true } });
  if (!medication) throw new ApiError(400, 'INVALID_MEDICATION', 'Medication not found');
}

async function assertBranch(tx: Tx, tenant: NonNullable<Express.Request['tenant']>, branchId: string) {
  if (!await canAccessBranch(tx, tenant, branchId)) throw new ApiError(404, 'NOT_FOUND', 'Branch not found');
}

function assertDateRange(startDate: Date, endDate: Date | null) {
  if (endDate && endDate.getTime() < startDate.getTime()) {
    throw new ApiError(400, 'INVALID_DATE_RANGE', 'end_date must not be before start_date');
  }
}

treatmentsRouter.get('/', validateQuery(treatmentListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const query = res.locals.validatedQuery as z.infer<typeof treatmentListQuery>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const rows = await tx.treatment.findMany({
      where: {
        AND: [
          {
            ...(query.patient_id ? { patientId: query.patient_id } : {}),
            ...(query.branch_id ? { branchId: query.branch_id } : {}),
            ...(query.responsible_user_id ? { responsibleUserId: query.responsible_user_id } : {}),
          },
          await branchScope(tx, tenant),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const settings = await settingFor(tx, tenant.organizationId);
    const cycles = rows.length
      ? await tx.refillCycle.findMany({
        where: { treatmentId: { in: rows.map(({ id }) => id) }, closedAt: null },
        include: { _count: { select: { deliveries: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
      : [];
    const cycleByTreatment = new Map<string, OpenCycle>();
    for (const cycle of cycles) {
      if (!cycleByTreatment.has(cycle.treatmentId)) cycleByTreatment.set(cycle.treatmentId, cycle);
    }
    const presented = rows.map((row) => present(row, cycleByTreatment.get(row.id) ?? null, settings));
    const filtered = query.derived_status
      ? presented.filter((row) => row.derived_status === query.derived_status)
      : presented;
    const cursorIndex = query.cursor ? filtered.findIndex((row) => row.id === query.cursor) : -1;
    const start = query.cursor ? (cursorIndex >= 0 ? cursorIndex + 1 : filtered.length) : 0;
    const data = filtered.slice(start, start + query.limit);
    const hasMore = start + query.limit < filtered.length;
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.list' });
    return { data, nextCursor: hasMore ? data.at(-1)!.id : null };
  });
  res.json(result);
});

/** Creates a treatment with its first refill cycle, activity, audit and automation event. Shared by the API and the CSV import. */
export async function createTreatment(tx: Tx, tenant: NonNullable<Express.Request['tenant']>, input: z.infer<typeof treatmentCreate>) {
    if (!await findAccessiblePatient(tx, tenant, input.patient_id, { archivedAt: null })) {
      throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    }
    await assertBranch(tx, tenant, input.branch_id);
    await assertMedication(tx, input.medication_id);
    await assertResponsibleMember(tx, tenant.organizationId, input.responsible_user_id);
    const startDate = dateOnly(input.start_date);
    const endDate = input.end_date ? dateOnly(input.end_date) : null;
    assertDateRange(startDate, endDate);
    const settings = await settingFor(tx, tenant.organizationId);
    const coverageEndOn = calculateCoverageEndOn({
      startDate,
      quantityPerCycle: input.quantity_per_cycle,
      dosePerIntake: input.dose_per_intake,
      intakesPerDay: input.intakes_per_day,
    });
    const customValues = await resolveCustomValues(tx, 'treatment', input.custom_values, {}, 'create');
    const treatment = await tx.treatment.create({
      data: {
        ...(customValues ? { customValues } : {}),
        organizationId: tenant.organizationId,
        patientId: input.patient_id,
        medicationId: input.medication_id,
        branchId: input.branch_id,
        responsibleUserId: input.responsible_user_id ?? null,
        dosePerIntake: input.dose_per_intake,
        intakesPerDay: input.intakes_per_day,
        quantityPerCycle: input.quantity_per_cycle,
        startDate,
        endDate,
        prescriberName: input.prescriber_name ?? null,
        prescriptionExpiresOn: input.prescription_expires_on ? dateOnly(input.prescription_expires_on) : null,
        status: 'active',
        statusChangedAt: new Date(),
        coverageEndOn,
        coverageManuallyAdjusted: false,
        notes: input.notes ?? null,
      } as Prisma.TreatmentUncheckedCreateInput,
    });
    const cycle = await tx.refillCycle.create({
      data: {
        organizationId: tenant.organizationId,
        treatmentId: treatment.id,
        branchId: input.branch_id,
        status: 'to_notify',
        expectedOn: coverageEndOn,
        expectedQuantity: input.quantity_per_cycle,
        suggestedNoticeOn: subtractDays(coverageEndOn, settings.noticeLeadDays),
      } as Prisma.RefillCycleUncheckedCreateInput,
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: treatment.patientId,
        treatmentId: treatment.id,
        cycleId: cycle.id,
        type: 'treatment_created',
        body: '',
        metadata: { coverage_end_on: coverageEndOn.toISOString().slice(0, 10) },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.create', subjectId: treatment.id });
    await fireEvent(tx, tenant.organizationId, 'treatment_created', { patientId: treatment.patientId, treatmentId: treatment.id, cycleId: cycle.id });
    return { treatment, cycle, settings };
}

treatmentsRouter.post('/', validateBody(treatmentCreate), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const input = req.body as z.infer<typeof treatmentCreate>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const { treatment, cycle, settings } = await createTreatment(tx, tenant, input);
    return present(treatment, { ...cycle, _count: { deliveries: 0 } }, settings);
  });
  res.status(201).json(result);
});

treatmentsRouter.get('/:id', validateParams(treatmentParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const settings = await settingFor(tx, tenant.organizationId);
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.read', subjectId: id });
    return present(treatment, await openCycleFor(tx, id), settings);
  });
  res.json(result);
});

treatmentsRouter.patch('/:id', validateParams(treatmentParams), validateBody(treatmentPatch), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const input = req.body as z.infer<typeof treatmentPatch>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findTreatment(tx, tenant, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (input.patient_id && !await findAccessiblePatient(tx, tenant, input.patient_id, { archivedAt: null })) {
      throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    }
    if (input.branch_id) await assertBranch(tx, tenant, input.branch_id);
    if (input.medication_id) await assertMedication(tx, input.medication_id);
    if (input.responsible_user_id !== undefined) {
      await assertResponsibleMember(tx, tenant.organizationId, input.responsible_user_id);
    }
    const startDate = input.start_date ? dateOnly(input.start_date) : existing.startDate;
    const endDate = input.end_date === undefined
      ? existing.endDate
      : input.end_date === null ? null : dateOnly(input.end_date);
    assertDateRange(startDate, endDate);
    const patchedValues = await resolveCustomValues(tx, 'treatment', input.custom_values, existing.customValues, 'patch');
    const data: Prisma.TreatmentUncheckedUpdateInput = {
      ...nonEmpty({
        patientId: input.patient_id,
        medicationId: input.medication_id,
        branchId: input.branch_id,
        responsibleUserId: input.responsible_user_id,
        dosePerIntake: input.dose_per_intake,
        intakesPerDay: input.intakes_per_day,
        quantityPerCycle: input.quantity_per_cycle,
        startDate: input.start_date ? startDate : undefined,
        endDate: input.end_date === undefined ? undefined : endDate,
        prescriberName: input.prescriber_name,
        prescriptionExpiresOn: input.prescription_expires_on === undefined
          ? undefined
          : input.prescription_expires_on === null ? null : dateOnly(input.prescription_expires_on),
        notes: input.notes,
      }),
      ...(patchedValues ? { customValues: patchedValues } : {}),
    };
    const scheduleChanged = input.dose_per_intake !== undefined
      || input.intakes_per_day !== undefined
      || input.quantity_per_cycle !== undefined
      || input.start_date !== undefined;
    if (scheduleChanged && !existing.coverageManuallyAdjusted) {
      const lastDelivery = await tx.delivery.findFirst({
        where: { treatmentId: id },
        orderBy: [{ deliveredOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      });
      const coverageEndOn = calculateCoverageEndOn({
        startDate,
        quantityPerCycle: input.quantity_per_cycle ?? existing.quantityPerCycle.toString(),
        dosePerIntake: input.dose_per_intake ?? existing.dosePerIntake.toString(),
        intakesPerDay: input.intakes_per_day ?? existing.intakesPerDay.toString(),
        lastDeliveryOn: lastDelivery?.deliveredOn ?? null,
        lastDeliveryQuantity: lastDelivery?.quantity.toString() ?? null,
      });
      data.coverageEndOn = coverageEndOn;
      await tx.refillCycle.updateMany({
        where: { treatmentId: id, closedAt: null, status: 'to_notify' },
        data: {
          expectedOn: coverageEndOn,
          suggestedNoticeOn: subtractDays(coverageEndOn, (await settingFor(tx, tenant.organizationId)).noticeLeadDays),
          version: { increment: 1 },
        },
      });
    }
    const updated = await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data,
    });
    if (input.branch_id) {
      await tx.refillCycle.updateMany({
        where: { treatmentId: id, closedAt: null },
        data: { branchId: input.branch_id, version: { increment: 1 } },
      });
    }
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: updated.patientId,
        treatmentId: updated.id,
        type: 'treatment_updated',
        body: '',
        metadata: { fields: Object.keys(input) },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.update', subjectId: id });
    return presentOne(tx, updated);
  });
  res.json(result);
});

treatmentsRouter.post('/:id/pause', validateParams(treatmentParams), validateBody(statusReasonInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:manage');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const { reason } = req.body as z.infer<typeof statusReasonInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findTreatment(tx, tenant, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (existing.status !== 'active') throw new ApiError(409, 'INVALID_STATUS', 'Only active treatments can be paused');
    const updated = await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { status: 'paused', statusReason: reason, statusChangedAt: new Date() },
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: updated.patientId,
        treatmentId: updated.id,
        type: 'treatment_paused',
        body: reason,
        metadata: { reason },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.pause', subjectId: id });
    return presentOne(tx, updated);
  });
  res.json(result);
});

treatmentsRouter.post('/:id/finish', validateParams(treatmentParams), validateBody(statusReasonInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:manage');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const { reason } = req.body as z.infer<typeof statusReasonInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findTreatment(tx, tenant, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (existing.status === 'finished') throw new ApiError(409, 'INVALID_STATUS', 'Treatment is already finished');
    const updated = await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { status: 'finished', statusReason: reason, statusChangedAt: new Date() },
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: updated.patientId,
        treatmentId: updated.id,
        type: 'treatment_finished',
        body: reason,
        metadata: { reason },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.finish', subjectId: id });
    return presentOne(tx, updated);
  });
  res.json(result);
});

treatmentsRouter.post('/:id/resume', validateParams(treatmentParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:manage');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findTreatment(tx, tenant, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (existing.status !== 'paused') throw new ApiError(409, 'INVALID_STATUS', 'Only paused treatments can be resumed');
    const updated = await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { status: 'active', statusReason: null, statusChangedAt: new Date() },
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: updated.patientId,
        treatmentId: updated.id,
        type: 'treatment_resumed',
        body: '',
        metadata: {},
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.resume', subjectId: id });
    return presentOne(tx, updated);
  });
  res.json(result);
});

treatmentsRouter.post('/:id/adjust-coverage', validateParams(treatmentParams), validateBody(coverageAdjustInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:manage');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const { new_end_on, reason } = req.body as z.infer<typeof coverageAdjustInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findTreatment(tx, tenant, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (existing.status === 'finished') throw new ApiError(409, 'INVALID_STATUS', 'Finished treatments cannot be adjusted');
    const coverageEndOn = dateOnly(new_end_on);
    const updated = await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { coverageEndOn, coverageManuallyAdjusted: true, coverageAdjustReason: reason },
    });
    await tx.refillCycle.updateMany({
      where: { treatmentId: id, closedAt: null },
      data: { expectedOn: coverageEndOn, version: { increment: 1 } },
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: updated.patientId,
        treatmentId: updated.id,
        type: 'coverage_adjusted',
        body: reason,
        metadata: { new_end_on, reason },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.coverage_adjust', subjectId: id });
    return presentOne(tx, updated);
  });
  res.json(result);
});

treatmentsRouter.post('/:id/renew-prescription', validateParams(treatmentParams), validateBody(prescriptionRenewInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:manage');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const { new_expiry } = req.body as z.infer<typeof prescriptionRenewInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findTreatment(tx, tenant, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const updated = await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { prescriptionExpiresOn: dateOnly(new_expiry) },
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: updated.patientId,
        treatmentId: updated.id,
        type: 'prescription_renewed',
        body: '',
        metadata: { new_expiry },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.prescription_renew', subjectId: id });
    return presentOne(tx, updated);
  });
  res.json(result);
});

function deliveryIdempotencyKey(req: Request): string | null {
  const raw = req.header('idempotency-key')?.trim();
  if (!raw) return null;
  if (raw.length > 200) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be at most 200 characters');
  return raw;
}

async function replayDelivery(
  tx: Tx,
  tenant: NonNullable<Express.Request['tenant']>,
  treatment: Prisma.TreatmentGetPayload<object>,
  key: string,
  id: string,
) {
  const existing = await tx.delivery.findFirst({ where: { idempotencyKey: key } });
  if (!existing) return null;
  if (existing.treatmentId !== id) {
    throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for another treatment');
  }
  const settings = await settingFor(tx, tenant.organizationId);
  const nextCycle = await openCycleFor(tx, id);
  return {
    ...present(treatment, nextCycle, settings),
    delivery: existing,
    next_cycle: nextCycle,
    idempotent_replay: true,
  };
}

treatmentsRouter.post('/:id/deliver', validateParams(treatmentParams), validateBody(deliveryInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const input = req.body as z.infer<typeof deliveryInput>;
  const key = deliveryIdempotencyKey(req);
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (treatment.status !== 'active') throw new ApiError(409, 'INVALID_STATUS', 'Only active treatments can receive deliveries');
    if (key) {
      const replay = await replayDelivery(tx, tenant, treatment, key, id);
      if (replay) return replay;
    }
    const open = await tx.refillCycle.findFirst({
      where: { treatmentId: id, closedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!open) throw new ApiError(409, 'NO_OPEN_CYCLE', 'Treatment has no open refill cycle');
    const deliveredOn = dateOnly(input.delivered_on);
    const coverageEndOn = calculateCoverageEndOn({
      startDate: treatment.startDate,
      quantityPerCycle: treatment.quantityPerCycle.toString(),
      dosePerIntake: treatment.dosePerIntake.toString(),
      intakesPerDay: treatment.intakesPerDay.toString(),
      lastDeliveryOn: deliveredOn,
      lastDeliveryQuantity: input.quantity,
      coverageManuallyAdjusted: false,
    });
    const delivery = await tx.delivery.create({
      data: {
        organizationId: tenant.organizationId,
        treatmentId: id,
        cycleId: open.id,
        branchId: treatment.branchId,
        quantity: input.quantity,
        deliveredOn,
        deliveredBy: tenant.userId,
        pickedUpBy: input.picked_up_by,
        pickedUpByName: input.picked_up_by_name ?? null,
        notes: input.notes ?? null,
        idempotencyKey: key,
      } as Prisma.DeliveryUncheckedCreateInput,
    });
    await tx.refillCycle.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id: open.id } },
      // Any cycle change bumps version so stale board clients get a 409.
      data: { status: 'delivered', closedAt: new Date(), version: { increment: 1 } },
    });
    const updated = await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: {
        lastDeliveryOn: deliveredOn,
        coverageEndOn,
        coverageManuallyAdjusted: false,
        coverageAdjustReason: null,
      },
    });
    const settings = await settingFor(tx, tenant.organizationId);
    const nextCycle = await tx.refillCycle.create({
      data: {
        organizationId: tenant.organizationId,
        treatmentId: id,
        branchId: treatment.branchId,
        status: 'to_notify',
        expectedOn: coverageEndOn,
        expectedQuantity: treatment.quantityPerCycle,
        suggestedNoticeOn: subtractDays(coverageEndOn, settings.noticeLeadDays),
      } as Prisma.RefillCycleUncheckedCreateInput,
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: treatment.patientId,
        treatmentId: id,
        cycleId: open.id,
        type: 'delivery',
        body: '',
        metadata: {
          delivery_id: delivery.id,
          quantity: input.quantity,
          delivered_on: input.delivered_on,
          picked_up_by: input.picked_up_by,
          next_cycle_id: nextCycle.id,
        },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.deliver', subjectId: id });
    await fireEvent(tx, tenant.organizationId, 'cycle_delivered', { patientId: treatment.patientId, treatmentId: id, cycleId: open.id });
    return {
      ...present(updated, { ...nextCycle, _count: { deliveries: 0 } }, settings),
      delivery,
      next_cycle: nextCycle,
      idempotent_replay: false,
    };
  });
  res.status(result.idempotent_replay ? 200 : 201).json(result);
});

treatmentsRouter.get('/:id/notice-preview', validateParams(treatmentParams), validateQuery(noticePreviewQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const query = res.locals.validatedQuery as z.infer<typeof noticePreviewQuery>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const [patient, medication, branch, organization, cycle] = await Promise.all([
      tx.patient.findFirst({ where: { id: treatment.patientId } }),
      tx.medication.findFirst({ where: { id: treatment.medicationId } }),
      tx.branch.findFirst({ where: { id: treatment.branchId } }),
      tx.organization.findUnique({ where: { id: tenant.organizationId } }),
      openCycleFor(tx, id),
    ]);
    if (!patient || !medication) throw new ApiError(404, 'NOT_FOUND', 'Patient or medication not found');
    const channel = query.channel ?? (patient.preferredChannel === 'whatsapp' ? 'whatsapp' : 'call');
    const template = await tx.messageTemplate.findFirst({
      where: { channel, kind: 'refill_notice', isActive: true, branchId: treatment.branchId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    }) ?? await tx.messageTemplate.findFirst({
      where: { channel, kind: 'refill_notice', isActive: true, branchId: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    const noticeDate = cycle?.expectedOn ?? treatment.coverageEndOn ?? treatment.startDate;
    const medicationName = medication.brandName ?? medication.genericName ?? medication.activeIngredient ?? medication.presentation;
    const body = renderNoticeTemplate(template?.body ?? defaultNoticeBody(channel), {
      patient: patient.fullName,
      medication: medicationName,
      date: noticeDate.toISOString().slice(0, 10),
      pharmacy: branch?.name ?? organization?.name ?? '',
    });
    const phone = normalizePhone(patient.phone);
    return {
      treatment_id: id,
      channel,
      template_id: template?.id ?? null,
      template_name: template?.name ?? null,
      body,
      template_body: template?.body ?? null,
      notice_date: noticeDate.toISOString().slice(0, 10),
      phone,
      wa_me_url: waMeUrl(phone, body),
      tel_url: phone ? `tel:+${phone}` : null,
      patient_consent: {
        reminder_consent: patient.reminderConsent,
        preferred_channel: patient.preferredChannel,
      },
      consent_warning: patient.reminderConsent ? null : 'El paciente no tiene consentimiento registrado para recordatorios.',
    };
  });
  res.json(result);
});

treatmentsRouter.post('/:id/notice-logged', validateParams(treatmentParams), validateBody(noticeLoggedInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const { channel } = req.body as z.infer<typeof noticeLoggedInput>;
  const activity = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const openCycle = await tx.refillCycle.findFirst({
      where: { treatmentId: id, closedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const movedCycle = openCycle?.status === 'to_notify'
      ? await tx.refillCycle.update({
        where: { organizationId_id: { organizationId: tenant.organizationId, id: openCycle.id } },
        data: { status: 'notified', noticeAttempts: { increment: 1 }, version: { increment: 1 } },
      })
      : openCycle
        ? await tx.refillCycle.update({
          where: { organizationId_id: { organizationId: tenant.organizationId, id: openCycle.id } },
          data: { noticeAttempts: { increment: 1 }, version: { increment: 1 } },
        })
        : null;
    const created = await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: treatment.patientId,
        treatmentId: id,
        ...(movedCycle ? { cycleId: movedCycle.id } : {}),
        type: channel === 'call' ? 'call' : 'notice',
        body: channel === 'call' ? 'Llamada de aviso abierta' : 'Aviso por WhatsApp abierto',
        metadata: { channel, logged: true, ...(movedCycle ? { cycle_status: movedCycle.status, notice_attempts: movedCycle.noticeAttempts } : {}) },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.notice_logged', subjectId: id });
    return created;
  });
  res.status(201).json(activity);
});

const pauseInput = z.object({ paused: z.boolean(), reason: z.string().trim().max(500).nullable().optional() }).strict();

/** Pauses or resumes automatic notices for one treatment. Pausing also cancels what was already waiting to go out. */
treatmentsRouter.patch('/:id/automation', validateParams(treatmentParams), validateBody(pauseInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const input = req.body as z.infer<typeof pauseInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    await tx.treatment.update({ where: { organizationId_id: { organizationId: tenant.organizationId, id } }, data: { automationPaused: input.paused } });
    const cancelled = input.paused
      ? (await tx.outboxMessage.updateMany({ where: { treatmentId: id, status: 'pending' }, data: { status: 'cancelled', cancelledAt: new Date(), lastError: 'automation_paused' } })).count
      : 0;
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId, patientId: treatment.patientId, treatmentId: id, type: 'treatment_updated',
        body: input.paused ? 'Avisos automáticos pausados' : 'Avisos automáticos reanudados',
        metadata: { automation_paused: input.paused, ...(input.paused && input.reason ? { reason: input.reason } : {}) }, authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: input.paused ? 'treatment.automation.pause' : 'treatment.automation.resume', subjectId: id, metadata: { cancelled } });
    return { id, automationPaused: input.paused, cancelled_messages: cancelled };
  });
  res.json(result);
});
