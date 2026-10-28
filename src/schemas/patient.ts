import { z } from 'zod';
import { pagingFields } from '../infra/pagination.js';

export const contactChannel = z.enum(['whatsapp', 'call', 'sms']);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const patientFields = {
  primaryBranchId: z.string().min(1),
  fullName: z.string().trim().min(1).max(160),
  documentId: optionalText(100),
  birthDate: z.string().date().nullable().optional(),
  phone: optionalText(40),
  phoneHasWhatsapp: z.boolean().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  address: optionalText(500),
  zone: optionalText(120),
  preferredChannel: contactChannel.optional(),
  careNotes: z.string().trim().max(5000).nullable().optional(),
  responsibleUserId: z.string().min(1).nullable().optional(),
};

export const patientCreate = z.object(patientFields);
export const patientPatch = z.object(patientFields).partial()
  .refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');
export const patientParams = z.object({ id: z.string().min(1) });

export const patientListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  branchId: z.string().optional(),
  responsibleUserId: z.string().optional(),
  archived: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  ...pagingFields,
});

export const duplicateCheck = z.object({
  documentId: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().min(1).max(40).optional(),
}).strict().refine((value) => value.documentId || value.phone, 'Documento o teléfono requerido');

export const caregiverInput = z.object({
  fullName: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(1).max(40),
  relationship: z.string().trim().min(1).max(80),
  isPrimary: z.boolean().default(false),
}).strict();
export const caregiverPatch = caregiverInput.partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');
export const caregiverParams = patientParams.extend({ caregiverId: z.string().min(1) });

export const consentInput = z.object({
  granted: z.boolean(),
  channel: contactChannel,
  evidence: z.string().trim().max(1000).nullable().optional(),
}).strict();

export const activityInput = z.object({
  type: z.enum(['note', 'call']),
  body: z.string().trim().min(1).max(5000),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();
export const activityListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().optional() });
