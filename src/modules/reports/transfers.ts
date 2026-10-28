import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { accessibleBranchIds } from '../../infra/branch-scope.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateQuery } from '../../infra/validate.js';
import { toDateOnly } from '../../domain/coverage.js';
import { parseBranchIds, reportBaseQuery, resolveReportRange } from '../../schemas/report.js';
import { resolveScopedBranchIds } from './branch-scope-helper.js';

export const reportsTransfersRouter = Router();
reportsTransfersRouter.use(resolveTenant);

type Tx = Prisma.TransactionClient;

const requirePermission = (role: Parameters<typeof puede>[0]) => {
  if (!puede(role, 'dashboard:read')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

/**
 * Aggregates over PatientTransfer, already populated by block 2's
 * `/api/v1/transfers` endpoints (prisma/schema.prisma model PatientTransfer,
 * src/modules/transfers/router.ts). This report does not write transfers, it
 * only reads and aggregates the existing rows.
 *
 * Branch scoping: a transfer is included when either its fromBranchId or
 * toBranchId is in the accessible/requested branch set - same "either side"
 * rule the existing `transferListQuery` (src/schemas/transfer.ts) already
 * documents for /api/v1/transfers, kept consistent here rather than
 * inventing a different rule for the aggregate report.
 */
const SCOPE_DEFINITION =
  'Un traslado se incluye si su sucursal de origen (from_branch_id) O su sucursal de destino (to_branch_id) ' +
  'está dentro del conjunto de sucursales accesible/solicitado - el mismo criterio "cualquiera de los dos ' +
  'lados" que ya usa el listado /api/v1/transfers.';

/**
 * `reason` (PatientTransfer.reason, prisma/schema.prisma) is `String @db.Text`
 * - free text entered by the user creating the transfer, with no enum/lookup
 * backing it. This report therefore CANNOT produce a clean "count by reason
 * category" breakdown: grouping by the raw text would fragment into as many
 * buckets as there are slightly different phrasings (e.g. "cambio de
 * domicilio" vs "Cambio de domicilio" vs "se mudó"), which would not be a
 * meaningful aggregate. What this report does instead: groups by the exact
 * (case-normalized, trimmed) reason string and returns the top N most
 * frequent exact strings, each counted as-is, plus documents this limitation
 * explicitly rather than silently presenting a misleading "by reason" chart.
 */
const REASON_LIMITATION_NOTE =
  'PatientTransfer.reason es texto libre (String @db.Text), no un enum ni una tabla de referencia. Por eso ' +
  'no existe un agrupamiento por "categoría de motivo" real: by_reason agrupa por el texto exacto ' +
  '(normalizado a minúsculas y recortado de espacios) y devuelve los más frecuentes, lo cual puede fragmentar ' +
  'motivos que un humano consideraría iguales pero están escritos de forma distinta. Si en el futuro se desea ' +
  'una categorización real, se necesitaría agregar un campo de categoría/enum al modelo PatientTransfer y ' +
  'migrar los datos existentes - esta función no puede inferirlo del texto libre de forma confiable.';

const BY_MONTH_DEFINITION = 'Mes calendario (YYYY-MM, UTC) de PatientTransfer.createdAt.';

type TransferRow = {
  id: string;
  fromBranchId: string;
  toBranchId: string;
  reason: string;
  treatmentsCount: number;
  cyclesCount: number;
  createdAt: Date;
};

export type TransfersReport = {
  summary: { total_transfers: number; total_treatments_moved: number; total_cycles_moved: number };
  by_origin_branch: Array<{ branch_id: string; name: string; label_color: string; count: number }>;
  by_destination_branch: Array<{ branch_id: string; name: string; label_color: string; count: number }>;
  by_reason: Array<{ reason: string; count: number }>;
  by_month: Array<{ month: string; count: number }>;
  notes: { reason_limitation: string };
  definitions: { scope: string; by_month: string };
};

const REASON_TOP_N = 20;

/**
 * Shared implementation behind GET /api/v1/reports/transfers and the CSV
 * export (export.ts).
 */
export async function getTransfersData(tx: Tx, branchIds: string[] | null, from: Date, to: Date): Promise<TransfersReport> {
  const where: Prisma.PatientTransferWhereInput = {
    createdAt: { gte: from, lte: to },
    ...(branchIds ? { OR: [{ fromBranchId: { in: branchIds } }, { toBranchId: { in: branchIds } }] } : {}),
  };

  const transfers = (await tx.patientTransfer.findMany({
    where,
    select: { id: true, fromBranchId: true, toBranchId: true, reason: true, treatmentsCount: true, cyclesCount: true, createdAt: true },
  })) as TransferRow[];

  const byOrigin = new Map<string, number>();
  const byDestination = new Map<string, number>();
  const byReason = new Map<string, number>();
  const byMonth = new Map<string, number>();
  let totalTreatments = 0;
  let totalCycles = 0;

  for (const transfer of transfers) {
    byOrigin.set(transfer.fromBranchId, (byOrigin.get(transfer.fromBranchId) ?? 0) + 1);
    byDestination.set(transfer.toBranchId, (byDestination.get(transfer.toBranchId) ?? 0) + 1);
    const reasonKey = transfer.reason.trim().toLowerCase();
    byReason.set(reasonKey, (byReason.get(reasonKey) ?? 0) + 1);
    const monthKey = transfer.createdAt.toISOString().slice(0, 7);
    byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + 1);
    totalTreatments += transfer.treatmentsCount;
    totalCycles += transfer.cyclesCount;
  }

  const branchIdsNeeded = [...new Set([...byOrigin.keys(), ...byDestination.keys()])];
  const branchCache = new Map<string, { name: string; label_color: string }>();
  if (branchIdsNeeded.length) {
    const branches = await tx.branch.findMany({ where: { id: { in: branchIdsNeeded } }, select: { id: true, name: true, labelColor: true } });
    for (const branch of branches) branchCache.set(branch.id, { name: branch.name, label_color: branch.labelColor });
  }

  const toBranchRows = (map: Map<string, number>) =>
    [...map.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([branchId, count]) => ({
        branch_id: branchId,
        name: branchCache.get(branchId)?.name ?? branchId,
        label_color: branchCache.get(branchId)?.label_color ?? '#CDE9EC',
        count,
      }));

  const by_reason = [...byReason.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, REASON_TOP_N)
    .map(([reason, count]) => ({ reason, count }));

  const by_month = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));

  return {
    summary: { total_transfers: transfers.length, total_treatments_moved: totalTreatments, total_cycles_moved: totalCycles },
    by_origin_branch: toBranchRows(byOrigin),
    by_destination_branch: toBranchRows(byDestination),
    by_reason,
    by_month,
    notes: { reason_limitation: REASON_LIMITATION_NOTE },
    definitions: { scope: SCOPE_DEFINITION, by_month: BY_MONTH_DEFINITION },
  };
}

reportsTransfersRouter.get('/', validateQuery(reportBaseQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role);
  const query = res.locals.validatedQuery as z.infer<typeof reportBaseQuery>;
  const requestedBranchIds = parseBranchIds(query.branch_id);

  const result = await withTenant(tenant.organizationId, async (tx: Tx) => {
    const today = toDateOnly(new Date());
    const scope = await accessibleBranchIds(tx, tenant);
    const branchIds = resolveScopedBranchIds(scope, requestedBranchIds);
    const { from, to } = resolveReportRange(query, today);
    return getTransfersData(tx, branchIds, from, to);
  });

  res.json(result);
});
