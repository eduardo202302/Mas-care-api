import type { Role as BaseRole } from './roles.js';

export type MenuSeed = {
  key: string;
  label: string;
  path: string | null;
  icon: string;
  order: number;
  permission: string | null;
  parentKey: string | null;
};

// Initial menu catalog. Mirrors the routes registered in max-care-web.
// The same rows are inserted by the `menu_roles` migration; after that the
// catalog is managed from the API (/api/v1/menu).
export const menuSeeds: readonly MenuSeed[] = [
  { key: 'inicio', label: 'Panel del día', path: '/inicio', icon: 'activity', order: 10, permission: null, parentKey: null },
  { key: 'tablero', label: 'Tablero', path: '/tablero', icon: 'kanban', order: 15, permission: null, parentKey: null },
  { key: 'incidencias', label: 'Incidencias', path: '/incidencias', icon: 'triangle-alert', order: 16, permission: null, parentKey: null },
  { key: 'tareas', label: 'Tareas', path: '/tareas', icon: 'list-checks', order: 20, permission: 'tasks:read', parentKey: null },
  { key: 'companias', label: 'Compañías', path: '/companias', icon: 'building-2', order: 30, permission: 'companies:write', parentKey: null },
  { key: 'pacientes', label: 'Pacientes', path: '/pacientes', icon: 'users', order: 40, permission: null, parentKey: null },
  { key: 'medicamentos', label: 'Medicamentos', path: '/medicamentos', icon: 'pill', order: 50, permission: null, parentKey: null },
  { key: 'ajustes', label: 'Ajustes', path: null, icon: 'settings-2', order: 60, permission: null, parentKey: null },
  { key: 'sucursales', label: 'Sucursales', path: '/ajustes/sucursales', icon: 'store', order: 61, permission: null, parentKey: 'ajustes' },
  { key: 'usuarios', label: 'Usuarios', path: '/ajustes/usuarios', icon: 'user-round', order: 62, permission: null, parentKey: 'ajustes' },
  { key: 'plantillas', label: 'Plantillas', path: '/ajustes/plantillas', icon: 'message-square-text', order: 63, permission: 'templates:read', parentKey: 'ajustes' },
  { key: 'umbrales', label: 'Umbrales', path: '/ajustes/umbrales', icon: 'sliders-horizontal', order: 64, permission: 'settings:read', parentKey: 'ajustes' },
  { key: 'roles', label: 'Roles', path: '/ajustes/roles', icon: 'shield-check', order: 65, permission: 'roles:read', parentKey: 'ajustes' },
  { key: 'menu', label: 'Menú', path: '/ajustes/menu', icon: 'list-tree', order: 66, permission: 'menu:write', parentKey: 'ajustes' },
  { key: 'existencias', label: 'Existencias', path: '/ajustes/existencias', icon: 'packages', order: 67, permission: 'stock:mark', parentKey: 'ajustes' },
];

export const menuItemId = (key: string) => `menu_${key}`;

export type PermissionFlags = { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean };
export type SystemRoleSeed = {
  key: BaseRole;
  name: string;
  description: string;
  menuKeys: readonly string[] | 'all';
  flags: PermissionFlags;
};

const common = ['inicio', 'tablero', 'incidencias', 'tareas', 'pacientes', 'medicamentos', 'ajustes', 'sucursales', 'usuarios', 'plantillas', 'umbrales', 'existencias'] as const;

export const systemRoleSeeds: readonly SystemRoleSeed[] = [
  { key: 'owner', name: 'Propietario', description: 'Acceso total a la organización.', menuKeys: 'all', flags: { canView: true, canCreate: true, canEdit: true, canDelete: true } },
  { key: 'admin', name: 'Administrador de farmacia', description: 'Gestiona la farmacia, usuarios y roles.', menuKeys: 'all', flags: { canView: true, canCreate: true, canEdit: true, canDelete: true } },
  { key: 'pharmacist', name: 'Farmacéutico', description: 'Gestiona pacientes, tratamientos y entregas.', menuKeys: common, flags: { canView: true, canCreate: true, canEdit: true, canDelete: true } },
  { key: 'operator', name: 'Operador/Auxiliar', description: 'Registra pacientes y tratamientos.', menuKeys: common, flags: { canView: true, canCreate: true, canEdit: true, canDelete: false } },
  { key: 'read_only', name: 'Solo lectura', description: 'Consulta sin modificar datos.', menuKeys: common, flags: { canView: true, canCreate: false, canEdit: false, canDelete: false } },
];
