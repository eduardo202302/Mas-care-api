import { Router } from 'express';
import { Prisma } from '@prisma/client';
import type { Role as DbRole } from '@prisma/client';
import type { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { normalizeGrants, type Grant } from '../../domain/menu-tree.js';
import { ApiError } from '../../infra/errors.js';
import { optionalPaging, sliceIfPaged } from '../../infra/pagination.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import { roleCreate, roleListQuery, roleParams, rolePatch } from '../../schemas/role.js';
import { loadCatalog, loadGrants } from './system-roles.js';

export const rolesRouter = Router();
rolesRouter.use(resolveTenant);

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

type Member = { role: string; roleId: string | null };
const countMembers = (role: DbRole, members: Member[]) =>
  members.filter((member) => member.roleId === role.id || (member.roleId === null && role.isSystem && member.role === role.key)).length;

const toDto = (role: DbRole, memberCount: number, grants: Grant[]) => ({
  id: role.id,
  key: role.key,
  name: role.name,
  description: role.description,
  baseRole: role.baseRole,
  isSystem: role.isSystem,
  isActive: role.isActive,
  memberCount,
  items: grants.map(({ menuItemId, canView, canCreate, canEdit, canDelete }) => ({ menuItemId, canView, canCreate, canEdit, canDelete })),
});

const duplicateName = () => new ApiError(409, 'ROLE_DUPLICATE', 'Ya existe un rol con ese nombre.', { name: 'Ya existe un rol con ese nombre.' });
const isUnique = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

async function replaceGrants(tx: Prisma.TransactionClient, organizationId: string, roleId: string, grants: Grant[]) {
  await tx.roleMenuItem.deleteMany({ where: { roleId } });
  if (grants.length) {
    await tx.roleMenuItem.createMany({
      data: grants.map((grant) => ({ organizationId, roleId, ...grant })) as Prisma.RoleMenuItemCreateManyInput[],
    });
  }
}

async function readMembers(tx: Prisma.TransactionClient, organizationId: string): Promise<Member[]> {
  return tx.member.findMany({ where: { organizationId }, select: { role: true, roleId: true } });
}

rolesRouter.get('/', validateQuery(roleListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'roles:read');
  const query = res.locals.validatedQuery as z.infer<typeof roleListQuery>;
  const data = await withTenant(tenant.organizationId, async (tx) => {
    const [roles, members] = await Promise.all([
      tx.role.findMany({
        where: query.active === undefined ? {} : { isActive: query.active },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      }),
      readMembers(tx, tenant.organizationId),
    ]);
    return Promise.all(roles.map(async (role) => toDto(role, countMembers(role, members), await loadGrants(tx, role.id))));
  });
  res.json(sliceIfPaged(data, optionalPaging.parse(req.query)));
});

rolesRouter.get('/:id', validateParams(roleParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'roles:read');
  const { id } = res.locals.validatedParams as z.infer<typeof roleParams>;
  const dto = await withTenant(tenant.organizationId, async (tx) => {
    const role = await tx.role.findFirst({ where: { id } });
    if (!role) throw new ApiError(404, 'NOT_FOUND', 'Role not found');
    const members = await readMembers(tx, tenant.organizationId);
    return toDto(role, countMembers(role, members), await loadGrants(tx, role.id));
  });
  res.json(dto);
});

rolesRouter.post('/', validateBody(roleCreate), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'roles:write');
  const input = req.body as z.infer<typeof roleCreate>;
  const catalog = await loadCatalog();
  const { grants, unknown } = normalizeGrants(input.items, catalog);
  if (unknown.length) throw new ApiError(400, 'INVALID_MENU_ITEM', 'Algún ítem de menú no existe.', { items: 'Algún ítem de menú no existe.' });
  const dto = await withTenant(tenant.organizationId, async (tx) => {
    const role = await tx.role.create({
      data: {
        organizationId: tenant.organizationId,
        name: input.name,
        description: input.description ?? null,
        baseRole: input.baseRole,
        isActive: input.isActive ?? true,
      } as Prisma.RoleUncheckedCreateInput,
    }).catch((error) => { throw isUnique(error) ? duplicateName() : error; });
    await replaceGrants(tx, tenant.organizationId, role.id, grants);
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'role.create', subjectId: role.id });
    return toDto(role, 0, grants);
  });
  res.status(201).json(dto);
});

rolesRouter.patch('/:id', validateParams(roleParams), validateBody(rolePatch), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'roles:write');
  const { id } = res.locals.validatedParams as z.infer<typeof roleParams>;
  const input = req.body as z.infer<typeof rolePatch>;
  const catalog = await loadCatalog();
  const normalized = input.items ? normalizeGrants(input.items, catalog) : null;
  if (normalized?.unknown.length) {
    throw new ApiError(400, 'INVALID_MENU_ITEM', 'Algún ítem de menú no existe.', { items: 'Algún ítem de menú no existe.' });
  }
  const dto = await withTenant(tenant.organizationId, async (tx) => {
    const current = await tx.role.findFirst({ where: { id } });
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Role not found');
    const members = await readMembers(tx, tenant.organizationId);
    const memberCount = countMembers(current, members);
    if (current.isSystem) {
      const locked = (['name', 'baseRole', 'isActive'] as const).find((field) => input[field] !== undefined && input[field] !== current[field]);
      if (locked) throw new ApiError(400, 'SYSTEM_ROLE_LOCKED', 'Un rol del sistema solo permite cambiar descripción y menús.', { [locked]: 'No editable en roles del sistema.' });
      if (current.key === 'owner' && input.items) {
        throw new ApiError(400, 'OWNER_ROLE_LOCKED', 'El rol Propietario siempre accede a todo el menú.', { items: 'No editable.' });
      }
    }
    if (input.isActive === false && memberCount > 0) {
      throw new ApiError(409, 'ROLE_IN_USE', 'No puedes desactivar un rol con usuarios asignados.', { isActive: 'Reasigna sus usuarios primero.' });
    }
    if (input.baseRole !== undefined && input.baseRole !== current.baseRole && memberCount > 0) {
      throw new ApiError(409, 'ROLE_IN_USE', 'No puedes cambiar el rol base con usuarios asignados.', { baseRole: 'Reasigna sus usuarios primero.' });
    }
    const data: Prisma.RoleUncheckedUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.baseRole !== undefined ? { baseRole: input.baseRole } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };
    const role = await tx.role.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data,
    }).catch((error) => { throw isUnique(error) ? duplicateName() : error; });
    if (normalized) await replaceGrants(tx, tenant.organizationId, id, normalized.grants);
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'role.update', subjectId: id });
    return toDto(role, memberCount, await loadGrants(tx, role.id));
  });
  res.json(dto);
});

rolesRouter.delete('/:id', validateParams(roleParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'roles:write');
  const { id } = res.locals.validatedParams as z.infer<typeof roleParams>;
  await withTenant(tenant.organizationId, async (tx) => {
    const role = await tx.role.findFirst({ where: { id } });
    if (!role) throw new ApiError(404, 'NOT_FOUND', 'Role not found');
    if (role.isSystem) throw new ApiError(400, 'SYSTEM_ROLE_LOCKED', 'Los roles del sistema no se pueden eliminar.');
    const members = await readMembers(tx, tenant.organizationId);
    if (countMembers(role, members) > 0) {
      throw new ApiError(409, 'ROLE_IN_USE', 'No puedes eliminar un rol con usuarios asignados.');
    }
    await tx.role.delete({ where: { organizationId_id: { organizationId: tenant.organizationId, id } } });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'role.delete', subjectId: id });
  });
  res.status(204).end();
});
