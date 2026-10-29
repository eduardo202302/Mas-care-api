import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { addDays, daysBetween, deriveCoverage, toDateOnly } from '../../domain/coverage.js';
import {
  computeDashboardCounts,
  noResponseWhere,
  sumDashboardCountRows,
  sumDashboardCounts,
  type DashboardCounts,
} from '../../domain/dashboard-metrics.js';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { accessibleBranchIds, requiredBranchScope } from '../../infra/branch-scope.js';
import { resolvePaging } from '../../infra/pagination.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateQuery } from '../../infra/validate.js';
import { findOrCreateSetting } from '../../infra/settings.js';
import {
  dashboardConsolidatedQuery,
  dashboardListQuery,
  dashboardQuery,
  parseDashboardCard,
} from '../../schemas/dashboard.js';

export const dashboardRouter = Router();
dashboardRouter.use(resolveTenant);

type Tx = Prisma.TransactionClient;
type SettingsRow = Awaited<ReturnType<typeof settingFor>>;
type TreatmentRow = Prisma.TreatmentGetPayload<{
  include: { patient: true; medication: true; branch: true };
}>;
type OpenCycle = Prisma.RefillCycleGetPayload<{ include: { _count: { select: { deliveries: true } } } }>;

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

function settingFor(tx: Tx, organizationId: string) {
  return findOrCreateSetting(tx, organizationId);
}

function todayOnly() {
  return toDateOnly(new Date());
}

function medicationName(medication: TreatmentRow['medication']) {
  return medication.brandName ?? medication.genericName ?? medication.activeIngredient ?? medication.presentation;
}

function presentRow(row: TreatmentRow, cycle: OpenCycle | null, settings: SettingsRow, today: Date) {
  const coverage = deriveCoverage(
    {
      status: row.status,
      startDate: row.startDate,
      quantityPerCycle: row.quantityPerCycle.toString(),
      dosePerIntake: row.dosePerIntake.toString(),
      intakesPerDay: row.intakesPerDay.toString(),
      coverageEndOn: row.coverageEndOn,
      coverageManuallyAdjusted: row.coverageManuallyAdjusted,
      prescriptionExpiresOn: row.prescriptionExpiresOn,
    },
    cycle ? { status: cycle.status, hasDelivery: cycle._count.deliveries > 0 } : null,
    today,
    {
      dueSoonDays: settings.dueSoonDays,
      upcomingDays: settings.upcomingDays,
      prescriptionWarningDays: settings.prescriptionWarningDays,
    },
  );
  return {
    treatment_id: row.id,
    patient: {
      id: row.patient.id,
      full_name: row.patient.fullName,
      phone: row.patient.phone,
      phone_has_whatsapp: row.patient.phoneHasWhatsapp,
      preferred_channel: row.patient.preferredChannel,
      reminder_consent: row.patient.reminderConsent,
    },
    medication: { id: row.medication.id, name: medicationName(row.medication) },
    branch: { id: row.branch.id, name: row.branch.name },
    coverage_end_on: row.coverageEndOn?.toISOString().slice(0, 10) ?? null,
    prescription_expires_on: row.prescriptionExpiresOn?.toISOString().slice(0, 10) ?? null,
    last_delivery_on: row.lastDeliveryOn?.toISOString().slice(0, 10) ?? null,
    days_remaining: coverage.daysRemaining,
    derived_status: coverage.status,
    prescription_flag: coverage.prescriptionFlag,
    contact: {
      phone: row.patient.phone,
      phone_has_whatsapp: row.patient.phoneHasWhatsapp,
      preferred_channel: row.patient.preferredChannel,
      reminder_consent: row.patient.reminderConsent,
    },
  };
}

