import { z } from 'zod';
import { pagingFields } from '../infra/pagination.js';

export const taskTypes = ['call', 'renew_prescription', 'prepare_delivery', 'other'] as const;
export const taskStatuses = ['open', 'done', 'cancelled'] as const;
export const taskFilters = ['all', 'today', 'overdue', 'upcoming'] as const;

const taskFields = {
  type: z.enum(taskTypes),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  due_at: z.coerce.date().nullable().optional(),
  assigned_to: z.string().min(1).nullable().optional(),
  branch_id: z.string().min(1).nullable().optional(),
  patient_id: z.string().min(1).nullable().optional(),
  treatment_id: z.string().min(1).nullable().optional(),
  cycle_id: z.string().min(1).nullable().optional(),
  auto_generated: z.boolean().optional(),
};

export const taskCreate = z.object(taskFields).strict();
export const taskPatch = z.object({
  ...taskFields,
  type: taskFields.type.optional(),
  title: taskFields.title.optional(),
  status: z.enum(taskStatuses).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');
export const taskParams = z.object({ id: z.string().min(1) });

const filterAliases: Record<string, (typeof taskFilters)[number]> = {
  all: 'all', todas: 'all',
  today: 'today', hoy: 'today',
  overdue: 'overdue', vencidas: 'overdue',
  upcoming: 'upcoming', proximas: 'upcoming', 'próximas': 'upcoming',
};

export function parseTaskFilter(value: string | undefined): (typeof taskFilters)[number] | undefined {
  if (!value) return 'all';
  return filterAliases[value.trim().toLowerCase()];
}

export const taskListQuery = z.object({
  filter: z.string().optional(),
  status: z.enum(taskStatuses).optional(),
  branch_id: z.string().optional(),
  patient_id: z.string().optional(),
  treatment_id: z.string().optional(),
  assigned_to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  ...pagingFields,
});
