import { z } from 'zod';

const isoDate = z.string().date();
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

export const externalPurchaseInput = z.object({
  quantity: z.coerce.number().positive().max(99999999.999),
  presentation: optionalText(160),
  purchased_on: isoDate,
  place: optionalText(160),
  notes: z.string().trim().max(5000).nullable().optional(),
}).strict();
