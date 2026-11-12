import type { Prisma, Role as DbRole } from '@prisma/client';
import { prisma, withTenant } from '../../infra/prisma.js';
import { ApiError } from '../../infra/errors.js';
import { actions, toPermissionSet, type PermissionSet } from '../../domain/permissions.js';
import { allGrants, type Grant, type MenuRow } from '../../domain/menu-tree.js';

// Every role lives in the database and is managed from the Roles screen. The only
// special one is "Master": each organization has exactly one, it always holds every
// permission, every branch and the whole menu, and it cannot be edited or removed, so an
// organization can never lock itself out.

export const MASTER_ROLE_KEY = 'master';
const FULL_ACCESS = { canView: true, canCreate: true, canEdit: true, canDelete: true } as const;

export const loadCatalog = (): Promise<MenuRow[]> =>
  prisma.menuItem.findMany({
    select: { id: true, key: true, label: true, path: true, icon: true, order: true, permission: true, parentId: true, isActive: true },
  });

export const isMasterRole = (role: Pick<DbRole, 'key'>) => role.key === MASTER_ROLE_KEY;

/** Master holds every action, including ones added after the role was created. */
export const rolePermissions = (role: DbRole): PermissionSet =>
  isMasterRole(role) ? new Set(actions) : toPermissionSet(role.permissions);

export const roleAllBranches = (role: DbRole): boolean => isMasterRole(role) || role.allBranches;

export async function loadGrants(tx: Prisma.TransactionClient, role: DbRole, catalog: readonly MenuRow[]): Promise<Grant[]> {
  if (isMasterRole(role)) return allGrants(catalog, FULL_ACCESS);
  return tx.roleMenuItem.findMany({
    where: { roleId: role.id },
    select: { menuItemId: true, canView: true, canCreate: true, canEdit: true, canDelete: true },
  });
}

/** Role of the current member, or null when they have none assigned yet. */
export async function findMemberRole(
  tx: Prisma.TransactionClient,
  tenant: { roleId: string | null },
): Promise<DbRole | null> {
  return tenant.roleId ? tx.role.findFirst({ where: { id: tenant.roleId } }) : null;
}

/** Validates the role chosen for a user: it must exist and be active. */
export async function resolveAssignableRole(tx: Prisma.TransactionClient, roleId: string): Promise<DbRole> {
  const role = await tx.role.findFirst({ where: { id: roleId } });
  if (!role || !role.isActive) {
    throw new ApiError(400, 'INVALID_ROLE', 'Selecciona un rol activo.', { roleId: 'Selecciona un rol activo.' });
  }
  return role;
}

/** Creates the organization's Master role when it does not exist yet. */
export async function ensureMasterRole(tx: Prisma.TransactionClient, organizationId: string): Promise<DbRole> {
  const existing = await tx.role.findFirst({ where: { key: MASTER_ROLE_KEY } });
  if (existing) return existing;
  const role = await tx.role.create({
    data: {
      organizationId,
      key: MASTER_ROLE_KEY,
      name: 'Master',
      description: 'Acceso total a la organización.',
      permissions: [...actions],
      allBranches: true,
      isSystem: true,
      isActive: true,
    } as Prisma.RoleUncheckedCreateInput,
  });
  const catalog = await loadCatalog();
  await tx.roleMenuItem.createMany({
    data: allGrants(catalog, FULL_ACCESS).map((grant) => ({ organizationId, roleId: role.id, ...grant })) as Prisma.RoleMenuItemCreateManyInput[],
  });
  return role;
}

/**
 * Makes sure the organization has its Master role. When nobody holds it yet (a brand-new
 * organization), the first member without a role becomes its Master.
 */
export async function ensureOrganizationMaster(organizationId: string): Promise<DbRole> {
  return withTenant(organizationId, async (tx) => {
    const master = await ensureMasterRole(tx, organizationId);
    if (await tx.member.count({ where: { organizationId, roleId: master.id } }) === 0) {
      const first = await tx.member.findFirst({ where: { organizationId, roleId: null }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (first) await tx.member.update({ where: { id: first.id }, data: { roleId: master.id } });
    }
    return master;
  });
}

/** Number of members that hold the Master role, so the last one can never be taken away. */
export async function countMasterHolders(tx: Prisma.TransactionClient, organizationId: string): Promise<number> {
  return tx.member.count({ where: { organizationId, roleRef: { key: MASTER_ROLE_KEY } } });
}

/** Nobody can assign a role that carries more access than their own. */
export function assertCanAssignRole(
  tenant: { permissions: PermissionSet; allBranches: boolean },
  role: DbRole,
) {
  const missing = [...rolePermissions(role)].filter((action) => !tenant.permissions.has(action));
  if ((missing.length || (roleAllBranches(role) && !tenant.allBranches))) {
    throw new ApiError(403, 'ROLE_NOT_ASSIGNABLE', 'No puedes asignar un rol con más acceso que el tuyo.', {
      roleId: 'Tu rol no permite asignar este rol.',
    });
  }
}
