import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody } from '../../infra/validate.js';
import { pipelineUpdate } from '../../schemas/pipeline.js';
import { record } from '../audit/record.js';

export const pipelinesRouter = Router();
pipelinesRouter.use(resolveTenant);

type Tx = Prisma.TransactionClient;
const KEY = 'refill_cycles';

const defaults = [
  { systemStatus: 'to_notify', name: 'Por avisar', color: '#2563eb' },
  { systemStatus: 'notified', name: 'Avisado', color: '#d97706' },
  { systemStatus: 'confirmed', name: 'Confirmado', color: '#0d9488' },
  { systemStatus: 'prepared', name: 'Preparado', color: '#7c3aed' },
  { systemStatus: 'closed', name: 'Entregado / No retirado', color: '#475569' },
] as const;

/** Board column a cycle sits in; `closed` groups delivered and not-picked-up. Cancelled cycles have none. */
export const columnOf = (status: string) => (status === 'delivered' || status === 'not_picked_up' ? 'closed' : status === 'cancelled' ? null : status);

/**
 * Cycles per stage. A cycle belongs to the stage it points at when that stage is under the cycle's current
 * column; otherwise (no stage, or a stale one from before a status change) to the first stage of its column.
 */
async function stageCounts(tx: Tx, stages: { id: string; systemStatus: string }[]) {
  const groups = await tx.refillCycle.groupBy({ by: ['status', 'stageId'], _count: { _all: true } });
  const counts: Record<string, number> = {};
  for (const { status, stageId, _count } of groups) {
    const column = columnOf(status);
    if (!column) continue;
    const chosen = stages.find((stage) => stage.id === stageId && stage.systemStatus === column) ?? stages.find((stage) => stage.systemStatus === column);
    if (chosen) counts[chosen.id] = (counts[chosen.id] ?? 0) + _count._all;
  }
  return counts;
}

async function load(tx: Tx, organizationId: string) {
  let pipeline = await tx.pipeline.findFirst({ where: { key: KEY }, include: { stages: { orderBy: { position: 'asc' } } } });
  if (!pipeline) {
    pipeline = await tx.pipeline.create({
      data: {
        organizationId, key: KEY, name: 'Ciclos de reposición', description: 'Seguimiento de cada reposición de medicamentos.',
        stages: { create: defaults.map((stage, position) => ({ organizationId, ...stage, position })) },
      },
      include: { stages: { orderBy: { position: 'asc' } } },
    });
  }
  const counts = await stageCounts(tx, pipeline.stages);
  return {
    id: pipeline.id,
    key: pipeline.key,
    name: pipeline.name,
    description: pipeline.description,
    stages: pipeline.stages.map((stage) => ({
      id: stage.id,
      system_status: stage.systemStatus,
      name: stage.name,
      description: stage.description,
      color: stage.color,
      position: stage.position,
      cycle_count: counts[stage.id] ?? 0,
    })),
  };
}

// Any signed-in member can read it: the board uses it for column titles and colours.
pipelinesRouter.get('/refill-cycles', async (req, res) => {
  const tenant = req.tenant!;
  res.json(await withTenant(tenant.organizationId, (tx) => load(tx, tenant.organizationId)));
});

/**
 * Stages are labels inside the fixed cycle statuses (the board columns): any number can sit under one status,
 * and cycles keep their status and derived state whatever stage they are in. The update lists every stage that
 * should remain; an existing stage left out is deleted, a stage without id is created under its system status.
 * Guards: a stage that holds cycles cannot be deleted, and each status keeps at least one stage.
 */
pipelinesRouter.put('/refill-cycles', (req, _res, next) => {
  if (!puede(req.tenant!.role, 'settings:write')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  next();
}, validateBody(pipelineUpdate), async (req, res) => {
  const tenant = req.tenant!;
  const input = req.body as z.infer<typeof pipelineUpdate>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const current = await load(tx, tenant.organizationId);
    const byId = new Map(current.stages.map((stage) => [stage.id, stage]));
    const sentIds = input.stages.flatMap((stage) => (stage.id ? [stage.id] : []));
    if (new Set(sentIds).size !== sentIds.length || sentIds.some((id) => !byId.has(id))) {
      throw new ApiError(400, 'UNKNOWN_STAGE', 'La lista incluye una etapa que no existe o repetida');
    }
    const names = input.stages.map((stage) => stage.name.toLocaleLowerCase());
    if (new Set(names).size !== names.length) throw new ApiError(400, 'DUPLICATE_STAGE_NAME', 'Dos etapas no pueden tener el mismo nombre');
    const statusOf = (stage: (typeof input.stages)[number]) => (stage.id ? byId.get(stage.id)!.system_status : stage.system_status);
    if (input.stages.some((stage) => !statusOf(stage))) {
      throw new ApiError(400, 'STAGE_STATUS_REQUIRED', 'Una etapa nueva necesita la columna a la que pertenece');
    }
    for (const status of defaults.map((item) => item.systemStatus)) {
      if (!input.stages.some((stage) => statusOf(stage) === status)) {
        throw new ApiError(409, 'LAST_STAGE', 'Cada columna necesita al menos una etapa.');
      }
    }
    const removed = current.stages.filter((stage) => !sentIds.includes(stage.id));
    for (const stage of removed) {
      if (stage.cycle_count > 0) {
        throw new ApiError(409, 'STAGE_IN_USE', `La etapa «${stage.name}» tiene ${stage.cycle_count} ciclos. Muévelos a otra etapa antes de borrarla.`);
      }
    }
    if (removed.length) {
      // Cycles that only point at it through an old status are released first (the foreign key would refuse otherwise).
      await tx.refillCycle.updateMany({ where: { stageId: { in: removed.map((stage) => stage.id) } }, data: { stageId: null } });
      await tx.pipelineStage.deleteMany({ where: { id: { in: removed.map((stage) => stage.id) } } });
    }
    await tx.pipeline.update({ where: { id: current.id }, data: { name: input.name, description: input.description ?? null } });
    for (const [position, stage] of input.stages.entries()) {
      const data = { name: stage.name, description: stage.description ?? null, color: stage.color, position };
      if (stage.id) await tx.pipelineStage.update({ where: { id: stage.id }, data });
      else await tx.pipelineStage.create({ data: { ...data, organizationId: tenant.organizationId, pipelineId: current.id, systemStatus: stage.system_status! } });
    }
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'pipeline.update', subjectId: current.id });
    return load(tx, tenant.organizationId);
  });
  res.json(result);
});
