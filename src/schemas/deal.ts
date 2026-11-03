import { z } from 'zod';
import { pagingFields } from '../infra/pagination.js';

export const dealPipelines = ['sales'] as const;
export const dealStages = [
  'appointment_scheduled',
  'qualified_to_buy',
  'presentation_scheduled',
  'decision_maker_bought_in',
  'contract_sent',
  'closed_won',
  'closed_lost',
] as const;
export const dealTypes = ['new_business', 'existing_business'] as const;
export const dealPriorities = ['low', 'medium', 'high'] as const;

export const dealLineItemInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    quantity: z.coerce.number().min(0.01).default(1),
    unitPrice: z.coerce.number().min(0),
  })
  .strict();

export const dealCreate = z
  .object({
    name: z.string().trim().min(1).max(200),
    pipeline: z.enum(dealPipelines).optional(),
    stage: z.enum(dealStages).optional(),
    dealType: z.enum(dealTypes).optional(),
    priority: z.enum(dealPriorities).optional(),
    amount: z.coerce.number().min(0).nullable().optional(),
    closeDate: z.coerce.date().nullable().optional(),
    ownerUserId: z.string().trim().min(1).nullable().optional(),
    contactId: z.string().trim().min(1).nullable().optional(),
    lineItems: z.array(dealLineItemInput).optional(),
  })
  .strict();

export const dealPatch = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    pipeline: z.enum(dealPipelines).optional(),
    stage: z.enum(dealStages).optional(),
    dealType: z.enum(dealTypes).optional(),
    priority: z.enum(dealPriorities).optional(),
    amount: z.coerce.number().min(0).nullable().optional(),
    closeDate: z.coerce.date().nullable().optional(),
    ownerUserId: z.string().trim().min(1).nullable().optional(),
    contactId: z.string().trim().min(1).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');

export const dealListQuery = z.object({
  ...pagingFields,
});

export const dealParams = z.object({ id: z.string().min(1), dealId: z.string().min(1) });
