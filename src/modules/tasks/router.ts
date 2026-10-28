import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { optionalBranchScope } from '../../infra/branch-scope.js';
import { canAccessBranch, findAccessiblePatient } from '../../infra/patient-access.js';
import { paginate } from '../../infra/pagination.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import {
  parseTaskFilter,
  taskCreate,
  taskListQuery,
  taskParams,
  taskPatch,
} from '../../schemas/task.js';

export const tasksRouter = Router();
tasksRouter.use(resolveTenant);

type Tx = Prisma.TransactionClient;
const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};
const nonEmpty = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

const include = {
  patient: { select: { id: true, fullName: true, phone: true } },
  treatment: { select: { id: true, patientId: true, branchId: true, coverageEndOn: true } },
  assignee: { select: { id: true, name: true, email: true } },
  completer: { select: { id: true, name: true, email: true } },
} as const;

function dayStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function findTask(tx: Tx, tenant: NonNullable<Express.Request['tenant']>, id: string) {
  const scope = await optionalBranchScope(tx, tenant);
  return tx.task.findFirst({ where: { AND: [{ id }, scope] }, include });
}

async function assertAssignee(tx: Tx, organizationId: string, userId?: string | null) {
  if (!userId) return;
  const member = await tx.member.findFirst({ where: { organizationId, userId }, select: { id: true } });
  if (!member) throw new ApiError(400, 'INVALID_ASSIGNEE', 'Assigned user must belong to this organization');
}

async function resolveLinks(
  tx: Tx,
  tenant: NonNullable<Express.Request['tenant']>,
  input: {
    branch_id?: string | null | undefined;
    patient_id?: string | null | undefined;
    treatment_id?: string | null | undefined;
    cycle_id?: string | null | undefined;
  },
  current?: { branchId: string | null; patientId: string | null; treatmentId: string | null; cycleId: string | null },
) {
  let branchId = input.branch_id === undefined ? current?.branchId ?? null : input.branch_id;
  let patientId = input.patient_id === undefined ? current?.patientId ?? null : input.patient_id;
  let treatmentId = input.treatment_id === undefined ? current?.treatmentId ?? null : input.treatment_id;
  const cycleId = input.cycle_id === undefined ? current?.cycleId ?? null : input.cycle_id;

  if (branchId && !await canAccessBranch(tx, tenant, branchId)) {
    throw new ApiError(404, 'NOT_FOUND', 'Branch not found');
  }
  if (treatmentId) {
    const treatment = await tx.treatment.findFirst({ where: { id: treatmentId }, select: { id: true, patientId: true, branchId: true } });
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (!await canAccessBranch(tx, tenant, treatment.branchId)) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (input.patient_id === undefined) patientId = treatment.patientId;
    if (input.branch_id === undefined) branchId = treatment.branchId;
  }
  if (cycleId) {
    const cycle = await tx.refillCycle.findFirst({
      where: { id: cycleId },
      select: { id: true, treatmentId: true, branchId: true, treatment: { select: { patientId: true } } },
    });
    if (!cycle) throw new ApiError(404, 'NOT_FOUND', 'Refill cycle not found');
    if (!await canAccessBranch(tx, tenant, cycle.branchId)) throw new ApiError(404, 'NOT_FOUND', 'Refill cycle not found');
    if (input.treatment_id === undefined) treatmentId = cycle.treatmentId;
    if (input.patient_id === undefined) patientId = cycle.treatment.patientId;
    if (input.branch_id === undefined) branchId = cycle.branchId;
  }
  if (patientId && !await findAccessiblePatient(tx, tenant, patientId)) {
    throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
  }
  return { branchId, patientId, treatmentId, cycleId };
}

tasksRouter.get('/', validateQuery(taskListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'tasks:read');
  const query = res.locals.validatedQuery as z.infer<typeof taskListQuery>;
  const filter = parseTaskFilter(query.filter);
  if (!filter) throw new ApiError(400, 'INVALID_FILTER', 'Unknown task filter');
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const start = dayStart();
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const scope = await optionalBranchScope(tx, tenant);
    const filterWhere: Prisma.TaskWhereInput = filter === 'all'
      ? {}
      : filter === 'today'
        ? { dueAt: { gte: start, lt: end } }
        : filter === 'overdue'
          ? { dueAt: { lt: start } }
          : { dueAt: { gte: end } };
    const where: Prisma.TaskWhereInput = {
      AND: [
        scope,
        filterWhere,
        query.status ? { status: query.status } : filter === 'all' ? {} : { status: 'open' },
        query.branch_id ? { branchId: query.branch_id } : {},
        query.patient_id ? { patientId: query.patient_id } : {},
        query.treatment_id ? { treatmentId: query.treatment_id } : {},
        query.assigned_to ? { assignedTo: query.assigned_to } : {},
      ],
    };
    return paginate(query, (args) => tx.task.findMany({
      where,
      include,
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }],
      take: args.take,
      skip: args.skip,
      ...(args.cursor ? { cursor: { organizationId_id: { organizationId: tenant.organizationId, id: args.cursor } } } : {}),
    }), () => tx.task.count({ where }));
  });
  res.json(result);
});

