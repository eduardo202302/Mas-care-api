import { z } from 'zod';

const isoDate = z.string().date();
const pickedUpBy = z.enum(['patient', 'caregiver', 'home_delivery', 'other']);
const messageChannel = z.enum(['whatsapp', 'call']);

export const deliveryInput = z.object({
  quantity: z.coerce.number().positive().max(99999999.99),
  delivered_on: isoDate,
  picked_up_by: pickedUpBy,
  picked_up_by_name: z.string().trim().min(1).max(160).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
}).strict();

export const deliveryHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).max(200).optional(),
});

export const cycleParams = z.object({ id: z.string().min(1) });

export const noticePreviewQuery = z.object({
  channel: messageChannel.optional(),
});

export const noticeLoggedInput = z.object({
  channel: messageChannel,
}).strict();
