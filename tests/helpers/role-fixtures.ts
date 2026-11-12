import { actions, type Action } from '../../src/domain/permissions.js';

// Fixtures for the integration tests only. The application has no built-in roles: these
// are ordinary database roles created by scripts/seed-test-roles.ts so the tests can
// exercise permission checks with limited roles. "admin" users hold the Master role.

export type FixtureRole = {
  /** Used in the e-mail of the fixture user: `${key}.a@maxcare.test`. */
  key: 'pharmacist' | 'operator' | 'read_only';
  name: string;
  allBranches: boolean;
  permissions: readonly Action[];
  /** Menu screens (by key) the role can see, with these action flags. */
  menu: { keys: readonly string[]; canCreate: boolean; canEdit: boolean; canDelete: boolean };
};

const commonMenu = ['inicio', 'tablero', 'incidencias', 'avisos', 'tareas', 'pacientes', 'tratamientos', 'medicamentos', 'ajustes', 'sucursales', 'usuarios', 'plantillas', 'umbrales', 'existencias', 'medicos', 'especialidades', 'centros_medicos', 'condiciones_salud'];

export const fixtureRoles: readonly FixtureRole[] = [
  {
    key: 'pharmacist',
    name: 'Prueba Farmacéutico',
    allBranches: false,
    permissions: [
      'branches:read', 'patients:read', 'patients:write', 'patients:archive',
      'medications:read', 'medications:write', 'treatments:read', 'treatments:write', 'treatments:manage',
      'dashboard:read', 'tasks:read', 'tasks:write', 'templates:read', 'templates:write',
      'audit:read', 'cycle:move', 'cycle:edit-date', 'stock:mark',
      'incident:create', 'incident:move', 'incident:resolve',
      'outbox:view', 'outbox:retry', 'inbound:assign', 'patient:transfer',
      'doctors:read', 'doctors:write', 'specialties:read', 'specialties:write',
      'medical-centers:read', 'medical-centers:write', 'health-conditions:read', 'health-conditions:write',
      'dose:log', 'dose:correct', 'inventory:purchase', 'inventory:adjust',
    ],
    menu: { keys: commonMenu, canCreate: true, canEdit: true, canDelete: true },
  },
  {
    key: 'operator',
    name: 'Prueba Operador',
    allBranches: false,
    permissions: [
      'branches:read', 'patients:read', 'patients:write', 'medications:read',
      'treatments:read', 'treatments:write', 'dashboard:read', 'tasks:read', 'tasks:write', 'templates:read',
      'cycle:move', 'stock:mark', 'incident:create', 'incident:move',
      'inbound:assign',
      'doctors:read', 'specialties:read', 'medical-centers:read', 'health-conditions:read',
      'dose:log', 'inventory:purchase',
    ],
    menu: { keys: commonMenu, canCreate: true, canEdit: true, canDelete: false },
  },
  {
    key: 'read_only',
    name: 'Prueba Solo lectura',
    allBranches: false,
    permissions: [
      'branches:read', 'patients:read', 'medications:read', 'treatments:read',
      'dashboard:read', 'tasks:read', 'templates:read',
      'doctors:read', 'specialties:read', 'medical-centers:read', 'health-conditions:read',
    ],
    menu: { keys: commonMenu, canCreate: false, canEdit: false, canDelete: false },
  },
];

export const allActions: readonly Action[] = actions;
