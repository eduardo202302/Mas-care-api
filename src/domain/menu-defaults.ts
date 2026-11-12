
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
  { key: 'inicio', label: 'Panel del Día', path: '/inicio', icon: 'activity', order: 10, permission: null, parentKey: null },
  { key: 'tablero', label: 'Tablero', path: '/tablero', icon: 'kanban', order: 15, permission: null, parentKey: null },
  { key: 'incidencias', label: 'Incidencias', path: '/incidencias', icon: 'triangle-alert', order: 16, permission: null, parentKey: null },
  { key: 'avisos', label: 'Avisos', path: '/avisos', icon: 'send', order: 17, permission: 'outbox:view', parentKey: null },
  { key: 'tareas', label: 'Tareas', path: '/tareas', icon: 'list-checks', order: 20, permission: 'tasks:read', parentKey: null },
  { key: 'companias', label: 'Compañías', path: '/companias', icon: 'building-2', order: 30, permission: 'companies:write', parentKey: null },
  { key: 'trabajos', label: 'Trabajos', path: '/trabajos', icon: 'activity', order: 31, permission: 'companies:write', parentKey: null },
  { key: 'pacientes', label: 'Pacientes', path: '/pacientes', icon: 'users', order: 40, permission: null, parentKey: null },
  { key: 'tratamientos', label: 'Tratamientos', path: '/tratamientos', icon: 'clipboard-list', order: 45, permission: 'treatments:read', parentKey: null },
  { key: 'medicamentos', label: 'Medicamentos', path: '/medicamentos', icon: 'pill', order: 50, permission: null, parentKey: null },
  { key: 'ajustes', label: 'Ajustes', path: null, icon: 'settings-2', order: 60, permission: null, parentKey: null },
  { key: 'sucursales', label: 'Sucursales', path: '/ajustes/sucursales', icon: 'store', order: 61, permission: null, parentKey: 'ajustes' },
  { key: 'usuarios', label: 'Usuarios', path: '/ajustes/usuarios', icon: 'user-round', order: 62, permission: null, parentKey: 'ajustes' },
  { key: 'plantillas', label: 'Plantillas', path: '/ajustes/plantillas', icon: 'message-square-text', order: 63, permission: 'templates:read', parentKey: 'ajustes' },
  { key: 'umbrales', label: 'Parámetros de Tiempo', path: '/ajustes/umbrales', icon: 'sliders-horizontal', order: 64, permission: 'settings:read', parentKey: 'ajustes' },
  { key: 'roles', label: 'Roles', path: '/ajustes/roles', icon: 'shield-check', order: 65, permission: 'roles:read', parentKey: 'ajustes' },
  { key: 'menu', label: 'Menú', path: '/ajustes/menu', icon: 'list-tree', order: 66, permission: 'menu:write', parentKey: 'ajustes' },
  { key: 'existencias', label: 'Existencias', path: '/ajustes/existencias', icon: 'packages', order: 67, permission: 'stock:mark', parentKey: 'ajustes' },
  { key: 'etapas', label: 'Etapas del Tablero', path: '/ajustes/etapas', icon: 'kanban', order: 68, permission: 'settings:write', parentKey: 'ajustes' },
  { key: 'propiedades', label: 'Propiedades', path: '/ajustes/propiedades', icon: 'list-tree', order: 69, permission: 'settings:write', parentKey: 'ajustes' },
  { key: 'medicos', label: 'Médicos', path: '/medicos', icon: 'stethoscope', order: 51, permission: 'doctors:read', parentKey: null },
  { key: 'especialidades', label: 'Especialidades', path: '/especialidades', icon: 'award', order: 52, permission: 'specialties:read', parentKey: null },
  { key: 'centros_medicos', label: 'Centros Médicos', path: '/centros-medicos', icon: 'hospital', order: 53, permission: 'medical-centers:read', parentKey: null },
  { key: 'condiciones_salud', label: 'Condiciones de Salud', path: '/condiciones-salud', icon: 'heart-pulse', order: 54, permission: 'health-conditions:read', parentKey: null },
];

export const menuItemId = (key: string) => `menu_${key}`;

export type PermissionFlags = { canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean };
