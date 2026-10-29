import type { Prisma } from '@prisma/client';
import { customFilter } from '../custom-properties/service.js';
import { addDays, deriveCoverage, subtractDays, toDateOnly } from '../../domain/coverage.js';
import { boardColumns, type BoardColumn } from '../../domain/cycleTransitions.js';
import { accessibleBranchIds } from '../../infra/branch-scope.js';
import { ApiError } from '../../infra/errors.js';
import { withTenant } from '../../infra/prisma.js';
import { findOrCreateSetting } from '../../infra/settings.js';
import type { z } from 'zod';
import type { boardColumnsQuery, boardQuery, cycleListQuery } from '../../schemas/board.js';

type Tx = Prisma.TransactionClient;
type Tenant = NonNullable<Express.Request['tenant']>;
type BoardFilters = z.infer<typeof boardQuery>;
type BoardListFilters = z.infer<typeof boardColumnsQuery> | z.infer<typeof cycleListQuery>;

export type BoardSettings = {
  dueSoonDays: number;
  upcomingDays: number;
  prescriptionWarningDays: number;
};

export function settingsFor(tx: Tx, organizationId: string) {
  return findOrCreateSetting(tx, organizationId);
}

export const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);
export const todayOnly = () => toDateOnly(new Date());

const cardInclude = {
  branch: { select: { id: true, name: true, labelColor: true } },
  treatment: {
    select: {
      id: true,
      patientId: true,
      medicationId: true,
      responsibleUserId: true,
      customValues: true,
      responsibleUser: { select: { id: true, name: true } },
      status: true,
      startDate: true,
      quantityPerCycle: true,
      dosePerIntake: true,
      intakesPerDay: true,
      coverageEndOn: true,
      coverageManuallyAdjusted: true,
      prescriptionExpiresOn: true,
      patient: { select: { id: true, fullName: true } },
      medication: {
        select: {
          id: true,
          brandName: true,
          genericName: true,
          activeIngredient: true,
          presentation: true,
        },
      },
    },
  },
  _count: { select: { deliveries: true } },
} satisfies Prisma.RefillCycleInclude;

export type BoardCycle = Prisma.RefillCycleGetPayload<{ include: typeof cardInclude }>;

/**
 * Board and table share this order so both views always show the same cycles
 * in the same sequence. `status` is constant inside an open column; it only
 * groups the closed column (delivered before not_picked_up). Null positions
 * mean "not manually ordered" and sort last, after which expected_on applies.
 */
export const cardOrderBy: Prisma.RefillCycleOrderByWithRelationInput[] = [
  { status: 'asc' },
  { boardPosition: { sort: 'asc', nulls: 'last' } },
  { expectedOn: 'asc' },
  { id: 'asc' },
];

const tableOrderBy = cardOrderBy;

export function medicationName(medication: BoardCycle['treatment']['medication']): string {
  return medication.brandName ?? medication.genericName ?? medication.activeIngredient ?? medication.presentation;
}

export function stockKey(branchId: string, medicationId: string): string {
  return `${branchId}:${medicationId}`;
}

export async function loadStockMarks(tx: Tx, cycles: readonly BoardCycle[]) {
  const branchIds = [...new Set(cycles.map((cycle) => cycle.branchId))];
  const medicationIds = [...new Set(cycles.map((cycle) => cycle.treatment.medicationId))];
  if (!branchIds.length || !medicationIds.length) return new Map<string, { level: string; reviewedAt: Date; reviewedBy: string }>();
  const marks = await tx.medicationStockMark.findMany({
    where: { branchId: { in: branchIds }, medicationId: { in: medicationIds } },
    select: { branchId: true, medicationId: true, level: true, reviewedAt: true, reviewedBy: true },
  });
  return new Map(marks.map((mark) => [stockKey(mark.branchId, mark.medicationId), mark]));
}

