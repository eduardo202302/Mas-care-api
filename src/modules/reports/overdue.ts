import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { accessibleBranchIds } from '../../infra/branch-scope.js';
import { resolvePaging } from '../../infra/pagination.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateQuery } from '../../infra/validate.js';
import { daysBetween, toDateOnly } from '../../domain/coverage.js';
import { parseBranchIds, reportBaseQuery, resolveReportRange } from '../../schemas/report.js';
import { resolveScopedBranchIds } from './branch-scope-helper.js';

export const overdueRouter = Router();
overdueRouter.use(resolveTenant);

const requirePermission = (role: Parameters<typeof puede>[0]) => {
  if (!puede(role, 'dashboard:read')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

/**
 * "Ciclo vencido" (overdue.ts, block 4a): reuses the exact overdue rule
 * dashboard/router.ts already applies at the Treatment level
 * (`coverageEndOn < today`, see computeDashboardCounts() in
 * src/domain/dashboard-metrics.ts and the `overdue` case in
 * dashboard/router.ts's `/list`), translated to the RefillCycle level that
 * this report is scoped to: a cycle is overdue when it is still open
 * (`closedAt IS NULL`) and its `expectedOn` is strictly before today. This
 * is the cycle-level analogue of the treatment-level rule - a cycle only
 * stays open past its expected date when nothing has closed it yet (no
 * delivery, no not-picked-up), which is precisely when its treatment would
 * also show "vencido" under deriveCoverage(). No separate/new overdue
 * concept was invented.
 *
 * `delivered_late` vs `still_pending`: the data DOES support this
 * distinction for a cycle whose `expectedOn` has passed - a Delivery row is
 * linked to its originating RefillCycle via `cycleId` (model Delivery,
 * prisma/schema.prisma), and marking a cycle "delivered" or "not_picked_up"
 * closes it (`closedAt` set), per cycleTransitions.ts. So:
 *   - `still_pending`: cycle still open (closedAt IS NULL) - no Delivery has
 *     been recorded against it yet.
 *   - `delivered_late`: the cycle DOES have a Delivery, but it was recorded
 *     after `expectedOn` (closing the cycle only once the delivery, even if
 *     late, actually happened).
 * Both are counted within "total_overdue" by `expectedOn` falling in range,
 * regardless of whether the cycle has since closed - "overdue" describes
 * whether the expected date was missed, not whether it is still open today.
 */
const OVERDUE_DEFINITION =
  'Un ciclo se considera "vencido" cuando su expected_on es anterior a hoy (mismo criterio que usa ' +
  'deriveCoverage()/dashboard para marcar un tratamiento como "vencido", aplicado a nivel de ciclo). Se ' +
  'incluyen en este informe los ciclos cuyo expected_on cae en el rango from/to. "entregado_tarde" indica ' +
  'que el ciclo tiene una Delivery registrada después de expected_on; "aun_pendiente" indica que el ciclo ' +
  'no tiene ninguna Delivery asociada todavía.';
const AVG_DELAY_DEFINITION =
  'Promedio de (delivered_on - expected_on) en días, calculado solo sobre los ciclos vencidos que ya ' +
  'tienen una entrega registrada (entregado_tarde); los ciclos aún sin entrega no tienen una fecha de ' +
  'entrega con la que calcular el retraso y por eso no participan en este promedio.';

type OverdueCycle = {
  id: string;
  branchId: string;
  treatmentId: string;
  expectedOn: Date;
  closedAt: Date | null;
  treatment: { patient: { id: string; fullName: string }; medication: { brandName: string | null; genericName: string | null; activeIngredient: string | null; presentation: string } };
  branch: { name: string; labelColor: string };
  deliveries: { deliveredOn: Date }[];
};

function medicationName(medication: OverdueCycle['treatment']['medication']) {
  return medication.brandName ?? medication.genericName ?? medication.activeIngredient ?? medication.presentation;
}

/** Earliest delivery after expectedOn, or null when still pending. */
function lateDeliveryFor(cycle: OverdueCycle): Date | null {
  const late = cycle.deliveries
    .map((delivery) => delivery.deliveredOn)
    .filter((deliveredOn) => deliveredOn.getTime() > cycle.expectedOn.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  return late[0] ?? null;
}

overdueRouter.get('/', validateQuery(reportBaseQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role);
  const query = res.locals.validatedQuery as z.infer<typeof reportBaseQuery>;
  const requestedBranchIds = parseBranchIds(query.branch_id);

  const result = await withTenant(tenant.organizationId, async (tx) => {
    const today = toDateOnly(new Date());
    const scope = await accessibleBranchIds(tx, tenant);
    const branchIds = resolveScopedBranchIds(scope, requestedBranchIds);
    const { from, to } = resolveReportRange(query, today);

    const where: Prisma.RefillCycleWhereInput = {
      expectedOn: { gte: from, lte: to, lt: today },
      ...(branchIds ? { branchId: { in: branchIds } } : {}),
    };

    const allOverdue = (await tx.refillCycle.findMany({
      where,
      select: {
        id: true,
        branchId: true,
        treatmentId: true,
        expectedOn: true,
        closedAt: true,
        treatment: { select: { patient: { select: { id: true, fullName: true } }, medication: { select: { brandName: true, genericName: true, activeIngredient: true, presentation: true } } } },
        branch: { select: { name: true, labelColor: true } },
        deliveries: { select: { deliveredOn: true } },
      },
      orderBy: [{ expectedOn: 'asc' }, { id: 'asc' }],
    })) as OverdueCycle[];

    const { page, rows, skip } = resolvePaging(query);
    const pageRows = allOverdue.slice(skip, skip + rows);

    const byBranch = new Map<string, { total_overdue: number; delays: number[]; name: string; label_color: string }>();
    let deliveredLate = 0;
    let stillPending = 0;
    const allDelays: number[] = [];

    for (const cycle of allOverdue) {
      const lateDelivery = lateDeliveryFor(cycle);
      const delayDays = lateDelivery ? daysBetween(cycle.expectedOn, lateDelivery) : null;
      if (lateDelivery) { deliveredLate += 1; allDelays.push(delayDays!); } else { stillPending += 1; }

      const row = byBranch.get(cycle.branchId) ?? { total_overdue: 0, delays: [], name: cycle.branch.name, label_color: cycle.branch.labelColor };
      row.total_overdue += 1;
      if (delayDays !== null) row.delays.push(delayDays);
      byBranch.set(cycle.branchId, row);
    }

    const detail = pageRows.map((cycle) => {
      const lateDelivery = lateDeliveryFor(cycle);
      return {
        cycle_id: cycle.id,
        patient: { id: cycle.treatment.patient.id, full_name: cycle.treatment.patient.fullName },
        medication: medicationName(cycle.treatment.medication),
        branch: { id: cycle.branchId, name: cycle.branch.name, label_color: cycle.branch.labelColor },
        expected_on: cycle.expectedOn.toISOString().slice(0, 10),
        delay_days: lateDelivery ? daysBetween(cycle.expectedOn, lateDelivery) : null,
        status: cycle.closedAt ? 'closed' : 'open',
        delivered_late: Boolean(lateDelivery),
      };
    });

    return {
      summary: { total_overdue: allOverdue.length, delivered_late: deliveredLate, still_pending: stillPending },
      by_branch: [...byBranch.entries()].map(([branchId, row]) => ({
        branch_id: branchId,
        name: row.name,
        label_color: row.label_color,
        total_overdue: row.total_overdue,
        avg_delay_days: row.delays.length ? Math.round((row.delays.reduce((a, b) => a + b, 0) / row.delays.length) * 100) / 100 : null,
      })),
      avg_delay_days: allDelays.length ? Math.round((allDelays.reduce((a, b) => a + b, 0) / allDelays.length) * 100) / 100 : null,
      detail,
      total: allOverdue.length,
      page,
      rows,
      definitions: { overdue: OVERDUE_DEFINITION, avg_delay_days: AVG_DELAY_DEFINITION },
    };
  });

  res.json(result);
});
