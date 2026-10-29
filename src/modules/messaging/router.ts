import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { accessibleBranchIds } from '../../infra/branch-scope.js';
import { ApiError } from '../../infra/errors.js';
import { findAccessiblePatient } from '../../infra/patient-access.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { processInbound } from '../../jobs/processInbound.js';
import { record } from '../audit/record.js';

type Tenant = NonNullable<Express.Request['tenant']>;
const requirePermission = (tenant: Tenant, action: Parameters<typeof puede>[1]) => {
  if (!puede(tenant.role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};
const idParams = z.object({ id: z.string().min(1) });

// --- Outbox: the queue of automatic messages -----------------------------------------------

export const outboxRouter = Router();
outboxRouter.use(resolveTenant);

const outboxQuery = z.object({
  status: z.enum(['pending', 'sending', 'sent', 'failed', 'cancelled', 'dry_run']).optional(),
  branch_id: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
}).strict();

/** Rows limited to the branches the user can see (owner and admin see all). */
async function outboxScope(tx: Prisma.TransactionClient, tenant: Tenant): Promise<Prisma.OutboxMessageWhereInput> {
  const ids = await accessibleBranchIds(tx, tenant);
  return ids === null ? {} : { branchId: { in: ids } };
}

const outboxView = (row: Prisma.OutboxMessageGetPayload<{ include: { patient: { select: { id: true; fullName: true } }; template: { select: { id: true; name: true } } } }>) => ({
  id: row.id,
  status: row.status,
  channel: row.channel,
  attempt_number: row.attemptNumber,
  attempts: row.attempts,
  last_error: row.lastError,
  scheduled_for: row.scheduledFor,
  sent_at: row.sentAt,
  cancelled_at: row.cancelledAt,
  created_at: row.createdAt,
  branch_id: row.branchId,
  cycle_id: row.cycleId,
  patient: { id: row.patient.id, name: row.patient.fullName },
  template: { id: row.template.id, name: row.template.name },
});
const outboxInclude = { patient: { select: { id: true, fullName: true } }, template: { select: { id: true, name: true } } } as const;

outboxRouter.get('/', validateQuery(outboxQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant, 'outbox:view');
  const query = res.locals.validatedQuery as z.infer<typeof outboxQuery>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const rows = await tx.outboxMessage.findMany({
      where: { AND: [await outboxScope(tx, tenant), query.status ? { status: query.status } : {}, query.branch_id ? { branchId: query.branch_id } : {}] },
      include: outboxInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return { data: page.map(outboxView), next_cursor: hasMore ? page.at(-1)!.id : null };
  });
  res.json(result);
});

async function findOutbox(tx: Prisma.TransactionClient, tenant: Tenant, id: string) {
  const row = await tx.outboxMessage.findFirst({ where: { AND: [{ id }, await outboxScope(tx, tenant)] } });
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Outbox message not found');
  return row;
}

outboxRouter.post('/:id/cancel', validateParams(idParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant, 'outbox:retry');
  const { id } = res.locals.validatedParams as z.infer<typeof idParams>;
  const row = await withTenant(tenant.organizationId, async (tx) => {
    const current = await findOutbox(tx, tenant, id);
    // Only what has not gone out yet can be cancelled; a message being sent is past the point of return.
    if (current.status !== 'pending' && current.status !== 'dry_run') throw new ApiError(409, 'NOT_CANCELLABLE', 'Solo se puede cancelar un mensaje pendiente');
    const updated = await tx.outboxMessage.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), lockedAt: null, lastError: 'manual_cancel' }, include: outboxInclude });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'outbox.cancel', subjectId: id });
    return updated;
  });
  res.json(outboxView(row));
});

outboxRouter.post('/:id/retry', validateParams(idParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant, 'outbox:retry');
  const { id } = res.locals.validatedParams as z.infer<typeof idParams>;
  const row = await withTenant(tenant.organizationId, async (tx) => {
    const current = await findOutbox(tx, tenant, id);
    if (current.status !== 'failed' && current.status !== 'cancelled') throw new ApiError(409, 'NOT_RETRYABLE', 'Solo se puede reintentar un mensaje fallido o cancelado');
    if (await tx.outboxMessage.findFirst({ where: { cycleId: current.cycleId, status: { in: ['pending', 'sending'] } }, select: { id: true } })) {
      throw new ApiError(409, 'ALREADY_QUEUED', 'El ciclo ya tiene un mensaje en cola');
    }
    // The marker lets the worker's recovery pass pick it up on its next run; the send still re-checks everything.
    const updated = await tx.outboxMessage.update({
      where: { id },
      data: { status: 'pending', attempts: 0, lockedAt: null, cancelledAt: null, lastError: 'manual_retry', scheduledFor: new Date() },
      include: outboxInclude,
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'outbox.retry', subjectId: id });
    return updated;
  });
  res.json(outboxView(row));
});

// --- Inbound: replies that could not be matched to a patient --------------------------------

export const inboundRouter = Router();
inboundRouter.use(resolveTenant);

inboundRouter.get('/unassigned', async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant, 'inbound:assign');
  const rows = await withTenant(tenant.organizationId, async (tx) => {
    const found = await tx.whatsappInbound.findMany({ where: { patientId: null, processedAt: { not: null } }, orderBy: { receivedAt: 'desc' }, take: 100 });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'inbound.unassigned.read' });
    return found;
  });
  res.json({ data: rows.map((row) => ({ id: row.id, channel: row.channel, from_phone: row.fromPhone, text: row.text, button: row.buttonPayload, received_at: row.receivedAt })) });
});

const assignInput = z.object({ patient_id: z.string().min(1) }).strict();

inboundRouter.post('/:id/assign', validateParams(idParams), validateBody(assignInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant, 'inbound:assign');
  const { id } = res.locals.validatedParams as z.infer<typeof idParams>;
  const input = req.body as z.infer<typeof assignInput>;
  await withTenant(tenant.organizationId, async (tx) => {
    const row = await tx.whatsappInbound.findFirst({ where: { id } });
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Inbound message not found');
    if (row.patientId) throw new ApiError(409, 'ALREADY_ASSIGNED', 'La respuesta ya tiene paciente');
    // Branch-scoped: you can only assign to a patient you can see.
    if (!await findAccessiblePatient(tx, tenant, input.patient_id, { archivedAt: null })) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    await tx.whatsappInbound.update({ where: { id }, data: { patientId: input.patient_id, processedAt: null } });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'inbound.assign', subjectId: id, metadata: { patientId: input.patient_id } });
  });
  // Process it now with the chosen patient (same rules as any reply: buttons, opt-out, free text).
  await processInbound({ organizationId: tenant.organizationId });
  res.json({ assigned: true });
});
