import { z } from 'zod';
import { pagingFields } from '../infra/pagination.js';

/**
 * Maximum date-range span accepted by any Phase 4 report, in days. The
 * frontend already caps the range picker at 24 months; this is defense in
 * depth on the backend so a hand-crafted request cannot force a full-table
 * scan across the entire history of the organization. 24 months is computed
 * as a fixed number of days (rather than calendar months, which have no
 * single day count) using the longest possible 24-month span: 2 years x 366
 * days to stay correct across leap years.
 */
export const MAX_RANGE_DAYS = 24 * 366;

/**
 * `branch_id` format decision: a single query param holding a comma-separated
 * list, e.g. `branch_id=a,b,c` (also accepts a single id with no comma, which
 * is the common case and reads identically to the single-branch filters
 * already used by `/dashboard` and `/transfers`). A repeated-key array
 * (`branch_id=a&branch_id=b`) was the alternative; CSV was chosen because:
 *   1. It stays wire-compatible with every existing single-branch_id caller
 *      (dashboardQuery, transferListQuery) with zero change to their shape.
 *   2. Express's default query parser (`qs`) already turns a repeated key
 *      into an array OR a string depending on how many times it appears,
 *      which is an easy source of "works with 2 branches, breaks with 1"
 *      bugs; a single string split on `,` has exactly one shape to validate.
 * All three Phase 4a reports use this same convention for consistency.
 */
export function parseBranchIds(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const ids = raw.split(',').map((id) => id.trim()).filter(Boolean);
  return ids.length ? ids : undefined;
}

export const reportGroupByValues = ['month', 'week', 'branch', 'medication'] as const;
export type ReportGroupBy = (typeof reportGroupByValues)[number];

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

/**
 * Shared query fields for every Phase 4 report (adherence, overdue,
 * no-response, and the 4b reports built on top of this same schema).
 * `from`/`to` are optional: a report with no range defaults to "all time
 * up to today" inside its own router (each report documents its own
 * default), but when both are given the combined span cannot exceed
 * MAX_RANGE_DAYS - validated below via `.refine()` so a single schema
 * enforces it everywhere instead of duplicating the check per router.
 */
export const reportBaseQuery = z
  .object({
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    branch_id: z.string().min(1).optional(),
    group_by: z.enum(reportGroupByValues).optional(),
    compare_previous: z.coerce.boolean().optional(),
    ...pagingFields,
  })
  .refine(
    (query) => {
      if (!query.from || !query.to) return true;
      const fromDate = new Date(`${query.from}T00:00:00.000Z`);
      const toDate = new Date(`${query.to}T00:00:00.000Z`);
      const days = Math.round((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000));
      return days >= 0 && days <= MAX_RANGE_DAYS;
    },
    { message: `El rango from/to no puede superar ${MAX_RANGE_DAYS} días (24 meses) ni ser negativo`, path: ['to'] },
  );

export type ReportBaseQuery = z.infer<typeof reportBaseQuery>;

/** Inclusive UTC-midnight bounds derived from a report's from/to strings. */
export function resolveReportRange(query: { from?: string | undefined; to?: string | undefined }, today: Date) {
  const to = query.to ? new Date(`${query.to}T00:00:00.000Z`) : today;
  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date(0);
  return { from, to };
}

export const reportPercentage = z.number().min(0).max(100).nullable();

export const reportAggregate = z.object({
  numerator: z.number().int(),
  denominator: z.number().int(),
  percentage: reportPercentage,
});

/**
 * Computes a percentage that is `null` (never 0 or 100) whenever the
 * denominator is 0, per the Phase 4 spec: an aggregation with no evaluable
 * rows has no adherence rate to report, and 0%/100% would both be
 * misleading placeholder values a dashboard could render as if real.
 */
export function percentageOrNull(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}
