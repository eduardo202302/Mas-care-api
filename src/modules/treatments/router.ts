import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  addDays,
  calculateCoverageEndOn,
  deriveCoverage,
  isPrescriptionExpired,
  subtractDays,
  toDateOnly,
  unitsPerDay,
  type CoverageCycle,
} from '../../domain/coverage.js';
import { equivalentIntakesPerDay, materializeOccurrences } from '../../domain/doseSchedule.js';
import { localDateString } from '../../domain/localDate.js';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { canAccessBranch, findAccessiblePatient } from '../../infra/patient-access.js';
import {
  authorizationDocumentAbsolutePath,
  authorizationDocumentRelativePath,
  authorizationDocumentUpload,
  prescriptionDocumentAbsolutePath,
  prescriptionDocumentRelativePath,
  prescriptionDocumentUpload,
} from '../../infra/fileStorage.js';
import { DEFAULT_ROWS } from '../../infra/pagination.js';
import { withTenant } from '../../infra/prisma.js';
import { findOrCreateSetting } from '../../infra/settings.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import { fireEvent } from '../automation/engine.js';
import { resolveCustomValues } from '../custom-properties/service.js';
import { actualRatePerDay, currentBalance, daysRemainingReal, daysUntilExhausted, isBelowThreshold, projectDosesByDay, realBalance } from '../../domain/inventory.js';
import {
  defaultNoticeBody,
  normalizePhone,
  renderNoticeTemplate,
  waMeUrl,
} from '../../domain/notice.js';
import {
  deliveryInput,
  noticeLoggedInput,
  noticePreviewQuery,
} from '../../schemas/delivery.js';
import {
  doseCorrectInput,
  doseLogParams,
  doseRescheduleInput,
  doseScheduleCreateInput,
  doseScheduleParams,
  doseSkipInput,
  doseTakeInput,
} from '../../schemas/dose.js';
import { externalPurchaseInput } from '../../schemas/external-purchase.js';
import { inventoryAdjustInput, inventoryEntriesQuery, inventoryThresholdInput } from '../../schemas/inventory.js';
import {
  coverageAdjustInput,
  prescriptionRenewInput,
  statusReasonInput,
  treatmentCreate,
  treatmentListQuery,
  treatmentParams,
  treatmentPatch,
} from '../../schemas/treatment.js';

export const treatmentsRouter = Router();
treatmentsRouter.use(resolveTenant);

type Tx = Prisma.TransactionClient;
type SettingsRow = Awaited<ReturnType<typeof settingFor>>;
type OpenCycle = Prisma.RefillCycleGetPayload<{ include: { _count: { select: { deliveries: true } } } }>;

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);
const nonEmpty = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

function settingFor(tx: Tx, organizationId: string) {
  return findOrCreateSetting(tx, organizationId);
}

async function branchScope(tx: Tx, tenant: NonNullable<Express.Request['tenant']>): Promise<Prisma.TreatmentWhereInput> {
  if (tenant.role === 'owner' || tenant.role === 'admin') return {};
  const memberships = await tx.branchMember.findMany({
    where: { organizationId: tenant.organizationId, userId: tenant.userId },
    select: { branchId: true },
  });
  return { branchId: { in: memberships.map(({ branchId }) => branchId) } };
}

async function findTreatment(
  tx: Tx,
  tenant: NonNullable<Express.Request['tenant']>,
  id: string,
  extra: Prisma.TreatmentWhereInput = {},
) {
  return tx.treatment.findFirst({
    where: { AND: [{ id, ...await branchScope(tx, tenant) }, extra] },
  });
}

