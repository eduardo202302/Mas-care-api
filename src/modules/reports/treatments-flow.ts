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

export const treatmentsFlowRouter = Router();
treatmentsFlowRouter.use(resolveTenant);

type Tx = Prisma.TransactionClient;

const requirePermission = (role: Parameters<typeof puede>[0]) => {
  if (!puede(role, 'dashboard:read')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

/**
 * Category -> Activity.type mapping, and why only these four categories are
 * in the response shape.
 *
 * ActivityType (prisma/schema.prisma) has exactly four treatment-lifecycle
 * values, each written at the moment the corresponding transition happens
 * (treatments/router.ts and cycleTransitions.ts write an Activity row when a
 * treatment is created/paused/resumed/finished), each carrying a real
 * `occurredAt` timestamp:
 *
 *   altas         <- treatment_created
 *   pausas        <- treatment_paused
 *   reanudaciones <- treatment_resumed
 *   finalizaciones <- treatment_finished
 *
 * All four are included because all four have this real, immutable,
 * timestamped source. There is no fifth lifecycle category in scope here
 * ("deleted"/"archived" treatments do not exist as a concept - Treatment has
 * no delete/archive, only status transitions among active/paused/finished,
 * fully covered by the four Activity types above), so nothing is being
 * silently left out: this list IS the complete set of treatment lifecycle
 * transitions this schema can produce an Activity for.
 */
const CATEGORY_ACTIVITY_TYPE = {
  altas: 'treatment_created',
  pausas: 'treatment_paused',
  reanudaciones: 'treatment_resumed',
  finalizaciones: 'treatment_finished',
} as const;
export const treatmentFlowCategories = Object.keys(CATEGORY_ACTIVITY_TYPE) as Array<keyof typeof CATEGORY_ACTIVITY_TYPE>;

const SOURCE_NOTE =
  'Las 4 categorías (altas, pausas, reanudaciones, finalizaciones) provienen de Activity.type ' +
  '(treatment_created, treatment_paused, treatment_resumed, treatment_finished respectivamente), cada una ' +
  'escrita en el momento real de la transición con su propio occurredAt. No se infiere ninguna categoría a ' +
  'partir del estado actual de Treatment (Treatment.status): Treatment solo expone el estado presente, no un ' +
  'historial, así que contar "tratamientos actualmente pausados" como si fuera "pausas en el rango" sería ' +
  'incorrecto (un tratamiento puede haberse pausado y reanudado varias veces dentro del mismo rango, o estar ' +
  'pausado hoy por una transición ocurrida fuera del rango). No se omite ninguna categoría de la lista ' +
  'original: ActivityType no define ninguna otra variante de ciclo de vida de tratamiento más allá de estas ' +
  'cuatro (altas/pausas/reanudaciones/finalizaciones es el conjunto completo).';

const MONTH_DEFINITION = 'Mes calendario (YYYY-MM, UTC) de Activity.occurredAt para esa categoría.';

type ActivityRow = { type: string; occurredAt: Date; treatment: { branchId: string } | null };

export type TreatmentsFlowReport = {
  by_month: Array<{ month: string; altas: number; pausas: number; reanudaciones: number; finalizaciones: number }>;
  totals: { altas: number; pausas: number; reanudaciones: number; finalizaciones: number };
  categories_included: typeof treatmentFlowCategories;
  notes: { source: string };
  definitions: { month: string };
};

/**
 * Shared implementation behind GET /api/v1/reports/treatments-flow and the
 * CSV export (export.ts).
 */
export async function getTreatmentsFlowData(tx: Tx, branchIds: string[] | null, from: Date, to: Date): Promise<TreatmentsFlowReport> {
  const activityTypes = Object.values(CATEGORY_ACTIVITY_TYPE);
  const where: Prisma.ActivityWhereInput = {
    type: { in: activityTypes },
    occurredAt: { gte: from, lte: to },
    ...(branchIds ? { treatment: { branchId: { in: branchIds } } } : {}),
  };
  const activities = (await tx.activity.findMany({
    where,
    select: { type: true, occurredAt: true, treatment: { select: { branchId: true } } },
  })) as ActivityRow[];

  const typeToCategory = new Map<string, keyof typeof CATEGORY_ACTIVITY_TYPE>(
    Object.entries(CATEGORY_ACTIVITY_TYPE).map(([category, type]) => [type, category as keyof typeof CATEGORY_ACTIVITY_TYPE]),
  );

  const byMonth = new Map<string, { altas: number; pausas: number; reanudaciones: number; finalizaciones: number }>();
  const totals = { altas: 0, pausas: 0, reanudaciones: 0, finalizaciones: 0 };

  for (const activity of activities) {
    const category = typeToCategory.get(activity.type);
    if (!category) continue; // branch-filtered out via treatment relation already; defensive only
    const monthKey = activity.occurredAt.toISOString().slice(0, 7);
    const row = byMonth.get(monthKey) ?? { altas: 0, pausas: 0, reanudaciones: 0, finalizaciones: 0 };
    row[category] += 1;
    byMonth.set(monthKey, row);
    totals[category] += 1;
  }

  const by_month = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, counts]) => ({ month, ...counts }));

  return {
    by_month,
    totals,
    categories_included: treatmentFlowCategories,
    notes: { source: SOURCE_NOTE },
    definitions: { month: MONTH_DEFINITION },
  };
}

treatmentsFlowRouter.get('/', validateQuery(reportBaseQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role);
  const query = res.locals.validatedQuery as z.infer<typeof reportBaseQuery>;
  const requestedBranchIds = parseBranchIds(query.branch_id);

  const result = await withTenant(tenant.organizationId, async (tx: Tx) => {
    const today = toDateOnly(new Date());
    const scope = await accessibleBranchIds(tx, tenant);
    const branchIds = resolveScopedBranchIds(scope, requestedBranchIds);
    const { from, to } = resolveReportRange(query, today);
    return getTreatmentsFlowData(tx, branchIds, from, to);
  });

  res.json(result);
});
