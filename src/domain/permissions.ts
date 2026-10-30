import type { Role } from './roles.js';

export const actions = [
  'branches:read', 'branches:write', 'patients:read', 'patients:write', 'patients:archive',
  'medications:read', 'medications:write', 'treatments:read', 'treatments:write', 'treatments:manage',
  'dashboard:read', 'tasks:read', 'tasks:write', 'templates:read', 'templates:write', 'imports:write',
  'settings:read', 'settings:write', 'audit:read', 'users:write', 'roles:read', 'roles:write',
  'cycle:move', 'cycle:edit-date', 'stock:mark', 'incident:create', 'incident:move', 'incident:resolve',
  'automation:manage', 'outbox:view', 'outbox:retry', 'inbound:assign',
  'patient:transfer', 'export:csv',
  'doctors:read', 'doctors:write', 'specialties:read', 'specialties:write',
  'medical-centers:read', 'medical-centers:write', 'health-conditions:read', 'health-conditions:write',
] as const;
export type Action = (typeof actions)[number];
const grants: Record<Role, readonly Action[]> = {
  owner: actions,
  admin: actions,
  pharmacist: [
    'branches:read', 'patients:read', 'patients:write', 'patients:archive',
    'medications:read', 'medications:write', 'treatments:read', 'treatments:write', 'treatments:manage',
    'dashboard:read', 'tasks:read', 'tasks:write', 'templates:read', 'templates:write',
    'audit:read', 'cycle:move', 'cycle:edit-date', 'stock:mark',
    'incident:create', 'incident:move', 'incident:resolve',
    'outbox:view', 'outbox:retry', 'inbound:assign', 'patient:transfer',
    'doctors:read', 'doctors:write', 'specialties:read', 'specialties:write',
    'medical-centers:read', 'medical-centers:write', 'health-conditions:read', 'health-conditions:write',
  ],
  operator: [
    'branches:read', 'patients:read', 'patients:write', 'medications:read',
    'treatments:read', 'treatments:write', 'dashboard:read', 'tasks:read', 'tasks:write', 'templates:read',
    'cycle:move', 'stock:mark', 'incident:create', 'incident:move',
    'inbound:assign',
    'doctors:read', 'specialties:read', 'medical-centers:read', 'health-conditions:read',
  ],
  read_only: [
    'branches:read', 'patients:read', 'medications:read', 'treatments:read',
    'dashboard:read', 'tasks:read', 'templates:read',
    'doctors:read', 'specialties:read', 'medical-centers:read', 'health-conditions:read',
  ],
};
export const puede = (role: Role, action: Action): boolean => grants[role].includes(action);
export const permissionsFor = (role: Role): readonly Action[] => grants[role];