export function presentCard(
  cycle: BoardCycle,
  settings: BoardSettings,
  stock: { level: string; reviewedAt: Date; reviewedBy: string } | undefined,
  today: Date,
) {
  const treatment = cycle.treatment;
  const coverage = deriveCoverage(
    {
      status: treatment.status,
      startDate: treatment.startDate,
      quantityPerCycle: treatment.quantityPerCycle.toString(),
      dosePerIntake: treatment.dosePerIntake.toString(),
      intakesPerDay: treatment.intakesPerDay.toString(),
      coverageEndOn: treatment.coverageEndOn,
      coverageManuallyAdjusted: treatment.coverageManuallyAdjusted,
      prescriptionExpiresOn: treatment.prescriptionExpiresOn,
    },
    { status: cycle.status, hasDelivery: cycle._count.deliveries > 0 },
    today,
    {
      dueSoonDays: settings.dueSoonDays,
      upcomingDays: settings.upcomingDays,
      prescriptionWarningDays: settings.prescriptionWarningDays,
    },
  );
  return {
    cycle_id: cycle.id,
    treatment_id: treatment.id,
    version: cycle.version,
    status: cycle.status,
    stage_id: cycle.stageId,
    priority: cycle.priority,
    type: cycle.type,
    treatment_custom_values: treatment.customValues,
    patient: { id: treatment.patient.id, nombre: treatment.patient.fullName, full_name: treatment.patient.fullName },
    medication: {
      id: treatment.medication.id,
      nombre: medicationName(treatment.medication),
      name: medicationName(treatment.medication),
      presentacion: treatment.medication.presentation,
      presentation: treatment.medication.presentation,
    },
    expected_on: cycle.expectedOn.toISOString().slice(0, 10),
    derived_status: coverage.status,
    days_remaining: coverage.daysRemaining,
    prescription_flag: coverage.prescriptionFlag,
    responsible_user_id: treatment.responsibleUserId,
    responsible: treatment.responsibleUser
      ? {
        id: treatment.responsibleUser.id,
        nombre: treatment.responsibleUser.name,
        name: treatment.responsibleUser.name,
      }
      : null,
    branch: { id: cycle.branch.id, nombre: cycle.branch.name, name: cycle.branch.name, label_color: cycle.branch.labelColor },
    stock_level: stock?.level ?? null,
    stock_reviewed_at: stock?.reviewedAt.toISOString() ?? null,
    board_position: cycle.boardPosition,
    closed_at: cycle.closedAt?.toISOString() ?? null,
  };
}

export type PresentedCard = ReturnType<typeof presentCard>;

export async function presentCycleCards(
  tx: Tx,
  cycles: readonly BoardCycle[],
  settings: BoardSettings,
  today: Date,
): Promise<PresentedCard[]> {
  const stock = await loadStockMarks(tx, cycles);
  return cycles.map((cycle) => presentCard(
    cycle,
    settings,
    stock.get(stockKey(cycle.branchId, cycle.treatment.medicationId)),
    today,
  ));
}

export async function loadCycleCard(
  tx: Tx,
  tenant: Tenant,
  cycleId: string,
  settings: BoardSettings,
  today: Date,
): Promise<PresentedCard | null> {
  const cycle = await tx.refillCycle.findFirst({ where: { id: cycleId, ...await branchScope(tx, tenant) }, include: cardInclude });
  if (!cycle) return null;
  return (await presentCycleCards(tx, [cycle], settings, today))[0] ?? null;
}

export async function branchScope(tx: Tx, tenant: Tenant): Promise<Prisma.RefillCycleWhereInput> {
  const ids = await accessibleBranchIds(tx, tenant);
  return ids === null ? {} : { branchId: { in: ids } };
}

export async function incidentBranchScope(tx: Tx, tenant: Tenant): Promise<Prisma.IncidentWhereInput> {
  const ids = await accessibleBranchIds(tx, tenant);
  return ids === null ? {} : { branchId: { in: ids } };
}

type DerivedContext = { today: Date; dueLimit: Date; upcomingLimit: Date };