async function openCycleFor(tx: Tx, treatmentId: string): Promise<OpenCycle | null> {
  return tx.refillCycle.findFirst({
    where: { treatmentId, closedAt: null },
    include: { _count: { select: { deliveries: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

function coverageCycle(cycle: OpenCycle | null): CoverageCycle {
  return cycle ? { status: cycle.status, hasDelivery: cycle._count.deliveries > 0 } : null;
}

function present(
  treatment: Prisma.TreatmentGetPayload<object>,
  cycle: OpenCycle | null,
  settings: SettingsRow,
  today = new Date(),
  inventory?: {
    balance: number | null;
    /** Saldo del libro menos lo ya consumido sin registrar. */
    balanceReal?: number | null;
    nextDoseAt: Date | null;
    ratePerDay: number | null;
    /** Días hasta agotar el saldo según la proyección; manda sobre ratePerDay. */
    daysRemainingReal?: number | null;
  },
) {
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
      lastDeliveryOn: treatment.lastDeliveryOn,
    },
    coverageCycle(cycle),
    today,
    {
      dueSoonDays: settings.dueSoonDays,
      upcomingDays: settings.upcomingDays,
      prescriptionWarningDays: settings.prescriptionWarningDays,
    },
  );
  const balance = inventory?.balance ?? null;
  const ratePerDay = inventory?.ratePerDay ?? null;
  return {
    ...treatment,
    derived_status: coverage.status,
    days_remaining: coverage.daysRemaining,
    prescription_flag: coverage.prescriptionFlag,
    inventory_balance: balance,
    inventory_balance_real: inventory?.balanceReal ?? balance,
    next_dose_at: inventory?.nextDoseAt ?? null,
    // Días que el saldo real alcanza al ritmo del horario de dosis vigente -
    // no confundir con days_remaining (cobertura/Pauta), que sigue dirigiendo
    // el aviso de reposición.
    days_remaining_real: inventory?.daysRemainingReal
      ?? (balance !== null && ratePerDay !== null ? daysRemainingReal(balance, ratePerDay) : null),
  };
}

async function presentOne(tx: Tx, treatment: Prisma.TreatmentGetPayload<object>): Promise<ReturnType<typeof present>> {
  const settings = await settingFor(tx, treatment.organizationId);
  return present(treatment, await openCycleFor(tx, treatment.id), settings);
}

async function assertResponsibleMember(tx: Tx, organizationId: string, userId?: string | null) {
  if (!userId) return;
  const member = await tx.member.findFirst({ where: { organizationId, userId }, select: { id: true } });
  if (!member) throw new ApiError(400, 'INVALID_RESPONSIBLE_USER', 'Responsible user must belong to this organization');
}

async function assertMedication(tx: Tx, medicationId: string) {
  const medication = await tx.medication.findFirst({ where: { id: medicationId, archivedAt: null }, select: { id: true } });
  if (!medication) throw new ApiError(400, 'INVALID_MEDICATION', 'Medication not found');
}

async function assertBranch(tx: Tx, tenant: NonNullable<Express.Request['tenant']>, branchId: string) {
  if (!await canAccessBranch(tx, tenant, branchId)) throw new ApiError(404, 'NOT_FOUND', 'Branch not found');
}

/**
 * El prescriptor es un médico registrado: devuelve su id y el nombre completo
 * para guardarlo denormalizado (las lecturas antiguas siguen mostrando el
 * nombre). Un id que no existe en la organización se rechaza.
 */
async function resolvePrescriber(
  tx: Tx,
  organizationId: string,
  prescriberId: string | null | undefined,
): Promise<{ id: string | null; name: string | null }> {
  if (!prescriberId) return { id: null, name: null };
  const doctor = await tx.doctor.findFirst({
    where: { id: prescriberId, organizationId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!doctor) throw new ApiError(422, 'INVALID_PRESCRIBER', 'Prescriber doctor not found');
  return { id: doctor.id, name: `${doctor.firstName} ${doctor.lastName}`.trim() };
}

export type TreatmentChange = {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
};

const changeDate = (value: Date | null | undefined) =>
  value ? value.toISOString().slice(0, 10) : null;
const changeText = (value: unknown) =>
  value === null || value === undefined || String(value).trim() === '' ? null : String(value);

async function medicationLabelById(tx: Tx, id: string): Promise<string | null> {
  const medication = await tx.medication.findUnique({
    where: { id },
    select: { brandName: true, genericName: true, activeIngredient: true, presentation: true },
  });
  if (!medication) return null;
  return [
    medication.brandName ?? medication.genericName ?? medication.activeIngredient,
    medication.presentation,
  ].filter(Boolean).join(' ');
}

async function branchLabelById(tx: Tx, id: string): Promise<string | null> {
  const branch = await tx.branch.findUnique({ where: { id }, select: { name: true } });
  return branch?.name ?? null;
}

async function userLabelById(tx: Tx, id: string | null): Promise<string | null> {
  if (!id) return null;
  const user = await tx.user.findUnique({ where: { id }, select: { name: true } });
  return user?.name ?? null;
}

/**
 * Describe el PATCH en el historial. Sin esto la actividad quedaba como
 * «Tratamiento Actualizado» sin decir qué se tocó, y el usuario no podía
 * distinguir una edición de notas de un cambio de dosis.
 */
export async function treatmentChanges(
  tx: Tx,
  before: Prisma.TreatmentGetPayload<object>,
  after: Prisma.TreatmentGetPayload<object>,
): Promise<TreatmentChange[]> {
  const changes: TreatmentChange[] = [];
  const push = (field: string, label: string, from: string | null, to: string | null) => {
    if ((from ?? '') !== (to ?? '')) changes.push({ field, label, from, to });
  };

  if (before.medicationId !== after.medicationId) {
    push(
      'medication_id',
      'Medicamento',
      await medicationLabelById(tx, before.medicationId),
      await medicationLabelById(tx, after.medicationId),
    );
  }
  if (before.branchId !== after.branchId) {
    push('branch_id', 'Sucursal', await branchLabelById(tx, before.branchId), await branchLabelById(tx, after.branchId));
  }
  if (before.responsibleUserId !== after.responsibleUserId) {
    push(
      'responsible_user_id',
      'Responsable',
      await userLabelById(tx, before.responsibleUserId),
      await userLabelById(tx, after.responsibleUserId),
    );
  }
  push('name', 'Nombre', changeText(before.name), changeText(after.name));
  push(
    'prescriber',
    'Prescriptor',
    changeText(before.prescriberName),
    changeText(after.prescriberName),
  );
  push('dose_per_intake', 'Dosis por toma', String(before.dosePerIntake), String(after.dosePerIntake));
  push('intakes_per_day', 'Tomas por día', String(before.intakesPerDay), String(after.intakesPerDay));
  push('quantity_per_cycle', 'Cantidad por ciclo', String(before.quantityPerCycle), String(after.quantityPerCycle));
  push('start_date', 'Fecha de inicio', changeDate(before.startDate), changeDate(after.startDate));
  push('end_date', 'Fecha de fin', changeDate(before.endDate), changeDate(after.endDate));
  push(
    'prescription_expires_on',
    'Vencimiento de receta',
    changeDate(before.prescriptionExpiresOn),
    changeDate(after.prescriptionExpiresOn),
  );
  if (changeText(before.notes) !== changeText(after.notes)) {
    changes.push({ field: 'notes', label: 'Notas', from: null, to: null });
  }
  if (JSON.stringify(before.customValues) !== JSON.stringify(after.customValues)) {
    changes.push({ field: 'custom_values', label: 'Propiedades personalizadas', from: null, to: null });
  }
  return changes;
}

const WEEKDAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * Describe un horario de dosis en palabras para el historial («Cada 8 horas»,
 * «Lunes y Miércoles a las 08:00»). Sin esto toda modificación decía solo
 * «Dosis del tratamiento actualizada» y no se sabía qué había cambiado.
 */
export function describeDoseSchedule(schedule: {
  frequencyType: 'daily' | 'interval' | 'weekly' | 'monthly' | string;
  times: string[];
  intervalHours: number | null;
  weekdays: number[];
  monthdays?: number[];
  dosePerIntake?: Prisma.Decimal | string | number;
}): string {
  const dose = schedule.dosePerIntake !== undefined ? String(schedule.dosePerIntake) : null;
  const prefix = dose ? `${dose} · ` : '';
  if (schedule.frequencyType === 'interval') {
    const hours = schedule.intervalHours ?? 0;
    if (hours > 0 && hours % 24 === 0) {
      const days = hours / 24;
      return days === 1 ? `${prefix}Cada día` : `${prefix}Cada ${days} días`;
    }
    return hours === 1 ? `${prefix}Cada hora` : `${prefix}Cada ${hours} horas`;
  }
  if (schedule.frequencyType === 'weekly') {
    const days = [...schedule.weekdays]
      .sort((a, b) => a - b)
      .map((day) => WEEKDAY_NAMES[day] ?? String(day))
      .join(', ');
    const times = schedule.times.length ? ` a las ${schedule.times.join(', ')}` : '';
    return `${prefix}${days || 'Días específicos'}${times}`;
  }
  if (schedule.frequencyType === 'monthly') {
    const days = [...(schedule.monthdays ?? [])].sort((a, b) => a - b).join(', ');
    const times = schedule.times.length ? ` a las ${schedule.times.join(', ')}` : '';
    return `${prefix}Días ${days || 'específicos'} de cada mes${times}`;
  }
  if (!schedule.times.length) return `${prefix}Diario`;
  return `${prefix}Diario a las ${schedule.times.join(', ')}`;
}

/** Resumen corto y legible para el `body` de la actividad. */
export function summarizeChanges(changes: TreatmentChange[]): string {
  if (!changes.length) return 'Sin cambios en los datos';
  const detail = (change: TreatmentChange) =>
    change.from === null && change.to === null
      ? change.label
      : `${change.label} ${change.from ?? '—'} → ${change.to ?? '—'}`;
  const shown = changes.slice(0, 3).map(detail).join(' · ');
  return changes.length > 3 ? `${shown} · y ${changes.length - 3} más` : shown;
}

function assertDateRange(startDate: Date, endDate: Date | null) {
  if (endDate && endDate.getTime() < startDate.getTime()) {
    throw new ApiError(400, 'INVALID_DATE_RANGE', 'end_date must not be before start_date');
  }
}

treatmentsRouter.get('/', validateQuery(treatmentListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const query = res.locals.validatedQuery as z.infer<typeof treatmentListQuery>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    // Con `page`/`rows` la lista es una tabla paginada (sucursal primero); sin ellos
    // se conserva el comportamiento anterior de cursor para el resto de pantallas.
    const paged = query.page !== undefined || query.rows !== undefined;
    const pageRows = query.rows ?? DEFAULT_ROWS;
    const pageNumber = query.page ?? 1;
    const contains = query.q ? { contains: query.q, mode: 'insensitive' as const } : null;
    const where: Prisma.TreatmentWhereInput = {
      AND: [
        {
          ...(query.patient_id ? { patientId: query.patient_id } : {}),
          ...(query.branch_id ? { branchId: query.branch_id } : {}),
          ...(query.responsible_user_id ? { responsibleUserId: query.responsible_user_id } : {}),
          ...(query.prescription_group_id ? { prescriptionGroupId: query.prescription_group_id } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(contains
            ? {
              OR: [
                { name: contains },
                { patient: { fullName: contains } },
                { medication: { OR: [{ brandName: contains }, { genericName: contains }, { activeIngredient: contains }] } },
              ],
            }
            : {}),
        },
        await branchScope(tx, tenant),
      ],
    };
    // El filtro por estado derivado se calcula después de presentar cada fila, así
    // que en ese caso se pagina en memoria en vez de en la base de datos.
    const pageInDb = paged && !query.derived_status;
    const dbTotal = pageInDb ? await tx.treatment.count({ where }) : 0;
    const rows = await tx.treatment.findMany({
      where,
      orderBy: paged
        ? [{ branchId: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(pageInDb ? { skip: (pageNumber - 1) * pageRows, take: pageRows } : {}),
      include: {
        patient: { select: { fullName: true } },
        medication: { select: { brandName: true, genericName: true, activeIngredient: true, presentation: true, doseUnit: true } },
      },
    });
    const settings = await settingFor(tx, tenant.organizationId);
    const cycles = rows.length
      ? await tx.refillCycle.findMany({
        where: { treatmentId: { in: rows.map(({ id }) => id) }, closedAt: null },
        include: { _count: { select: { deliveries: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
      : [];
    const cycleByTreatment = new Map<string, OpenCycle>();
    for (const cycle of cycles) {
      if (!cycleByTreatment.has(cycle.treatmentId)) cycleByTreatment.set(cycle.treatmentId, cycle);
    }
    // Batched queries for the whole page, never one per row: a raw balance (ledger sum), the
    // earliest still-scheduled dose, and the active dose schedule (for the real days-remaining
    // next to that balance) - the full actual-rate projection (from taken doses) stays on the
    // treatment detail page's own /inventory endpoint.
    const treatmentIds = rows.map(({ id }) => id);
    const [balances, nextDoses, allSchedules, takenDoses] = treatmentIds.length
      ? await Promise.all([
        tx.inventoryEntry.groupBy({ by: ['treatmentId'], where: { treatmentId: { in: treatmentIds } }, _sum: { quantityDelta: true } }),
        tx.doseLog.findMany({
          where: { treatmentId: { in: treatmentIds }, status: 'scheduled', scheduledFor: { gte: new Date() } },
          select: { treatmentId: true, scheduledFor: true },
          orderBy: { scheduledFor: 'asc' },
        }),
        // Todas las versiones, no solo la vigente: una reposición futura ya
        // programada con otro ritmo también consume saldo.
        tx.doseSchedule.findMany({
          where: { treatmentId: { in: treatmentIds } },
          select: { treatmentId: true, id: true, dosePerIntake: true, times: true, frequencyType: true, intervalHours: true, anchorAt: true, weekdays: true, monthdays: true, effectiveFrom: true, effectiveTo: true },
          orderBy: [{ treatmentId: 'asc' }, { effectiveFrom: 'asc' }],
        }),
        tx.doseLog.findMany({
          where: { treatmentId: { in: treatmentIds }, status: 'taken' },
          select: { treatmentId: true, scheduledFor: true },
        }),
      ])
      : [[], [], [], []];
    // Última compra con hora: la entrega de la farmacia o la compra externa más reciente
    // que no fue revertida (el libro de inventario guarda el instante exacto).
    const purchaseEntries = treatmentIds.length
      ? await tx.inventoryEntry.findMany({
        where: {
          treatmentId: { in: treatmentIds },
          type: { in: ['pharmacy_delivery', 'external_purchase'] },
          reversalEntries: { none: {} },
        },
        select: { treatmentId: true, createdAt: true },
        orderBy: [{ treatmentId: 'asc' }, { createdAt: 'desc' }],
        distinct: ['treatmentId'],
      })
      : [];
    const lastPurchaseByTreatment = new Map(purchaseEntries.map((entry) => [entry.treatmentId, entry.createdAt]));
    const balanceByTreatment = new Map(balances.map((row) => [row.treatmentId, row._sum.quantityDelta ? Number(row._sum.quantityDelta.toString()) : 0]));
    const nextDoseByTreatment = new Map<string, Date>();
    for (const dose of nextDoses) {
      if (!nextDoseByTreatment.has(dose.treatmentId)) nextDoseByTreatment.set(dose.treatmentId, dose.scheduledFor);
    }
    // La versión vigente (sin effectiveTo) sigue mandando para el ritmo mostrado.
    const scheduleByTreatment = new Map(
      allSchedules.filter((schedule) => schedule.effectiveTo === null).map((schedule) => [schedule.treatmentId, schedule]),
    );
    const schedulesByTreatment = new Map<string, typeof allSchedules>();
    for (const schedule of allSchedules) {
      const list = schedulesByTreatment.get(schedule.treatmentId) ?? [];
      list.push(schedule);
      schedulesByTreatment.set(schedule.treatmentId, list);
    }
    const takenByTreatment = new Map<string, Set<number>>();
    for (const dose of takenDoses) {
      const set = takenByTreatment.get(dose.treatmentId) ?? new Set<number>();
      set.add(dose.scheduledFor.getTime());
      takenByTreatment.set(dose.treatmentId, set);
    }
    const listTodayLocal = new Date(`${localDateString(new Date(), settings.timezone)}T00:00:00.000Z`);
    const listHorizon = new Date(listTodayLocal.getTime() + 120 * 86400000);
    const listNow = new Date();
    const presented = rows.map((row) => {
      const schedule = scheduleByTreatment.get(row.id);
      const ratePerDay = schedule
        ? unitsPerDay(schedule.dosePerIntake.toString(), equivalentIntakesPerDay(schedule).toString())
        : unitsPerDay(row.dosePerIntake.toString(), row.intakesPerDay.toString());
      const balance = balanceByTreatment.get(row.id) ?? null;
      // Mismo cálculo que el panel de inventario, para que la tarjeta del
      // listado y la ficha nunca digan días distintos.
      let daysRemainingReal: number | null = null;
      let balanceReal: number | null = balance;
      const versions = schedulesByTreatment.get(row.id);
      if (balance !== null && versions?.length) {
        // Igual que el panel: se cuenta desde la última entrega para poder
        // descontar las tomas que ya pasaron sin registrarse.
        const historyFrom = new Date(
          `${localDateString(row.lastDeliveryOn ?? row.startDate, settings.timezone)}T00:00:00.000Z`,
        );
        const occurrences = materializeOccurrences(
          versions.map((version) => ({
            id: version.id,
            dosePerIntake: version.dosePerIntake.toString(),
            times: version.times,
            frequencyType: version.frequencyType,
            intervalHours: version.intervalHours,
            anchorAt: version.anchorAt,
            weekdays: version.weekdays,
            monthdays: version.monthdays,
            effectiveFrom: version.effectiveFrom,
            effectiveTo: version.effectiveTo,
          })),
          historyFrom,
          listHorizon,
          settings.timezone,
        );
        const taken = takenByTreatment.get(row.id);
        let consumedUnlogged = 0;
        const perDay = new Map<string, number>();
        for (const occurrence of occurrences) {
          if (taken?.has(occurrence.scheduledFor.getTime())) continue;
          if (occurrence.scheduledFor < listNow) {
            consumedUnlogged += occurrence.nominalQuantity;
            continue;
          }
          const key = localDateString(occurrence.scheduledFor, settings.timezone);
          perDay.set(key, (perDay.get(key) ?? 0) + occurrence.nominalQuantity);
        }
        balanceReal = realBalance(balance, consumedUnlogged);
        const projection = projectDosesByDay(balanceReal, [...perDay].map(([date, units]) => ({ date, units })));
        daysRemainingReal = daysUntilExhausted(balanceReal, projection, listTodayLocal, ratePerDay).days;
      }
      const { patient, ...treatmentRow } = row;
      return {
        ...present(treatmentRow, cycleByTreatment.get(row.id) ?? null, settings, new Date(), {
          balance,
          balanceReal,
          nextDoseAt: nextDoseByTreatment.get(row.id) ?? null,
          ratePerDay,
          daysRemainingReal,
        }),
        patient_name: patient.fullName,
        last_purchase_at: lastPurchaseByTreatment.get(row.id)?.toISOString() ?? null,
        active_schedule: schedule
          ? {
            frequencyType: schedule.frequencyType,
            times: schedule.times,
            intervalHours: schedule.intervalHours,
            anchorAt: schedule.anchorAt,
            weekdays: schedule.weekdays,
            monthdays: schedule.monthdays,
            dosePerIntake: schedule.dosePerIntake.toString(),
          }
          : null,
      };
    });
    const filtered = query.derived_status
      ? presented.filter((row) => row.derived_status === query.derived_status)
      : presented;
    if (paged) {
      const data = pageInDb ? filtered : filtered.slice((pageNumber - 1) * pageRows, pageNumber * pageRows);
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.list' });
      return { data, total: pageInDb ? dbTotal : filtered.length, page: pageNumber, rows: pageRows, nextCursor: null };
    }
    const cursorIndex = query.cursor ? filtered.findIndex((row) => row.id === query.cursor) : -1;
    const start = query.cursor ? (cursorIndex >= 0 ? cursorIndex + 1 : filtered.length) : 0;
    const data = filtered.slice(start, start + query.limit);
    const hasMore = start + query.limit < filtered.length;
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.list' });
    return { data, nextCursor: hasMore ? data.at(-1)!.id : null };
  });
  res.json(result);
});

/** Creates a treatment with its first refill cycle, activity, audit and automation event. Shared by the API and the CSV import. */
export async function createTreatment(tx: Tx, tenant: NonNullable<Express.Request['tenant']>, input: z.infer<typeof treatmentCreate>) {
    if (!await findAccessiblePatient(tx, tenant, input.patient_id, { archivedAt: null })) {
      throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    }
    await assertBranch(tx, tenant, input.branch_id);
    await assertMedication(tx, input.medication_id);
    await assertResponsibleMember(tx, tenant.organizationId, input.responsible_user_id);
    const startDate = dateOnly(input.start_date);
    const endDate = input.end_date ? dateOnly(input.end_date) : null;
    assertDateRange(startDate, endDate);
    const settings = await settingFor(tx, tenant.organizationId);
    const coverageEndOn = calculateCoverageEndOn({
      startDate,
      quantityPerCycle: input.quantity_per_cycle,
      dosePerIntake: input.dose_per_intake,
      intakesPerDay: input.intakes_per_day,
    });
    const customValues = await resolveCustomValues(tx, 'treatment', input.custom_values, {}, 'create');
    const prescriber = await resolvePrescriber(tx, tenant.organizationId, input.prescriber_id);
    const treatment = await tx.treatment.create({
      data: {
        ...(customValues ? { customValues } : {}),
        organizationId: tenant.organizationId,
        patientId: input.patient_id,
        medicationId: input.medication_id,
        branchId: input.branch_id,
        name: input.name ?? null,
        prescriptionGroupId: input.prescription_group_id ?? null,
        responsibleUserId: input.responsible_user_id ?? null,
        dosePerIntake: input.dose_per_intake,
        intakesPerDay: input.intakes_per_day,
        quantityPerCycle: input.quantity_per_cycle,
        startDate,
        endDate,
        prescriberDoctorId: prescriber.id,
        prescriberName: prescriber.name ?? input.prescriber_name ?? null,
        prescriptionExpiresOn: input.prescription_expires_on ? dateOnly(input.prescription_expires_on) : null,
        status: 'active',
        statusChangedAt: new Date(),
        coverageEndOn,
        coverageManuallyAdjusted: false,
        notes: input.notes ?? null,
      } as Prisma.TreatmentUncheckedCreateInput,
    });
    const cycle = await tx.refillCycle.create({
      data: {
        organizationId: tenant.organizationId,
        treatmentId: treatment.id,
        branchId: input.branch_id,
        status: 'to_notify',
        expectedOn: coverageEndOn,
        expectedQuantity: input.quantity_per_cycle,
        suggestedNoticeOn: subtractDays(coverageEndOn, settings.noticeLeadDays),
      } as Prisma.RefillCycleUncheckedCreateInput,
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: treatment.patientId,
        treatmentId: treatment.id,
        cycleId: cycle.id,
        type: 'treatment_created',
        body: '',
        metadata: { coverage_end_on: coverageEndOn.toISOString().slice(0, 10) },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.create', subjectId: treatment.id });
    await fireEvent(tx, tenant.organizationId, 'treatment_created', { patientId: treatment.patientId, treatmentId: treatment.id, cycleId: cycle.id });
    return { treatment, cycle, settings };
}

treatmentsRouter.post('/', validateBody(treatmentCreate), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const input = req.body as z.infer<typeof treatmentCreate>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const { treatment, cycle, settings } = await createTreatment(tx, tenant, input);
    return present(treatment, { ...cycle, _count: { deliveries: 0 } }, settings);
  });
  res.status(201).json(result);
});

treatmentsRouter.get('/:id', validateParams(treatmentParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const settings = await settingFor(tx, tenant.organizationId);
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.read', subjectId: id });
    return present(treatment, await openCycleFor(tx, id), settings);
  });
  res.json(result);
});

treatmentsRouter.patch('/:id', validateParams(treatmentParams), validateBody(treatmentPatch), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const input = req.body as z.infer<typeof treatmentPatch>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findTreatment(tx, tenant, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (input.patient_id && !await findAccessiblePatient(tx, tenant, input.patient_id, { archivedAt: null })) {
      throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    }
    if (input.branch_id) await assertBranch(tx, tenant, input.branch_id);
    if (input.medication_id) await assertMedication(tx, input.medication_id);
    if (input.responsible_user_id !== undefined) {
      await assertResponsibleMember(tx, tenant.organizationId, input.responsible_user_id);
    }
    const startDate = input.start_date ? dateOnly(input.start_date) : existing.startDate;
    const endDate = input.end_date === undefined
      ? existing.endDate
      : input.end_date === null ? null : dateOnly(input.end_date);
    assertDateRange(startDate, endDate);
    const patchedValues = await resolveCustomValues(tx, 'treatment', input.custom_values, existing.customValues, 'patch');
    // prescriber_id manda: al elegir médico se guarda su nombre; al vaciarlo se
    // limpia también el nombre para no dejar un prescriptor fantasma.
    const prescriber = input.prescriber_id === undefined
      ? undefined
      : await resolvePrescriber(tx, tenant.organizationId, input.prescriber_id);
    const data: Prisma.TreatmentUncheckedUpdateInput = {
      ...nonEmpty({
        patientId: input.patient_id,
        medicationId: input.medication_id,
        branchId: input.branch_id,
        name: input.name,
        responsibleUserId: input.responsible_user_id,
        dosePerIntake: input.dose_per_intake,
        intakesPerDay: input.intakes_per_day,
        quantityPerCycle: input.quantity_per_cycle,
        startDate: input.start_date ? startDate : undefined,
        endDate: input.end_date === undefined ? undefined : endDate,
        prescriberName: prescriber ? prescriber.name : input.prescriber_name,
        prescriberDoctorId: prescriber ? prescriber.id : undefined,
        prescriptionExpiresOn: input.prescription_expires_on === undefined
          ? undefined
          : input.prescription_expires_on === null ? null : dateOnly(input.prescription_expires_on),
        notes: input.notes,
      }),
      ...(patchedValues ? { customValues: patchedValues } : {}),
    };
    const scheduleChanged = input.dose_per_intake !== undefined
      || input.intakes_per_day !== undefined
      || input.quantity_per_cycle !== undefined
      || input.start_date !== undefined;
    if (scheduleChanged && !existing.coverageManuallyAdjusted) {
      const lastDelivery = await tx.delivery.findFirst({
        where: { treatmentId: id },
        orderBy: [{ deliveredOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      });
      const coverageEndOn = calculateCoverageEndOn({
        startDate,
        quantityPerCycle: input.quantity_per_cycle ?? existing.quantityPerCycle.toString(),
        dosePerIntake: input.dose_per_intake ?? existing.dosePerIntake.toString(),
        intakesPerDay: input.intakes_per_day ?? existing.intakesPerDay.toString(),
        lastDeliveryOn: lastDelivery?.deliveredOn ?? null,
        lastDeliveryQuantity: lastDelivery?.quantity.toString() ?? null,
      });
      data.coverageEndOn = coverageEndOn;
      await tx.refillCycle.updateMany({
        where: { treatmentId: id, closedAt: null, status: 'to_notify' },
        data: {
          expectedOn: coverageEndOn,
          suggestedNoticeOn: subtractDays(coverageEndOn, (await settingFor(tx, tenant.organizationId)).noticeLeadDays),
          version: { increment: 1 },
        },
      });
    }
    const updated = await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data,
    });
    if (input.branch_id) {
      await tx.refillCycle.updateMany({
        where: { treatmentId: id, closedAt: null },
        data: { branchId: input.branch_id, version: { increment: 1 } },
      });
    }
    const changes = await treatmentChanges(tx, existing, updated);
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: updated.patientId,
        treatmentId: updated.id,
        type: 'treatment_updated',
        body: summarizeChanges(changes),
        metadata: { fields: Object.keys(input), changes },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.update', subjectId: id });
    return presentOne(tx, updated);
  });
  res.json(result);
});

treatmentsRouter.post('/:id/pause', validateParams(treatmentParams), validateBody(statusReasonInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:manage');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const { reason } = req.body as z.infer<typeof statusReasonInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findTreatment(tx, tenant, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (existing.status !== 'active') throw new ApiError(409, 'INVALID_STATUS', 'Only active treatments can be paused');
    const updated = await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { status: 'paused', statusReason: reason, statusChangedAt: new Date() },
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: updated.patientId,
        treatmentId: updated.id,
        type: 'treatment_paused',
        body: reason,
        metadata: { reason },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.pause', subjectId: id });
    return presentOne(tx, updated);
  });
  res.json(result);
});

treatmentsRouter.post('/:id/finish', validateParams(treatmentParams), validateBody(statusReasonInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:manage');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const { reason } = req.body as z.infer<typeof statusReasonInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findTreatment(tx, tenant, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (existing.status === 'finished') throw new ApiError(409, 'INVALID_STATUS', 'Treatment is already finished');
    const updated = await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { status: 'finished', statusReason: reason, statusChangedAt: new Date() },
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: updated.patientId,
        treatmentId: updated.id,
        type: 'treatment_finished',
        body: reason,
        metadata: { reason },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.finish', subjectId: id });
    return presentOne(tx, updated);
  });
  res.json(result);
});

treatmentsRouter.post('/:id/resume', validateParams(treatmentParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:manage');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findTreatment(tx, tenant, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (existing.status !== 'paused') throw new ApiError(409, 'INVALID_STATUS', 'Only paused treatments can be resumed');
    const updated = await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { status: 'active', statusReason: null, statusChangedAt: new Date() },
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: updated.patientId,
        treatmentId: updated.id,
        type: 'treatment_resumed',
        body: '',
        metadata: {},
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.resume', subjectId: id });
    return presentOne(tx, updated);
  });
  res.json(result);
});

treatmentsRouter.post('/:id/adjust-coverage', validateParams(treatmentParams), validateBody(coverageAdjustInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:manage');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const { new_end_on, reason } = req.body as z.infer<typeof coverageAdjustInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findTreatment(tx, tenant, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (existing.status === 'finished') throw new ApiError(409, 'INVALID_STATUS', 'Finished treatments cannot be adjusted');
    const coverageEndOn = dateOnly(new_end_on);
    const updated = await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { coverageEndOn, coverageManuallyAdjusted: true, coverageAdjustReason: reason },
    });
    await tx.refillCycle.updateMany({
      where: { treatmentId: id, closedAt: null },
      data: { expectedOn: coverageEndOn, version: { increment: 1 } },
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: updated.patientId,
        treatmentId: updated.id,
        type: 'coverage_adjusted',
        body: reason,
        metadata: { new_end_on, reason },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.coverage_adjust', subjectId: id });
    return presentOne(tx, updated);
  });
  res.json(result);
});

