/**
 * Pure dose-schedule expansion.
 *
 * This module intentionally has no Express, Prisma or database imports so the
 * clock-time scheduling rules can be tested without infrastructure, the same
 * way src/domain/coverage.ts tests the coverage rules.
 */
import { CoverageInputError, addDays, toDateOnly, toNumber, type DecimalLike } from './coverage.js';

export { CoverageInputError as DoseScheduleInputError };

const AVERAGE_DAYS_PER_MONTH = 30.4375;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTime(time: string): { hour: number; minute: number } {
  const match = TIME_PATTERN.exec(time);
  if (!match) throw new CoverageInputError(`Hora inválida: ${time}`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Converts one `HH:mm` wall-clock time on a given local calendar date, in an
 * IANA time zone, to the UTC instant it represents. No timezone library is
 * used: a naive-UTC guess is formatted back through the target zone with
 * Intl.DateTimeFormat (same primitive as localDateString) and the resulting
 * offset corrects the guess. This does not special-case the instant of a DST
 * transition - acceptable here since every organization so far uses a fixed
 * UTC offset.
 */
export function zonedTimeToUtc(localDate: Date, time: string, timezone: string): Date {
  const { hour, minute } = parseTime(time);
  const day = toDateOnly(localDate);
  const naiveUtc = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(naiveUtc);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offset = asUtc - naiveUtc.getTime();
  return new Date(naiveUtc.getTime() - offset);
}

/**
 * How a version repeats. `daily` (and its absence, for versions created
 * before this type existed) applies `times` to every calendar day - the
 * original and still the default behavior. `interval` steps from `anchorAt`
 * by `intervalHours`, independent of calendar days: this is what covers an
 * hour interval that does not evenly divide 24 ("cada 5 horas") and every
 * day-interval case ("cada 30 días" = intervalHours 720), since those can
 * drift across midnight and cannot be expressed as fixed daily clock times.
 * `weekly` applies `times` only on the calendar days whose weekday is in
 * `weekdays` (0=domingo..6=sábado, matching Date#getUTCDay() on a date-only
 * local-calendar Date, the same convention used everywhere else in this
 * module). `monthly` applies `times` only on the calendar days whose
 * day-of-month is in `monthdays` (1-31); a selected day that a month lacks
 * (e.g. 31 in April) falls on that month's last day instead of being skipped,
 * so the dose is never missed.
 */
export type DoseFrequencyType = 'daily' | 'interval' | 'weekly' | 'monthly';

export type DoseScheduleVersion = {
  id: string;
  dosePerIntake: DecimalLike;
  times: string[];
  /** Defaults to 'daily' when absent, for backward compatibility with versions created before this field existed. */
  frequencyType?: DoseFrequencyType;
  /** Required when frequencyType is 'interval'. */
  intervalHours?: number | null;
  /** Required when frequencyType is 'interval': the exact instant of the first occurrence. */
  anchorAt?: Date | null;
  /** Required (non-empty) when frequencyType is 'weekly'. */
  weekdays?: number[];
  /** Required (non-empty) when frequencyType is 'monthly'. Days of the month, 1-31. */
  monthdays?: number[];
  /** Date-only, inclusive. */
  effectiveFrom: Date;
  /** Date-only, inclusive. null means still active. */
  effectiveTo: Date | null;
};

/**
 * The version in effect on a given local calendar day. Versions must not
 * overlap (changing the dose always closes the previous version first), so
 * at most one can match.
 */
export function activeVersionOnDate(versions: DoseScheduleVersion[], localDate: Date): DoseScheduleVersion | null {
  const day = toDateOnly(localDate);
  return (
    versions.find((version) => {
      const from = toDateOnly(version.effectiveFrom);
      const to = version.effectiveTo ? toDateOnly(version.effectiveTo) : null;
      return from.getTime() <= day.getTime() && (!to || day.getTime() <= to.getTime());
    }) ?? null
  );
}

export type GeneratedOccurrence = {
  doseScheduleId: string;
  scheduledFor: Date;
  nominalQuantity: number;
};

/** Every occurrence of an 'interval' version within [rangeStart, rangeEnd] (date-only, inclusive), stepping from anchorAt by intervalHours - never locked to calendar days, since the step may not divide 24h evenly. */
function intervalOccurrences(version: DoseScheduleVersion, rangeStart: Date, rangeEnd: Date, timezone: string): GeneratedOccurrence[] {
  if (!version.anchorAt || !version.intervalHours) throw new CoverageInputError(`La versión de horario ${version.id} es de tipo 'interval' pero le falta anchorAt o intervalHours`);
  const anchor = version.anchorAt.getTime();
  const stepMs = version.intervalHours * 3_600_000;
  const lower = zonedTimeToUtc(rangeStart, '00:00', timezone).getTime();
  const upperExclusive = zonedTimeToUtc(addDays(rangeEnd, 1), '00:00', timezone).getTime();
  const dose = toNumber(version.dosePerIntake);
  const occurrences: GeneratedOccurrence[] = [];
  const firstStep = Math.max(0, Math.ceil((lower - anchor) / stepMs));
  for (let instant = anchor + firstStep * stepMs; instant < upperExclusive; instant += stepMs) {
    occurrences.push({ doseScheduleId: version.id, scheduledFor: new Date(instant), nominalQuantity: dose });
  }
  return occurrences;
}

/** Whether `day` (date-only) is one of the selected days of the month; days past a short month's end land on its last day. */
function isMonthday(day: Date, monthdays: number[]): boolean {
  const dayOfMonth = day.getUTCDate();
  if (monthdays.includes(dayOfMonth)) return true;
  const lastDayOfMonth = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
  return dayOfMonth === lastDayOfMonth && monthdays.some((selected) => selected > lastDayOfMonth);
}

/**
 * Materializes every dose occurrence for calendar days [fromLocalDate,
 * toLocalDate] (inclusive, in org timezone). Versions are processed one at a
 * time (sorted by effectiveFrom, since they never overlap) rather than
 * picking an active version per day: an 'interval' version's occurrences are
 * not day-aligned, so they cannot be generated from a day-by-day loop the
 * way 'daily'/'weekly' ones are. Each version is first clipped to its own
 * [effectiveFrom, effectiveTo] intersected with the requested window - a
 * version outside the window (treatment not started yet, or a gap) simply
 * contributes nothing, never an error.
 */
export function materializeOccurrences(
  versions: DoseScheduleVersion[],
  fromLocalDate: Date,
  toLocalDate: Date,
  timezone: string,
): GeneratedOccurrence[] {
  const start = toDateOnly(fromLocalDate);
  const end = toDateOnly(toLocalDate);
  if (end.getTime() < start.getTime()) throw new CoverageInputError('El rango de fechas es inválido');
  const occurrences: GeneratedOccurrence[] = [];
  const sorted = [...versions].sort((a, b) => toDateOnly(a.effectiveFrom).getTime() - toDateOnly(b.effectiveFrom).getTime());
  for (const version of sorted) {
    const versionFrom = toDateOnly(version.effectiveFrom);
    const versionTo = version.effectiveTo ? toDateOnly(version.effectiveTo) : null;
    const rangeStart = versionFrom.getTime() > start.getTime() ? versionFrom : start;
    const rangeEnd = versionTo && versionTo.getTime() < end.getTime() ? versionTo : end;
    if (rangeEnd.getTime() < rangeStart.getTime()) continue;
    const frequencyType = version.frequencyType ?? 'daily';
    if (frequencyType === 'interval') {
      occurrences.push(...intervalOccurrences(version, rangeStart, rangeEnd, timezone));
      continue;
    }
    const dose = toNumber(version.dosePerIntake);
    const weekdays = version.weekdays ?? [];
    const monthdays = version.monthdays ?? [];
    for (let day = rangeStart; day.getTime() <= rangeEnd.getTime(); day = addDays(day, 1)) {
      if (frequencyType === 'weekly' && !weekdays.includes(day.getUTCDay())) continue;
      if (frequencyType === 'monthly' && !isMonthday(day, monthdays)) continue;
      for (const time of version.times) {
        occurrences.push({ doseScheduleId: version.id, scheduledFor: zonedTimeToUtc(day, time, timezone), nominalQuantity: dose });
      }
    }
  }
  return occurrences;
}

/**
 * The daily intake rate this version is equivalent to, for coverage/inventory
 * burn-rate math (src/domain/coverage.ts, src/domain/inventory.ts) that was
 * written assuming a constant "times per day" rate and must stay that way -
 * see effectiveDoseRate() in src/modules/treatments/router.ts, the only
 * caller. 'daily' keeps the exact pre-existing formula (times.length, i.e.
 * one dose per listed time, every day). 'interval' and 'weekly' convert
 * their own repeat rule into the equivalent daily average.
 */
export function equivalentIntakesPerDay(version: Pick<DoseScheduleVersion, 'frequencyType' | 'times' | 'intervalHours' | 'weekdays' | 'monthdays'>): number {
  const frequencyType = version.frequencyType ?? 'daily';
  if (frequencyType === 'interval') return 24 / (version.intervalHours ?? 24);
  if (frequencyType === 'weekly') return (version.times.length * (version.weekdays ?? []).length) / 7;
  if (frequencyType === 'monthly') return (version.times.length * (version.monthdays ?? []).length) / AVERAGE_DAYS_PER_MONTH;
  return version.times.length;
}
