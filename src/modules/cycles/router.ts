import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { canAccessBranch } from '../../infra/patient-access.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import { cycleParams } from '../../schemas/delivery.js';
import { cycleExpectedOnInput, cycleListQuery, cycleMoveInput } from '../../schemas/board.js';
import { validateCycleMove } from '../../domain/cycleTransitions.js';
import { branchScope, dateOnly, loadCycleCard, settingsFor, tableData, todayOnly } from '../board/service.js';
import { resolveInsertion } from '../board/positions.js';

export const cyclesRouter = Router();
cyclesRouter.use(resolveTenant);

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

async function findCycle(tx: Prisma.TransactionClient, tenant: NonNullable<Express.Request['tenant']>, id: string) {
  const cycle = await tx.refillCycle.findFirst({
    where: { id },
    include: { treatment: { select: { id: true, patientId: true, status: true } } },
  });
  if (!cycle) return null;
  if (!await canAccessBranch(tx, tenant, cycle.branchId)) return null;
  return cycle;
}

cyclesRouter.get('/', validateQuery(cycleListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const query = res.locals.validatedQuery as z.infer<typeof cycleListQuery>;
  res.json(await tableData(tenant, query));
});

cyclesRouter.post('/:id/mark-prepared', validateParams(cycleParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const { id } = res.locals.validatedParams as z.infer<typeof cycleParams>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const cycle = await findCycle(tx, tenant, id);
    if (!cycle) throw new ApiError(404, 'NOT_FOUND', 'Refill cycle not found');
    if (cycle.closedAt) throw new ApiError(409, 'INVALID_STATUS', 'Closed cycles cannot be marked as prepared');
    if (cycle.treatment.status !== 'active') throw new ApiError(409, 'INVALID_STATUS', 'Treatment is not active');
    const updated = await tx.refillCycle.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { status: 'prepared', version: { increment: 1 } },
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: cycle.treatment.patientId,
        treatmentId: cycle.treatment.id,
        cycleId: cycle.id,
        type: 'treatment_updated',
        body: 'Ciclo marcado como preparado',
        metadata: { cycle_status: 'prepared' },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'cycle.mark_prepared', subjectId: id });
    return updated;
  });
  res.json(result);
});

cyclesRouter.post('/:id/mark-not-picked-up', validateParams(cycleParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const { id } = res.locals.validatedParams as z.infer<typeof cycleParams>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const cycle = await findCycle(tx, tenant, id);
    if (!cycle) throw new ApiError(404, 'NOT_FOUND', 'Refill cycle not found');
    if (cycle.closedAt) throw new ApiError(409, 'INVALID_STATUS', 'Cycle is already closed');
    const updated = await tx.refillCycle.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { status: 'not_picked_up', closedAt: new Date(), version: { increment: 1 } },
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: cycle.treatment.patientId,
        treatmentId: cycle.treatment.id,
        cycleId: cycle.id,
        type: 'treatment_updated',
        body: 'Ciclo marcado como no retirado',
        metadata: { cycle_status: 'not_picked_up' },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'cycle.mark_not_picked_up', subjectId: id });
    return updated;
  });
  res.json(result);
});
cyclesRouter.post('/:id/move', validateParams(cycleParams), validateBody(cycleMoveInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'cycle:move');
  const { id } = res.locals.validatedParams as z.infer<typeof cycleParams>;
  const input = req.body as z.infer<typeof cycleMoveInput>;

  const result = await withTenant(tenant.organizationId, async (tx) => {
    const cycle = await tx.refillCycle.findFirst({
      where: { AND: [{ id }, await branchScope(tx, tenant)] },
      include: { treatment: { select: { id: true, patientId: true, status: true, medicationId: true } } },
    });
    if (!cycle) throw new ApiError(404, 'NOT_FOUND', 'Refill cycle not found');
    const settings = await settingsFor(tx, tenant.organizationId);
    const today = todayOnly();

    if (cycle.version !== input.expected_version) {
      const card = await loadCycleCard(tx, tenant, id, settings, today);
      throw new ApiError(409, 'STALE_VERSION', 'The cycle was changed by someone else', undefined, { card });
    }
    if (cycle.closedAt || ['delivered', 'not_picked_up', 'cancelled'].includes(cycle.status)) {
      throw new ApiError(409, 'CYCLE_CLOSED', 'Closed cycles cannot be moved');
    }
    const validation = validateCycleMove(cycle.status, input.to_status);
    if (!validation.ok) throw new ApiError(validation.status, validation.code, validation.message);

    const warnings: Array<{ code: string; message: string }> = [];
    // Stock only gates the prepared column; other moves must stay cheap.
    const mark = validation.to === 'prepared'
      ? await tx.medicationStockMark.findFirst({
        where: { branchId: cycle.branchId, medicationId: cycle.treatment.medicationId },
      })
      : null;
    if (mark) {
      if (mark.level === 'out_of_stock' && !input.confirm_out_of_stock) {
        throw new ApiError(422, 'STOCK_OUT_OF_STOCK', 'Stock is out for this medication; confirm to move anyway', undefined, {
          branch_id: cycle.branchId,
          medication_id: cycle.treatment.medicationId,
          level: mark.level,
          reviewed_at: mark.reviewedAt.toISOString(),
          reviewed_by: mark.reviewedBy,
        });
      }
      if (mark.level === 'low') warnings.push({ code: 'STOCK_LOW', message: 'Stock is marked as low' });
      if (Date.now() - mark.reviewedAt.getTime() > 7 * 24 * 60 * 60 * 1000) {
        warnings.push({ code: 'STOCK_STALE', message: 'Stock was reviewed more than 7 days ago' });
      }
    }

    const columnCards = await tx.refillCycle.findMany({
      where: { branchId: cycle.branchId, status: validation.to, id: { not: cycle.id } },
      select: { id: true, boardPosition: true },
      orderBy: [{ boardPosition: 'asc' }, { expectedOn: 'asc' }, { id: 'asc' }],
    });
    const insertion = resolveInsertion(columnCards, input.after_id, input.before_id);
    if ('error' in insertion) throw new ApiError(400, insertion.error, 'after_id and before_id must be neighbours in the target column');
    if (insertion.rebalanced) {
      for (const assignment of insertion.assignments) {
        await tx.refillCycle.update({
          where: { organizationId_id: { organizationId: tenant.organizationId, id: assignment.id } },
          // Rebalancing changes the visible order of these cards too.
          data: { boardPosition: assignment.position, version: { increment: 1 } },
        });
      }
    }

    const changed = await tx.refillCycle.updateMany({
      where: { id: cycle.id, version: input.expected_version },
      data: { status: validation.to, boardPosition: insertion.position, version: { increment: 1 } },
    });
    if (changed.count === 0) {
      const card = await loadCycleCard(tx, tenant, id, settings, today);
      throw new ApiError(409, 'STALE_VERSION', 'The cycle was changed by someone else', undefined, { card });
    }

    let incidentId: string | null = null;
    if (validation.to === 'prepared' && mark?.level === 'out_of_stock' && input.confirm_out_of_stock) {
      const openIncident = await tx.incident.findFirst({
        where: { cycleId: cycle.id, type: 'out_of_stock', status: { not: 'resolved' } },
        select: { id: true },
      });
      if (!openIncident) {
        const incident = await tx.incident.create({
          data: {
            organizationId: tenant.organizationId,
            branchId: cycle.branchId,
            patientId: cycle.treatment.patientId,
            treatmentId: cycle.treatment.id,
            cycleId: cycle.id,
            type: 'out_of_stock',
            status: 'new',
            description: 'Ciclo marcado como preparado sin existencias confirmadas',
            createdBy: tenant.userId,
          },
        });
        incidentId = incident.id;
        await tx.activity.create({
          data: {
            organizationId: tenant.organizationId,
            patientId: cycle.treatment.patientId,
            treatmentId: cycle.treatment.id,
            cycleId: cycle.id,
            type: 'incident',
            body: 'Incidencia por falta de existencias',
            metadata: { incident_id: incident.id, incident_type: 'out_of_stock' },
            authorId: tenant.userId,
          },
        });
        await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'incident.create', subjectId: incident.id });
      }
    }

    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: cycle.treatment.patientId,
        treatmentId: cycle.treatment.id,
        cycleId: cycle.id,
        type: 'cycle_moved',
        body: '',
        metadata: { from: cycle.status, to: validation.to },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'cycle.move', subjectId: cycle.id });
    const card = await loadCycleCard(tx, tenant, id, settings, today);
    if (!card) throw new ApiError(404, 'NOT_FOUND', 'Refill cycle not found');
    return { ...card, card, warnings, incident_id: incidentId };
  });
  res.json(result);
});

