import { z } from 'zod';

export const inventoryAdjustInput = z.object({
  quantity_delta: z.coerce.number().min(-99999999.999).max(99999999.999).refine((value) => value !== 0, 'El ajuste no puede ser cero'),
  note: z.string().trim().min(1, 'Explica el motivo del ajuste').max(2000),
}).strict();

export const inventoryThresholdInput = z.object({
  low_inventory_threshold: z.coerce.number().positive().max(99999999.999).nullable(),
}).strict();

export const inventoryEntriesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
