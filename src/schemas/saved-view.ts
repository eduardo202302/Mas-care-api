import { z } from 'zod';

export const savedViewEntity = z.enum(['patients', 'cycles', 'patients_columns', 'cycles_columns']);
export const savedViewCreate = z.object({
  entity: savedViewEntity,
  name: z.string().trim().min(1).max(100),
  filters: z.record(z.string(), z.unknown()).default({}),
  columns: z.array(z.string().min(1).max(80)).max(100).default([]),
  sort: z.record(z.string(), z.unknown()).default({}),
  isDefault: z.boolean().default(false),
}).strict();
export const savedViewPatch = savedViewCreate.omit({ entity: true }).partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');
export const savedViewQuery = z.object({ entity: savedViewEntity });
export const savedViewParams = z.object({ id: z.string().min(1) });
