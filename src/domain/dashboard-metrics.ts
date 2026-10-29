/**
 * Shared per-branch dashboard count calculations.
 *
 * Extracted from `src/modules/dashboard/router.ts` (block 3 of Phase 4) so the
 * consolidated multi-branch panel (`GET /api/v1/dashboard/consolidated`) and
 * the existing single-branch panel (`GET /api/v1/dashboard`) compute the same
 * five numbers from one implementation instead of two divergent copies.
 *
 * `no_response` counts treatments whose open cycle ran out of notice attempts without an
 * answer, or that already has an open `patient_no_response` incident.
 */
import type { Prisma } from '@prisma/client';
import { addDays } from './coverage.js';

type Tx = Prisma.TransactionClient;

export type DashboardCounts = {
  today_refills: number;
  due_soon: number;
  overdue: number;
  pending_pickups: number;
  prescriptions_to_renew: number;
  no_response: number;
};

export type DashboardCountSettings = {
  dueSoonDays: number;
  prescriptionWarningDays: number;
  /** Attempts after which an unanswered notice counts as «sin respuesta» (3 by default). */
  maxNoticeAttempts?: number;
};

/** Treatments with an open cycle whose notices went unanswered, or with an open no-response incident. */
export const noResponseWhere = (maxNoticeAttempts = 3): Prisma.TreatmentWhereInput => ({
  cycles: {
    some: {
      closedAt: null,
      OR: [
        { status: 'notified', noticeAttempts: { gte: maxNoticeAttempts } },
        { incidents: { some: { type: 'patient_no_response', status: { not: 'resolved' } } } },
      ],
    },
  },
});

/**
 * Counts the same five dashboard cards `/dashboard` renders, for one branch
 * (or organization-wide when `branchId` is null) on one calendar day. `date`
 * must already be a UTC-midnight "date-only" value (see `toDateOnly` in
 * `coverage.ts`) - callers resolve "today" themselves so this function stays
 * pure with respect to the current clock.
 *
 * `organizationId` is accepted for callers/tests to see the tenant a call is
 * scoped to, but is not added to the Prisma `where` here: `tx` is always a
 * transaction obtained through `withTenant`, whose query extension
 * (`src/infra/prisma.ts`) already injects `organizationId` into every
 * `Treatment` operation. Adding it again would be redundant, not wrong, but
 * the original `/dashboard` code never did it either, so this keeps parity.
 */
export async function computeDashboardCounts(
  tx: Tx,
  _organizationId: string,
  branchId: string | null,
  date: Date,
  settings: DashboardCountSettings,
): Promise<DashboardCounts> {
  const dueLimit = addDays(date, settings.dueSoonDays);
  const prescriptionLimit = addDays(date, settings.prescriptionWarningDays);
  const branch = branchId ? { branchId } : {};
  const base: Prisma.TreatmentWhereInput = { status: 'active', ...branch };

  const [overdue, todayRefills, dueSoon, pendingPickups, prescriptions, noResponse] = await Promise.all([
    tx.treatment.count({ where: { AND: [base, { coverageEndOn: { lt: date } }] } }),
    tx.treatment.count({ where: { AND: [base, { coverageEndOn: date }] } }),
    tx.treatment.count({ where: { AND: [base, { coverageEndOn: { gte: date, lte: dueLimit } }] } }),
    tx.treatment.count({
      where: {
        AND: [base, { cycles: { some: { status: 'prepared', closedAt: null, deliveries: { none: {} } } } }],
      },
    }),
    tx.treatment.count({
      where: { AND: [base, { prescriptionExpiresOn: { not: null, lte: prescriptionLimit } }] },
    }),
    tx.treatment.count({ where: { AND: [base, noResponseWhere(settings.maxNoticeAttempts)] } }),
  ]);

  return {
    today_refills: todayRefills,
    due_soon: dueSoon,
    overdue,
    pending_pickups: pendingPickups,
    prescriptions_to_renew: prescriptions,
    no_response: noResponse,
  };
}

/**
 * Sums computeDashboardCounts() across several branches. Used by:
 * - `/dashboard` when a restricted user (operator/pharmacist with more than
 *   one assigned branch) asks with no `branch_id`, so their total still
 *   reflects only their accessible branches and not the whole organization.
 * - `/dashboard/consolidated`'s TOTAL row, which sums the exact per-branch
 *   rows already computed for the `branches` array (no separate query).
 *
 * The sum is exact: `status = 'active' AND branchId IN (A, B)` counts the
 * same rows as one count for A plus one count for B, because branchId
 * partitions treatments into disjoint sets.
 */
export function sumDashboardCountRows(rows: DashboardCounts[]): DashboardCounts {
  return rows.reduce<DashboardCounts>(
    (total, row) => ({
      today_refills: total.today_refills + row.today_refills,
      due_soon: total.due_soon + row.due_soon,
      overdue: total.overdue + row.overdue,
      pending_pickups: total.pending_pickups + row.pending_pickups,
      prescriptions_to_renew: total.prescriptions_to_renew + row.prescriptions_to_renew,
      no_response: total.no_response + row.no_response,
    }),
    { today_refills: 0, due_soon: 0, overdue: 0, pending_pickups: 0, prescriptions_to_renew: 0, no_response: 0 },
  );
}

/** Computes computeDashboardCounts() for each branch and sums the result. */
export async function sumDashboardCounts(
  tx: Tx,
  organizationId: string,
  branchIds: string[],
  date: Date,
  settings: DashboardCountSettings,
): Promise<DashboardCounts> {
  const perBranch = await Promise.all(
    branchIds.map((branchId) => computeDashboardCounts(tx, organizationId, branchId, date, settings)),
  );
  return sumDashboardCountRows(perBranch);
}
