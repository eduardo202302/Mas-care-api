import { z } from 'zod';
import { pagingFields } from '../infra/pagination.js';

export const dashboardCardKeys = [
  'today_refills',
  'due_soon',
  'overdue',
  'pending_pickups',
  'prescriptions_to_renew',
  'no_response',
] as const;
export type DashboardCard = (typeof dashboardCardKeys)[number];

const aliases: Record<string, DashboardCard> = {
  today: 'today_refills',
  today_refills: 'today_refills',
  reposiciones_hoy: 'today_refills',
  due_soon: 'due_soon',
  vence_pronto: 'due_soon',
  overdue: 'overdue',
  vencidos: 'overdue',
  vencido: 'overdue',
  pending_pickup: 'pending_pickups',
  pending_pickups: 'pending_pickups',
  retiro_pendiente: 'pending_pickups',
  retiros_pendientes: 'pending_pickups',
  prescriptions: 'prescriptions_to_renew',
  prescriptions_to_renew: 'prescriptions_to_renew',
  recetas_por_renovar: 'prescriptions_to_renew',
  no_response: 'no_response',
  sin_respuesta: 'no_response',
};

export function parseDashboardCard(value: string): DashboardCard | undefined {
  const normalized = value.trim().toLowerCase();
  if (aliases[normalized]) return aliases[normalized];
  if ((dashboardCardKeys as readonly string[]).includes(normalized)) return normalized as DashboardCard;
  return undefined;
}

export const dashboardQuery = z.object({
  branch_id: z.string().min(1).optional(),
});

export const dashboardListQuery = z.object({
  card: z.string().min(1),
  branch_id: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  ...pagingFields,
});

/**
 * `date` is an optional "YYYY-MM-DD" date-only string, defaulting to today
 * when omitted - the same format `toDateOnly()` (src/domain/coverage.ts)
 * normalizes any date-like value to. `branch_id` is intentionally NOT
 * accepted here: which branches a caller may see is resolved server-side
 * from their role/BranchMember scope (src/infra/branch-scope.ts), never from
 * client-supplied query params, so the client cannot widen its own scope.
 */
export const dashboardConsolidatedQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
});
