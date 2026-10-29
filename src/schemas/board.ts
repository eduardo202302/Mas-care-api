import { z } from 'zod';
import { derivedStatuses } from '../domain/coverage.js';
import { boardColumns, refillCycleStatuses } from '../domain/cycleTransitions.js';

const isoDate = z.string().date();

/** One filter schema shared by the board, its columns and the table view. */
export const boardFilterFields = {
  branch_id: z.string().min(1).optional(),
  responsible_user_id: z.string().min(1).optional(),
  medication_id: z.string().min(1).optional(),
  derived_status: z.enum(derivedStatuses).optional(),
  q: z.string().trim().min(1).max(160).optional(),
  expected_from: isoDate.optional(),
  expected_to: isoDate.optional(),
};

export const boardQuery = z.object(boardFilterFields).strict();

export const boardColumnsQuery = z.object({
  ...boardFilterFields,
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
}).strict();

export const boardColumnParams = z.object({ status: z.enum(boardColumns) });


export const cycleMoveInput = z.object({
  to_status: z.enum(refillCycleStatuses),
  after_id: z.string().min(1).nullable().optional(),
  before_id: z.string().min(1).nullable().optional(),
  expected_version: z.coerce.number().int().min(0),
  confirm_out_of_stock: z.boolean().optional(),
}).strict();

export const cycleExpectedOnInput = z.object({
  expected_on: isoDate,
  reason: z.string().trim().min(1).max(1000).optional(),
  expected_version: z.coerce.number().int().min(0),
}).strict();

export const cycleCreateInput = z.object({
  treatment_id: z.string().min(1),
  status: z.enum(['to_notify', 'notified', 'confirmed', 'prepared']).default('to_notify'),
}).strict();

export const eligibleTreatmentsQuery = z.object({
  q: z.string().trim().max(100).optional(),
}).strict();

const csvIds = z.string().min(1).max(2000).transform((value) => value.split(',').map((id) => id.trim()).filter(Boolean)).pipe(z.array(z.string().min(1)).min(1).max(50));

export const cycleSortFields = ['expected_on', 'created_at', 'coverage_end_on', 'derived_status', 'status', 'patient', 'medication'] as const;
const sortParam = z.string().max(200).transform((value) => value.split(',').filter(Boolean)).pipe(
  z.array(z.string().regex(/^[a-z_]+:(asc|desc)$/)).max(3),
).refine((parts) => parts.every((part) => (cycleSortFields as readonly string[]).includes(part.split(':')[0]!)), 'Campo de orden desconocido');

/** Table-only filters: dates, association sets combinable with and/or, and multi-sort. */
export const cycleTableFields = {
  created_from: isoDate.optional(),
  created_to: isoDate.optional(),
  activity_from: isoDate.optional(),
  activity_to: isoDate.optional(),
  coverage_from: isoDate.optional(),
  coverage_to: isoDate.optional(),
  patient_ids: csvIds.optional(),
  medication_ids: csvIds.optional(),
  branch_ids: csvIds.optional(),
  responsible_ids: csvIds.optional(),
  treatment_ids: csvIds.optional(),
  match: z.enum(['and', 'or']).default('and'),
  stage_id: z.string().min(1).max(60).optional(),
  cp_key: z.string().max(60).optional(),
  cp_value: z.string().max(200).optional(),
  sort: sortParam.optional(),
};

export const cycleBatchInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign_responsible'), responsible_user_id: z.string().min(1).nullable() }),
  z.object({ action: z.literal('change_stage'), to_status: z.enum(['to_notify', 'notified', 'confirmed', 'prepared']), confirm_out_of_stock: z.boolean().optional() }),
  z.object({ action: z.literal('create_tasks'), title: z.string().trim().min(1).max(160), assigned_to: z.string().min(1).nullable().optional(), due_on: isoDate.optional() }),
  z.object({ action: z.literal('archive'), reason: z.string().trim().min(1).max(500).optional() }),
]).and(z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  confirm: z.literal(true, { errorMap: () => ({ message: 'La acción por lote requiere confirmación' }) }),
}));

export const cycleListQuery = z.object({
  ...boardFilterFields,
  ...cycleTableFields,
  status: z.enum(refillCycleStatuses).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
}).strict();
