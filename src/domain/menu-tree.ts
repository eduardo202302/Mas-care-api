import { menuItemId, systemRoleSeeds, type PermissionFlags } from './menu-defaults.js';

export type MenuRow = {
  id: string;
  key: string;
  label: string;
  path: string | null;
  icon: string;
  order: number;
  permission: string | null;
  parentId: string | null;
  isActive: boolean;
};

export type GrantInput = Partial<PermissionFlags> & { menuItemId: string };
export type Grant = PermissionFlags & { menuItemId: string };
export type VisibleMenuItem = Omit<MenuRow, 'permission' | 'isActive'> & PermissionFlags;

const byOrder = (a: MenuRow, b: MenuRow) => a.order - b.order || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);

export const allGrants = (items: readonly MenuRow[], flags: PermissionFlags): Grant[] =>
  items.map((item) => ({ menuItemId: item.id, ...flags }));

/**
 * Normalises the grants submitted for a role against the catalog:
 * - drops duplicates and unknown ids (reported in `unknown`)
 * - any create/edit/delete flag implies view
 * - a child grant pulls its parent in (view only) so the tree stays navigable
 */
export function normalizeGrants(input: readonly GrantInput[], catalog: readonly MenuRow[]) {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const result = new Map<string, Grant>();
  const unknown: string[] = [];
  for (const entry of input) {
    if (!byId.has(entry.menuItemId)) { unknown.push(entry.menuItemId); continue; }
    const canCreate = entry.canCreate ?? false;
    const canEdit = entry.canEdit ?? false;
    const canDelete = entry.canDelete ?? false;
    const canView = (entry.canView ?? true) || canCreate || canEdit || canDelete;
    if (!canView) continue;
    result.set(entry.menuItemId, { menuItemId: entry.menuItemId, canView, canCreate, canEdit, canDelete });
  }
  for (const grant of [...result.values()]) {
    const parentId = byId.get(grant.menuItemId)?.parentId;
    if (parentId && !result.has(parentId)) {
      result.set(parentId, { menuItemId: parentId, canView: true, canCreate: false, canEdit: false, canDelete: false });
    }
  }
  return { grants: [...result.values()], unknown };
}

/**
 * Menu a user sees: active items granted to the role (view), whose required
 * API permission the user holds, plus any group needed to reach them.
 * The result is flat; clients rebuild the tree from `parentId`.
 */
export function resolveVisibleMenu(
  catalog: readonly MenuRow[],
  grants: readonly Grant[],
  permissions: ReadonlySet<string>,
): VisibleMenuItem[] {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const grantById = new Map(grants.map((grant) => [grant.menuItemId, grant]));
  const usable = (item: MenuRow) => {
    if (!item.isActive) return false;
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    return !parent || parent.isActive;
  };
  const ownVisible = (item: MenuRow) =>
    usable(item) && item.path !== null && Boolean(grantById.get(item.id)?.canView) && (!item.permission || permissions.has(item.permission));

  const visibleIds = new Set<string>();
  for (const item of catalog) {
    if (!ownVisible(item)) continue;
    visibleIds.add(item.id);
    if (item.parentId) visibleIds.add(item.parentId);
  }
  return catalog
    .filter((item) => visibleIds.has(item.id))
    .sort(byOrder)
    .map((item) => {
      const grant = grantById.get(item.id);
      const own = ownVisible(item);
      return {
        id: item.id,
        key: item.key,
        label: item.label,
        // Groups (no path) are shown only to reach their visible children.
        path: own ? item.path : null,
        icon: item.icon,
        order: item.order,
        parentId: item.parentId,
        canView: own && Boolean(grant?.canView),
        canCreate: own && Boolean(grant?.canCreate),
        canEdit: own && Boolean(grant?.canEdit),
        canDelete: own && Boolean(grant?.canDelete),
      };
    });
}

/** Screens that belong to the platform owner, whatever role they hold in the active organization. */
export const platformOwnerPermissions = ['companies:write', 'menu:write'] as const;

export function withPlatformOwnerGrants(grants: readonly Grant[], catalog: readonly MenuRow[]): Grant[] {
  const have = new Set(grants.map((grant) => grant.menuItemId));
  const extra = catalog
    .filter((item) => item.permission && (platformOwnerPermissions as readonly string[]).includes(item.permission) && !have.has(item.id))
    .map((item) => ({ menuItemId: item.id, canView: true, canCreate: true, canEdit: true, canDelete: true }));
  return [...grants, ...extra];
}
/** Menu grants of a built-in role (owner, admin, ...), which are defined in code and not stored. */
export function builtInGrants(role: string, catalog: readonly MenuRow[]): Grant[] {
  const seed = systemRoleSeeds.find((candidate) => candidate.key === role);
  if (!seed) return [];
  const allowed = seed.menuKeys === 'all' ? null : new Set(seed.menuKeys.map(menuItemId));
  return allGrants(catalog.filter((item) => !allowed || allowed.has(item.id)), seed.flags);
}