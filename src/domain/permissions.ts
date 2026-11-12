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
  'dose:log', 'dose:correct', 'inventory:purchase', 'inventory:adjust', 'inventory:settings:write',
] as const;
export type Action = (typeof actions)[number];

/** What the signed-in member's role allows. Loaded from the database, never from code. */
export type PermissionSet = ReadonlySet<Action>;

export const isAction = (value: string): value is Action => (actions as readonly string[]).includes(value);

/** Keeps only known actions, so a stale permission stored on a role can never grant anything. */
export const toPermissionSet = (values: readonly string[]): PermissionSet => new Set(values.filter(isAction));

export const puede = (permissions: PermissionSet, action: Action): boolean => permissions.has(action);
