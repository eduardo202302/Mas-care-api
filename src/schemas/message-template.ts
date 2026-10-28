import { z } from 'zod';

export const messageChannel = z.enum(['whatsapp', 'call']);

const templateFields = {
  channel: messageChannel,
  kind: z.string().trim().min(1).max(60).default('refill_notice'),
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
  branch_id: z.string().min(1).nullable().optional(),
  is_active: z.boolean().optional(),
};

export const templateCreate = z.object(templateFields).strict();
export const templatePatch = z.object({
  ...templateFields,
  channel: templateFields.channel.optional(),
  kind: templateFields.kind.optional(),
  name: templateFields.name.optional(),
  body: templateFields.body.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');
export const templateParams = z.object({ id: z.string().min(1) });

export const templateListQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  rows: z.coerce.number().int().min(1).max(100).optional(),
  channel: messageChannel.optional(),
  kind: z.string().optional(),
  branch_id: z.string().optional(),
  active: z.enum(['true', 'false']).optional().transform((value) => value === undefined ? undefined : value === 'true'),
});