treatmentsRouter.post('/:id/renew-prescription', validateParams(treatmentParams), validateBody(prescriptionRenewInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:manage');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const { new_expiry } = req.body as z.infer<typeof prescriptionRenewInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await findTreatment(tx, tenant, id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const updated = await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { prescriptionExpiresOn: dateOnly(new_expiry) },
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: updated.patientId,
        treatmentId: updated.id,
        type: 'prescription_renewed',
        body: '',
        metadata: { new_expiry },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.prescription_renew', subjectId: id });
    return presentOne(tx, updated);
  });
  res.json(result);
});

function deliveryIdempotencyKey(req: Request): string | null {
  const raw = req.header('idempotency-key')?.trim();
  if (!raw) return null;
  if (raw.length > 200) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be at most 200 characters');
  return raw;
}

async function replayDelivery(
  tx: Tx,
  tenant: NonNullable<Express.Request['tenant']>,
  treatment: Prisma.TreatmentGetPayload<object>,
  key: string,
  id: string,
) {
  const existing = await tx.delivery.findFirst({ where: { idempotencyKey: key } });
  if (!existing) return null;
  if (existing.treatmentId !== id) {
    throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for another treatment');
  }
  const settings = await settingFor(tx, tenant.organizationId);
  const nextCycle = await openCycleFor(tx, id);
  return {
    ...present(treatment, nextCycle, settings),
    delivery: existing,
    next_cycle: nextCycle,
    idempotent_replay: true,
  };
}

