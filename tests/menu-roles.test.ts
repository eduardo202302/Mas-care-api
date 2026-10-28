import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { menuItemId, menuSeeds, systemRoleSeeds } from '../src/domain/menu-defaults.js';
import { allGrants, builtInGrants, normalizeGrants, resolveVisibleMenu, withPlatformOwnerGrants, type MenuRow } from '../src/domain/menu-tree.js';
import { menuCreate, menuPatch } from '../src/schemas/menu.js';
import { roleCreate, rolePatch } from '../src/schemas/role.js';

const catalog: MenuRow[] = menuSeeds.map((seed) => ({
  id: menuItemId(seed.key), key: seed.key, label: seed.label, path: seed.path, icon: seed.icon, order: seed.order,
  permission: seed.permission, parentId: seed.parentKey ? menuItemId(seed.parentKey) : null, isActive: true,
}));
const view = { canView: true, canCreate: false, canEdit: false, canDelete: false };

describe('menu catalog defaults', () => {
  it('matches the rows inserted by the migration', () => {
    const sql = readFileSync('prisma/migrations/20261027000000_menu_roles/migration.sql', 'utf8');
    for (const seed of menuSeeds) {
      expect(sql).toContain(`'${menuItemId(seed.key)}','${seed.key}','${seed.label}'`);
    }
    expect(sql.match(/\('menu_/g)).toHaveLength(menuSeeds.length);
  });

  it('uses unique keys and paths and only one level of nesting', () => {
    expect(new Set(menuSeeds.map((seed) => seed.key)).size).toBe(menuSeeds.length);
    const paths = menuSeeds.map((seed) => seed.path).filter(Boolean);
    expect(new Set(paths).size).toBe(paths.length);
    for (const seed of menuSeeds) {
      const parent = menuSeeds.find((item) => item.key === seed.parentKey);
      if (seed.parentKey) expect(parent?.parentKey).toBeNull();
    }
  });

  it('references only catalog keys from the system roles', () => {
    for (const role of systemRoleSeeds) {
      if (role.menuKeys === 'all') continue;
      for (const key of role.menuKeys) expect(menuSeeds.some((seed) => seed.key === key)).toBe(true);
    }
  });
});

describe('normalizeGrants', () => {
  it('pulls the parent in when a child is granted', () => {
    const { grants } = normalizeGrants([{ menuItemId: menuItemId('usuarios'), ...view }], catalog);
    expect(grants.map((grant) => grant.menuItemId).sort()).toEqual([menuItemId('ajustes'), menuItemId('usuarios')].sort());
  });

  it('treats create/edit/delete as implying view and drops empty grants', () => {
    const { grants } = normalizeGrants([
      { menuItemId: menuItemId('pacientes'), canView: false, canEdit: true },
      { menuItemId: menuItemId('tareas'), canView: false },
    ], catalog);
    expect(grants).toEqual([{ menuItemId: menuItemId('pacientes'), canView: true, canCreate: false, canEdit: true, canDelete: false }]);
  });

  it('reports unknown ids and dedupes', () => {
    const result = normalizeGrants([
      { menuItemId: 'nope' }, { menuItemId: menuItemId('inicio') }, { menuItemId: menuItemId('inicio') },
    ], catalog);
    expect(result.unknown).toEqual(['nope']);
    expect(result.grants).toHaveLength(1);
  });
});

describe('resolveVisibleMenu', () => {
  const grantsFor = (...keys: string[]) => keys.map((key) => ({ menuItemId: menuItemId(key), ...view }));

  it('hides items the role was not granted', () => {
    const menu = resolveVisibleMenu(catalog, grantsFor('inicio', 'pacientes'), new Set());
    expect(menu.map((item) => item.key)).toEqual(['inicio', 'pacientes']);
  });

  it('requires the API permission of the item as well', () => {
    const grants = grantsFor('inicio', 'ajustes', 'umbrales', 'usuarios');
    expect(resolveVisibleMenu(catalog, grants, new Set()).map((item) => item.key)).toEqual(['inicio', 'ajustes', 'usuarios']);
    expect(resolveVisibleMenu(catalog, grants, new Set(['settings:read'])).map((item) => item.key)).toContain('umbrales');
  });

  it('shows a group only when one of its children is visible', () => {
    const menu = resolveVisibleMenu(catalog, grantsFor('ajustes', 'umbrales'), new Set());
    expect(menu).toEqual([]);
  });

  it('keeps a group that is reachable only through its children as a pure group', () => {
    const menu = resolveVisibleMenu(catalog, grantsFor('usuarios'), new Set());
    const group = menu.find((item) => item.key === 'ajustes');
    expect(group).toMatchObject({ path: null, parentId: null, canView: false });
  });

  it('skips inactive items and the children of inactive parents', () => {
    const inactive = catalog.map((item) => (item.key === 'ajustes' ? { ...item, isActive: false } : item));
    const menu = resolveVisibleMenu(inactive, grantsFor('inicio', 'ajustes', 'usuarios'), new Set());
    expect(menu.map((item) => item.key)).toEqual(['inicio']);
  });

  it('gives the owner the whole catalog allowed by their permissions', () => {
    const grants = allGrants(catalog, { canView: true, canCreate: true, canEdit: true, canDelete: true });
    const menu = resolveVisibleMenu(catalog, grants, new Set(['tasks:read', 'templates:read', 'settings:read', 'roles:read']));
    expect(menu.map((item) => item.key)).not.toContain('companias');
    expect(menu.map((item) => item.key)).not.toContain('menu');
    expect(menu.map((item) => item.key)).toContain('roles');
  });
});

describe('withPlatformOwnerGrants', () => {
  const ownerPermissions = new Set(['companies:write', 'menu:write']);

  it('gives the platform owner Compañías and Menú even with a low role', () => {
    const base = [{ menuItemId: menuItemId('inicio'), ...view }];
    const menu = resolveVisibleMenu(catalog, withPlatformOwnerGrants(base, catalog), ownerPermissions);
    expect(menu.map((item) => item.key)).toEqual(expect.arrayContaining(['inicio', 'companias', 'ajustes', 'menu']));
    expect(menu.map((item) => item.key)).not.toContain('pacientes');
  });

  it('does not grant them to a regular user, who lacks the permission', () => {
    const menu = resolveVisibleMenu(catalog, withPlatformOwnerGrants([], catalog), new Set());
    expect(menu).toEqual([]);
  });

  it('keeps existing grants untouched', () => {
    const base = [{ menuItemId: menuItemId('menu'), canView: true, canCreate: false, canEdit: false, canDelete: false }];
    const result = withPlatformOwnerGrants(base, catalog);
    expect(result.filter((grant) => grant.menuItemId === menuItemId('menu'))).toEqual(base);
  });
});

describe('builtInGrants', () => {
  it('gives the owner and admin the whole catalog', () => {
    expect(builtInGrants('owner', catalog)).toHaveLength(catalog.length);
    expect(builtInGrants('admin', catalog)).toHaveLength(catalog.length);
  });

  it('limits the other built-in roles to the common screens', () => {
    const keys = builtInGrants('operator', catalog).map((grant) => grant.menuItemId);
    expect(keys).toContain(menuItemId('pacientes'));
    expect(keys).not.toContain(menuItemId('roles'));
    expect(keys).not.toContain(menuItemId('menu'));
  });

  it('applies the action flags of the role', () => {
    const [grant] = builtInGrants('read_only', catalog);
    expect(grant).toMatchObject({ canView: true, canCreate: false, canEdit: false, canDelete: false });
  });

  it('returns nothing for an unknown role', () => {
    expect(builtInGrants('member', catalog)).toEqual([]);
  });
});

describe('menu and role schemas', () => {
  it('validates menu items', () => {
    expect(menuCreate.safeParse({ key: 'x_y', label: 'X', path: '/x' }).success).toBe(true);
    expect(menuCreate.safeParse({ key: 'Bad Key', label: 'X' }).success).toBe(false);
    expect(menuCreate.safeParse({ key: 'ok', label: 'X', path: 'no-slash' }).success).toBe(false);
    expect(menuPatch.safeParse({}).success).toBe(false);
    expect(menuPatch.safeParse({ isActive: false }).success).toBe(true);
  });

  it('validates roles and refuses to create owners', () => {
    expect(roleCreate.safeParse({ name: 'Caja', baseRole: 'operator' }).success).toBe(true);
    expect(roleCreate.safeParse({ name: 'Caja', baseRole: 'owner' }).success).toBe(false);
    expect(roleCreate.safeParse({ name: 'C', baseRole: 'operator' }).success).toBe(false);
    expect(rolePatch.safeParse({}).success).toBe(false);
  });
});

describe('menu and role endpoints', () => {
  it('are documented in OpenAPI', async () => {
    const document = (await request(app).get('/api/v1/openapi.json').expect(200)).body;
    for (const path of ['/api/v1/menu', '/api/v1/menu/reorder', '/api/v1/menu/{id}', '/api/v1/roles', '/api/v1/roles/{id}']) {
      expect(document.paths[path]).toBeDefined();
    }
    expect(document.paths['/api/v1/menu'].post).toBeDefined();
    expect(document.paths['/api/v1/roles/{id}'].delete).toBeDefined();
    expect(document.components.schemas.Role).toBeDefined();
    expect(document.components.schemas.MenuItem).toBeDefined();
    expect(document.components.schemas.Me.properties.menu).toBeDefined();
  });

  it('require authentication', async () => {
    expect((await request(app).get('/api/v1/menu')).status).toBe(401);
    expect((await request(app).get('/api/v1/roles')).status).toBe(401);
  });
});
