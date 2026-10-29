import { z } from 'zod';

export const messageChannel = z.enum(['whatsapp', 'call', 'telegram']);

const templateFields = {
  channel: messageChannel,
  kind: z.string().trim().min(1).max(60).default('refill_notice'),
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
  branch_id: z.string().min(1).nullable().optional(),
  is_active: z.boolean().optional(),
  // WhatsApp template registered in Meta. Only `approved` templates are sent automatically.
  wa_template_name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'Minúsculas, números y _ como en Meta').nullable().optional(),
  wa_language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'Código de idioma como es o es_MX').optional(),
  wa_status: z.enum(['draft', 'pending', 'approved', 'rejected']).optional(),
  wa_category: z.enum(['utility', 'marketing', 'authentication']).nullable().optional(),
  // 1 = first notice, 2 = reminder, 3 = last reminder.
  attempt_number: z.number().int().min(1).max(10).optional(),
};

export const templateCreate = z.object(templateFields).strict().refine(
  (value) => value.wa_status !== 'approved' || Boolean(value.wa_template_name),
  { message: 'Una plantilla aprobada necesita el nombre registrado en Meta', path: ['wa_template_name'] },
);
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

export const templateTestSend = z.object({ phone: z.string().trim().min(7).max(25) }).strict();
