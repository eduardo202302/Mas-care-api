import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { accessibleBranchIds } from '../../infra/branch-scope.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateQuery } from '../../infra/validate.js';
import { findOrCreateSetting } from '../../infra/settings.js';
import { daysBetween, toDateOnly } from '../../domain/coverage.js';
import { parseBranchIds, reportBaseQuery, resolveReportRange } from '../../schemas/report.js';
import { resolveScopedBranchIds } from './branch-scope-helper.js';
import { getRefillsData } from './refills.js';
import { getTreatmentsFlowData } from './treatments-flow.js';
import { getTransfersData } from './transfers.js';

export const reportsExportRouter = Router();
reportsExportRouter.use(resolveTenant);

type Tx = Prisma.TransactionClient;

const requirePermission = (role: Parameters<typeof puede>[0]) => {
  if (!puede(role, 'export:csv')) throw new ApiError(403, 'FORBIDDEN', 'export:csv permission required');
};

/**
 * `export:csv` (src/domain/permissions.ts) is only granted to owner/admin -
 * the two roles whose `actions` include every permission. pharmacist,
 * operator and read_only do not have it, so they get 403 FORBIDDEN here,
 * same ApiError/error envelope every other report uses.
 */

/**
 * Hard cap on exported rows. 50,000 rows at a handful of columns each keeps
 * a generated CSV comfortably under typical spreadsheet/email attachment
 * limits and bounds how long one export request can hold a transaction
 * open. A request whose underlying report would produce more rows than this
 * fails fast with a dedicated error code instead of silently truncating
 * (which would produce a CSV that looks complete but is missing data) or
 * hanging mid-stream.
 */
export const MAX_EXPORT_ROWS = 50_000;

const reportTypes = ['adherence', 'overdue', 'no-response', 'refills', 'treatments-flow', 'transfers'] as const;
export type ReportType = (typeof reportTypes)[number];

export const exportParams = z.object({ type: z.enum(reportTypes) });
export const exportQuery = reportBaseQuery.and(z.object({ separator: z.enum([',', ';']).optional() }));

/**
 * Rate limiting for CSV export specifically (separate from the generic
 * per-route limiters already wired in app.ts for auth/registration): export
 * work is heavier (can read up to MAX_EXPORT_ROWS rows and builds a full CSV
 * string in memory) so it gets its own, stricter budget per IP, following
 * the exact `windowMs`/`limit`/`handler` shape already used for
 * forgot-password etc. in app.ts.
 */
export const exportRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Demasiadas exportaciones. Inténtalo más tarde.' } }),
});

type Column = { header: string; value: (row: Record<string, unknown>) => string | number | boolean | null };

function csvEscape(value: string | number | boolean | null, separator: string): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(separator) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows: Record<string, unknown>[], columns: Column[], separator: string): string {
  const header = columns.map((col) => csvEscape(col.header, separator)).join(separator);
  const lines = rows.map((row) => columns.map((col) => csvEscape(col.value(row), separator)).join(separator));
  return [header, ...lines].join('\r\n');
}

/**
 * Patient-data flag. There is no existing header/field convention for this
 * in block 4a (no-response.ts simply omits phone, it does not set any
 * flag), so this introduces the first one: a response header
 * `X-Contains-Patient-Data: true` is set only for the two report types
 * whose rows are per-patient (overdue, no-response - both key their detail
 * rows by a specific patient's id/name). refills/treatments-flow/transfers
 * are aggregate-only (counts per medication/branch/month) and never name an
 * individual patient, so the header is omitted for those, same as adherence
 * (also branch/month/medication aggregates, no patient rows).
 */
const PATIENT_DATA_TYPES = new Set<ReportType>(['overdue', 'no-response']);

/**
 * Per-type row builders. For refills/treatments-flow/transfers this calls
 * the exact same `getXxxData()` function the JSON report endpoint uses
 * (refills.ts/treatments-flow.ts/transfers.ts), so CSV and JSON can never
 * drift apart.
 *
 * adherence/overdue/no-response are NOT imported from adherence.ts/
 * overdue.ts/no-response.ts: those three files are out of scope for this
 * block (explicitly listed as "do not touch" by the task), and none of them
 * exports its aggregation as a separate function - the logic lives inline in
 * their route handlers. Rather than edit those files to extract a
 * `getXxxData()` (which the task forbids), the same rule each file's own
 * comments document is re-applied here against the same tables, reusing the
 * shared domain helpers (`daysBetween`, `toDateOnly`, `percentageOrNull`,
 * `findOrCreateSetting`, `resolveScopedBranchIds`) rather than re-deriving
 * those. This does duplicate the per-row shaping logic; that duplication is
 * the deliberate, documented cost of not touching the 4a files.
 */
