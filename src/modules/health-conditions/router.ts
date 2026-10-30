import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { resolvePaging } from '../../infra/pagination.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import { conditionCreate, conditionListQuery, conditionParams, conditionPatch } from '../../schemas/healthCondition.js';

export const healthConditionsRouter = Router();
healthConditionsRouter.use(resolveTenant);

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};
const nonEmpty = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

function isUniqueConflict(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

healthConditionsRouter.get('/', validateQuery(conditionListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'health-conditions:read');
  const query = res.locals.validatedQuery as z.infer<typeof conditionListQuery>;
  const where: Prisma.HealthConditionWhereInput = {
    ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
    ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
  };
  const { page, rows, skip } = resolvePaging(query);
  const [data, total] = await withTenant(tenant.organizationId, (tx) => Promise.all([
    tx.healthCondition.findMany({ where, orderBy: [{ name: 'asc' }], take: rows, skip }),
    tx.healthCondition.count({ where }),
  ]));
  res.json({ data, total, page, rows });
});

healthConditionsRouter.post('/', validateBody(conditionCreate), async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    requirePermission(tenant.role, 'health-conditions:write');
    const input = req.body as z.infer<typeof conditionCreate>;
    const condition = await withTenant(tenant.organizationId, async (tx) => {
      let created;
      try {
        created = await tx.healthCondition.create({ data: { ...nonEmpty(input), organizationId: tenant.organizationId } as Prisma.HealthConditionUncheckedCreateInput });
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new ApiError(409, 'CONDITION_NAME_IN_USE', 'Ya existe una condición de salud con este nombre.', { name: 'Ya existe una condición de salud con este nombre.' });
        }
        throw error;
      }
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'health-condition.create', subjectId: created.id });
      return created;
    });
    res.status(201).json(condition);
  } catch (error) {
    next(error);
  }
});

healthConditionsRouter.get('/:id', validateParams(conditionParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'health-conditions:read');
  const { id } = res.locals.validatedParams as z.infer<typeof conditionParams>;
  const condition = await withTenant(tenant.organizationId, (tx) => tx.healthCondition.findUnique({ where: { id } }));
  if (!condition) throw new ApiError(404, 'NOT_FOUND', 'Condición de salud no encontrada.');
  res.json(condition);
});

healthConditionsRouter.patch('/:id', validateParams(conditionParams), validateBody(conditionPatch), async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    requirePermission(tenant.role, 'health-conditions:write');
    const { id } = res.locals.validatedParams as z.infer<typeof conditionParams>;
    const input = req.body as z.infer<typeof conditionPatch>;
    const condition = await withTenant(tenant.organizationId, async (tx) => {
      const existing = await tx.healthCondition.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Condición de salud no encontrada.');
      let updated;
      try {
        updated = await tx.healthCondition.update({ where: { organizationId_id: { organizationId: tenant.organizationId, id } }, data: nonEmpty(input) as Prisma.HealthConditionUncheckedUpdateInput });
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new ApiError(409, 'CONDITION_NAME_IN_USE', 'Ya existe una condición de salud con este nombre.', { name: 'Ya existe una condición de salud con este nombre.' });
        }
        throw error;
      }
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'health-condition.update', subjectId: id });
      return updated;
    });
    res.json(condition);
  } catch (error) {
    next(error);
  }
});
