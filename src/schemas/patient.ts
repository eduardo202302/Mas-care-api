import { z } from 'zod';
import { pagingFields } from '../infra/pagination.js';

export const contactChannel = z.enum(['whatsapp', 'call', 'sms', 'telegram']);
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
  customValues: z.record(z.string(), z.unknown()).optional(),
};

export const patientCreate = z.object(patientFields);
export const patientPatch = z.object(patientFields).partial()
  .refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');
export const patientParams = z.object({ id: z.string().min(1) });

export const patientSortFields = ['created_at', 'full_name', 'document_id', 'birth_date'] as const;
const patientSort = z.string().max(200).transform((value) => value.split(',').filter(Boolean)).pipe(
  z.array(z.string().regex(/^[a-z_]+:(asc|desc)$/)).max(3),
).refine((parts) => parts.every((part) => (patientSortFields as readonly string[]).includes(part.split(':')[0]!)), 'Campo de orden desconocido');

export const patientListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  branchId: z.string().optional(),
  responsibleUserId: z.string().optional(),
  archived: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  sort: patientSort.optional(),
  cp_key: z.string().max(60).optional(),
  cp_value: z.string().max(200).optional(),
  created_from: z.string().date().optional(),
  created_to: z.string().date().optional(),
  activity_from: z.string().date().optional(),
  activity_to: z.string().date().optional(),
  expected_from: z.string().date().optional(),
  expected_to: z.string().date().optional(),
  coverage_from: z.string().date().optional(),
  coverage_to: z.string().date().optional(),
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
  type: z.enum(['note', 'call', 'email', 'meeting']),
  body: z.string().trim().min(1).max(5000),
  // Email and meeting entries are dated by the user; notes and calls default to now.
  occurredOn: z.string().date().optional(),
  treatmentId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict();
export const activityListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().optional(), treatment_id: z.string().optional() });
