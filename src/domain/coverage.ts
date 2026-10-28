/**
 * Pure coverage calculations for treatments.
 *
 * This module intentionally has no Express, Prisma or database imports so the
 * medication coverage rules can be tested without infrastructure.
 */

export const derivedStatuses = [
  'vencido',
  'vence_pronto',
  'retiro_pendiente',
  'proxima_reposicion',
  'al_dia',
] as const;
export type DerivedStatus = (typeof derivedStatuses)[number];

export const treatmentStatuses = ['active', 'paused', 'finished'] as const;
export type TreatmentStatus = (typeof treatmentStatuses)[number];

export const refillCycleStatuses = [
  'to_notify',
  'notified',
  'confirmed',
  'prepared',
  'delivered',
  'not_picked_up',
  'cancelled',
] as const;
export type RefillCycleStatus = (typeof refillCycleStatuses)[number];

export type DecimalLike = number | string;

export type CoverageSettings = {
  dueSoonDays: number;
  upcomingDays: number;
  prescriptionWarningDays: number;
};

export type CoverageTreatment = {
  status: TreatmentStatus;
  startDate: Date;
  quantityPerCycle: DecimalLike;
  dosePerIntake: DecimalLike;
  intakesPerDay: DecimalLike;
  coverageEndOn: Date | null;
  coverageManuallyAdjusted: boolean;
  prescriptionExpiresOn: Date | null;
};

export type CoverageCycle = {
  status: RefillCycleStatus;
  hasDelivery: boolean;
} | null;

export type DerivedCoverage = {
  status: DerivedStatus | null;
  daysRemaining: number | null;
  prescriptionFlag: boolean;
};

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export class CoverageInputError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'CoverageInputError';
  }
}

export function toNumber(value: DecimalLike): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new CoverageInputError('El valor debe ser un número finito');
  return parsed;
}

function assertPositive(value: DecimalLike, label: string): number {
  const parsed = toNumber(value);
  if (parsed <= 0) throw new CoverageInputError(`${label} debe ser mayor que cero`);
  return parsed;
}

/** Converts any date-like value to a UTC midnight Date so day math is stable. */
export function toDateOnly(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new CoverageInputError('Fecha inválida');
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(toDateOnly(date).getTime() + days * MILLISECONDS_PER_DAY);
}

export function subtractDays(date: Date, days: number): Date {
  return addDays(date, -days);
}

/** Whole calendar days from one UTC date-only value to another. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((toDateOnly(to).getTime() - toDateOnly(from).getTime()) / MILLISECONDS_PER_DAY);
}

/**
 * units_per_day = dose_per_intake × intakes_per_day.
 * Fractional doses (0.5 tablet) and weekly intakes (1/7) are supported.
 */
export function unitsPerDay(dosePerIntake: DecimalLike, intakesPerDay: DecimalLike): number {
  const dose = assertPositive(dosePerIntake, 'La dosis por toma');
  const intakes = assertPositive(intakesPerDay, 'Las tomas por día');
  return dose * intakes;
}

/**
 * days_covered = floor(quantity ÷ units_per_day).
 *
 * The floor is deliberate: a partial day at the end of a package does not
 * count as a covered day, so 10 units at 3 units/day cover 3 days (not 3.33).
 * A tiny epsilon compensates for binary floating-point representations of
 * decimal inputs (for example 0.3 / 0.1 must still produce 3).
 */
export function daysCovered(quantity: DecimalLike, units: DecimalLike): number {
  const amount = assertPositive(quantity, 'La cantidad');
  const daily = assertPositive(units, 'Las unidades por día');
  return Math.floor(amount / daily + 1e-9);
}

/**
 * Calculates the stored coverage end date.
 *
 * With deliveries, the last delivery date and its quantity are the basis.
 * Without deliveries, the treatment start date and its initial cycle quantity
 * are used. A manual adjustment wins until the next delivery (callers should
 * pass coverageManuallyAdjusted: false when registering a delivery).
 */
export function calculateCoverageEndOn(input: {
  startDate: Date;
  quantityPerCycle: DecimalLike;
  dosePerIntake: DecimalLike;
  intakesPerDay: DecimalLike;
  lastDeliveryOn?: Date | null;
  lastDeliveryQuantity?: DecimalLike | null;
  coverageEndOn?: Date | null;
  coverageManuallyAdjusted?: boolean;
}): Date {
  if (input.coverageManuallyAdjusted && input.coverageEndOn) {
    return toDateOnly(input.coverageEndOn);
  }
  const hasDelivery = input.lastDeliveryOn != null;
  const baseDate = hasDelivery ? input.lastDeliveryOn! : input.startDate;
  const quantity = hasDelivery && input.lastDeliveryQuantity != null
    ? input.lastDeliveryQuantity
    : input.quantityPerCycle;
  const units = unitsPerDay(input.dosePerIntake, input.intakesPerDay);
  return addDays(baseDate, daysCovered(quantity, units));
}

/** Days left from today through coverage_end_on. Zero means coverage ends today. */
export function daysRemaining(treatment: CoverageTreatment, today: Date): number | null {
  if (!treatment.coverageEndOn) return null;
  return daysBetween(today, treatment.coverageEndOn);
}

/**
 * Independent prescription warning. Finished treatments are excluded because
 * they no longer need a renewed prescription.
 */
export function prescriptionFlag(
  treatment: CoverageTreatment,
  today: Date,
  settings: CoverageSettings,
): boolean {
  if (treatment.status === 'finished' || !treatment.prescriptionExpiresOn) return false;
  const warningLimit = addDays(today, settings.prescriptionWarningDays);
  return toDateOnly(treatment.prescriptionExpiresOn).getTime() <= warningLimit.getTime();
}

/**
 * Derived status precedence (first match wins):
 * 1. vencido           coverage_end_on < today
 * 2. vence_pronto      days remaining <= due_soon_days
 * 3. retiro_pendiente  open cycle prepared and without deliveries
 * 4. proxima_reposicion days remaining <= upcoming_days
 * 5. al_dia            everything else
 *
 * Paused and finished treatments have no derived status. All comparisons use
 * UTC calendar days.
 */
export function deriveStatus(
  treatment: CoverageTreatment,
  cycle: CoverageCycle,
  today: Date,
  settings: CoverageSettings,
): DerivedStatus | null {
  if (treatment.status !== 'active') return null;

  const remaining = daysRemaining(treatment, today);
  if (remaining !== null && remaining < 0) return 'vencido';
  if (remaining !== null && remaining <= settings.dueSoonDays) return 'vence_pronto';
  if (cycle?.status === 'prepared' && !cycle.hasDelivery) return 'retiro_pendiente';
  if (remaining !== null && remaining <= settings.upcomingDays) return 'proxima_reposicion';
  return 'al_dia';
}

export function deriveCoverage(
  treatment: CoverageTreatment,
  cycle: CoverageCycle,
  today: Date,
  settings: CoverageSettings,
): DerivedCoverage {
  const status = deriveStatus(treatment, cycle, today, settings);
  return {
    status,
    daysRemaining: status === null ? null : daysRemaining(treatment, today),
    prescriptionFlag: prescriptionFlag(treatment, today, settings),
  };
}
