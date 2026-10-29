import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { accessibleBranchIds, requiredBranchScope } from '../../infra/branch-scope.js';
import { ApiError } from '../../infra/errors.js';
import { canAccessBranch, findAccessiblePatient } from '../../infra/patient-access.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import {
  incidentCreate, incidentListQuery, incidentMoveInput, incidentParams,
  incidentPatch, incidentResolveInput,
} from '../../schemas/incident.js';
import { record } from '../audit/record.js';
import { resolveInsertion } from '../board/positions.js';
import { branchScope, incidentBranchScope } from '../board/service.js';

export const incidentsRouter = Router();
incidentsRouter.use(resolveTenant);

type Tx = Prisma.TransactionClient;
type Tenant = NonNullable<Express.Request['tenant']>;

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

const orderBy: Prisma.IncidentOrderByWithRelationInput[] = [
  { boardPosition: { sort: 'asc', nulls: 'last' } },
  { createdAt: 'asc' },
  { id: 'asc' },
];

/** Names the web needs to render an incident card without extra requests. */
const incidentInclude = {
  branch: { select: { id: true, name: true, labelColor: true } },
  patient: { select: { id: true, fullName: true } },
  assignee: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
} satisfies Prisma.IncidentInclude;

async function findIncident(tx: Tx, tenant: Tenant, id: string) {
  return tx.incident.findFirst({
    where: { AND: [{ id }, await incidentBranchScope(tx, tenant)] },
    include: incidentInclude,
  });
}

async function assertMember(tx: Tx, organizationId: string, userId?: string | null) {
  if (!userId) return;
  const member = await tx.member.findFirst({ where: { organizationId, userId }, select: { id: true } });
  if (!member) throw new ApiError(400, 'INVALID_ASSIGNED_USER', 'Assigned user must belong to this organization');
}

async function assertRefs(
  tx: Tx,
  tenant: Tenant,
  input: {
    branch_id?: string | undefined;
    patient_id?: string | null | undefined;
    treatment_id?: string | null | undefined;
    cycle_id?: string | null | undefined;
    assigned_to?: string | null | undefined;
  },
) {
  if (input.branch_id && !await canAccessBranch(tx, tenant, input.branch_id)) {
    throw new ApiError(404, 'NOT_FOUND', 'Branch not found');
  }
  if (input.patient_id && !await findAccessiblePatient(tx, tenant, input.patient_id)) {
    throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
  }
  if (input.treatment_id) {
    const treatment = await tx.treatment.findFirst({
      where: { AND: [{ id: input.treatment_id }, await requiredBranchScope(tx, tenant)] },
      select: { id: true },
    });
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
  }
  if (input.cycle_id) {
    const cycle = await tx.refillCycle.findFirst({
      where: { AND: [{ id: input.cycle_id }, await branchScope(tx, tenant)] },
      select: { id: true, branchId: true },
    });
    if (!cycle) throw new ApiError(404, 'NOT_FOUND', 'Refill cycle not found');
    if (input.branch_id && cycle.branchId !== input.branch_id) {
      throw new ApiError(400, 'BRANCH_MISMATCH', 'The cycle belongs to another branch');
    }
  }
  await assertMember(tx, tenant.organizationId, input.assigned_to);
}

function activityData(incident: { id: string; patientId: string | null; treatmentId: string | null; cycleId: string | null; type: string; status: string }, tenant: Tenant, body: string, metadata: Prisma.InputJsonObject) {
  return {
    organizationId: tenant.organizationId,
    patientId: incident.patientId!,
    ...(incident.treatmentId ? { treatmentId: incident.treatmentId } : {}),
    ...(incident.cycleId ? { cycleId: incident.cycleId } : {}),
    type: 'incident' as const,
    body,
    metadata,
    authorId: tenant.userId,
  };
}

incidentsRouter.get('/', validateQuery(incidentListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const query = res.locals.validatedQuery as z.infer<typeof incidentListQuery>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const ids = await accessibleBranchIds(tx, tenant);
    if (ids !== null && ids.length === 0) return { data: [], next_cursor: null };
    const where: Prisma.IncidentWhereInput = {
      AND: [
        ...(query.branch_id ? [{ branchId: query.branch_id }] : []),
        ...(ids === null ? [] : [{ branchId: { in: ids } }]),
        ...(query.status ? [{ status: query.status }] : []),
        ...(query.type ? [{ type: query.type }] : []),
        ...(query.assigned_to ? [{ assignedTo: query.assigned_to }] : []),
      ],
    };
    const rows = await tx.incident.findMany({
      where,
      orderBy,
      include: incidentInclude,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { organizationId_id: { organizationId: tenant.organizationId, id: query.cursor } }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return { data, next_cursor: hasMore ? data.at(-1)!.id : null };
  });
  res.json(result);
});

incidentsRouter.get('/:id', validateParams(incidentParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const { id } = res.locals.validatedParams as z.infer<typeof incidentParams>;
  const incident = await withTenant(tenant.organizationId, (tx) => findIncident(tx, tenant, id));
  if (!incident) throw new ApiError(404, 'NOT_FOUND', 'Incident not found');
  res.json(incident);
});

