import { Router } from 'express';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { ApiError } from '../../infra/errors.js';
import { prisma, withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { requirePlatformOwner, sessionIsPlatformOwner } from '../../infra/platform-owner-guard.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import { menuCreate, menuListQuery, menuParams, menuPatch, menuReorder } from '../../schemas/menu.js';

// Global menu catalog (not tenant-scoped). Everyone signed in can read the
// active items; only the platform owner can change it.
export const menuRouter = Router();
menuRouter.use(resolveTenant);

const select = {
  id: true, key: true, label: true, path: true, icon: true, order: true, isActive: true, permission: true, parentId: true,
} satisfies Prisma.MenuItemSelect;
const orderBy = [{ order: 'asc' }, { label: 'asc' }, { id: 'asc' }] satisfies Prisma.MenuItemOrderByWithRelationInput[];

const audit = (req: { tenant?: Express.Request['tenant'] }, action: string, subjectId: string) => {
  const tenant = req.tenant!;
  return withTenant(tenant.organizationId, (tx) =>
    record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action, subjectId }));
};

const conflict = (error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = String(error.meta?.target ?? '');
    const field = target.includes('path') ? 'path' : 'key';
    return new ApiError(409, 'MENU_DUPLICATE', field === 'path' ? 'Ya existe un ítem con esa ruta.' : 'Ya existe un ítem con esa clave.', {
      [field]: field === 'path' ? 'Ya existe un ítem con esa ruta.' : 'Ya existe un ítem con esa clave.',
    });
  }
  return error;
};

/** The menu supports groups and one level of children. */
function assertParent(parentId: string | null, selfId: string | null, all: { id: string; parentId: string | null }[]) {
  if (!parentId) return;
  const invalid = (message: string) => new ApiError(400, 'INVALID_PARENT', message, { parentId: message });
  if (parentId === selfId) throw invalid('Un ítem no puede ser su propio padre.');
  const parent = all.find((item) => item.id === parentId);
  if (!parent) throw invalid('El menú padre no existe.');
  if (parent.parentId) throw invalid('El menú soporta solo un nivel de submenús.');
  if (selfId && all.some((item) => item.parentId === selfId)) throw invalid('Un ítem con submenús no puede tener padre.');
}

menuRouter.get('/', validateQuery(menuListQuery), async (req, res) => {
  const query = res.locals.validatedQuery as z.infer<typeof menuListQuery>;
  const owner = await sessionIsPlatformOwner(req);
  if (query.includeInactive && !owner) throw new ApiError(403, 'FORBIDDEN', 'Solo el propietario global puede ver ítems inactivos.');
  const data = await prisma.menuItem.findMany({ where: query.includeInactive ? {} : { isActive: true }, select, orderBy });
  res.json({ data });
});

menuRouter.post('/', validateBody(menuCreate), async (req, res) => {
  await requirePlatformOwner(req);
  const input = req.body as z.infer<typeof menuCreate>;
  const all = await prisma.menuItem.findMany({ select: { id: true, parentId: true } });
  assertParent(input.parentId, null, all);
  const created = await prisma.menuItem.create({ data: input, select }).catch((error) => { throw conflict(error); });
  await audit(req, 'menu.create', created.id);
  res.status(201).json(created);
});

// Declared before "/:id" so "reorder" is not read as an id.
menuRouter.patch('/reorder', validateBody(menuReorder), async (req, res) => {
  await requirePlatformOwner(req);
  const { items } = req.body as z.infer<typeof menuReorder>;
  const all = await prisma.menuItem.findMany({ select: { id: true, parentId: true } });
  const known = new Set(all.map((item) => item.id));
  const missing = items.find((item) => !known.has(item.id));
  if (missing) throw new ApiError(404, 'NOT_FOUND', 'Menu item not found');
  const next = all.map((item) => {
    const change = items.find((entry) => entry.id === item.id);
    return { id: item.id, parentId: change && change.parentId !== undefined ? change.parentId : item.parentId };
  });
  for (const item of next) assertParent(item.parentId, item.id, next);
  await prisma.$transaction(items.map((item) => prisma.menuItem.update({
    where: { id: item.id },
    data: { order: item.order, ...(item.parentId !== undefined ? { parentId: item.parentId } : {}) },
  })));
  await audit(req, 'menu.reorder', items[0]!.id);
  const data = await prisma.menuItem.findMany({ select, orderBy });
  res.json({ data });
});

menuRouter.patch('/:id', validateParams(menuParams), validateBody(menuPatch), async (req, res) => {
  await requirePlatformOwner(req);
  const { id } = res.locals.validatedParams as z.infer<typeof menuParams>;
  const input = req.body as z.infer<typeof menuPatch>;
  const all = await prisma.menuItem.findMany({ select: { id: true, parentId: true } });
  if (!all.some((item) => item.id === id)) throw new ApiError(404, 'NOT_FOUND', 'Menu item not found');
  if (input.parentId !== undefined) assertParent(input.parentId, id, all);
  const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Prisma.MenuItemUncheckedUpdateInput;
  const updated = await prisma.menuItem.update({ where: { id }, data, select }).catch((error) => { throw conflict(error); });
  await audit(req, 'menu.update', id);
  res.json(updated);
});

menuRouter.delete('/:id', validateParams(menuParams), async (req, res) => {
  await requirePlatformOwner(req);
  const { id } = res.locals.validatedParams as z.infer<typeof menuParams>;
  const item = await prisma.menuItem.findUnique({ where: { id }, select: { id: true, _count: { select: { children: true } } } });
  if (!item) throw new ApiError(404, 'NOT_FOUND', 'Menu item not found');
  if (item._count.children > 0) {
    throw new ApiError(409, 'MENU_HAS_CHILDREN', 'Elimina o mueve primero los submenús de este ítem.');
  }
  // Role assignments of the item are removed by the foreign key (ON DELETE CASCADE).
  await prisma.menuItem.delete({ where: { id } });
  await audit(req, 'menu.delete', id);
  res.status(204).end();
});
