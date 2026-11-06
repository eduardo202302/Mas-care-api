/**
 * Pure inventory-ledger math, complementary to src/domain/coverage.ts (which
 * keeps deriving coverage_end_on for the pharmacy-refill pipeline - this
 * module answers a different question: how many units does the patient
 * physically have left, based on real taken doses, not the prescribed rate).
 *
 * No Express, Prisma or database imports, same reasoning as coverage.ts.
 */
import { CoverageInputError, toNumber, type DecimalLike } from './coverage.js';

export { CoverageInputError as InventoryInputError };

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_TAKEN_LOGS_FOR_WINDOW_RATE = 3;
const DEFAULT_RATE_WINDOW_DAYS = 14;

export type RateSource = 'actual' | 'scheduled';

export type LedgerEntry = { quantityDelta: DecimalLike };

export type TakenDoseLog = {
  scheduledFor: Date;
  nominalQuantity: DecimalLike;
  actualQuantity: DecimalLike | null;
};

/**
 * Current balance for a treatment: sum of every ledger delta. The balance is
 * never stored as a mutable counter - this is the only place it is computed,
 * so a reversed/corrected entry (recorded as a new row, never an edit) is
 * automatically reflected without any special-case logic here.
 */
export function currentBalance(entries: LedgerEntry[]): number {
  return entries.reduce((total, entry) => total + toNumber(entry.quantityDelta), 0);
}

function quantityOf(log: TakenDoseLog): number {
  return toNumber(log.actualQuantity ?? log.nominalQuantity);
}

/**
 * Real daily consumption rate from doses actually marked `taken`, not from
 * what the schedule says should happen.
 *
 * Adaptive window: doses taken in the trailing `windowDays` are used when
 * there are at least MIN_TAKEN_LOGS_FOR_WINDOW_RATE of them. With fewer, the
 * 14-day window would make a freshly started treatment look like it barely
 * consumes anything (e.g. 1 dose / 14 days), so every available taken dose
 * is used instead, with the denominator shrunk to the real span of days
 * they cover. With no taken doses at all, the caller's prescribed rate
 * (typically coverage.ts's unitsPerDay) is returned so days_remaining_real
 * is never undefined for a brand-new treatment.
 */
export function actualRatePerDay(
  takenLogs: TakenDoseLog[],
  now: Date,
  scheduledRatePerDay: number,
  windowDays: number = DEFAULT_RATE_WINDOW_DAYS,
): { ratePerDay: number; source: RateSource } {
  const upToNow = takenLogs.filter((log) => log.scheduledFor.getTime() <= now.getTime());
  const windowStart = now.getTime() - windowDays * MILLISECONDS_PER_DAY;
  const withinWindow = upToNow.filter((log) => log.scheduledFor.getTime() >= windowStart);

  if (withinWindow.length >= MIN_TAKEN_LOGS_FOR_WINDOW_RATE) {
    const total = withinWindow.reduce((sum, log) => sum + quantityOf(log), 0);
    return { ratePerDay: total / windowDays, source: 'actual' };
  }
  if (upToNow.length === 0) {
    return { ratePerDay: scheduledRatePerDay, source: 'scheduled' };
  }
  const earliest = Math.min(...upToNow.map((log) => log.scheduledFor.getTime()));
  const spanDays = Math.max(1, (now.getTime() - earliest) / MILLISECONDS_PER_DAY);
  const total = upToNow.reduce((sum, log) => sum + quantityOf(log), 0);
  return { ratePerDay: total / spanDays, source: 'actual' };
}

/**
 * days_remaining_real = floor(balance / rate). Mirrors coverage.ts's
 * daysCovered: a partial day does not round up, and the same epsilon
 * compensates for binary floating-point representations of decimal inputs.
 * A non-positive rate has no meaningful "days remaining" (nothing is being
 * consumed, or the input is invalid), so it returns null rather than
 * Infinity or a misleading number.
 */
export function daysRemainingReal(balance: number, ratePerDay: number): number | null {
  if (ratePerDay <= 0) return null;
  if (balance <= 0) return 0;
  return Math.floor(balance / ratePerDay + 1e-9);
}

/**
 * Whether the balance has crossed a low-inventory threshold, for the alert
 * job. Strictly at-or-below the threshold triggers it (crossing exactly to
 * the threshold counts as low, not "almost low").
 */
export function isBelowThreshold(balance: number, threshold: DecimalLike | null): boolean {
  if (threshold === null) return false;
  return balance <= toNumber(threshold);
}

export type ProjectionRow = {
  /** Fecha local (YYYY-MM-DD) en la que toca tomar. */
  date: string;
  /** Unidades que se consumen ese día. */
  units: number;
  /** Saldo que queda después de las tomas de ese día. */
  remaining: number;
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Proyección día a día del saldo, limitada a los días en que **de verdad toca
 * tomar**. Una dosis cada 3 días no consume 0.333 unidades a diario: consume 1
 * unidad cada tres días, y mostrar el saldo fraccionado todos los días era
 * ruido sin sentido para el paciente.
 *
 * `dosesByDay` viene de materializar el horario real del tratamiento; si un día
 * no aparece, no hay toma y tampoco hay fila.
 */
export function projectDosesByDay(
  balance: number,
  dosesByDay: { date: string; units: number }[],
  maxRows = 60,
): ProjectionRow[] {
  let remaining = balance;
  const rows: ProjectionRow[] = [];
  for (const day of [...dosesByDay].sort((a, b) => a.date.localeCompare(b.date))) {
    if (rows.length >= maxRows) break;
    remaining -= day.units;
    rows.push({
      date: day.date,
      units: round3(day.units),
      remaining: remaining > 0 ? round3(remaining) : 0,
    });
    if (remaining <= 0) break;
  }
  return rows;
}

/**
 * Días que el saldo alcanza según la proyección real (los días en que toca
 * tomar). Si la proyección no llega a agotar el saldo en el horizonte, se cae
 * al cálculo por ritmo promedio.
 *
 * `present()` (listado) y `GET /inventory` (panel) deben devolver **el mismo**
 * número: antes uno dividía saldo/ritmo (30 / 0.333 = 90 días) y el otro
 * contaba los días reales (28), así que la misma tarjeta mostraba dos
 * respuestas contradictorias según la pantalla.
 */
export function daysUntilExhausted(
  balance: number,
  projection: ProjectionRow[],
  today: Date,
  fallbackRate: number | null,
): { days: number | null; exhaustedOn: string | null } {
  if (balance <= 0) return { days: 0, exhaustedOn: today.toISOString().slice(0, 10) };
  const last = projection[projection.length - 1];
  if (last && last.remaining <= 0) {
    const days = Math.round(
      (new Date(`${last.date}T00:00:00.000Z`).getTime() - today.getTime()) / MILLISECONDS_PER_DAY,
    );
    return { days, exhaustedOn: last.date };
  }
  return {
    days: fallbackRate !== null ? daysRemainingReal(balance, fallbackRate) : null,
    exhaustedOn: null,
  };
}

/**
 * Saldo real: lo que queda físicamente en el frasco. El libro solo registra
 * entregas y compras; una toma programada cuya hora ya pasó y nadie marcó
 * como tomada igual se consumió, así que se descuenta aquí.
 *
 * Mostrar el saldo del libro (30) cuando ya se tomaron 6 unidades daba una
 * respuesta falsa a «cuántas me quedan».
 */
export function realBalance(balance: number, consumedUnlogged: number): number {
  const left = balance - consumedUnlogged;
  return left > 0 ? round3(left) : 0;
}
