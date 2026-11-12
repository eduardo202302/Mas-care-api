import { Router } from 'express';
import { Prisma } from '@prisma/client';
import type { Role as DbRole } from '@prisma/client';
import type { z } from 'zod';
import { puede, type Action } from '../../domain/permissions.js';
import { normalizeGrants, type Grant, type MenuRow } from '../../domain/menu-tree.js';
import { ApiError } from '../../infra/errors.js';
import { optionalPaging, sliceIfPaged } from '../../infra/pagination.js';
import { withTenant } from '../../infra/prisma.js';
import { invalidateRoleAccess } from '../../infra/role-access.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import { roleCreate, roleListQuery, roleParams, rolePatch } from '../../schemas/role.js';
import { isMasterRole, loadCatalog, loadGrants, roleAllBranches, rolePermissions } from './system-roles.js';

export const rolesRouter = Router();
rolesRouter.use(resolveTenant);

const requirePermission = (permissions: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(permissions, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

const toDto = (role: DbRole, memberCount: number, grants: Grant[]) => ({
  id: role.id,
  numericId: role.numericId,
  key: role.key,
  name: role.name,
  description: role.description,
  permissions: [...rolePermissions(role)],
  allBranches: roleAllBranches(role),
  isSystem: role.isSystem,
  isActive: role.isActive,
  memberCount,
  items: grants.map(({ menuItemId, canView, canCreate, canEdit, canDelete }) => ({ menuItemId, canView, canCreate, canEdit, canDelete })),
});

const duplicateName = () => new ApiError(409, 'ROLE_DUPLICATE', 'Ya existe un rol con ese nombre.', { name: 'Ya existe un rol con ese nombre.' });
const isUnique = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** Nobody can hand out access they do not hold themselves, so editing roles cannot be used to escalate. */
function assertCanGrant(
  tenant: NonNullable<Express.Request['tenant']>,
  permissions: readonly Action[] | undefined,
  allBranches: boolean | undefined,
) {
  const missing = (permissions ?? []).filter((action) => !tenant.permissions.has(action));
  if (missing.length) {
    throw new ApiError(403, 'PERMISSION_NOT_GRANTABLE', 'No puedes otorgar permisos que tu rol no tiene.', { permissions: `No puedes otorgar: ${missing.join(', ')}.` });
  }
  if (allBranches && !tenant.allBranches) {
    throw new ApiError(403, 'PERMISSION_NOT_GRANTABLE', 'No puedes dar acceso a todas las sucursales si tu rol no lo tiene.', { allBranches: 'Tu rol no tiene acceso a todas las sucursales.' });
  }
}

async function replaceGrants(tx: Prisma.TransactionClient, organizationId: string, roleId: string, grants: Grant[]) {
  await tx.roleMenuItem.deleteMany({ where: { roleId } });
  if (grants.length) {
    await tx.roleMenuItem.createMany({
      data: grants.map((grant) => ({ organizationId, roleId, ...grant })) as Prisma.RoleMenuItemCreateManyInput[],
    });
  }
}

const countMembers = (tx: Prisma.TransactionClient, organizationId: string, roleId: string) =>
  tx.member.count({ where: { organizationId, roleId } });

const loadMemberCounts = async (tx: Prisma.TransactionClient, organizationId: string) => {
  const rows = await tx.member.groupBy({ by: ['roleId'], where: { organizationId, roleId: { not: null } }, _count: { _all: true } });
  return new Map(rows.map((row) => [row.roleId as string, row._count._all]));
};

const invalidMenu = () => new ApiError(400, 'INVALID_MENU_ITEM', 'Algún ítem de menú no existe.', { items: 'Algún ítem de menú no existe.' });
const masterLocked = (field: string) =>
  new ApiError(400, 'SYSTEM_ROLE_LOCKED', 'El rol Master siempre tiene acceso total: solo puedes cambiar su descripción.', { [field]: 'No editable en el rol Master.' });

rolesRouter.get('/', validateQuery(roleListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.permissions, 'roles:read');
  const query = res.locals.validatedQuery as z.infer<typeof roleListQuery>;
  const catalog = await loadCatalog();
  const data = await withTenant(tenant.organizationId, async (tx) => {
    const [roles, counts] = await Promise.all([
      tx.role.findMany({
        where: query.active === undefined ? {} : { isActive: query.active },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      }),
      loadMemberCounts(tx, tenant.organizationId),
    ]);
    return Promise.all(roles.map(async (role) => toDto(role, counts.get(role.id) ?? 0, await loadGrants(tx, role, catalog))));
  });
  res.json(sliceIfPaged(data, optionalPaging.parse(req.query)));
});

rolesRouter.get('/:id', validateParams(roleParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.permissions, 'roles:read');
  const { id } = res.locals.validatedParams as z.infer<typeof roleParams>;
  const catalog = await loadCatalog();
  const dto = await withTenant(tenant.organizationId, async (tx) => {
    const role = await tx.role.findFirst({ where: { id } });
    if (!role) throw new ApiError(404, 'NOT_FOUND', 'Role not found');
    return toDto(role, await countMembers(tx, tenant.organizationId, role.id), await loadGrants(tx, role, catalog));
  });
  res.json(dto);
});

