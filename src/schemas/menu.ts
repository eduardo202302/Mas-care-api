import { z } from 'zod';

const menuFields = {
  key: z.string().trim().regex(/^[a-z0-9_]{2,40}$/, 'Usa minúsculas, números o guion bajo (2 a 40).'),
  label: z.string().trim().min(1).max(60),
  path: z.string().trim().regex(/^\/[A-Za-z0-9\-_/]*$/, 'La ruta debe empezar con / y no tener espacios.').max(120).nullable(),
  icon: z.string().trim().regex(/^[a-z0-9-]{1,40}$/, 'Nombre de ícono inválido.'),
  order: z.number().int().min(0).max(100000),
  isActive: z.boolean(),
  permission: z.string().trim().min(1).max(60).nullable(),
  parentId: z.string().min(1).nullable(),
};

export const menuCreate = z.object({
  key: menuFields.key,
  label: menuFields.label,
  path: menuFields.path.default(null),
  icon: menuFields.icon.default('circle'),
  order: menuFields.order.default(0),
  isActive: menuFields.isActive.default(true),
  permission: menuFields.permission.default(null),
  parentId: menuFields.parentId.default(null),
}).strict();

export const menuPatch = z.object({
  label: menuFields.label,
  path: menuFields.path,
  icon: menuFields.icon,
  order: menuFields.order,
  isActive: menuFields.isActive,
  permission: menuFields.permission,
  parentId: menuFields.parentId,
}).partial().strict().refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');

export const menuReorder = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    order: menuFields.order,
    parentId: menuFields.parentId.optional(),
  }).strict()).min(1).max(200),
}).strict();

export const menuParams = z.object({ id: z.string().min(1) });
export const menuListQuery = z.object({
  includeInactive: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
});

export const menuItemSchema = z.object({
  id: z.string(), key: z.string(), label: z.string(), path: z.string().nullable(), icon: z.string(),
  order: z.number().int(), isActive: z.boolean(), permission: z.string().nullable(), parentId: z.string().nullable(),
});