treatmentsRouter.post('/:id/deliver', validateParams(treatmentParams), validateBody(deliveryInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const input = req.body as z.infer<typeof deliveryInput>;
  const key = deliveryIdempotencyKey(req);
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (treatment.status !== 'active') throw new ApiError(409, 'INVALID_STATUS', 'Only active treatments can receive deliveries');
    if (key) {
      const replay = await replayDelivery(tx, tenant, treatment, key, id);
      if (replay) return replay;
    }
    // Un reintento idempotente devuelve la entrega ya registrada; una entrega
    // nueva con la receta vencida nunca se permite.
    await assertPrescriptionValid(tx, tenant.organizationId, treatment);
    const open = await tx.refillCycle.findFirst({
      where: { treatmentId: id, closedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!open) throw new ApiError(409, 'NO_OPEN_CYCLE', 'Treatment has no open refill cycle');
    const deliveredOn = dateOnly(input.delivered_on);
    const doseRate = await effectiveDoseRate(tx, id, treatment);
    const coverageEndOn = calculateCoverageEndOn({
      startDate: treatment.startDate,
      quantityPerCycle: treatment.quantityPerCycle.toString(),
      dosePerIntake: doseRate.dosePerIntake,
      intakesPerDay: doseRate.intakesPerDay,
      lastDeliveryOn: deliveredOn,
      lastDeliveryQuantity: input.quantity,
      coverageManuallyAdjusted: false,
    });
    const delivery = await tx.delivery.create({
      data: {
        organizationId: tenant.organizationId,
        treatmentId: id,
        cycleId: open.id,
        branchId: treatment.branchId,
        quantity: input.quantity,
        deliveredOn,
        deliveredBy: tenant.userId,
        pickedUpBy: input.picked_up_by,
        pickedUpByName: input.picked_up_by_name ?? null,
        notes: input.notes ?? null,
        idempotencyKey: key,
      } as Prisma.DeliveryUncheckedCreateInput,
    });
    // La entrega es la entrada de inventario: lo que se le entrega al paciente
    // pasa a sumar el saldo disponible, sin que haga falta registrarlo aparte
    // como compra externa o ajuste manual.
    await tx.inventoryEntry.create({
      data: {
        organizationId: tenant.organizationId,
        treatmentId: id,
        type: 'pharmacy_delivery',
        quantityDelta: input.quantity,
        deliveryId: delivery.id,
        recordedBy: tenant.userId,
      } as Prisma.InventoryEntryUncheckedCreateInput,
    });
    await tx.refillCycle.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id: open.id } },
      // Any cycle change bumps version so stale board clients get a 409.
      data: { status: 'delivered', closedAt: new Date(), version: { increment: 1 } },
    });
    const updated = await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: {
        lastDeliveryOn: deliveredOn,
        coverageEndOn,
        coverageManuallyAdjusted: false,
        coverageAdjustReason: null,
      },
    });
    const settings = await settingFor(tx, tenant.organizationId);
    // The treatment's own end date already falls on or before the next refill would be
    // due: nothing left to replenish, so no new cycle is opened (it would be a "Por
    // avisar" card for a reposición that will never happen).
    const treatmentEnds = updated.endDate !== null && updated.endDate.getTime() <= coverageEndOn.getTime();
    const nextCycle = treatmentEnds ? null : await tx.refillCycle.create({
      data: {
        organizationId: tenant.organizationId,
        treatmentId: id,
        branchId: treatment.branchId,
        status: 'to_notify',
        expectedOn: coverageEndOn,
        expectedQuantity: treatment.quantityPerCycle,
        suggestedNoticeOn: subtractDays(coverageEndOn, settings.noticeLeadDays),
      } as Prisma.RefillCycleUncheckedCreateInput,
    });
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: treatment.patientId,
        treatmentId: id,
        cycleId: open.id,
        type: 'delivery',
        body: '',
        metadata: {
          delivery_id: delivery.id,
          quantity: input.quantity,
          delivered_on: input.delivered_on,
          picked_up_by: input.picked_up_by,
          next_cycle_id: nextCycle?.id ?? null,
        },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.deliver', subjectId: id });
    await fireEvent(tx, tenant.organizationId, 'cycle_delivered', { patientId: treatment.patientId, treatmentId: id, cycleId: open.id });
    return {
      ...present(updated, nextCycle ? { ...nextCycle, _count: { deliveries: 0 } } : null, settings),
      delivery,
      next_cycle: nextCycle,
      idempotent_replay: false,
    };
  });
  res.status(result.idempotent_replay ? 200 : 201).json(result);
});

