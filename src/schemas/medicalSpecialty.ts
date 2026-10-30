import { z } from 'zod';
import { pagingFields } from '../infra/pagination.js';

const specialtyFields = {
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
};

export const specialtyCreate = z.object(specialtyFields).strict();
export const specialtyPatch = z.object(specialtyFields).partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');
export const specialtyParams = z.object({ id: z.string().min(1) });
export const specialtyListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  ...pagingFields,
});
