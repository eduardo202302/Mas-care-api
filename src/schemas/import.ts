import { z } from 'zod';

export const columnMapping = z.record(z.string(), z.string().min(1));

export const importRequest = z.object({
  filename: z.string().trim().min(1).max(255).optional(),
  column_mapping: columnMapping,
  csv: z.string().min(1).optional(),
}).strict();

export const importPreviewQuery = z.object({});
