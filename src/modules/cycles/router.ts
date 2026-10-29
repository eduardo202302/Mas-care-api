import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { canAccessBranch, findAccessiblePatient } from '../../infra/patient-access.js';
import { requiredBranchScope } from '../../infra/branch-scope.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import { cycleParams } from '../../schemas/delivery.js';
import { cycleBatchInput, cycleCreateInput, cycleExpectedOnInput, cycleListQuery, cycleMoveInput, eligibleTreatmentsQuery } from '../../schemas/board.js';
import { validateCycleMove } from '../../domain/cycleTransitions.js';
import { branchScope, dateOnly, loadCycleCard, settingsFor, tableData, todayOnly } from '../board/service.js';
import { resolveInsertion } from '../board/positions.js';
import { columnOf } from '../pipelines/router.js';

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

/** Puts the cycle in a stage of its current column (null = the column's first stage). Status and version do not change. */
cyclesRouter.patch('/:id/stage', validateParams(cycleParams), validateBody(z.object({ stage_id: z.string().min(1).nullable() }).strict()), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'cycle:move');
  const { id } = res.locals.validatedParams as z.infer<typeof cycleParams>;
  const { stage_id: stageId } = req.body as { stage_id: string | null };
  await withTenant(tenant.organizationId, async (tx) => {
    const cycle = await findCycle(tx, tenant, id);
    if (!cycle) throw new ApiError(404, 'NOT_FOUND', 'Refill cycle not found');
    const column = columnOf(cycle.status);
    if (!column) throw new ApiError(409, 'CYCLE_CANCELLED', 'Un ciclo cancelado no tiene etapa');
    if (stageId) {
      const stage = await tx.pipelineStage.findFirst({ where: { id: stageId } });
      if (!stage || stage.systemStatus !== column) throw new ApiError(400, 'STAGE_NOT_IN_COLUMN', 'La etapa no pertenece a la columna actual del ciclo');
    }
    await tx.refillCycle.update({ where: { organizationId_id: { organizationId: tenant.organizationId, id } }, data: { stageId } });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'cycle.stage', subjectId: id });
  });
  res.json({ cycle_id: id, stage_id: stageId });
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

const OPEN = ['to_notify', 'notified', 'confirmed', 'prepared'] as const;

/** Active treatments that have no open cycle: the only ones a cycle can be created for. */
cyclesRouter.get('/eligible-treatments', validateQuery(eligibleTreatmentsQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const query = res.locals.validatedQuery as z.infer<typeof eligibleTreatmentsQuery>;
  const data = await withTenant(tenant.organizationId, async (tx) => {
    const rows = await tx.treatment.findMany({
      where: {
        AND: [
          { status: 'active', cycles: { none: { closedAt: null, status: { in: [...OPEN] } } } },
          await requiredBranchScope(tx, tenant),
          query.q ? { patient: { fullName: { contains: query.q, mode: 'insensitive' } } } : {},
        ],
      },
      include: {
        patient: { select: { id: true, fullName: true } },
        medication: { select: { genericName: true, brandName: true, presentation: true } },
        responsibleUser: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      patient: { id: row.patient.id, name: row.patient.fullName },
      medication: `${row.medication.genericName ?? row.medication.brandName ?? row.medication.presentation} ${row.medication.presentation}`.trim(),
      branch_id: row.branchId,
      quantity_per_cycle: row.quantityPerCycle.toString(),
      coverage_end_on: row.coverageEndOn ? row.coverageEndOn.toISOString().slice(0, 10) : null,
      responsible: row.responsibleUser ? { id: row.responsibleUser.id, name: row.responsibleUser.name } : null,
    }));
  });
  res.json({ data });
});

/**
 * A cycle is always born from a treatment; there are no loose cycles. When the
 * request carries a `treatment_id` it attaches to that existing treatment (the
 * eligible-treatments flow). Otherwise it creates the treatment inline from the
 * patient/medication/branch/quantity the form collected, so the person filling
 * "Nuevo Ciclo" never has to manage a separate treatment record. Dosing fields
 * aren't collected by that form, so they get the minimal default of once a day.
 */