treatmentsRouter.get('/:id/notice-preview', validateParams(treatmentParams), validateQuery(noticePreviewQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const query = res.locals.validatedQuery as z.infer<typeof noticePreviewQuery>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const [patient, medication, branch, organization, cycle] = await Promise.all([
      tx.patient.findFirst({ where: { id: treatment.patientId } }),
      tx.medication.findFirst({ where: { id: treatment.medicationId } }),
      tx.branch.findFirst({ where: { id: treatment.branchId } }),
      tx.organization.findUnique({ where: { id: tenant.organizationId } }),
      openCycleFor(tx, id),
    ]);
    if (!patient || !medication) throw new ApiError(404, 'NOT_FOUND', 'Patient or medication not found');
    const channel = query.channel ?? (patient.preferredChannel === 'whatsapp' ? 'whatsapp' : 'call');
    const template = await tx.messageTemplate.findFirst({
      where: { channel, kind: 'refill_notice', isActive: true, branchId: treatment.branchId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    }) ?? await tx.messageTemplate.findFirst({
      where: { channel, kind: 'refill_notice', isActive: true, branchId: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    const noticeDate = cycle?.expectedOn ?? treatment.coverageEndOn ?? treatment.startDate;
    const medicationName = medication.brandName ?? medication.genericName ?? medication.activeIngredient ?? medication.presentation;
    const body = renderNoticeTemplate(template?.body ?? defaultNoticeBody(channel), {
      patient: patient.fullName,
      medication: medicationName,
      date: noticeDate.toISOString().slice(0, 10),
      pharmacy: branch?.name ?? organization?.name ?? '',
    });
    const phone = normalizePhone(patient.phone);
    return {
      treatment_id: id,
      channel,
      template_id: template?.id ?? null,
      template_name: template?.name ?? null,
      body,
      template_body: template?.body ?? null,
      notice_date: noticeDate.toISOString().slice(0, 10),
      phone,
      wa_me_url: waMeUrl(phone, body),
      tel_url: phone ? `tel:+${phone}` : null,
      patient_consent: {
        reminder_consent: patient.reminderConsent,
        preferred_channel: patient.preferredChannel,
      },
      consent_warning: patient.reminderConsent ? null : 'El paciente no tiene consentimiento registrado para recordatorios.',
    };
  });
  res.json(result);
});

treatmentsRouter.post('/:id/notice-logged', validateParams(treatmentParams), validateBody(noticeLoggedInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const { channel } = req.body as z.infer<typeof noticeLoggedInput>;
  const activity = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const openCycle = await tx.refillCycle.findFirst({
      where: { treatmentId: id, closedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const movedCycle = openCycle?.status === 'to_notify'
      ? await tx.refillCycle.update({
        where: { organizationId_id: { organizationId: tenant.organizationId, id: openCycle.id } },
        data: { status: 'notified', noticeAttempts: { increment: 1 }, version: { increment: 1 } },
      })
      : openCycle
        ? await tx.refillCycle.update({
          where: { organizationId_id: { organizationId: tenant.organizationId, id: openCycle.id } },
          data: { noticeAttempts: { increment: 1 }, version: { increment: 1 } },
        })
        : null;
    const created = await tx.activity.create({
      data: {
        organizationId: tenant.organizationId,
        patientId: treatment.patientId,
        treatmentId: id,
        ...(movedCycle ? { cycleId: movedCycle.id } : {}),
        type: channel === 'call' ? 'call' : 'notice',
        body: channel === 'call' ? 'Llamada de aviso abierta' : 'Aviso por WhatsApp abierto',
        metadata: { channel, logged: true, ...(movedCycle ? { cycle_status: movedCycle.status, notice_attempts: movedCycle.noticeAttempts } : {}) },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.notice_logged', subjectId: id });
    return created;
  });
  res.status(201).json(activity);
});

const pauseInput = z.object({ paused: z.boolean(), reason: z.string().trim().max(500).nullable().optional() }).strict();

/** Pauses or resumes automatic notices for one treatment. Pausing also cancels what was already waiting to go out. */
treatmentsRouter.patch('/:id/automation', validateParams(treatmentParams), validateBody(pauseInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const input = req.body as z.infer<typeof pauseInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    await tx.treatment.update({ where: { organizationId_id: { organizationId: tenant.organizationId, id } }, data: { automationPaused: input.paused } });
    const cancelled = input.paused
      ? (await tx.outboxMessage.updateMany({ where: { treatmentId: id, status: 'pending' }, data: { status: 'cancelled', cancelledAt: new Date(), lastError: 'automation_paused' } })).count
      : 0;
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId, patientId: treatment.patientId, treatmentId: id, type: 'treatment_updated',
        body: input.paused ? 'Avisos automáticos pausados' : 'Avisos automáticos reanudados',
        metadata: { automation_paused: input.paused, ...(input.paused && input.reason ? { reason: input.reason } : {}) }, authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: input.paused ? 'treatment.automation.pause' : 'treatment.automation.resume', subjectId: id, metadata: { cancelled } });
    return { id, automationPaused: input.paused, cancelled_messages: cancelled };
  });
  res.json(result);
});

// --- Dose tracking + inventory ledger ---
// Parallel to RefillCycle (which stays "when the pharmacy delivers the next
// batch"): this answers "how many units does the patient have left, and
// what did they actually take". The patient never has an account or role on
// this platform (see Patient model), so every write below is made by a User
// through this authenticated API - nothing here is reachable from the
// WhatsApp/Telegram inbound pipeline.

async function findDoseSchedule(tx: Tx, organizationId: string, treatmentId: string, doseScheduleId: string) {
  return tx.doseSchedule.findFirst({ where: { id: doseScheduleId, treatmentId, organizationId } });
}

async function activeDoseSchedule(tx: Tx, treatmentId: string) {
  return tx.doseSchedule.findFirst({ where: { treatmentId, effectiveTo: null }, orderBy: { effectiveFrom: 'desc' } });
}

/**
 * dose_per_intake / intakes_per_day efectivos para calcular coverage_end_on:
 * el horario de dosis real manda en cuanto existe uno (es lo que de verdad
 * se le da al paciente); la Pauta del tratamiento es solo el valor inicial
 * antes de definir un horario.
 */
export async function effectiveDoseRate(
  tx: Tx,
  treatmentId: string,
  fallback: { dosePerIntake: Prisma.Decimal | string; intakesPerDay: Prisma.Decimal | string },
): Promise<{ dosePerIntake: string; intakesPerDay: string }> {
  const schedule = await activeDoseSchedule(tx, treatmentId);
  return schedule
    ? { dosePerIntake: schedule.dosePerIntake.toString(), intakesPerDay: equivalentIntakesPerDay(schedule).toString() }
    : { dosePerIntake: fallback.dosePerIntake.toString(), intakesPerDay: fallback.intakesPerDay.toString() };
}

async function findDoseLog(tx: Tx, organizationId: string, treatmentId: string, doseLogId: string) {
  return tx.doseLog.findFirst({ where: { id: doseLogId, treatmentId, organizationId } });
}

/** "No retroactivo": a dose can only be logged for today (org-local) or later, never for a past calendar day. */
async function assertNotRetroactive(tx: Tx, organizationId: string, scheduledFor: Date) {
  const settings = await settingFor(tx, organizationId);
  const today = localDateString(new Date(), settings.timezone);
  const doseDay = localDateString(scheduledFor, settings.timezone);
  if (doseDay < today) throw new ApiError(409, 'RETROACTIVE_NOT_ALLOWED', 'No se pueden registrar tomas de días anteriores a hoy');
}

/**
 * Una receta vencida no autoriza ninguna entrega: bloquea el registro hasta que
 * se renueve. La receta sigue siendo válida durante todo su propio día de
 * vencimiento (se compara contra el calendario local de la organización).
 */
async function assertPrescriptionValid(tx: Tx, organizationId: string, treatment: { prescriptionExpiresOn: Date | string | null }) {
  if (!treatment.prescriptionExpiresOn) return;
  const settings = await settingFor(tx, organizationId);
  const today = new Date(`${localDateString(new Date(), settings.timezone)}T00:00:00.000Z`);
  if (!isPrescriptionExpired(treatment, today)) return;
  const expiry = toDateOnly(treatment.prescriptionExpiresOn).toISOString().slice(0, 10);
  throw new ApiError(
    409,
    'PRESCRIPTION_EXPIRED',
    `La receta venció el ${expiry}. Renueva la receta antes de registrar la entrega.`,
  );
}

treatmentsRouter.get('/:id/dose-schedules', validateParams(treatmentParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    return tx.doseSchedule.findMany({ where: { treatmentId: id }, orderBy: [{ effectiveFrom: 'desc' }] });
  });
  res.json({ data: result });
});

