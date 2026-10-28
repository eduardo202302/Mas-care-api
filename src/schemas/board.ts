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

export const cycleListQuery = z.object({
  ...boardFilterFields,
  status: z.enum(refillCycleStatuses).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
}).strict();

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