cyclesRouter.post('/', validateBody(cycleCreateInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const input = req.body as z.infer<typeof cycleCreateInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const settings = await settingsFor(tx, tenant.organizationId);
    const today = todayOnly();
    let treatment = input.treatment_id
      ? await tx.treatment.findFirst({ where: { AND: [{ id: input.treatment_id }, await requiredBranchScope(tx, tenant)] } })
      : null;
    if (input.treatment_id && !treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (treatment) {
      if (treatment.status !== 'active') throw new ApiError(409, 'INVALID_STATUS', 'Only active treatments can have cycles');
      if (await tx.refillCycle.findFirst({ where: { treatmentId: treatment.id, closedAt: null, status: { in: [...OPEN] } } })) {
        throw new ApiError(409, 'OPEN_CYCLE_EXISTS', 'The treatment already has an open cycle');
      }
    } else {
      if (!await findAccessiblePatient(tx, tenant, input.patient_id!, { archivedAt: null })) {
        throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
      }
      if (!await canAccessBranch(tx, tenant, input.branch_id!)) throw new ApiError(404, 'NOT_FOUND', 'Branch not found');
      const medication = await tx.medication.findFirst({ where: { id: input.medication_id!, archivedAt: null }, select: { id: true } });
      if (!medication) throw new ApiError(400, 'INVALID_MEDICATION', 'Medication not found');
      if (input.responsible_user_id) {
        const member = await tx.member.findFirst({ where: { organizationId: tenant.organizationId, userId: input.responsible_user_id }, select: { id: true } });
        if (!member) throw new ApiError(400, 'INVALID_RESPONSIBLE_USER', 'Responsible user must belong to this organization');
      }
      treatment = await tx.treatment.create({
        data: {
          organizationId: tenant.organizationId,
          patientId: input.patient_id!,
          medicationId: input.medication_id!,
          branchId: input.branch_id!,
          name: input.name ?? null,
          responsibleUserId: input.responsible_user_id ?? null,
          dosePerIntake: 1,
          intakesPerDay: 1,
          quantityPerCycle: input.quantity_per_cycle!,
          startDate: today,
          status: 'active',
          statusChangedAt: new Date(),
          coverageEndOn: input.coverage_end_on ? dateOnly(input.coverage_end_on) : null,
          coverageManuallyAdjusted: Boolean(input.coverage_end_on),
        } as Prisma.TreatmentUncheckedCreateInput,
      });
      await tx.activity.create({
        data: {
          organizationId: tenant.organizationId, patientId: treatment.patientId, treatmentId: treatment.id,
          type: 'treatment_created', body: '', metadata: {}, authorId: tenant.userId,
        },
      });
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.create', subjectId: treatment.id });
    }
    const expectedOn = treatment.coverageEndOn ?? today;
    const cycle = await tx.refillCycle.create({
      data: {
        organizationId: tenant.organizationId,
        treatmentId: treatment.id,
        branchId: treatment.branchId,
        status: input.status,
        expectedOn,
        expectedQuantity: treatment.quantityPerCycle,
        suggestedNoticeOn: new Date(expectedOn.getTime() - settings.noticeLeadDays * 86_400_000),
        priority: input.priority ?? null,
        type: input.type ?? null,
      } as Prisma.RefillCycleUncheckedCreateInput,
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId, patientId: treatment.patientId, treatmentId: treatment.id, cycleId: cycle.id,
        type: 'treatment_updated', body: 'Ciclo creado desde el tablero', metadata: { created_cycle_id: cycle.id, status: input.status }, authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'cycle.create', subjectId: cycle.id });
    return loadCycleCard(tx, tenant, cycle.id, settings, today);
  });
  res.status(201).json(result);
});

/**
 * Batch actions over table selections. Always requires `confirm: true`; the
 * branch scope is applied to every id, closed cycles are skipped and reported.
 */