async function buildRows(
  type: ReportType,
  tx: Tx,
  branchIds: string[] | null,
  from: Date,
  to: Date,
  today: Date,
): Promise<{ rows: Record<string, unknown>[]; columns: Column[] }> {
  if (type === 'refills') {
    const report = await getRefillsData(tx, branchIds, from, to, today);
    const columns: Column[] = [
      { header: 'medication_id', value: (r) => r.medication_id as string },
      { header: 'medication', value: (r) => r.medication as string },
      { header: 'branch_id', value: (r) => r.branch_id as string },
      { header: 'branch', value: (r) => r.branch as string },
      { header: 'delivered_units', value: (r) => r.delivered_units as number },
      { header: 'estimated_packages', value: (r) => (r.estimated_packages as number | undefined) ?? null },
      { header: 'stock_status', value: (r) => r.stock_status as string | null },
      ...([7, 14, 30, 60] as const).map((h) => ({
        header: `forecast_${h}d_units`,
        value: (r: Record<string, unknown>) => {
          const forecast = r.forecast as Record<string, { units: number }>;
          return forecast[String(h)]?.units ?? 0;
        },
      })),
    ];
    return { rows: report.data as unknown as Record<string, unknown>[], columns };
  }

  if (type === 'treatments-flow') {
    const report = await getTreatmentsFlowData(tx, branchIds, from, to);
    const columns: Column[] = [
      { header: 'month', value: (r) => r.month as string },
      { header: 'altas', value: (r) => r.altas as number },
      { header: 'pausas', value: (r) => r.pausas as number },
      { header: 'reanudaciones', value: (r) => r.reanudaciones as number },
      { header: 'finalizaciones', value: (r) => r.finalizaciones as number },
    ];
    return { rows: report.by_month as unknown as Record<string, unknown>[], columns };
  }

  if (type === 'transfers') {
    const report = await getTransfersData(tx, branchIds, from, to);
    const columns: Column[] = [
      { header: 'month', value: (r) => r.month as string },
      { header: 'count', value: (r) => r.count as number },
    ];
    return { rows: report.by_month as unknown as Record<string, unknown>[], columns };
  }

  // adherence/overdue/no-response are handled by the route handler before
  // this function is ever called (they need organizationId, see
  // buildAdherenceRows/buildOverdueRows/buildNoResponseRows below), so this
  // branch is unreachable in practice; kept as an explicit error rather than
  // falling through silently.
  throw new Error(`unhandled report type in buildRows: ${type}`);
}

/**
 * adherence/overdue/no-response row builders need the organizationId (for
 * findOrCreateSetting) which the generic buildRows() above does not have in
 * scope cleanly - defined as their own functions instead, called directly
 * from the route handler where organizationId is available.
 */