/**
 * Creates a new DoseSchedule version. The first schedule of a treatment
 * needs no authorization. Changing an already-active schedule (a real dose
 * or time-of-day change, not the initial setup) requires authorized_by +
 * authorization_note, and closes the previous version the day before the
 * new one starts - it is never edited in place, so past DoseLog rows keep
 * pointing at the version that was active when they were generated.
 */
treatmentsRouter.post('/:id/dose-schedules', validateParams(treatmentParams), authorizationDocumentUpload, async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const input = doseScheduleCreateInput.parse(req.body);
  const file = req.file;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const current = await activeDoseSchedule(tx, id);
    const isChange = Boolean(current);
    if (isChange && (!input.authorized_by || !input.authorization_note)) {
      throw new ApiError(400, 'AUTHORIZATION_REQUIRED', 'Cambiar la dosis de un tratamiento con horario activo requiere authorized_by y authorization_note');
    }
    const effectiveFrom = dateOnly(input.effective_from);
    if (current && effectiveFrom.getTime() <= toDateOnly(current.effectiveFrom).getTime()) {
      throw new ApiError(400, 'INVALID_DATE', 'effective_from debe ser posterior al inicio de la versión activa');
    }
    const documentPath = file ? authorizationDocumentRelativePath(tenant.organizationId, file.filename) : null;
    if (current) {
      await tx.doseSchedule.update({
        where: { organizationId_id: { organizationId: tenant.organizationId, id: current.id } },
        data: { effectiveTo: subtractDays(effectiveFrom, 1) },
      });
    }
    const created = await tx.doseSchedule.create({
      data: {
        organizationId: tenant.organizationId,
        treatmentId: id,
        dosePerIntake: input.dose_per_intake,
        times: input.times,
        frequencyType: input.frequency_type,
        intervalHours: input.interval_hours ?? null,
        anchorAt: input.anchor_at ? new Date(input.anchor_at) : null,
        weekdays: input.weekdays,
        monthdays: input.monthdays,
        effectiveFrom,
        effectiveTo: null,
        reason: input.reason ?? null,
        authorizedBy: input.authorized_by ?? null,
        authorizationNote: input.authorization_note ?? null,
        authorizationDocumentPath: documentPath,
        createdBy: tenant.userId,
      } as Prisma.DoseScheduleUncheckedCreateInput,
    });
    // El horario real manda sobre la cobertura calculada: si el ritmo de
    // consumo cambia, el fin de cobertura (y el próximo aviso de reposición)
    // se recalculan de inmediato, igual que cuando llega una entrega.
    let coverageEndOn: Date | null = null;
    if (!treatment.coverageManuallyAdjusted) {
      const lastDelivery = await tx.delivery.findFirst({
        where: { treatmentId: id },
        orderBy: [{ deliveredOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      });
      coverageEndOn = calculateCoverageEndOn({
        startDate: treatment.startDate,
        quantityPerCycle: treatment.quantityPerCycle.toString(),
        dosePerIntake: input.dose_per_intake.toString(),
        intakesPerDay: equivalentIntakesPerDay({
          frequencyType: input.frequency_type,
          times: input.times,
          intervalHours: input.interval_hours ?? null,
          weekdays: input.weekdays,
          monthdays: input.monthdays,
        }).toString(),
        lastDeliveryOn: lastDelivery?.deliveredOn ?? null,
        lastDeliveryQuantity: lastDelivery?.quantity.toString() ?? null,
      });
      await tx.treatment.update({
        where: { organizationId_id: { organizationId: tenant.organizationId, id } },
        data: { coverageEndOn },
      });
      const settings = await settingFor(tx, tenant.organizationId);
      await tx.refillCycle.updateMany({
        where: { treatmentId: id, closedAt: null, status: 'to_notify' },
        data: {
          expectedOn: coverageEndOn,
          suggestedNoticeOn: subtractDays(coverageEndOn, settings.noticeLeadDays),
          version: { increment: 1 },
        },
      });
    }
    // Qué cambió respecto al horario que se cierra, con los valores reales.
    const scheduleChanges: TreatmentChange[] = isChange && current
      ? [
        {
          field: 'dose_per_intake',
          label: 'Cantidad por toma',
          from: String(current.dosePerIntake),
          to: String(input.dose_per_intake),
        },
        {
          field: 'frequency',
          label: 'Frecuencia',
          from: describeDoseSchedule(current),
          to: describeDoseSchedule({
            frequencyType: input.frequency_type,
            times: input.times,
            intervalHours: input.interval_hours ?? null,
            weekdays: input.weekdays,
            monthdays: input.monthdays,
          }),
        },
      ].filter((change) => change.from !== change.to)
      : [];
    const scheduleBody = isChange
      ? summarizeChanges(scheduleChanges) || 'Dosis del tratamiento actualizada'
      : `Creada · ${describeDoseSchedule({
        frequencyType: input.frequency_type,
        times: input.times,
        intervalHours: input.interval_hours ?? null,
        weekdays: input.weekdays,
        monthdays: input.monthdays,
        dosePerIntake: input.dose_per_intake,
      })}`;
    await tx.activity.create({
      data: {
        organizationId: tenant.organizationId, patientId: treatment.patientId, treatmentId: id, type: 'treatment_updated',
        body: scheduleBody,
        metadata: { dose_schedule_id: created.id, dose_per_intake: input.dose_per_intake, frequency_type: input.frequency_type, times: input.times, interval_hours: input.interval_hours ?? null, weekdays: input.weekdays, monthdays: input.monthdays, authorized_by: input.authorized_by ?? null, coverage_end_on: coverageEndOn ? coverageEndOn.toISOString().slice(0, 10) : null, ...(scheduleChanges.length ? { changes: scheduleChanges } : {}) },
        authorId: tenant.userId,
      },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.dose_schedule.create', subjectId: created.id });
    return created;
  });
  res.status(201).json(result);
});

treatmentsRouter.get('/:id/dose-schedules/:doseScheduleId/authorization-document', validateParams(doseScheduleParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const { id, doseScheduleId } = res.locals.validatedParams as z.infer<typeof doseScheduleParams>;
  const schedule = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const row = await findDoseSchedule(tx, tenant.organizationId, id, doseScheduleId);
    if (!row?.authorizationDocumentPath) throw new ApiError(404, 'NOT_FOUND', 'Document not found');
    return row;
  });
  res.sendFile(authorizationDocumentAbsolutePath(schedule.authorizationDocumentPath!));
});

