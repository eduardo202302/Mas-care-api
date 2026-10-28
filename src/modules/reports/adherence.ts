import { Router } from 'express';
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
import { parseBranchIds, percentageOrNull, reportBaseQuery, resolveReportRange } from '../../schemas/report.js';
import { resolveScopedBranchIds } from './branch-scope-helper.js';

export const adherenceRouter = Router();
adherenceRouter.use(resolveTenant);

type Tx = Prisma.TransactionClient;

const requirePermission = (role: Parameters<typeof puede>[0]) => {
  if (!puede(role, 'dashboard:read')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

/**
 * "Ciclo adherente" (adherence.ts, block 4a):
 *
 * A RefillCycle counts as adherent when it has at least one Delivery whose
 * `deliveredOn` is on or before `expectedOn + dueSoonDays` days. There is no
 * dedicated "adherence window" field on `Setting` (reviewed the full model:
 * upcomingDays, dueSoonDays, noticeLeadDays, maxNoticeAttempts,
 * retryAfterHours, prescriptionWarningDays, automationEnabled/DryRun,
 * timezone, noticeWindowStart/End, autoCallTaskWithoutConsent,
 * defaultCountryCode - none of these is specific to "was this refill picked
 * up close enough to on time"). `dueSoonDays` was chosen over
 * `upcomingDays`/`prescriptionWarningDays` because it is the same threshold
 * `deriveCoverage()` (src/domain/coverage.ts) already uses to flag a cycle
 * as urgent ("vence_pronto"); reusing it keeps one tolerance concept across
 * the app instead of inventing a second, unrelated number. A delivery on
 * `expectedOn` itself (0 days late) is always adherent; a delivery with no
 * date at all (cycle still open, never delivered) is NOT adherent.
 *
 * Denominator ("ciclos evaluables"): RefillCycle rows whose `expectedOn`
 * falls inside [from, to] AND whose `expectedOn` is not in the future
 * relative to today. Rationale: a cycle expected tomorrow has not had the
 * chance to be late or on time yet, so including it would understate
 * adherence for no reason tied to actual behavior - it is excluded from the
 * denominator entirely (not counted as non-adherent, not counted as
 * adherent) regardless of what `to` is set to.
 */
const ADHERENCE_DEFINITION =
  'Un ciclo se considera "adherente" cuando tiene al menos una entrega (Delivery) registrada en o antes de ' +
  'expected_on + due_soon_days días (el mismo umbral que deriveCoverage() usa para "vence_pronto"). El ' +
  'denominador son los ciclos cuyo expected_on cae en el rango from/to Y ya venció (expected_on <= hoy); ' +
  'los ciclos cuyo expected_on es futuro se excluyen del denominador porque aún no tuvieron oportunidad de ' +
  'ser puntuales o tardíos.';
const AVG_DELAY_DEFINITION =
  'Promedio de (delivered_on - expected_on) en días, calculado solo sobre los ciclos adherentes del rango ' +
  'que tuvieron al menos un día de retraso o ninguno (valor 0 o positivo); ciclos sin entrega no participan ' +
  'en este promedio porque no tienen una fecha de entrega con la que calcular el retraso.';
const MANUAL_ADJUSTMENTS_DEFINITION =
  'Cantidad de tratamientos con una Activity de tipo coverage_adjusted cuyo occurredAt cae en el rango ' +
  'from/to (se prefiere la Activity de auditoría sobre el flag crudo coverageManuallyAdjusted porque ese ' +
  'flag es un estado actual que se sobrescribe en el siguiente ajuste o entrega, mientras que la Activity ' +
  'es un registro inmutable por evento y permite contar cuántos ajustes ocurrieron DENTRO del rango, no solo ' +
  'si el tratamiento está actualmente ajustado).';

type EvaluableCycle = {
  id: string;
  branchId: string;
  treatmentId: string;
  expectedOn: Date;
  treatment: { medicationId: string; medication: { brandName: string | null; genericName: string | null; activeIngredient: string | null; presentation: string } };
  deliveries: { deliveredOn: Date }[];
};

function medicationName(medication: EvaluableCycle['treatment']['medication']) {
  return medication.brandName ?? medication.genericName ?? medication.activeIngredient ?? medication.presentation;
}

function isAdherent(cycle: EvaluableCycle, dueSoonDays: number): boolean {
  const limit = new Date(cycle.expectedOn.getTime() + dueSoonDays * 24 * 60 * 60 * 1000);
  return cycle.deliveries.some((delivery) => delivery.deliveredOn.getTime() <= limit.getTime());
}

function delayDaysFor(cycle: EvaluableCycle): number | null {
  const onTimeOrLate = cycle.deliveries
    .map((delivery) => daysBetween(cycle.expectedOn, delivery.deliveredOn))
    .filter((days) => days >= 0);
  if (!onTimeOrLate.length) return null;
  return Math.min(...onTimeOrLate);
}

type Agg = { numerator: number; denominator: number };
function bump(map: Map<string, Agg>, key: string, adherent: boolean) {
  const row = map.get(key) ?? { numerator: 0, denominator: 0 };
  row.denominator += 1;
  if (adherent) row.numerator += 1;
  map.set(key, row);
}
function toAggregateRows(map: Map<string, Agg>) {
  return [...map.entries()].map(([key, { numerator, denominator }]) => ({
    key,
    numerator,
    denominator,
    percentage: percentageOrNull(numerator, denominator),
  }));
}

async function evaluateRange(tx: Tx, branchIds: string[] | null, from: Date, to: Date, today: Date) {
  const effectiveTo = to.getTime() < today.getTime() ? to : today;
  const where: Prisma.RefillCycleWhereInput = {
    expectedOn: { gte: from, lte: effectiveTo },
    ...(branchIds ? { branchId: { in: branchIds } } : {}),
  };
  const cycles = (await tx.refillCycle.findMany({
    where,
    select: {
      id: true,
      branchId: true,
      treatmentId: true,
      expectedOn: true,
      treatment: { select: { medicationId: true, medication: { select: { brandName: true, genericName: true, activeIngredient: true, presentation: true } } } },
      deliveries: { select: { deliveredOn: true } },
    },
  })) as EvaluableCycle[];
  return cycles;
}

adherenceRouter.get('/', validateQuery(reportBaseQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role);
  const query = res.locals.validatedQuery as z.infer<typeof reportBaseQuery>;
  const requestedBranchIds = parseBranchIds(query.branch_id);

  const result = await withTenant(tenant.organizationId, async (tx) => {
    const settings = await findOrCreateSetting(tx, tenant.organizationId);
    const today = toDateOnly(new Date());
    const scope = await accessibleBranchIds(tx, tenant);
    const branchIds = resolveScopedBranchIds(scope, requestedBranchIds);

    const { from, to } = resolveReportRange(query, today);
    const cycles = await evaluateRange(tx, branchIds, from, to, today);

    const byMonth = new Map<string, Agg>();
    const byBranch = new Map<string, Agg>();
    const byMedication = new Map<string, Agg>();
    const branchNames = new Map<string, { name: string; label_color: string }>();
    const medicationNames = new Map<string, string>();
    const delays: number[] = [];
    let numerator = 0;

    for (const cycle of cycles) {
      const adherent = isAdherent(cycle, settings.dueSoonDays);
      if (adherent) {
        numerator += 1;
        const delay = delayDaysFor(cycle);
        if (delay !== null) delays.push(delay);
      }
      const monthKey = cycle.expectedOn.toISOString().slice(0, 7);
      bump(byMonth, monthKey, adherent);
      bump(byBranch, cycle.branchId, adherent);
      bump(byMedication, cycle.treatment.medicationId, adherent);
      medicationNames.set(cycle.treatment.medicationId, medicationName(cycle.treatment.medication));
    }

    const denominator = cycles.length;

    if (byBranch.size) {
      const branches = await tx.branch.findMany({
        where: { id: { in: [...byBranch.keys()] } },
        select: { id: true, name: true, labelColor: true },
      });
      for (const branch of branches) branchNames.set(branch.id, { name: branch.name, label_color: branch.labelColor });
    }

    const manualAdjustmentsCount = await tx.activity.count({
      where: {
        type: 'coverage_adjusted',
        occurredAt: { gte: from, lte: to },
        ...(branchIds ? { treatment: { branchId: { in: branchIds } } } : {}),
      },
    });

    let previousPeriod = null;
    if (query.compare_previous) {
      const spanMs = to.getTime() - from.getTime();
      const prevTo = new Date(from.getTime() - 24 * 60 * 60 * 1000);
      const prevFrom = new Date(prevTo.getTime() - spanMs);
      const prevCycles = await evaluateRange(tx, branchIds, prevFrom, prevTo, today);
      const prevNumerator = prevCycles.filter((cycle) => isAdherent(cycle, settings.dueSoonDays)).length;
      previousPeriod = {
        numerator: prevNumerator,
        denominator: prevCycles.length,
        percentage: percentageOrNull(prevNumerator, prevCycles.length),
      };
    }

    return {
      summary: { numerator, denominator, percentage: percentageOrNull(numerator, denominator) },
      previous_period: previousPeriod,
      by_month: toAggregateRows(byMonth).map((row) => ({ month: row.key, numerator: row.numerator, denominator: row.denominator, percentage: row.percentage })),
      by_branch: toAggregateRows(byBranch).map((row) => ({
        branch_id: row.key,
        name: branchNames.get(row.key)?.name ?? row.key,
        label_color: branchNames.get(row.key)?.label_color ?? '#CDE9EC',
        numerator: row.numerator,
        denominator: row.denominator,
        percentage: row.percentage,
      })),
      by_medication: toAggregateRows(byMedication).map((row) => ({
        medication_id: row.key,
        name: medicationNames.get(row.key) ?? row.key,
        numerator: row.numerator,
        denominator: row.denominator,
        percentage: row.percentage,
      })),
      avg_delay_days: delays.length ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 100) / 100 : null,
      manual_adjustments_count: manualAdjustmentsCount,
      definitions: {
        adherence: ADHERENCE_DEFINITION,
        avg_delay_days: AVG_DELAY_DEFINITION,
        manual_adjustments_count: MANUAL_ADJUSTMENTS_DEFINITION,
      },
    };
  });

  res.json(result);
});