function derivedConditions(context: DerivedContext) {
  const vencido: Prisma.RefillCycleWhereInput = {
    treatment: { is: { status: 'active', coverageEndOn: { lt: context.today } } },
  };
  const vencePronto: Prisma.RefillCycleWhereInput = {
    treatment: { is: { status: 'active', coverageEndOn: { gte: context.today, lte: context.dueLimit } } },
  };
  const retiroPendiente: Prisma.RefillCycleWhereInput = {
    AND: [
      { status: 'prepared' },
      { deliveries: { none: {} } },
      { treatment: { is: { status: 'active' } } },
      {
        OR: [
          { treatment: { is: { coverageEndOn: null } } },
          { treatment: { is: { coverageEndOn: { gt: context.dueLimit } } } },
        ],
      },
    ],
  };
  const proximaReposicion: Prisma.RefillCycleWhereInput = {
    AND: [
      { treatment: { is: { status: 'active', coverageEndOn: { gt: context.dueLimit, lte: context.upcomingLimit } } } },
      { NOT: { status: 'prepared', deliveries: { none: {} } } },
    ],
  };
  return { vencido, vencePronto, retiroPendiente, proximaReposicion };
}

/** SQL translation of deriveStatus, so filtering and counts stay in the database. */
export function derivedWhere(status: string, context: DerivedContext): Prisma.RefillCycleWhereInput {
  const conditions = derivedConditions(context);
  switch (status) {
    case 'vencido':
      return conditions.vencido;
    case 'vence_pronto':
      return conditions.vencePronto;
    case 'retiro_pendiente':
      return conditions.retiroPendiente;
    case 'proxima_reposicion':
      return conditions.proximaReposicion;
    case 'al_dia':
      return {
        AND: [
          { treatment: { is: { status: 'active' } } },
          { NOT: { OR: [conditions.vencido, conditions.vencePronto, conditions.retiroPendiente, conditions.proximaReposicion] } },
        ],
      };
    default:
      return {};
  }
}

export function derivedContext(settings: BoardSettings, today = todayOnly()): DerivedContext {
  return {
    today,
    dueLimit: addDays(today, settings.dueSoonDays),
    upcomingLimit: addDays(today, settings.upcomingDays),
  };
}

export async function baseWhere(
  tx: Tx,
  tenant: Tenant,
  filters: BoardFilters,
  context: DerivedContext,
): Promise<Prisma.RefillCycleWhereInput> {
  const scoped = await branchScope(tx, tenant);
  const treatment: Prisma.TreatmentWhereInput = {};
  if (filters.responsible_user_id) treatment.responsibleUserId = filters.responsible_user_id;
  if (filters.medication_id) treatment.medicationId = filters.medication_id;
  if (filters.q) treatment.patient = { fullName: { contains: filters.q, mode: 'insensitive' } };
  const expectedOn: Prisma.DateTimeFilter = {};
  if (filters.expected_from) expectedOn.gte = dateOnly(filters.expected_from);
  if (filters.expected_to) expectedOn.lte = dateOnly(filters.expected_to);

  const and: Prisma.RefillCycleWhereInput[] = [scoped];
  if (filters.branch_id) and.push({ branchId: filters.branch_id });
  if (Object.keys(treatment).length) and.push({ treatment: { is: treatment } });
  if (Object.keys(expectedOn).length) and.push({ expectedOn });
  if (filters.derived_status) and.push(derivedWhere(filters.derived_status, context));
  return { AND: and };
}

export function columnWhere(column: BoardColumn, base: Prisma.RefillCycleWhereInput, today = todayOnly()): Prisma.RefillCycleWhereInput {
  if (column === 'closed') {
    return {
      AND: [
        base,
        { status: { in: ['delivered', 'not_picked_up'] } },
        { closedAt: { gte: subtractDays(today, 7) } },
      ],
    };
  }
  return { AND: [base, { status: column }] };
}

export function isBoardColumn(value: string): value is BoardColumn {
  return (boardColumns as readonly string[]).includes(value);
}

