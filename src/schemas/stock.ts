import { z } from 'zod';

export const stockLevels = ['in_stock', 'low', 'out_of_stock'] as const;

export const stockMarkQuery = z.object({
  branch_id: z.string().min(1).optional(),
  medication_id: z.string().min(1).optional(),
}).strict();

export const stockMarkInput = z.object({
  level: z.enum(stockLevels),
}).strict();

export const stockMarkParams = z.object({
  branchId: z.string().min(1),
  medicationId: z.string().min(1),
});