async function buildAdherenceRows(tx: Tx, organizationId: string, branchIds: string[] | null, from: Date, to: Date, today: Date) {
  const settings = await findOrCreateSetting(tx, organizationId);
  const effectiveTo = to.getTime() < today.getTime() ? to : today;
  const cycles = await tx.refillCycle.findMany({
    where: { expectedOn: { gte: from, lte: effectiveTo }, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
    select: {
      id: true,
      branchId: true,
      expectedOn: true,
      treatment: { select: { medication: { select: { brandName: true, genericName: true, activeIngredient: true, presentation: true } } } },
      deliveries: { select: { deliveredOn: true } },
    },
  });
  const rows = cycles.map((cycle) => {
    const limit = new Date(cycle.expectedOn.getTime() + settings.dueSoonDays * 24 * 60 * 60 * 1000);
    const adherent = cycle.deliveries.some((d) => d.deliveredOn.getTime() <= limit.getTime());
    const medication = cycle.treatment.medication;
    return {
      cycle_id: cycle.id,
      branch_id: cycle.branchId,
      medication: medication.brandName ?? medication.genericName ?? medication.activeIngredient ?? medication.presentation,
      expected_on: cycle.expectedOn.toISOString().slice(0, 10),
      adherent,
    };
  });
  const columns: Column[] = [
    { header: 'cycle_id', value: (r) => r.cycle_id as string },
    { header: 'branch_id', value: (r) => r.branch_id as string },
    { header: 'medication', value: (r) => r.medication as string },
    { header: 'expected_on', value: (r) => r.expected_on as string },
    { header: 'adherent', value: (r) => r.adherent as boolean },
  ];
  return { rows: rows as unknown as Record<string, unknown>[], columns };
}

async function buildOverdueRows(tx: Tx, branchIds: string[] | null, from: Date, to: Date, today: Date) {
  const cycles = await tx.refillCycle.findMany({
    where: { expectedOn: { gte: from, lte: to, lt: today }, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
    select: {
      id: true,
      branchId: true,
      expectedOn: true,
      closedAt: true,
      treatment: { select: { patient: { select: { id: true, fullName: true } } } },
      deliveries: { select: { deliveredOn: true } },
    },
  });
  // Patient name is a person-identifying field, kept here (unlike phone,
  // which this codebase never exposes in any report/export per block 4a's
  // rule) because overdue/no-response rows are already per-patient by
  // nature and the UI needs a name to be useful; phone/message content stay
  // excluded, matching every other report in this module.
  const rows = cycles.map((cycle) => ({
    cycle_id: cycle.id,
    branch_id: cycle.branchId,
    patient_id: cycle.treatment.patient.id,
    patient_name: cycle.treatment.patient.fullName,
    expected_on: cycle.expectedOn.toISOString().slice(0, 10),
    status: cycle.closedAt ? 'closed' : 'open',
    delay_days: cycle.deliveries.some((d) => d.deliveredOn.getTime() > cycle.expectedOn.getTime())
      ? daysBetween(cycle.expectedOn, cycle.deliveries.map((d) => d.deliveredOn).sort((a, b) => a.getTime() - b.getTime())[0]!)
      : null,
  }));
  const columns: Column[] = [
    { header: 'cycle_id', value: (r) => r.cycle_id as string },
    { header: 'branch_id', value: (r) => r.branch_id as string },
    { header: 'patient_id', value: (r) => r.patient_id as string },
    { header: 'patient_name', value: (r) => r.patient_name as string },
    { header: 'expected_on', value: (r) => r.expected_on as string },
    { header: 'status', value: (r) => r.status as string },
    { header: 'delay_days', value: (r) => r.delay_days as number | null },
  ];
  return { rows: rows as unknown as Record<string, unknown>[], columns };
}

async function buildNoResponseRows(tx: Tx, organizationId: string, branchIds: string[] | null, from: Date, to: Date, today: Date) {
  const settings = await findOrCreateSetting(tx, organizationId);
  const notices = await tx.notice.findMany({
    where: {
      status: { in: ['sent', 'failed'] },
      readAt: null,
      repliedAt: null,
      sentAt: { gte: from, lte: to },
      ...(branchIds ? { cycle: { branchId: { in: branchIds } } } : {}),
    },
    select: { patientId: true, cycleId: true, sentAt: true },
    orderBy: [{ sentAt: 'asc' }],
  });
  const byPatient = new Map<string, typeof notices>();
  for (const notice of notices) {
    const list = byPatient.get(notice.patientId) ?? [];
    list.push(notice);
    byPatient.set(notice.patientId, list);
  }
  const candidatePatientIds = [...byPatient.entries()].filter(([, n]) => n.length >= settings.maxNoticeAttempts).map(([id]) => id);
  const cycleIds = [...new Set(notices.filter((n) => candidatePatientIds.includes(n.patientId)).map((n) => n.cycleId))];
  const deliveries = cycleIds.length ? await tx.delivery.findMany({ where: { cycleId: { in: cycleIds } }, select: { cycleId: true, deliveredOn: true } }) : [];
  const latestDeliveryByCycle = new Map<string, Date>();
  for (const delivery of deliveries) {
    const current = latestDeliveryByCycle.get(delivery.cycleId);
    if (!current || delivery.deliveredOn.getTime() > current.getTime()) latestDeliveryByCycle.set(delivery.cycleId, delivery.deliveredOn);
  }
  const finalPatientIds = candidatePatientIds.filter((patientId) => {
    const patientNotices = byPatient.get(patientId)!;
    const earliestNotice = patientNotices[0]!.sentAt;
    return !patientNotices.some((n) => {
      const delivery = latestDeliveryByCycle.get(n.cycleId);
      return delivery && delivery.getTime() > earliestNotice.getTime();
    });
  });
  const patients = finalPatientIds.length ? await tx.patient.findMany({ where: { id: { in: finalPatientIds } }, select: { id: true, fullName: true } }) : [];
  const patientById = new Map(patients.map((p) => [p.id, p]));
  const rows = finalPatientIds.map((patientId) => {
    const patientNotices = byPatient.get(patientId)!;
    const lastNoticeAt = patientNotices.reduce((latest, n) => (n.sentAt.getTime() > latest.getTime() ? n.sentAt : latest), patientNotices[0]!.sentAt);
    return {
      patient_id: patientId,
      patient_name: patientById.get(patientId)?.fullName ?? null,
      attempts_count: patientNotices.length,
      last_notice_at: lastNoticeAt.toISOString(),
      age_days: daysBetween(lastNoticeAt, today),
    };
  });
  const columns: Column[] = [
    { header: 'patient_id', value: (r) => r.patient_id as string },
    { header: 'patient_name', value: (r) => r.patient_name as string | null },
    { header: 'attempts_count', value: (r) => r.attempts_count as number },
    { header: 'last_notice_at', value: (r) => r.last_notice_at as string },
    { header: 'age_days', value: (r) => r.age_days as number },
  ];
  return { rows: rows as unknown as Record<string, unknown>[], columns };
}

reportsExportRouter.get(
  '/:type',
  exportRateLimit,
  validateQuery(exportQuery),
  async (req, res) => {
    const tenant = req.tenant!;
    requirePermission(tenant.role);
    const parsedParams = exportParams.safeParse(req.params);
    if (!parsedParams.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Unknown report type for export');
    const { type } = parsedParams.data;
    const query = res.locals.validatedQuery as z.infer<typeof exportQuery>;
    const separator = query.separator ?? ',';
    const requestedBranchIds = parseBranchIds(query.branch_id);

    const { csv, rowCount } = await withTenant(tenant.organizationId, async (tx: Tx) => {
      const today = toDateOnly(new Date());
      const scope = await accessibleBranchIds(tx, tenant);
      const branchIds = resolveScopedBranchIds(scope, requestedBranchIds);
      const { from, to } = resolveReportRange(query, today);

      let built: { rows: Record<string, unknown>[]; columns: Column[] };
      if (type === 'adherence') built = await buildAdherenceRows(tx, tenant.organizationId, branchIds, from, to, today);
      else if (type === 'overdue') built = await buildOverdueRows(tx, branchIds, from, to, today);
      else if (type === 'no-response') built = await buildNoResponseRows(tx, tenant.organizationId, branchIds, from, to, today);
      else built = await buildRows(type, tx, branchIds, from, to, today);

      if (built.rows.length > MAX_EXPORT_ROWS) {
        throw new ApiError(
          413,
          'EXPORT_TOO_LARGE',
          `El informe tiene ${built.rows.length} filas, que supera el límite de exportación de ${MAX_EXPORT_ROWS}. Reduce el rango de fechas o filtra por sucursal.`,
        );
      }

      return { csv: toCsv(built.rows, built.columns, separator), rowCount: built.rows.length };
    });

    // Patient-data header: only overdue/no-response rows name an individual
    // patient (see PATIENT_DATA_TYPES comment above). Phone numbers and
    // message/notice body content are never included in any of these
    // builders, matching the no-response.ts JSON endpoint's own rule. This
    // CSV export is not logged with its body (see app.ts's request logger,
    // which logs only method/path/status/durationMs, never req.body or the
    // response payload).
    if (PATIENT_DATA_TYPES.has(type)) res.setHeader('X-Contains-Patient-Data', 'true');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('X-Export-Row-Count', String(rowCount));
    res.setHeader('Content-Disposition', `attachment; filename="report-${type}.csv"`);
    res.send(csv);
  },
);