incidentsRouter.post('/', validateBody(incidentCreate), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'incident:create');
  const input = req.body as z.infer<typeof incidentCreate>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    await assertRefs(tx, tenant, input);
    // One open incident per cycle and type (also enforced by a partial unique index).
    if (input.cycle_id && await tx.incident.findFirst({ where: { cycleId: input.cycle_id, type: input.type, status: { not: 'resolved' } }, select: { id: true } })) {
      throw new ApiError(409, 'DUPLICATE_INCIDENT', 'Este ciclo ya tiene una incidencia abierta de ese tipo');
    }
    const incident = await tx.incident.create({
      data: {
        organizationId: tenant.organizationId,
        branchId: input.branch_id,
        type: input.type,
        status: input.status ?? 'new',
        patientId: input.patient_id ?? null,
        treatmentId: input.treatment_id ?? null,
        cycleId: input.cycle_id ?? null,
        assignedTo: input.assigned_to ?? null,
        description: input.description,
        createdBy: tenant.userId,
      },
      include: incidentInclude,
    });
    if (incident.patientId) {
      await tx.activity.create({
        data: activityData(incident, tenant, incident.description, { incident_id: incident.id, incident_type: incident.type, status: incident.status }),
      });
    }
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'incident.create', subjectId: incident.id });
    return incident;
  });
  res.status(201).json(result);
});

incidentsRouter.patch('/:id', validateParams(incidentParams), validateBody(incidentPatch), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'incident:move');
  const { id } = res.locals.validatedParams as z.infer<typeof incidentParams>;
  const input = req.body as z.infer<typeof incidentPatch>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findIncident(tx, tenant, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Incident not found');
    if (existing.status === 'resolved') throw new ApiError(409, 'INCIDENT_CLOSED', 'Resolved incidents cannot be edited');
    await assertRefs(tx, tenant, input);
    const updated = await tx.incident.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: {
        ...(input.branch_id ? { branchId: input.branch_id } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.patient_id !== undefined ? { patientId: input.patient_id } : {}),
        ...(input.treatment_id !== undefined ? { treatmentId: input.treatment_id } : {}),
        ...(input.cycle_id !== undefined ? { cycleId: input.cycle_id } : {}),
        ...(input.assigned_to !== undefined ? { assignedTo: input.assigned_to } : {}),
        ...(input.description ? { description: input.description } : {}),
      },
      include: incidentInclude,
    });
    if (updated.patientId) {
      await tx.activity.create({
        data: activityData(updated, tenant, input.description ?? '', { fields: Object.keys(input) }),
      });
    }
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'incident.update', subjectId: id });
    return updated;
  });
  res.json(result);
});

incidentsRouter.post('/:id/move', validateParams(incidentParams), validateBody(incidentMoveInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'incident:move');
  const { id } = res.locals.validatedParams as z.infer<typeof incidentParams>;
  const input = req.body as z.infer<typeof incidentMoveInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findIncident(tx, tenant, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Incident not found');
    if (input.to_status === 'resolved') {
      throw new ApiError(400, 'RESOLVE_ENDPOINT_REQUIRED', 'Incidents are resolved through POST /incidents/:id/resolve');
    }
    if (existing.status === 'resolved') throw new ApiError(409, 'INCIDENT_CLOSED', 'Resolved incidents cannot be moved');

    const cards = await tx.incident.findMany({
      where: { branchId: existing.branchId, status: input.to_status, id: { not: existing.id } },
      select: { id: true, boardPosition: true },
      orderBy,
    });
    const insertion = resolveInsertion(cards, input.after_id, input.before_id);
    if ('error' in insertion) throw new ApiError(400, insertion.error, 'after_id and before_id must be neighbours in the target column');
    if (insertion.rebalanced) {
      for (const assignment of insertion.assignments) {
        await tx.incident.update({
          where: { organizationId_id: { organizationId: tenant.organizationId, id: assignment.id } },
          data: { boardPosition: assignment.position },
        });
      }
    }
    const updated = await tx.incident.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { status: input.to_status, boardPosition: insertion.position },
      include: incidentInclude,
    });
    if (updated.patientId) {
      await tx.activity.create({
        data: activityData(updated, tenant, '', { from: existing.status, to: input.to_status }),
      });
    }
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'incident.move', subjectId: id });
    return updated;
  });
  res.json(result);
});

incidentsRouter.post('/:id/resolve', validateParams(incidentParams), validateBody(incidentResolveInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'incident:resolve');
  const { id } = res.locals.validatedParams as z.infer<typeof incidentParams>;
  const { resolution } = req.body as z.infer<typeof incidentResolveInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findIncident(tx, tenant, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Incident not found');
    if (existing.status === 'resolved') throw new ApiError(409, 'INCIDENT_CLOSED', 'Incident is already resolved');
    const updated = await tx.incident.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { status: 'resolved', resolution, resolvedAt: new Date(), boardPosition: null },
      include: incidentInclude,
    });
    if (updated.patientId) {
      await tx.activity.create({
        data: activityData(updated, tenant, resolution, { resolution, status: 'resolved' }),
      });
    }
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'incident.resolve', subjectId: id });
    return updated;
  });
  res.json(result);
});
