import { z } from 'zod';

export const exportEntities = ['patients', 'medications', 'cycles'] as const;
export type ExportEntity = (typeof exportEntities)[number];

export const exportParams = z.object({ entity: z.enum(exportEntities) });

export const exportInput = z.object({
  format: z.enum(['csv', 'xlsx']),
  columns: z.array(z.string().min(1).max(60)).min(1).max(40),
  q: z.string().trim().max(100).optional(),
  branchId: z.string().min(1).optional(),
  status: z.enum(['to_notify', 'notified', 'confirmed', 'prepared', 'delivered', 'not_picked_up', 'cancelled']).optional(),
}).strict();
