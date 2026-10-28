import { z } from 'zod';
import { pagingFields } from '../infra/pagination.js';

export const transferParams = z.object({ id: z.string().min(1) });

export const transferInput = z.object({
  to_branch_id: z.string().min(1),
  reason: z.string().trim().min(1).max(2000),
  treatment_ids: z.array(z.string().min(1)).min(1).optional(),
  confirm_stock_warning: z.boolean().optional(),
}).strict();

export const transferHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).max(200).optional(),
});

/** Patient-scoped history: no branch_id filter needed, the patient id in the path already scopes it. */
export const patientTransferListQuery = z.object({
  ...pagingFields,
});

/**
 * Global listing filter decision: `branch_id` matches a transfer where that
 * branch was EITHER the origin OR the destination (an owner/admin reviewing
 * one branch wants to see patients that left it as well as patients that
 * arrived into it — restricting to only one side would hide half the
 * relevant activity for that branch).
 */
export const transferListQuery = z.object({
  branch_id: z.string().min(1).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  ...pagingFields,
});