treatmentsRouter.post('/:id/prescription-document', validateParams(treatmentParams), prescriptionDocumentUpload, async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:write');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const file = req.file;
  if (!file) throw new ApiError(400, 'VALIDATION_ERROR', 'prescription_document es requerido');
  const documentPath = prescriptionDocumentRelativePath(tenant.organizationId, file.filename);
  await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { prescriptionDocumentPath: documentPath },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.prescription_document.upload', subjectId: id });
  });
  res.status(201).json({ has_prescription_document: true });
});

treatmentsRouter.get('/:id/prescription-document', validateParams(treatmentParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const treatment = await withTenant(tenant.organizationId, async (tx) => {
    const row = await findTreatment(tx, tenant, id);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    if (!row.prescriptionDocumentPath) throw new ApiError(404, 'NOT_FOUND', 'Document not found');
    return row;
  });
  res.sendFile(prescriptionDocumentAbsolutePath(treatment.prescriptionDocumentPath!));
});

treatmentsRouter.get('/:id/doses', validateParams(treatmentParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    return tx.doseLog.findMany({ where: { treatmentId: id }, orderBy: [{ scheduledFor: 'desc' }], take: 100 });
  });
  res.json({ data: result });
});

treatmentsRouter.post('/:id/doses/:doseLogId/take', validateParams(doseLogParams), validateBody(doseTakeInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'dose:log');
  const { id, doseLogId } = res.locals.validatedParams as z.infer<typeof doseLogParams>;
  const input = req.body as z.infer<typeof doseTakeInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const doseLog = await findDoseLog(tx, tenant.organizationId, id, doseLogId);
    if (!doseLog) throw new ApiError(404, 'NOT_FOUND', 'Dose log not found');
    if (doseLog.status !== 'scheduled') throw new ApiError(409, 'INVALID_STATUS', 'Only a scheduled dose can be marked as taken');
    await assertNotRetroactive(tx, tenant.organizationId, doseLog.scheduledFor);
    const quantity = input.actual_quantity ?? Number(doseLog.nominalQuantity);
    const entry = await tx.inventoryEntry.create({
      data: {
        organizationId: tenant.organizationId, treatmentId: id, type: 'dose_consumption',
        quantityDelta: -quantity, doseLogId, recordedBy: tenant.userId,
      } as Prisma.InventoryEntryUncheckedCreateInput,
    });
    const updated = await tx.doseLog.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id: doseLogId } },
      data: { status: 'taken', actualQuantity: input.actual_quantity ?? null, recordedBy: tenant.userId, recordedAt: new Date(), inventoryEntryId: entry.id },
    });
    await tx.activity.create({
      data: { organizationId: tenant.organizationId, patientId: treatment.patientId, treatmentId: id, type: 'dose_taken', body: '', metadata: { dose_log_id: doseLogId, quantity }, authorId: tenant.userId },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.dose.take', subjectId: doseLogId });
    return updated;
  });
  res.json(result);
});

treatmentsRouter.post('/:id/doses/:doseLogId/skip', validateParams(doseLogParams), validateBody(doseSkipInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'dose:log');
  const { id, doseLogId } = res.locals.validatedParams as z.infer<typeof doseLogParams>;
  const input = req.body as z.infer<typeof doseSkipInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const doseLog = await findDoseLog(tx, tenant.organizationId, id, doseLogId);
    if (!doseLog) throw new ApiError(404, 'NOT_FOUND', 'Dose log not found');
    if (doseLog.status !== 'scheduled') throw new ApiError(409, 'INVALID_STATUS', 'Only a scheduled dose can be marked as skipped');
    await assertNotRetroactive(tx, tenant.organizationId, doseLog.scheduledFor);
    // Skipped doses never consume inventory - nothing left the patient's stock.
    const updated = await tx.doseLog.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id: doseLogId } },
      data: { status: 'skipped', skipReasonCode: input.skip_reason_code, skipReasonNote: input.skip_reason_note ?? null, recordedBy: tenant.userId, recordedAt: new Date() },
    });
    await tx.activity.create({
      data: { organizationId: tenant.organizationId, patientId: treatment.patientId, treatmentId: id, type: 'dose_skipped', body: input.skip_reason_note ?? '', metadata: { dose_log_id: doseLogId, skip_reason_code: input.skip_reason_code }, authorId: tenant.userId },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.dose.skip', subjectId: doseLogId });
    return updated;
  });
  res.json(result);
});

/** Closes the original occurrence and opens a new one at the new time - the original is never silently moved. */
treatmentsRouter.post('/:id/doses/:doseLogId/reschedule', validateParams(doseLogParams), validateBody(doseRescheduleInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'dose:log');
  const { id, doseLogId } = res.locals.validatedParams as z.infer<typeof doseLogParams>;
  const input = req.body as z.infer<typeof doseRescheduleInput>;
  const rescheduledFor = new Date(input.rescheduled_for);
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const doseLog = await findDoseLog(tx, tenant.organizationId, id, doseLogId);
    if (!doseLog) throw new ApiError(404, 'NOT_FOUND', 'Dose log not found');
    if (doseLog.status !== 'scheduled') throw new ApiError(409, 'INVALID_STATUS', 'Only a scheduled dose can be rescheduled');
    await assertNotRetroactive(tx, tenant.organizationId, doseLog.scheduledFor);
    let created;
    try {
      created = await tx.doseLog.create({
        data: {
          organizationId: tenant.organizationId, treatmentId: id, doseScheduleId: doseLog.doseScheduleId,
          scheduledFor: rescheduledFor, status: 'scheduled', nominalQuantity: doseLog.nominalQuantity,
        } as Prisma.DoseLogUncheckedCreateInput,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'CONFLICT', 'Ya existe una toma programada para esa fecha y hora');
      }
      throw error;
    }
    const updated = await tx.doseLog.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id: doseLogId } },
      data: { status: 'rescheduled', rescheduledFor, recordedBy: tenant.userId, recordedAt: new Date() },
    });
    await tx.activity.create({
      data: { organizationId: tenant.organizationId, patientId: treatment.patientId, treatmentId: id, type: 'dose_rescheduled', body: '', metadata: { dose_log_id: doseLogId, new_dose_log_id: created.id, rescheduled_for: rescheduledFor.toISOString() }, authorId: tenant.userId },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.dose.reschedule', subjectId: doseLogId });
    return { ...updated, new_dose_log: created };
  });
  res.json(result);
});

/** Reverts a taken/skipped/rescheduled dose back to `scheduled`. Never edits the InventoryEntry in place - a reversal entry is created, the original stays untouched. */
treatmentsRouter.post('/:id/doses/:doseLogId/correct', validateParams(doseLogParams), validateBody(doseCorrectInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'dose:correct');
  const { id, doseLogId } = res.locals.validatedParams as z.infer<typeof doseLogParams>;
  const input = req.body as z.infer<typeof doseCorrectInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const doseLog = await findDoseLog(tx, tenant.organizationId, id, doseLogId);
    if (!doseLog) throw new ApiError(404, 'NOT_FOUND', 'Dose log not found');
    if (doseLog.status === 'scheduled') throw new ApiError(409, 'INVALID_STATUS', 'Nothing to correct: the dose is still scheduled');
    let reversalEntryId: string | null = null;
    if (doseLog.inventoryEntryId) {
      const original = await tx.inventoryEntry.findFirst({ where: { id: doseLog.inventoryEntryId, treatmentId: id, organizationId: tenant.organizationId } });
      if (original) {
        const reversal = await tx.inventoryEntry.create({
          data: {
            organizationId: tenant.organizationId, treatmentId: id, type: 'reversal',
            quantityDelta: original.quantityDelta.negated(), reversedEntryId: original.id, doseLogId, recordedBy: tenant.userId,
            note: input.correction_note,
          } as Prisma.InventoryEntryUncheckedCreateInput,
        });
        reversalEntryId = reversal.id;
      }
    }
    const updated = await tx.doseLog.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id: doseLogId } },
      data: {
        status: 'scheduled', actualQuantity: null, skipReasonCode: null, skipReasonNote: null, rescheduledFor: null,
        recordedBy: null, recordedAt: null, inventoryEntryId: null,
        correctedBy: tenant.userId, correctedAt: new Date(), correctionNote: input.correction_note,
      },
    });
    await tx.activity.create({
      data: { organizationId: tenant.organizationId, patientId: treatment.patientId, treatmentId: id, type: 'dose_corrected', body: input.correction_note, metadata: { dose_log_id: doseLogId, reversal_entry_id: reversalEntryId }, authorId: tenant.userId },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.dose.correct', subjectId: doseLogId });
    return updated;
  });
  res.json(result);
});

