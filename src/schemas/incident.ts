import { z } from 'zod';

export const incidentTypes = [
  'prescription_expired',
  'out_of_stock',
  'patient_no_response',
  'patient_reported',
] as const;
export const incidentStatuses = ['new', 'in_progress', 'resolved'] as const;

const description = z.string().trim().min(1).max(5000);

export const incidentCreate = z.object({
  branch_id: z.string().min(1),
  type: z.enum(incidentTypes),
  status: z.enum(['new', 'in_progress']).optional(),
  patient_id: z.string().min(1).nullable().optional(),
  treatment_id: z.string().min(1).nullable().optional(),
  cycle_id: z.string().min(1).nullable().optional(),
  assigned_to: z.string().min(1).nullable().optional(),
  description,
}).strict();

export const incidentPatch = z.object({
  branch_id: z.string().min(1).optional(),
  type: z.enum(incidentTypes).optional(),
  status: z.enum(['new', 'in_progress']).optional(),
  patient_id: z.string().min(1).nullable().optional(),
  treatment_id: z.string().min(1).nullable().optional(),
  cycle_id: z.string().min(1).nullable().optional(),
  assigned_to: z.string().min(1).nullable().optional(),
  description: description.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');

export const incidentListQuery = z.object({
  branch_id: z.string().min(1).optional(),
  status: z.enum(incidentStatuses).optional(),
  type: z.enum(incidentTypes).optional(),
  assigned_to: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
}).strict();

export const incidentMoveInput = z.object({
  to_status: z.enum(incidentStatuses),
  after_id: z.string().min(1).nullable().optional(),
  before_id: z.string().min(1).nullable().optional(),
}).strict();

export const incidentResolveInput = z.object({
  resolution: z.string().trim().min(1, 'La resolución es obligatoria').max(5000),
}).strict();

export const incidentParams = z.object({ id: z.string().min(1) });