async function openCyclesFor(tx: Tx, treatmentIds: string[]) {
  if (!treatmentIds.length) return new Map<string, OpenCycle>();
  const cycles = await tx.refillCycle.findMany({
    where: { treatmentId: { in: treatmentIds }, closedAt: null },
    include: { _count: { select: { deliveries: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const map = new Map<string, OpenCycle>();
  for (const cycle of cycles) if (!map.has(cycle.treatmentId)) map.set(cycle.treatmentId, cycle);
  return map;
}

async function presentRows(tx: Tx, rows: TreatmentRow[], settings: SettingsRow, today: Date) {
  const cycles = await openCyclesFor(tx, rows.map(({ id }) => id));
  return rows.map((row) => presentRow(row, cycles.get(row.id) ?? null, settings, today));
}

async function scopedWhere(
  tx: Tx,
  tenant: NonNullable<Express.Request['tenant']>,
  extra: Prisma.TreatmentWhereInput,
): Promise<Prisma.TreatmentWhereInput> {
  return { AND: [await requiredBranchScope(tx, tenant), extra] };
}

dashboardRouter.get('/', validateQuery(dashboardQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'dashboard:read');
  const { branch_id } = res.locals.validatedQuery as z.infer<typeof dashboardQuery>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const settings = await settingFor(tx, tenant.organizationId);
    const today = todayOnly();
    const dueLimit = addDays(today, settings.dueSoonDays);
    const prescriptionLimit = addDays(today, settings.prescriptionWarningDays);
    const branch = branch_id ? { branchId: branch_id } : {};
    const base = await scopedWhere(tx, tenant, { status: 'active', ...branch });
    const include = { patient: true, medication: true, branch: true } as const;

    // `counts` reuses the shared computeDashboardCounts() so this endpoint and
    // /dashboard/consolidated can never diverge on the five card numbers. The
    // detailed `lists` below still need the full per-treatment rows (with
    // patient/medication/branch info), which computeDashboardCounts does not
    // return, so they are fetched separately exactly as before.
    //
    // computeDashboardCounts() takes exactly one branchId (or null = whole
    // organization, no branch filter). When a branch_id is given we pass it
    // straight through. Without one, the authorization scope decides: owners
    // and admins (accessibleBranchIds === null) still get a single org-wide call;
    // a restricted user is summed per accessible branch instead of a single
    // null call, because null would otherwise count the whole organization
    // and silently widen that user's visibility past their assigned branches.
    // Summing per branch is exact here (status + branchId are disjoint sets).
    const scopeBranchIds = await accessibleBranchIds(tx, tenant);
    const counts = branch_id
      ? await computeDashboardCounts(tx, tenant.organizationId, branch_id, today, settings)
      : scopeBranchIds === null
        ? await computeDashboardCounts(tx, tenant.organizationId, null, today, settings)
        : await sumDashboardCounts(tx, tenant.organizationId, scopeBranchIds, today, settings);

    const [coverageRows, prescriptionRows, pendingRows, noResponseRows] = await Promise.all([
      tx.treatment.findMany({
        where: { AND: [base, { coverageEndOn: { not: null, lte: dueLimit } }] },
        include,
        orderBy: [{ coverageEndOn: 'asc' }, { id: 'asc' }],
        take: 15,
      }),
      tx.treatment.findMany({
        where: { AND: [base, { prescriptionExpiresOn: { not: null, lte: prescriptionLimit } }] },
        include,
        orderBy: [{ prescriptionExpiresOn: 'asc' }, { id: 'asc' }],
        take: 15,
      }),
      tx.treatment.findMany({
        where: {
          AND: [base, { cycles: { some: { status: 'prepared', closedAt: null, deliveries: { none: {} } } } }],
        },
        include,
        orderBy: [{ coverageEndOn: 'asc' }, { id: 'asc' }],
        take: 15,
      }),
      tx.treatment.findMany({
        where: { AND: [base, noResponseWhere(settings.maxNoticeAttempts)] },
        include,
        orderBy: [{ coverageEndOn: 'asc' }, { id: 'asc' }],
        take: 15,
      }),
    ]);

    const coveragePresented = await presentRows(tx, coverageRows, settings, today);
    const prescriptionPresented = await presentRows(tx, prescriptionRows, settings, today);
    const pendingPresented = await presentRows(tx, pendingRows, settings, today);
    const noResponsePresented = await presentRows(tx, noResponseRows, settings, today);

    return {
      branch_id: branch_id ?? null,
      generated_at: new Date().toISOString(),
      counts,
      lists: {
        today_refills: coveragePresented.filter((row) => row.days_remaining === 0),
        due_soon: coveragePresented.filter((row) => (row.days_remaining ?? -1) >= 0 && (row.days_remaining ?? -1) <= settings.dueSoonDays),
        overdue: coveragePresented.filter((row) => (row.days_remaining ?? 0) < 0),
        pending_pickups: pendingPresented,
        prescriptions_to_renew: prescriptionPresented.filter((row) => row.prescription_flag),
        no_response: noResponsePresented,
      },
    };
  });
  res.json(result);
});

/**
 * "Open" incidents are every status except `resolved` (`new`, `in_progress`).
 * This mirrors how src/modules/incidents/router.ts itself treats `resolved`
 * as the only closed/terminal state (e.g. `INCIDENT_CLOSED` guards keyed off
 * `status === 'resolved'`), so "open" here means "not yet resolved" rather
 * than hand-picking a subset of non-resolved statuses.
 */
const OPEN_INCIDENT_STATUSES: Array<'new' | 'in_progress'> = ['new', 'in_progress'];

type ConsolidatedBranchRow = DashboardCounts & {
  branch_id: string;
  name: string;
  label_color: string;
  open_incidents: number;
  failed_messages: number;
  stock_check_age_days: number | null;
};

async function extraBranchMetrics(
  tx: Tx,
  branchId: string,
  today: Date,
): Promise<{ open_incidents: number; failed_messages: number; stock_check_age_days: number | null }> {
  const [openIncidents, failedMessages, latestStockMark] = await Promise.all([
    tx.incident.count({ where: { branchId, status: { in: OPEN_INCIDENT_STATUSES } } }),
    tx.outboxMessage.count({ where: { branchId, status: 'failed' } }),
    tx.medicationStockMark.findFirst({ where: { branchId }, orderBy: { reviewedAt: 'desc' }, select: { reviewedAt: true } }),
  ]);
  return {
    open_incidents: openIncidents,
    failed_messages: failedMessages,
    // No stock mark ever recorded for this branch -> null (no age to report),
    // rather than 0 (which would misleadingly read as "checked today").
    stock_check_age_days: latestStockMark ? daysBetween(toDateOnly(latestStockMark.reviewedAt), today) : null,
  };
}

dashboardRouter.get('/consolidated', validateQuery(dashboardConsolidatedQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'dashboard:read');
  const { date } = res.locals.validatedQuery as z.infer<typeof dashboardConsolidatedQuery>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const settings = await settingFor(tx, tenant.organizationId);
    const today = date ? toDateOnly(date) : todayOnly();

    // Resolve the branch list from server-side authorization ONLY. A
    // client-supplied branch_id would never be honored here even if sent -
    // this endpoint does not read branch_id from the query at all.
    const scopeBranchIds = await accessibleBranchIds(tx, tenant);
    const branches = scopeBranchIds === null
      ? await tx.branch.findMany({ where: { archivedAt: null }, orderBy: [{ name: 'asc' }, { id: 'asc' }] })
      : await tx.branch.findMany({
          where: { id: { in: scopeBranchIds }, archivedAt: null },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        });

    const branchRows: ConsolidatedBranchRow[] = await Promise.all(
      branches.map(async (branch) => {
        const [counts, extra] = await Promise.all([
          computeDashboardCounts(tx, tenant.organizationId, branch.id, today, settings),
          extraBranchMetrics(tx, branch.id, today),
        ]);
        return {
          branch_id: branch.id,
          name: branch.name,
          label_color: branch.labelColor,
          ...counts,
          ...extra,
        };
      }),
    );

    const countsTotal = sumDashboardCountRows(branchRows);
    const total = {
      ...countsTotal,
      open_incidents: branchRows.reduce((sum, row) => sum + row.open_incidents, 0),
      failed_messages: branchRows.reduce((sum, row) => sum + row.failed_messages, 0),
      // stock_check_age_days has no sensible TOTAL (ages from different
      // branches are not additive), so it is simply omitted from `total`.
    };

    return {
      date: today.toISOString().slice(0, 10),
      branches: branchRows,
      total,
    };
  });
  res.json(result);
});

