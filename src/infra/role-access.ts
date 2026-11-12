import { withTenant } from './prisma.js';
import type { PermissionSet } from '../domain/permissions.js';
import { roleAllBranches, rolePermissions } from '../modules/roles/system-roles.js';

export type RoleAccess = { permissions: PermissionSet; allBranches: boolean };

// A role is read on every request, and each read against the remote database costs a
// transaction, so it is cached briefly. Edits made through the Roles screen clear the
// entry right away; the short TTL only bounds how long another server instance could
// keep serving a stale role.
const TTL_MS = 10_000;
const cache = new Map<string, { access: RoleAccess; expiresAt: number }>();

export async function getRoleAccess(organizationId: string, roleId: string): Promise<RoleAccess> {
  const key = `${organizationId}:${roleId}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.access;
  const role = await withTenant(organizationId, (tx) => tx.role.findFirst({ where: { id: roleId } }));
  // A missing or deactivated role grants nothing.
  const access: RoleAccess = role && role.isActive
    ? { permissions: rolePermissions(role), allBranches: roleAllBranches(role) }
    : { permissions: new Set(), allBranches: false };
  cache.set(key, { access, expiresAt: Date.now() + TTL_MS });
  return access;
}

export function invalidateRoleAccess(organizationId: string, roleId?: string) {
  if (roleId) cache.delete(`${organizationId}:${roleId}`);
  else for (const key of cache.keys()) if (key.startsWith(`${organizationId}:`)) cache.delete(key);
}