rolesRouter.post('/', validateBody(roleCreate), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.permissions, 'roles:write');
  const input = req.body as z.infer<typeof roleCreate>;
  assertCanGrant(tenant, input.permissions, input.allBranches);
  const catalog: MenuRow[] = await loadCatalog();
  const { grants, unknown } = normalizeGrants(input.items, catalog);
  if (unknown.length) throw invalidMenu();
  const dto = await withTenant(tenant.organizationId, async (tx) => {
    const role = await tx.role.create({
      data: {
        organizationId: tenant.organizationId,
        name: input.name,
        description: input.description ?? null,
        permissions: [...new Set(input.permissions)],
        allBranches: input.allBranches ?? false,
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
  requirePermission(tenant.permissions, 'roles:write');
  const { id } = res.locals.validatedParams as z.infer<typeof roleParams>;
  const input = req.body as z.infer<typeof rolePatch>;
  const catalog = await loadCatalog();
  const normalized = input.items ? normalizeGrants(input.items, catalog) : null;
  if (normalized?.unknown.length) throw invalidMenu();
  const dto = await withTenant(tenant.organizationId, async (tx) => {
    const current = await tx.role.findFirst({ where: { id } });
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Role not found');
    if (isMasterRole(current)) {
      if (input.name !== undefined && input.name !== current.name) throw masterLocked('name');
      if (input.isActive !== undefined && input.isActive !== current.isActive) throw masterLocked('isActive');
      for (const field of ['permissions', 'allBranches', 'items'] as const) {
        if (input[field] !== undefined) throw masterLocked(field);
      }
    } else {
      assertCanGrant(tenant, input.permissions, input.allBranches);
    }
    const memberCount = await countMembers(tx, tenant.organizationId, id);
    if (input.isActive === false && memberCount > 0) {
      throw new ApiError(409, 'ROLE_IN_USE', 'No puedes desactivar un rol con usuarios asignados.', { isActive: 'Reasigna sus usuarios primero.' });
    }
    const data: Prisma.RoleUncheckedUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.permissions !== undefined ? { permissions: [...new Set(input.permissions)] } : {}),
      ...(input.allBranches !== undefined ? { allBranches: input.allBranches } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };
    const role = await tx.role.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data,
    }).catch((error) => { throw isUnique(error) ? duplicateName() : error; });
    if (normalized) await replaceGrants(tx, tenant.organizationId, id, normalized.grants);
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'role.update', subjectId: id });
    return toDto(role, memberCount, await loadGrants(tx, role, catalog));
  });
  invalidateRoleAccess(tenant.organizationId, id);
  res.json(dto);
});

rolesRouter.delete('/:id', validateParams(roleParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.permissions, 'roles:write');
  const { id } = res.locals.validatedParams as z.infer<typeof roleParams>;
  await withTenant(tenant.organizationId, async (tx) => {
    const role = await tx.role.findFirst({ where: { id } });
    if (!role) throw new ApiError(404, 'NOT_FOUND', 'Role not found');
    if (role.isSystem) throw new ApiError(400, 'SYSTEM_ROLE_LOCKED', 'El rol Master no se puede eliminar.');
    if (await countMembers(tx, tenant.organizationId, role.id) > 0) {
      throw new ApiError(409, 'ROLE_IN_USE', 'No puedes eliminar un rol con usuarios asignados.');
    }
    await tx.role.delete({ where: { organizationId_id: { organizationId: tenant.organizationId, id } } });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'role.delete', subjectId: id });
  });
  invalidateRoleAccess(tenant.organizationId, id);
  res.status(204).end();
});