dashboardRouter.get('/list', validateQuery(dashboardListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'dashboard:read');
  const query = res.locals.validatedQuery as z.infer<typeof dashboardListQuery>;
  const card = parseDashboardCard(query.card);
  if (!card) throw new ApiError(400, 'INVALID_CARD', 'Unknown dashboard card');
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const settings = await settingFor(tx, tenant.organizationId);
    const today = todayOnly();
    const dueLimit = addDays(today, settings.dueSoonDays);
    const prescriptionLimit = addDays(today, settings.prescriptionWarningDays);
    const base = await scopedWhere(tx, tenant, {
      status: 'active',
      ...(query.branch_id ? { branchId: query.branch_id } : {}),
    });
    const include = { patient: true, medication: true, branch: true } as const;
    let where: Prisma.TreatmentWhereInput;
    let orderBy: Prisma.TreatmentOrderByWithRelationInput[] = [{ coverageEndOn: 'asc' }, { id: 'asc' }];
    switch (card) {
      case 'overdue':
        where = { AND: [base, { coverageEndOn: { lt: today } }] };
        break;
      case 'today_refills':
        where = { AND: [base, { coverageEndOn: today }] };
        break;
      case 'due_soon':
        where = { AND: [base, { coverageEndOn: { gte: today, lte: dueLimit } }] };
        break;
      case 'pending_pickups':
        where = {
          AND: [base, { cycles: { some: { status: 'prepared', closedAt: null, deliveries: { none: {} } } } }],
        };
        break;
      case 'prescriptions_to_renew':
        where = { AND: [base, { prescriptionExpiresOn: { not: null, lte: prescriptionLimit } }] };
        orderBy = [{ prescriptionExpiresOn: 'asc' }, { id: 'asc' }];
        break;
      case 'no_response':
        where = { AND: [base, noResponseWhere(settings.maxNoticeAttempts)] };
        break;
    }
    const { page, rows: size, skip } = resolvePaging(query);
    const [rows, total] = await Promise.all([
      tx.treatment.findMany({ where, include, orderBy, take: size, skip }),
      tx.treatment.count({ where }),
    ]);
    const data = await presentRows(tx, rows, settings, today);
    return { card, branch_id: query.branch_id ?? null, data, total, page, rows: size };
  });
  res.json(result);
});
