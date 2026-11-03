import { z } from 'zod';
import { pagingFields } from '../infra/pagination.js';

export const companyActivityTypes = ['note', 'email', 'call', 'meeting', 'task'] as const;

export const companyActivityCreate = z
  .object({
    type: z.enum(companyActivityTypes),
    title: z.string().trim().max(200).nullable().optional(),
    body: z.string().trim().max(5000).nullable().optional(),
    contactName: z.string().trim().max(160).nullable().optional(),
    dueAt: z.coerce.date().nullable().optional(),
    occurredAt: z.coerce.date().optional(),
  })
  .strict();

export const companyActivityPatch = z
  .object({
    title: z.string().trim().max(200).nullable().optional(),
    body: z.string().trim().max(5000).nullable().optional(),
    contactName: z.string().trim().max(160).nullable().optional(),
    dueAt: z.coerce.date().nullable().optional(),
    completed: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');

export const companyActivityListQuery = z.object({
  type: z.enum(companyActivityTypes).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  ...pagingFields,
});

export const companyActivityParams = z.object({ id: z.string().min(1), activityId: z.string().min(1) });