tasksRouter.post('/', validateBody(taskCreate), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'tasks:write');
  const input = req.body as z.infer<typeof taskCreate>;
  const task = await withTenant(tenant.organizationId, async (tx) => {
    await assertAssignee(tx, tenant.organizationId, input.assigned_to);
    const links = await resolveLinks(tx, tenant, input);
    const created = await tx.task.create({
      data: {
        organizationId: tenant.organizationId,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        dueAt: input.due_at ?? null,
        assignedTo: input.assigned_to ?? null,
        branchId: links.branchId,
        patientId: links.patientId,
        treatmentId: links.treatmentId,
        cycleId: links.cycleId,
        autoGenerated: input.auto_generated ?? false,
      } as Prisma.TaskUncheckedCreateInput,
      include,
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'task.create', subjectId: created.id });
    return created;
  });
  res.status(201).json(task);
});

tasksRouter.get('/:id', validateParams(taskParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'tasks:read');
  const { id } = res.locals.validatedParams as z.infer<typeof taskParams>;
  const task = await withTenant(tenant.organizationId, async (tx) => {
    const found = await findTask(tx, tenant, id);
    if (!found) throw new ApiError(404, 'NOT_FOUND', 'Task not found');
    return found;
  });
  res.json(task);
});

tasksRouter.patch('/:id', validateParams(taskParams), validateBody(taskPatch), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'tasks:write');
  const { id } = res.locals.validatedParams as z.infer<typeof taskParams>;
  const input = req.body as z.infer<typeof taskPatch>;
  const task = await withTenant(tenant.organizationId, async (tx) => {
    const current = await findTask(tx, tenant, id);
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Task not found');
    await assertAssignee(tx, tenant.organizationId, input.assigned_to);
    const links = await resolveLinks(tx, tenant, input, {
      branchId: current.branchId,
      patientId: current.patientId,
      treatmentId: current.treatmentId,
      cycleId: current.cycleId,
    });
    const completed = input.status === 'done' && current.status !== 'done';
    if (completed && !links.patientId) throw new ApiError(409, 'TASK_WITHOUT_PATIENT', 'A task must be linked to a patient to complete it');
    const reopened = input.status !== undefined && input.status !== 'done' && current.status === 'done';
    const updated = await tx.task.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: {
        ...nonEmpty({
          type: input.type,
          title: input.title,
          description: input.description,
          dueAt: input.due_at,
          assignedTo: input.assigned_to,
          branchId: input.branch_id === undefined ? undefined : links.branchId,
          patientId: input.patient_id === undefined ? undefined : links.patientId,
          treatmentId: input.treatment_id === undefined ? undefined : links.treatmentId,
          cycleId: input.cycle_id === undefined ? undefined : links.cycleId,
          autoGenerated: input.auto_generated,
          status: input.status,
        }),
        ...(completed ? { completedAt: new Date(), completedBy: tenant.userId } : {}),
        ...(reopened ? { completedAt: null, completedBy: null } : {}),
      } as Prisma.TaskUncheckedUpdateInput,
      include,
    });
    if (completed) {
      await tx.activity.create({
        data: {
          organizationId: tenant.organizationId,
          patientId: updated.patientId!,
          treatmentId: updated.treatmentId,
          cycleId: updated.cycleId,
          type: 'task',
          body: updated.title,
          metadata: { task_id: updated.id, status: 'done' },
          authorId: tenant.userId,
        },
      });
    }
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'task.update', subjectId: id });
    return updated;
  });
  res.json(task);
});

tasksRouter.post('/:id/complete', validateParams(taskParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'tasks:write');
  const { id } = res.locals.validatedParams as z.infer<typeof taskParams>;
  const task = await withTenant(tenant.organizationId, async (tx) => {
    const current = await findTask(tx, tenant, id);
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Task not found');
    if (current.status === 'done') return current;
    if (!current.patientId) throw new ApiError(409, 'TASK_WITHOUT_PATIENT', 'A task must be linked to a patient to complete it');
    const updated = await tx.task.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { status: 'done', completedAt: new Date(), completedBy: tenant.userId },
      include,
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: updated.patientId!,
        treatmentId: updated.treatmentId,
        cycleId: updated.cycleId,
        type: 'task',
        body: updated.title,
        metadata: { task_id: updated.id, status: 'done' },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'task.complete', subjectId: id });
    return updated;
  });
  res.json(task);
});

tasksRouter.delete('/:id', validateParams(taskParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'tasks:write');
  const { id } = res.locals.validatedParams as z.infer<typeof taskParams>;
  await withTenant(tenant.organizationId, async (tx) => {
    const current = await findTask(tx, tenant, id);
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Task not found');
    await tx.task.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { status: 'cancelled', completedAt: null, completedBy: null },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'task.cancel', subjectId: id });
  });
  res.status(204).end();
});