treatmentsRouter.get('/:id/inventory', validateParams(treatmentParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const entries = await tx.inventoryEntry.findMany({ where: { treatmentId: id }, select: { quantityDelta: true } });
    const balance = currentBalance(entries.map((entry) => ({ quantityDelta: entry.quantityDelta.toString() })));
    const takenLogs = await tx.doseLog.findMany({
      where: { treatmentId: id, status: 'taken' },
      select: { scheduledFor: true, nominalQuantity: true, actualQuantity: true },
      orderBy: { scheduledFor: 'desc' },
      take: 500,
    });
    // El horario real (DoseSchedule.times) es la fuente de verdad para el
    // consumo una vez que existe - la Pauta del tratamiento (dose_per_intake
    // / intakes_per_day) solo se usa de respaldo si todavía no se definió
    // un horario de dosis.
    const schedule = await activeDoseSchedule(tx, id);
    const scheduledRatePerDay = schedule
      ? unitsPerDay(schedule.dosePerIntake.toString(), equivalentIntakesPerDay(schedule).toString())
      : unitsPerDay(treatment.dosePerIntake.toString(), treatment.intakesPerDay.toString());
    const { ratePerDay, source } = actualRatePerDay(
      takenLogs.map((log) => ({ scheduledFor: log.scheduledFor, nominalQuantity: log.nominalQuantity.toString(), actualQuantity: log.actualQuantity?.toString() ?? null })),
      new Date(),
      scheduledRatePerDay,
    );
    const threshold = treatment.lowInventoryThreshold?.toString() ?? null;
    // Proyección sobre los días reales de toma: se materializa el horario
    // activo, se agrupa por fecha local y se arrastra el saldo sólo en esos
    // días. Sin horario definido se usa la pauta (tomas todos los días).
    const settings = await settingFor(tx, tenant.organizationId);
    const todayLocal = new Date(`${localDateString(new Date(), settings.timezone)}T00:00:00.000Z`);
    const horizon = 120;
    const dosesByDay: { date: string; units: number }[] = [];
    let consumedUnlogged = 0;
    if (schedule) {
      const versions = await tx.doseSchedule.findMany({
        where: { treatmentId: id },
        orderBy: [{ effectiveFrom: 'asc' }],
      });
      // Desde la última entrega (o el inicio) para poder contar lo ya pasado.
      const historyFrom = new Date(
        `${localDateString(treatment.lastDeliveryOn ?? treatment.startDate, settings.timezone)}T00:00:00.000Z`,
      );
      const occurrences = materializeOccurrences(
        versions.map((version) => ({
          id: version.id,
          dosePerIntake: version.dosePerIntake.toString(),
          times: version.times,
          frequencyType: version.frequencyType,
          intervalHours: version.intervalHours,
          anchorAt: version.anchorAt,
          weekdays: version.weekdays,
          monthdays: version.monthdays,
          effectiveFrom: version.effectiveFrom,
          effectiveTo: version.effectiveTo,
        })),
        historyFrom,
        addDays(todayLocal, horizon),
        settings.timezone,
      );
      // Una toma ya registrada como 'taken' ya descontó su unidad del saldo:
      // volver a restarla aquí la contaría dos veces. Solo se proyecta lo que
      // queda por tomar.
      const taken = new Set(
        (
          await tx.doseLog.findMany({
            where: { treatmentId: id, status: 'taken' },
            select: { scheduledFor: true },
          })
        ).map((log) => log.scheduledFor.toISOString()),
      );
      // Las tomas cuya hora ya pasó y nadie registró se consumieron igual, así
      // que descuentan del saldo real; las futuras alimentan la proyección.
      const now = new Date();
      const perDay = new Map<string, number>();
      for (const occurrence of occurrences) {
        if (taken.has(occurrence.scheduledFor.toISOString())) continue;
        if (occurrence.scheduledFor.getTime() < now.getTime()) {
          consumedUnlogged += occurrence.nominalQuantity;
          continue;
        }
        const key = localDateString(occurrence.scheduledFor, settings.timezone);
        perDay.set(key, (perDay.get(key) ?? 0) + occurrence.nominalQuantity);
      }
      for (const [date, units] of perDay) dosesByDay.push({ date, units });
    } else {
      // Sin horario: la pauta implica tomas todos los días.
      const perDay = unitsPerDay(treatment.dosePerIntake.toString(), treatment.intakesPerDay.toString());
      for (let day = 0; day < horizon; day++) {
        dosesByDay.push({ date: addDays(todayLocal, day).toISOString().slice(0, 10), units: perDay });
      }
    }
    const balanceReal = realBalance(balance, consumedUnlogged);
    const projection = projectDosesByDay(balanceReal, dosesByDay);
    const { days, exhaustedOn } = daysUntilExhausted(balanceReal, projection, todayLocal, ratePerDay);
    return {
      balance,
      balance_real: balanceReal,
      consumed_unlogged: consumedUnlogged,
      rate_per_day: ratePerDay,
      rate_source: source,
      days_remaining_real: days,
      low_inventory_threshold: threshold,
      is_low: isBelowThreshold(balance, threshold),
      exhausted_on: exhaustedOn,
      projection,
    };
  });
  res.json(result);
});

treatmentsRouter.get('/:id/inventory/entries', validateParams(treatmentParams), validateQuery(inventoryEntriesQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const query = res.locals.validatedQuery as z.infer<typeof inventoryEntriesQuery>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const rows = await tx.inventoryEntry.findMany({
      where: { treatmentId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const data = rows.slice(0, query.limit);
    return { data, next_cursor: hasMore ? data.at(-1)!.id : null };
  });
  res.json(result);
});

treatmentsRouter.post('/:id/external-purchases', validateParams(treatmentParams), validateBody(externalPurchaseInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'inventory:purchase');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const input = req.body as z.infer<typeof externalPurchaseInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const purchase = await tx.externalPurchase.create({
      data: {
        organizationId: tenant.organizationId, treatmentId: id, quantity: input.quantity,
        presentation: input.presentation ?? null, purchasedOn: dateOnly(input.purchased_on),
        place: input.place ?? null, notes: input.notes ?? null, recordedBy: tenant.userId,
      } as Prisma.ExternalPurchaseUncheckedCreateInput,
    });
    const entry = await tx.inventoryEntry.create({
      data: {
        organizationId: tenant.organizationId, treatmentId: id, type: 'external_purchase',
        quantityDelta: input.quantity, externalPurchaseId: purchase.id, recordedBy: tenant.userId,
      } as Prisma.InventoryEntryUncheckedCreateInput,
    });
    await tx.activity.create({
      data: { organizationId: tenant.organizationId, patientId: treatment.patientId, treatmentId: id, type: 'external_purchase_recorded', body: input.notes ?? '', metadata: { external_purchase_id: purchase.id, quantity: input.quantity, presentation: input.presentation ?? null }, authorId: tenant.userId },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.external_purchase.create', subjectId: purchase.id });
    return { purchase, inventory_entry: entry };
  });
  res.status(201).json(result);
});

treatmentsRouter.post('/:id/inventory/adjust', validateParams(treatmentParams), validateBody(inventoryAdjustInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'inventory:adjust');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const input = req.body as z.infer<typeof inventoryAdjustInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const entry = await tx.inventoryEntry.create({
      data: { organizationId: tenant.organizationId, treatmentId: id, type: 'manual_adjustment', quantityDelta: input.quantity_delta, note: input.note, recordedBy: tenant.userId },
    });
    await tx.activity.create({
      data: { organizationId: tenant.organizationId, patientId: treatment.patientId, treatmentId: id, type: 'inventory_adjusted', body: input.note, metadata: { quantity_delta: input.quantity_delta }, authorId: tenant.userId },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.inventory.adjust', subjectId: entry.id });
    return entry;
  });
  res.status(201).json(result);
});

treatmentsRouter.patch('/:id/inventory/threshold', validateParams(treatmentParams), validateBody(inventoryThresholdInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'inventory:settings:write');
  const { id } = res.locals.validatedParams as z.infer<typeof treatmentParams>;
  const input = req.body as z.infer<typeof inventoryThresholdInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const treatment = await findTreatment(tx, tenant, id);
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const updated = await tx.treatment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { lowInventoryThreshold: input.low_inventory_threshold },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'treatment.inventory.threshold', subjectId: id, metadata: { low_inventory_threshold: input.low_inventory_threshold } });
    return { id, low_inventory_threshold: updated.lowInventoryThreshold };
  });
  res.json(result);
});