cyclesRouter.post('/batch', validateBody(cycleBatchInput), async (req, res) => {
  const tenant = req.tenant!;
  const input = req.body as z.infer<typeof cycleBatchInput>;
  requirePermission(tenant.role, input.action === 'change_stage' || input.action === 'archive' ? 'cycle:move' : 'treatments:write');
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const cycles = await tx.refillCycle.findMany({
      where: { AND: [{ id: { in: input.ids } }, await branchScope(tx, tenant)] },
      include: { treatment: { select: { id: true, patientId: true, medicationId: true } } },
    });
    const open = cycles.filter((cycle) => !cycle.closedAt && (OPEN as readonly string[]).includes(cycle.status));
    const skipped = input.ids.filter((id) => !open.some((cycle) => cycle.id === id));
    const userId = 'responsible_user_id' in input ? input.responsible_user_id : 'assigned_to' in input ? input.assigned_to : null;
    if (userId && !await tx.member.findFirst({ where: { organizationId: tenant.organizationId, userId }, select: { id: true } })) {
      throw new ApiError(400, 'INVALID_RESPONSIBLE_USER', 'User must belong to this organization');
    }
    const note = (cycle: (typeof open)[number], type: 'cycle_moved' | 'treatment_updated' | 'task', body: string, metadata: Prisma.InputJsonObject) =>
      tx.activity.create({
        data: {
          organizationId: tenant.organizationId, patientId: cycle.treatment.patientId, treatmentId: cycle.treatment.id,
          cycleId: cycle.id, type, body, metadata, authorId: tenant.userId,
        },
      });

    // Moving to Prepared needs stock; like a single move, out-of-stock cycles wait for explicit confirmation.
    let blocked: string[] = [];
    let toApply = open;
    if (input.action === 'change_stage' && input.to_status === 'prepared' && !input.confirm_out_of_stock) {
      const marks = await tx.medicationStockMark.findMany({
        where: { level: 'out_of_stock', OR: open.map((cycle) => ({ branchId: cycle.branchId, medicationId: cycle.treatment.medicationId })) },
        select: { branchId: true, medicationId: true },
      });
      const out = new Set(marks.map((mark) => `${mark.branchId}:${mark.medicationId}`));
      blocked = open.filter((cycle) => out.has(`${cycle.branchId}:${cycle.treatment.medicationId}`)).map((cycle) => cycle.id);
      toApply = open.filter((cycle) => !blocked.includes(cycle.id));
    }

    for (const cycle of toApply) {
      if (input.action === 'assign_responsible') {
        await tx.treatment.update({ where: { organizationId_id: { organizationId: tenant.organizationId, id: cycle.treatment.id } }, data: { responsibleUserId: input.responsible_user_id } });
        await tx.refillCycle.update({ where: { organizationId_id: { organizationId: tenant.organizationId, id: cycle.id } }, data: { version: { increment: 1 } } });
        await note(cycle, 'treatment_updated', 'Responsable cambiado por lote', { batch: true, responsible_user_id: input.responsible_user_id });
      } else if (input.action === 'change_stage') {
        await tx.refillCycle.update({
          where: { organizationId_id: { organizationId: tenant.organizationId, id: cycle.id } },
          data: { status: input.to_status, boardPosition: null, version: { increment: 1 } },
        });
        await note(cycle, 'cycle_moved', '', { batch: true, from: cycle.status, to: input.to_status });
      } else if (input.action === 'create_tasks') {
        await tx.task.create({
          data: {
            organizationId: tenant.organizationId, branchId: cycle.branchId, type: 'other', title: input.title, status: 'open',
            assignedTo: input.assigned_to ?? null, dueAt: input.due_on ? dateOnly(input.due_on) : null,
            patientId: cycle.treatment.patientId, treatmentId: cycle.treatment.id, cycleId: cycle.id,
          },
        });
        await note(cycle, 'task', input.title, { batch: true });
      } else {
        await tx.refillCycle.update({
          where: { organizationId_id: { organizationId: tenant.organizationId, id: cycle.id } },
          data: { status: 'cancelled', closedAt: new Date(), version: { increment: 1 } },
        });
        await note(cycle, 'treatment_updated', input.reason ?? 'Ciclo archivado por lote', { batch: true, cancelled: true });
      }
    }
    await record(tx, {
      organizationId: tenant.organizationId, actorId: tenant.userId, action: `cycle.batch.${input.action}`,
      metadata: { requested: input.ids.length, applied: toApply.length, skipped: skipped.length, blocked: blocked.length },
    });
    return { action: input.action, requested: input.ids.length, applied: toApply.length, skipped, blocked_out_of_stock: blocked };
  });
  res.json(result);
});
