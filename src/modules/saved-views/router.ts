import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { savedViewCreate, savedViewParams, savedViewPatch, savedViewQuery } from '../../schemas/saved-view.js';

export const savedViewsRouter = Router();
savedViewsRouter.use(resolveTenant);

const family = (entity: string) => (entity.startsWith('cycles') ? 'treatments' : 'patients');
const requireRead = (role: Parameters<typeof puede>[0], entity: string) => {
  if (!puede(role, `${family(entity)}:read` as Parameters<typeof puede>[1])) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};
// Column preferences are personal, so reading is enough; saved views need write access.
const requireWrite = (role: Parameters<typeof puede>[0], entity: string) => {
  if (entity.endsWith('_columns')) { requireRead(role, entity); return; }
  if (!puede(role, `${family(entity)}:write` as Parameters<typeof puede>[1])) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};
const handleUniqueName = (error: unknown): never => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ApiError(409, 'SAVED_VIEW_EXISTS', 'A saved view with this name already exists');
  }
  throw error;
};

savedViewsRouter.get('/', validateQuery(savedViewQuery), async (req, res) => {
  const tenant = req.tenant!;
  const { entity } = res.locals.validatedQuery as z.infer<typeof savedViewQuery>;
  requireRead(tenant.role, entity);
  const data = await withTenant(tenant.organizationId, (tx) => tx.savedView.findMany({
    where: { userId: tenant.userId, entity },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  }), tenant.userId);
  res.json({ data });
});

savedViewsRouter.post('/', validateBody(savedViewCreate), async (req, res) => {
  const tenant = req.tenant!;
  const input = req.body as z.infer<typeof savedViewCreate>;
  requireWrite(tenant.role, input.entity);
  try {
    const view = await withTenant(tenant.organizationId, async (tx) => {
      if (input.isDefault) {
        await tx.savedView.updateMany({ where: { userId: tenant.userId, entity: input.entity, isDefault: true }, data: { isDefault: false } });
      }
      return tx.savedView.create({
        data: {
          ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
          organizationId: tenant.organizationId,
          userId: tenant.userId,
          filters: input.filters as Prisma.InputJsonObject,
          columns: input.columns as Prisma.InputJsonArray,
          sort: input.sort as Prisma.InputJsonObject,
        } as Prisma.SavedViewUncheckedCreateInput,
      });
    }, tenant.userId);
    res.status(201).json(view);
  } catch (error) { handleUniqueName(error); }
});

savedViewsRouter.patch('/:id', validateParams(savedViewParams), validateBody(savedViewPatch), async (req, res) => {
  const tenant = req.tenant!;
  const { id } = res.locals.validatedParams as z.infer<typeof savedViewParams>;
  const input = req.body as z.infer<typeof savedViewPatch>;
  try {
    const view = await withTenant(tenant.organizationId, async (tx) => {
      const current = await tx.savedView.findFirst({ where: { id, userId: tenant.userId } });
      if (!current) throw new ApiError(404, 'NOT_FOUND', 'Saved view not found');
      requireWrite(tenant.role, current.entity);
      if (input.isDefault) {
        await tx.savedView.updateMany({ where: { userId: tenant.userId, entity: current.entity, isDefault: true, NOT: { id } }, data: { isDefault: false } });
      }
      return tx.savedView.update({
        where: { id },
        data: {
          ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
          ...(input.filters !== undefined ? { filters: input.filters as Prisma.InputJsonObject } : {}),
          ...(input.columns !== undefined ? { columns: input.columns as Prisma.InputJsonArray } : {}),
          ...(input.sort !== undefined ? { sort: input.sort as Prisma.InputJsonObject } : {}),
        } as Prisma.SavedViewUncheckedUpdateInput,
      });
    }, tenant.userId);
    res.json(view);
  } catch (error) { handleUniqueName(error); }
});

savedViewsRouter.delete('/:id', validateParams(savedViewParams), async (req, res) => {
  const tenant = req.tenant!;
  const { id } = res.locals.validatedParams as z.infer<typeof savedViewParams>;
  await withTenant(tenant.organizationId, async (tx) => {
    const current = await tx.savedView.findFirst({ where: { id, userId: tenant.userId } });
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Saved view not found');
    requireWrite(tenant.role, current.entity);
    await tx.savedView.delete({ where: { id } });
  }, tenant.userId);
  res.status(204).end();
});