cyclesRouter.patch('/:id/expected-on', validateParams(cycleParams), validateBody(cycleExpectedOnInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'cycle:edit-date');
  const { id } = res.locals.validatedParams as z.infer<typeof cycleParams>;
  const input = req.body as z.infer<typeof cycleExpectedOnInput>;

  const result = await withTenant(tenant.organizationId, async (tx) => {
    const cycle = await tx.refillCycle.findFirst({
      where: { AND: [{ id }, await branchScope(tx, tenant)] },
      include: { treatment: { select: { id: true, patientId: true } } },
    });
    if (!cycle) throw new ApiError(404, 'NOT_FOUND', 'Refill cycle not found');
    const settings = await settingsFor(tx, tenant.organizationId);
    const today = todayOnly();
    if (cycle.version !== input.expected_version) {
      const card = await loadCycleCard(tx, tenant, id, settings, today);
      throw new ApiError(409, 'STALE_VERSION', 'The cycle was changed by someone else', undefined, { card });
    }
    if (cycle.closedAt || ['delivered', 'not_picked_up', 'cancelled'].includes(cycle.status)) {
      throw new ApiError(409, 'CYCLE_CLOSED', 'Closed cycles cannot be edited');
    }
    const expectedOn = dateOnly(input.expected_on);
    const changed = await tx.refillCycle.updateMany({
      where: { id: cycle.id, version: input.expected_version },
      data: { expectedOn, version: { increment: 1 } },
    });
    if (changed.count === 0) {
      const card = await loadCycleCard(tx, tenant, id, settings, today);
      throw new ApiError(409, 'STALE_VERSION', 'The cycle was changed by someone else', undefined, { card });
    }
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: cycle.treatment.patientId,
        treatmentId: cycle.treatment.id,
        cycleId: cycle.id,
        type: 'treatment_updated',
        body: input.reason ?? '',
        metadata: {
          expected_on: input.expected_on,
          previous_expected_on: cycle.expectedOn.toISOString().slice(0, 10),
          ...(input.reason ? { reason: input.reason } : {}),
        },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'cycle.edit_date', subjectId: cycle.id });
    const card = await loadCycleCard(tx, tenant, id, settings, today);
    if (!card) throw new ApiError(404, 'NOT_FOUND', 'Refill cycle not found');
    return card;
  });
  res.json(result);
});
