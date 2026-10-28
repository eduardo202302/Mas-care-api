import { Router } from 'express';
import { prisma, withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { permissionsFor } from '../../domain/permissions.js';
import { isPlatformOwner } from '../../domain/platform-owner.js';
import { builtInGrants, resolveVisibleMenu, withPlatformOwnerGrants } from '../../domain/menu-tree.js';
import { findMemberRole, loadCatalog, loadGrants } from '../roles/system-roles.js';

export const meRouter = Router();
meRouter.get('/', resolveTenant, async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    const platformOwner = isPlatformOwner(tenant.user.email);
    const permissions: string[] = platformOwner
      ? [...permissionsFor(tenant.role), 'companies:read', 'companies:write', 'menu:write']
      : [...permissionsFor(tenant.role)];
    const catalog = await loadCatalog();
    // Branches and role share one transaction: each extra one costs several round trips.
    const [organization, { branches, roleInfo }] = await Promise.all([
      prisma.organization.findUniqueOrThrow({ where: { id: tenant.organizationId }, select: { id: true, name: true } }),
      withTenant(tenant.organizationId, async (tx) => {
        const branches = await tx.branch.findMany({ where: { organizationId: tenant.organizationId, archivedAt: null }, select: { id: true, name: true, labelColor: true } });
        const role = await findMemberRole(tx, tenant);
        return { branches, roleInfo: { role, grants: role ? await loadGrants(tx, role.id) : builtInGrants(tenant.role, catalog) } };
      }),
    ]);
    res.json({
      user: tenant.user,
      organization,
      role: tenant.role,
      roleId: roleInfo.role?.id ?? null,
      roleName: roleInfo.role?.name ?? null,
      isPlatformOwner: platformOwner,
      branches,
      permissions,
      menu: resolveVisibleMenu(catalog, platformOwner ? withPlatformOwnerGrants(roleInfo.grants, catalog) : roleInfo.grants, new Set(permissions)),
    });
  } catch (error) { next(error); }
});