export async function boardData(
  tenant: Tenant,
  filters: BoardFilters,
  perColumn = 30,
) {
  return withTenant(tenant.organizationId, async (tx) => {
    const settings = await settingsFor(tx, tenant.organizationId);
    const today = todayOnly();
    const context = derivedContext(settings, today);
    const base = await baseWhere(tx, tenant, filters, context);
    const columns = await Promise.all(boardColumns.map(async (column) => {
      const where = columnWhere(column, base, today);
      const [count, dueToday, overdue, dueSoon, rows] = await Promise.all([
        tx.refillCycle.count({ where }),
        tx.refillCycle.count({ where: { AND: [where, { expectedOn: { lte: today } }] } }),
        tx.refillCycle.count({ where: { AND: [where, { expectedOn: { lt: today } }] } }),
        tx.refillCycle.count({ where: { AND: [where, { expectedOn: { gte: today, lte: addDays(today, 3) } }] } }),
        tx.refillCycle.findMany({
          where,
          include: cardInclude,
          orderBy: cardOrderBy,
          take: perColumn,
        }),
      ]);
      return [column, {
        column,
        count,
        due_today_count: dueToday,
        overdue_count: overdue,
        due_soon_count: dueSoon,
        cards: await presentCycleCards(tx, rows, settings, today),
      }] as const;
    }));
    const closedCards = columns.reduce((total, [, column]) => total + (column.column === 'closed' ? column.count : 0), 0);
    return {
      generated_at: new Date().toISOString(),
      filters,
      columns: Object.fromEntries(columns.map(([key, value]) => [key, value])),
      totals: {
        open: columns.reduce((total, [key, column]) => total + (key === 'closed' ? 0 : column.count), 0),
        closed: closedCards,
      },
    };
  });
}

