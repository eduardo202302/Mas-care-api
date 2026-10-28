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

export const refillsRouter = Router();
refillsRouter.use(resolveTenant);

type Tx = Prisma.TransactionClient;

const requirePermission = (role: Parameters<typeof puede>[0]) => {
  if (!puede(role, 'dashboard:read')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

/**
 * Forecast horizons, in days, for "unidades previstas" below. Fixed set per
 * the block 4b spec (7/14/30/60), not derived from any Setting - this report
 * documents its own horizons rather than reusing an unrelated threshold like
 * dueSoonDays/upcomingDays (those drive coverage *status*, not a refill
 * demand forecast).
 */
export const FORECAST_HORIZON_DAYS = [7, 14, 30, 60] as const;

/**
 * "Unidades entregadas" = sum of Delivery.quantity for deliveries whose
 * deliveredOn falls in [from, to], grouped by medication + branch. This is a
 * plain historical fact (Delivery is an immutable record of what was handed
 * over), unlike the forecast below.
 *
 * "Previsión por horizonte" = for each open RefillCycle (closedAt IS NULL)
 * whose expectedOn falls within today..today+horizon, sum expectedQuantity.
 * This is only ever an estimate of near-term demand from cycles that already
 * exist - it intentionally excludes any treatment that has no open cycle
 * (e.g. a treatment whose next cycle has not been generated yet, or one
 * that's paused/finished), because there is no cycle row to source a
 * forecast quantity from without inventing one. This is why the response
 * carries an explicit note instead of silently under/over-counting.
 */
const FORECAST_NOTE =
  'Previsión estimada, no incluye tratamientos sin ciclo: solo se suman los RefillCycle abiertos ' +
  '(closedAt es null) cuyo expected_on cae dentro del horizonte. Un tratamiento activo que aún no tiene un ' +
  'ciclo de reposición generado, o uno pausado/finalizado, no aporta previsión en ningún horizonte porque no ' +
  'existe una fila de ciclo de la que tomar la cantidad esperada.';

const DELIVERED_UNITS_DEFINITION =
  'Suma de Delivery.quantity de las entregas cuyo delivered_on cae en el rango from/to, agrupada por ' +
  'medicamento y sucursal (Delivery.branchId).';

const STOCK_STATUS_DEFINITION =
  'Último MedicationStockMark registrado para ese medicamento + sucursal (level: in_stock | low | ' +
  'out_of_stock), o null si nunca se ha marcado el stock de esa combinación.';

const PACKAGE_SIZE_NOTE =
  'Medication.unitsPerPackage existe en el esquema (Decimal opcional, unidades por envase) y se usa aquí ' +
  'para estimar estimated_packages = ceil(unidades / unitsPerPackage) tanto en delivered_units como en cada ' +
  'horizonte de previsión. Cuando unitsPerPackage es null para ese medicamento (campo opcional, no todos los ' +
  'medicamentos lo tienen capturado), estimated_packages se omite (no se envía en null) para ese medicamento ' +
  'en vez de reportar un envase inventado.';

type MedicationLite = { id: string; brandName: string | null; genericName: string | null; activeIngredient: string | null; presentation: string; unitsPerPackage: string | number | null };

function medicationName(medication: Pick<MedicationLite, 'brandName' | 'genericName' | 'activeIngredient' | 'presentation'>) {
  return medication.brandName ?? medication.genericName ?? medication.activeIngredient ?? medication.presentation;
}

function estimatedPackages(units: number, unitsPerPackage: string | number | null): number | undefined {
  if (unitsPerPackage === null) return undefined;
  const size = Number(unitsPerPackage);
  if (!Number.isFinite(size) || size <= 0) return undefined;
  return Math.ceil(units / size);
}

type Row = {
  medication_id: string;
  medication: string;
  branch_id: string;
  branch: string;
  label_color: string;
  delivered_units: number;
  forecast: Record<string, { units: number }>;
  stock_status: 'in_stock' | 'low' | 'out_of_stock' | null;
};

export type RefillsRow = {
  medication_id: string;
  medication: string;
  branch_id: string;
  branch: string;
  label_color: string;
  delivered_units: number;
  estimated_packages?: number;
  forecast: Record<string, { units: number; estimated_packages?: number }>;
  stock_status: 'in_stock' | 'low' | 'out_of_stock' | null;
};

export type RefillsReport = {
  data: RefillsRow[];
  horizons_days: typeof FORECAST_HORIZON_DAYS;
  notes: { forecast: string; package_size: string };
  definitions: { delivered_units: string; stock_status: string };
};

function keyFor(medicationId: string, branchId: string) {
  return `${medicationId}:${branchId}`;
}

/**
 * Shared implementation behind GET /api/v1/reports/refills and the CSV
 * export (export.ts). Pulled out of the route handler so both call sites
 * run the exact same aggregation instead of the export reimplementing it.
 */
export async function getRefillsData(tx: Tx, branchIds: string[] | null, from: Date, to: Date, today: Date): Promise<RefillsReport> {
  const deliveryWhere: Prisma.DeliveryWhereInput = {
    deliveredOn: { gte: from, lte: to },
    ...(branchIds ? { branchId: { in: branchIds } } : {}),
  };
  const deliveries = await tx.delivery.findMany({
    where: deliveryWhere,
    select: {
      quantity: true,
      branchId: true,
      treatment: { select: { medicationId: true, medication: { select: { id: true, brandName: true, genericName: true, activeIngredient: true, presentation: true, unitsPerPackage: true } } } },
    },
  });

  const rows = new Map<string, Row>();
  const medicationCache = new Map<string, MedicationLite>();
  const branchCache = new Map<string, { name: string; label_color: string }>();

  for (const delivery of deliveries) {
    const medication = delivery.treatment.medication;
    medicationCache.set(medication.id, medication as MedicationLite);
    const key = keyFor(medication.id, delivery.branchId);
    const row = rows.get(key) ?? {
      medication_id: medication.id,
      medication: medicationName(medication),
      branch_id: delivery.branchId,
      branch: '',
      label_color: '',
      delivered_units: 0,
      forecast: {},
      stock_status: null,
    };
    row.delivered_units += Number(delivery.quantity);
    rows.set(key, row);
  }

  const maxHorizon = Math.max(...FORECAST_HORIZON_DAYS);
  const horizonCutoff = new Date(today.getTime() + maxHorizon * 24 * 60 * 60 * 1000);
  const cycleWhere: Prisma.RefillCycleWhereInput = {
    closedAt: null,
    expectedOn: { gte: today, lte: horizonCutoff },
    ...(branchIds ? { branchId: { in: branchIds } } : {}),
  };
  const forecastCycles = await tx.refillCycle.findMany({
    where: cycleWhere,
    select: {
      branchId: true,
      expectedOn: true,
      expectedQuantity: true,
      treatment: { select: { medicationId: true, medication: { select: { id: true, brandName: true, genericName: true, activeIngredient: true, presentation: true, unitsPerPackage: true } } } },
    },
  });

  for (const cycle of forecastCycles) {
    const medication = cycle.treatment.medication;
    medicationCache.set(medication.id, medication as MedicationLite);
    const key = keyFor(medication.id, cycle.branchId);
    const row = rows.get(key) ?? {
      medication_id: medication.id,
      medication: medicationName(medication),
      branch_id: cycle.branchId,
      branch: '',
      label_color: '',
      delivered_units: 0,
      forecast: {},
      stock_status: null,
    };
    const daysOut = Math.ceil((cycle.expectedOn.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    for (const horizon of FORECAST_HORIZON_DAYS) {
      if (daysOut > horizon) continue;
      const bucket = row.forecast[String(horizon)] ?? { units: 0 };
      bucket.units += Number(cycle.expectedQuantity);
      row.forecast[String(horizon)] = bucket;
    }
    rows.set(key, row);
  }

  const branchIdsNeeded = [...new Set([...rows.values()].map((r) => r.branch_id))];
  if (branchIdsNeeded.length) {
    const branches = await tx.branch.findMany({ where: { id: { in: branchIdsNeeded } }, select: { id: true, name: true, labelColor: true } });
    for (const branch of branches) branchCache.set(branch.id, { name: branch.name, label_color: branch.labelColor });
  }

  const medicationIdsNeeded = [...new Set([...rows.values()].map((r) => r.medication_id))];
  const stockMarks = medicationIdsNeeded.length && branchIdsNeeded.length
    ? await tx.medicationStockMark.findMany({
        where: { medicationId: { in: medicationIdsNeeded }, branchId: { in: branchIdsNeeded } },
        select: { medicationId: true, branchId: true, level: true },
      })
    : [];
  const stockByKey = new Map(stockMarks.map((mark) => [keyFor(mark.medicationId, mark.branchId), mark.level]));

  const data: RefillsRow[] = [...rows.values()].map((row) => {
    const branchInfo = branchCache.get(row.branch_id);
    const medication = medicationCache.get(row.medication_id)!;
    const estDeliveredPackages = estimatedPackages(row.delivered_units, medication.unitsPerPackage);
    const forecast = Object.fromEntries(
      FORECAST_HORIZON_DAYS.map((horizon) => {
        const bucket = row.forecast[String(horizon)] ?? { units: 0 };
        const packages = estimatedPackages(bucket.units, medication.unitsPerPackage);
        return [
          String(horizon),
          { units: Math.round(bucket.units * 100) / 100, ...(packages !== undefined ? { estimated_packages: packages } : {}) },
        ];
      }),
    );
    return {
      medication_id: row.medication_id,
      medication: row.medication,
      branch_id: row.branch_id,
      branch: branchInfo?.name ?? row.branch_id,
      label_color: branchInfo?.label_color ?? '#CDE9EC',
      delivered_units: Math.round(row.delivered_units * 100) / 100,
      ...(estDeliveredPackages !== undefined ? { estimated_packages: estDeliveredPackages } : {}),
      forecast,
      stock_status: stockByKey.get(keyFor(row.medication_id, row.branch_id)) ?? null,
    };
  });

  return {
    data,
    horizons_days: FORECAST_HORIZON_DAYS,
    notes: { forecast: FORECAST_NOTE, package_size: PACKAGE_SIZE_NOTE },
    definitions: { delivered_units: DELIVERED_UNITS_DEFINITION, stock_status: STOCK_STATUS_DEFINITION },
  };
}

refillsRouter.get('/', validateQuery(reportBaseQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role);
  const query = res.locals.validatedQuery as z.infer<typeof reportBaseQuery>;
  const requestedBranchIds = parseBranchIds(query.branch_id);

  const result = await withTenant(tenant.organizationId, async (tx: Tx) => {
    const today = toDateOnly(new Date());
    const scope = await accessibleBranchIds(tx, tenant);
    const branchIds = resolveScopedBranchIds(scope, requestedBranchIds);
    const { from, to } = resolveReportRange(query, today);
    return getRefillsData(tx, branchIds, from, to, today);
  });

  res.json(result);
});
