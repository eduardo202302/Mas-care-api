import type { Prisma, Role as DbRole } from '@prisma/client';
import { prisma } from '../../infra/prisma.js';
import { ApiError } from '../../infra/errors.js';
import type { Grant, MenuRow } from '../../domain/menu-tree.js';

// Roles stored in the database are the custom ones managed from the Roles
// screen. The built-in roles (owner, admin, ...) are not stored: members
// without a custom role get the menu defined in domain/menu-defaults.ts.

export const loadCatalog = (): Promise<MenuRow[]> =>
  prisma.menuItem.findMany({
    select: { id: true, key: true, label: true, path: true, icon: true, order: true, permission: true, parentId: true, isActive: true },
  });

export async function loadGrants(tx: Prisma.TransactionClient, roleId: string): Promise<Grant[]> {
  return tx.roleMenuItem.findMany({
    where: { roleId },
    select: { menuItemId: true, canView: true, canCreate: true, canEdit: true, canDelete: true },
  });
}

/** Custom role of the current member, or null when they use a built-in role. */
export async function findMemberRole(
  tx: Prisma.TransactionClient,
  tenant: { roleId: string | null },
): Promise<DbRole | null> {
  return tenant.roleId ? tx.role.findFirst({ where: { id: tenant.roleId } }) : null;
}

/**
 * Validates a custom role chosen for a user. Returns the base role that drives
 * API permissions and the id to store on the member.
 */
export async function resolveAssignableRole(tx: Prisma.TransactionClient, roleId: string) {
  const role = await tx.role.findFirst({ where: { id: roleId } });
  if (!role || !role.isActive) {
    throw new ApiError(400, 'INVALID_ROLE', 'Selecciona un rol activo.', { roleId: 'Selecciona un rol activo.' });
  }
  return { baseRole: role.baseRole as 'admin' | 'pharmacist' | 'operator' | 'read_only', customId: role.id };
}
