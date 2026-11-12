import { z } from 'zod';
import { actions } from '../domain/permissions.js';

export const roleGrantInput = z.object({
  menuItemId: z.string().min(1),
  canView: z.boolean().default(true),
  canCreate: z.boolean().default(false),
  canEdit: z.boolean().default(false),
  canDelete: z.boolean().default(false),
}).strict();

const roleFields = {
  name: z.string().trim().min(2, 'Mínimo 2 caracteres.').max(80),
  description: z.string().trim().max(300).nullable(),
  permissions: z.array(z.enum(actions)).max(actions.length),
  allBranches: z.boolean(),
  isActive: z.boolean(),
  items: z.array(roleGrantInput).max(200),
};

export const roleCreate = z.object({
  name: roleFields.name,
  description: roleFields.description.optional(),
  permissions: roleFields.permissions.default([]),
  allBranches: roleFields.allBranches.optional(),
  isActive: roleFields.isActive.optional(),
  items: roleFields.items.default([]),
}).strict();

export const rolePatch = z.object({
  name: roleFields.name,
  description: roleFields.description,
  permissions: roleFields.permissions,
  allBranches: roleFields.allBranches,
  isActive: roleFields.isActive,
  items: roleFields.items,
}).partial().strict().refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');

export const roleParams = z.object({ id: z.string().min(1) });
export const roleListQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  rows: z.coerce.number().int().min(1).max(100).optional(),
  active: z.enum(['true', 'false']).optional().transform((value) => value === undefined ? undefined : value === 'true'),
});

export const roleSchema = z.object({
  id: z.string(), numericId: z.string(), key: z.string().nullable(), name: z.string(), description: z.string().nullable(),
  permissions: z.array(z.string()), allBranches: z.boolean(), isSystem: z.boolean(), isActive: z.boolean(), memberCount: z.number().int(),
  items: z.array(z.object({
    menuItemId: z.string(), canView: z.boolean(), canCreate: z.boolean(), canEdit: z.boolean(), canDelete: z.boolean(),
  })),
});