export async function columnData(
  tenant: Tenant,
  column: BoardColumn,
  query: BoardListFilters,
) {
  return withTenant(tenant.organizationId, async (tx) => {
    const settings = await settingsFor(tx, tenant.organizationId);
    const today = todayOnly();
    const context = derivedContext(settings, today);
    const base = await baseWhere(tx, tenant, query, context);
    const where = columnWhere(column, base, today);
    const rows = await tx.refillCycle.findMany({
      where,
      include: cardInclude,
      orderBy: cardOrderBy,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { organizationId_id: { organizationId: tenant.organizationId, id: query.cursor } }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const data = await presentCycleCards(tx, page, settings, today);
    return {
      status: column,
      data,
      next_cursor: hasMore ? data.at(-1)!.cycle_id : null,
    };
  });
}

const dayRange = (from?: string, to?: string) => ({
  ...(from ? { gte: dateOnly(from) } : {}),
  ...(to ? { lte: new Date(dateOnly(to).getTime() + 86_399_999) } : {}),
});

/** Table-only filters. Association sets combine with `match`; dates always narrow (AND). */
function tableExtraWhere(query: z.infer<typeof cycleListQuery>): Prisma.RefillCycleWhereInput[] {
  const and: Prisma.RefillCycleWhereInput[] = [];
  if (query.created_from || query.created_to) and.push({ createdAt: dayRange(query.created_from, query.created_to) });
  if (query.activity_from || query.activity_to) {
    // "some activity in the range": the cycle was touched between the two dates.
    and.push({ activities: { some: { occurredAt: dayRange(query.activity_from, query.activity_to) } } });
  }
  if (query.coverage_from || query.coverage_to) and.push({ treatment: { is: { coverageEndOn: dayRange(query.coverage_from, query.coverage_to) } } });
  const sets: Prisma.RefillCycleWhereInput[] = [];
  if (query.patient_ids) sets.push({ treatment: { is: { patientId: { in: query.patient_ids } } } });
  if (query.medication_ids) sets.push({ treatment: { is: { medicationId: { in: query.medication_ids } } } });
  if (query.branch_ids) sets.push({ branchId: { in: query.branch_ids } });
  if (query.responsible_ids) sets.push({ treatment: { is: { responsibleUserId: { in: query.responsible_ids } } } });
  if (query.treatment_ids) sets.push({ treatmentId: { in: query.treatment_ids } });
  if (sets.length) and.push(query.match === 'or' ? { OR: sets } : { AND: sets });
  return and;
}

const sortMap: Record<string, (dir: 'asc' | 'desc') => Prisma.RefillCycleOrderByWithRelationInput> = {
  expected_on: (dir) => ({ expectedOn: dir }),
  created_at: (dir) => ({ createdAt: dir }),
  coverage_end_on: (dir) => ({ treatment: { coverageEndOn: dir } }),
  // shortcut: the derived status follows days to coverage end, so it sorts by that date. Upgrade if derived statuses stop being date-driven.
  derived_status: (dir) => ({ treatment: { coverageEndOn: dir } }),
  status: (dir) => ({ status: dir }),
  patient: (dir) => ({ treatment: { patient: { fullName: dir } } }),
  medication: (dir) => ({ treatment: { medication: { genericName: dir } } }),
};

function tableOrder(sort?: string[]): Prisma.RefillCycleOrderByWithRelationInput[] {
  if (!sort?.length) return tableOrderBy;
  return [...sort.map((part) => {
    const [field, dir] = part.split(':') as [string, 'asc' | 'desc'];
    return sortMap[field]!(dir);
  }), { id: 'asc' }];
}

/**
 * Cycles in one stage. A cycle is in a stage when it points at it from the stage's column, or when it is the
 * column's first stage and the cycle points at nothing (or at a stage of another column).
 */
async function stageWhere(tx: Tx, stageId: string): Promise<Prisma.RefillCycleWhereInput> {
  const stage = await tx.pipelineStage.findFirst({ where: { id: stageId } });
  if (!stage) throw new ApiError(400, 'UNKNOWN_STAGE', 'Etapa desconocida');
  const siblings = await tx.pipelineStage.findMany({ where: { pipelineId: stage.pipelineId, systemStatus: stage.systemStatus }, orderBy: { position: 'asc' }, select: { id: true } });
  const statuses = stage.systemStatus === 'closed' ? ['delivered', 'not_picked_up'] : [stage.systemStatus];
  const inColumn = { status: { in: statuses as ('delivered' | 'not_picked_up')[] } };
  if (siblings[0]?.id !== stage.id) return { AND: [inColumn, { stageId: stage.id }] };
  return { AND: [inColumn, { OR: [{ stageId: null }, { stageId: stage.id }, { stageId: { notIn: siblings.map((item) => item.id) } }] }] };
}

export async function tableData(tenant: Tenant, query: z.infer<typeof cycleListQuery>) {
  return withTenant(tenant.organizationId, async (tx) => {
    const settings = await settingsFor(tx, tenant.organizationId);
    const today = todayOnly();
    const context = derivedContext(settings, today);
    const custom = await customFilter(tx, 'treatment', query.cp_key, query.cp_value);
    const stage = query.stage_id ? [await stageWhere(tx, query.stage_id)] : [];
    const base = { AND: [await baseWhere(tx, tenant, query, context), ...tableExtraWhere(query), ...stage, ...(custom ? [{ treatment: { is: { customValues: custom as Prisma.JsonFilter<'Treatment'> } } }] : [])] };
    /**
     * Without an explicit status the table mirrors the board exactly: the four
     * open columns plus the pickup outcomes closed during the last 7 days.
     */
    const where: Prisma.RefillCycleWhereInput = query.status
      ? { AND: [base, { status: query.status }] }
      : {
        AND: [
          base,
          {
            OR: [
              { status: { in: ['to_notify', 'notified', 'confirmed', 'prepared'] } },
              {
                status: { in: ['delivered', 'not_picked_up'] },
                closedAt: { gte: subtractDays(today, 7) },
              },
            ],
          },
        ],
      };
    const rows = await tx.refillCycle.findMany({
      where,
      include: cardInclude,
      orderBy: tableOrder(query.sort),
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { organizationId_id: { organizationId: tenant.organizationId, id: query.cursor } }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const data = await presentCycleCards(tx, page, settings, today);
    return {
      status: query.status ?? null,
      data,
      next_cursor: hasMore ? data.at(-1)!.cycle_id : null,
    };
  });
}
