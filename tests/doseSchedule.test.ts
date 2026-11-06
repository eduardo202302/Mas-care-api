import { describe, expect, it } from 'vitest';
import {
  DoseScheduleInputError,
  activeVersionOnDate,
  equivalentIntakesPerDay,
  materializeOccurrences,
  parseTime,
  zonedTimeToUtc,
  type DoseScheduleVersion,
} from '../src/domain/doseSchedule.js';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const TZ = 'America/Santo_Domingo'; // fixed UTC-4, no DST

describe('parseTime', () => {
  it('accepts valid HH:mm', () => {
    expect(parseTime('08:00')).toEqual({ hour: 8, minute: 0 });
    expect(parseTime('23:59')).toEqual({ hour: 23, minute: 59 });
  });

  it('rejects malformed times', () => {
    expect(() => parseTime('24:00')).toThrow(DoseScheduleInputError);
    expect(() => parseTime('8:00')).toThrow(DoseScheduleInputError);
    expect(() => parseTime('not-a-time')).toThrow(DoseScheduleInputError);
  });
});

describe('zonedTimeToUtc', () => {
  it('converts a fixed-offset local time to its UTC instant', () => {
    // Case 3 (varias tomas/día): a 08:00 local dose in UTC-4 is 12:00Z.
    expect(zonedTimeToUtc(day('2026-11-04'), '08:00', TZ).toISOString()).toBe('2026-11-04T12:00:00.000Z');
    expect(zonedTimeToUtc(day('2026-11-04'), '20:00', TZ).toISOString()).toBe('2026-11-05T00:00:00.000Z');
  });
});

describe('activeVersionOnDate (case 2: cambio de dosis a mitad de tratamiento)', () => {
  const versions: DoseScheduleVersion[] = [
    { id: 'v1', dosePerIntake: 1, times: ['08:00'], effectiveFrom: day('2026-01-01'), effectiveTo: day('2026-01-10') },
    { id: 'v2', dosePerIntake: 0.5, times: ['08:00', '20:00'], effectiveFrom: day('2026-01-11'), effectiveTo: null },
  ];

  it('picks the version whose range covers the day, never both', () => {
    expect(activeVersionOnDate(versions, day('2026-01-05'))?.id).toBe('v1');
    expect(activeVersionOnDate(versions, day('2026-01-10'))?.id).toBe('v1');
    expect(activeVersionOnDate(versions, day('2026-01-11'))?.id).toBe('v2');
    expect(activeVersionOnDate(versions, day('2026-02-01'))?.id).toBe('v2');
  });

  it('returns null for a day before the treatment started', () => {
    expect(activeVersionOnDate(versions, day('2025-12-31'))).toBeNull();
  });
});

describe('materializeOccurrences', () => {
  it('generates one occurrence per time-of-day, per covered calendar day (case 3)', () => {
    const versions: DoseScheduleVersion[] = [
      { id: 'v1', dosePerIntake: 0.5, times: ['08:00', '14:00', '20:00'], effectiveFrom: day('2026-01-01'), effectiveTo: null },
    ];
    const occurrences = materializeOccurrences(versions, day('2026-01-01'), day('2026-01-02'), TZ);
    expect(occurrences).toHaveLength(6);
    expect(occurrences.every((o) => o.doseScheduleId === 'v1' && o.nominalQuantity === 0.5)).toBe(true);
  });

  it('switches version mid-window without generating overlapping or duplicate occurrences (case 2)', () => {
    const versions: DoseScheduleVersion[] = [
      { id: 'v1', dosePerIntake: 1, times: ['08:00'], effectiveFrom: day('2026-01-01'), effectiveTo: day('2026-01-01') },
      { id: 'v2', dosePerIntake: 2, times: ['08:00'], effectiveFrom: day('2026-01-02'), effectiveTo: null },
    ];
    const occurrences = materializeOccurrences(versions, day('2026-01-01'), day('2026-01-02'), TZ);
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0]).toMatchObject({ doseScheduleId: 'v1', nominalQuantity: 1 });
    expect(occurrences[1]).toMatchObject({ doseScheduleId: 'v2', nominalQuantity: 2 });
  });

  it('skips days with no active version instead of throwing', () => {
    const versions: DoseScheduleVersion[] = [
      { id: 'v1', dosePerIntake: 1, times: ['08:00'], effectiveFrom: day('2026-01-05'), effectiveTo: null },
    ];
    const occurrences = materializeOccurrences(versions, day('2026-01-01'), day('2026-01-05'), TZ);
    expect(occurrences).toHaveLength(1);
  });

  it('rejects an inverted date range', () => {
    expect(() => materializeOccurrences([], day('2026-01-05'), day('2026-01-01'), TZ)).toThrow(DoseScheduleInputError);
  });
});

describe('materializeOccurrences: daily mode, precomputed hourly intervals', () => {
  it.each([
    ['cada 4 horas', ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'], 6],
    ['cada 6 horas', ['00:00', '06:00', '12:00', '18:00'], 4],
    ['cada 8 horas', ['00:00', '08:00', '16:00'], 3],
    ['cada 12 horas', ['08:00', '20:00'], 2],
    ['cada 24 horas', ['08:00'], 1],
  ])('%s: one occurrence per listed time, for a single day', (_label, times, expectedPerDay) => {
    const versions: DoseScheduleVersion[] = [
      { id: 'v1', dosePerIntake: 1, times, frequencyType: 'daily', effectiveFrom: day('2026-11-04'), effectiveTo: day('2026-11-04') },
    ];
    const occurrences = materializeOccurrences(versions, day('2026-11-04'), day('2026-11-04'), TZ);
    expect(occurrences).toHaveLength(expectedPerDay);
  });
});

describe('materializeOccurrences: interval mode', () => {
  it('a custom hourly interval that does not divide 24 steps from the anchor, not from calendar-day boundaries', () => {
    const anchor = zonedTimeToUtc(day('2026-11-04'), '08:00', TZ);
    const versions: DoseScheduleVersion[] = [
      { id: 'v1', dosePerIntake: 1, times: [], frequencyType: 'interval', intervalHours: 5, anchorAt: anchor, effectiveFrom: day('2026-11-04'), effectiveTo: null },
    ];
    const occurrences = materializeOccurrences(versions, day('2026-11-04'), day('2026-11-05'), TZ);
    expect(occurrences[0]!.scheduledFor.getTime()).toBe(anchor.getTime());
    const times = occurrences.map((o) => o.scheduledFor.getTime());
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]! - times[i - 1]!).toBe(5 * 3_600_000);
    }
    expect(occurrences).toHaveLength(8); // Nov4 12/17/22h + Nov5 03/08/13/18/23h UTC
    const windowEndExclusive = zonedTimeToUtc(day('2026-11-06'), '00:00', TZ).getTime();
    expect(times.every((t) => t < windowEndExclusive)).toBe(true);
  });

  it('every 30 days (e.g. Meticobal) produces one occurrence every 30 days from the anchor, at a fixed hour', () => {
    const anchor = zonedTimeToUtc(day('2026-01-01'), '08:00', TZ);
    const versions: DoseScheduleVersion[] = [
      { id: 'v1', dosePerIntake: 1, times: [], frequencyType: 'interval', intervalHours: 24 * 30, anchorAt: anchor, effectiveFrom: day('2026-01-01'), effectiveTo: null },
    ];
    const occurrences = materializeOccurrences(versions, day('2026-01-01'), day('2026-01-31'), TZ);
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0]!.scheduledFor.getTime()).toBe(anchor.getTime());
    expect(occurrences[1]!.scheduledFor.getTime() - occurrences[0]!.scheduledFor.getTime()).toBe(30 * 24 * 3_600_000);
  });

  it('respects the organization timezone when clipping the generation window', () => {
    // 05:00Z sits inside "Jan 1" for Santo Domingo (local midnight = 04:00Z) but
    // before "Jan 1" starts for Honolulu (local midnight = 10:00Z) - so the same
    // single-day window picks up a different occurrence of this 24h series
    // depending on the org timezone, even though the anchor instant is fixed.
    const anchor = new Date('2026-01-01T05:00:00.000Z');
    const versions: DoseScheduleVersion[] = [
      { id: 'v1', dosePerIntake: 1, times: [], frequencyType: 'interval', intervalHours: 24, anchorAt: anchor, effectiveFrom: day('2026-01-01'), effectiveTo: null },
    ];
    const inSantoDomingo = materializeOccurrences(versions, day('2026-01-01'), day('2026-01-01'), TZ);
    const inHonolulu = materializeOccurrences(versions, day('2026-01-01'), day('2026-01-01'), 'Pacific/Honolulu');
    expect(inSantoDomingo).toHaveLength(1);
    expect(inHonolulu).toHaveLength(1);
    expect(inSantoDomingo[0]!.scheduledFor.toISOString()).toBe('2026-01-01T05:00:00.000Z');
    expect(inHonolulu[0]!.scheduledFor.toISOString()).toBe('2026-01-02T05:00:00.000Z');
  });

  it('crosses a month and year boundary without gaps or duplicates', () => {
    const anchor = zonedTimeToUtc(day('2025-12-30'), '08:00', TZ);
    const versions: DoseScheduleVersion[] = [
      { id: 'v1', dosePerIntake: 1, times: [], frequencyType: 'interval', intervalHours: 24, anchorAt: anchor, effectiveFrom: day('2025-12-30'), effectiveTo: null },
    ];
    const occurrences = materializeOccurrences(versions, day('2025-12-30'), day('2026-01-02'), TZ);
    expect(occurrences).toHaveLength(4);
    const uniqueInstants = new Set(occurrences.map((o) => o.scheduledFor.getTime()));
    expect(uniqueInstants.size).toBe(4);
  });
});

describe('materializeOccurrences: weekly mode', () => {
  it('applies times only on the selected weekday (one day, one time)', () => {
    const start = day('2026-01-01');
    const weekday = start.getUTCDay();
    const versions: DoseScheduleVersion[] = [
      { id: 'v1', dosePerIntake: 2, times: ['10:00'], frequencyType: 'weekly', weekdays: [weekday], effectiveFrom: start, effectiveTo: null },
    ];
    // A 7-day window contains exactly one day matching `weekday` (the start day itself).
    const occurrences = materializeOccurrences(versions, start, day('2026-01-07'), TZ);
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.scheduledFor.getTime()).toBe(zonedTimeToUtc(start, '10:00', TZ).getTime());
  });

  it('supports several selected weekdays and several times per matching day', () => {
    const start = day('2026-01-01');
    const weekday = start.getUTCDay();
    const otherWeekday = (weekday + 3) % 7;
    const versions: DoseScheduleVersion[] = [
      { id: 'v1', dosePerIntake: 2, times: ['08:00', '20:00'], frequencyType: 'weekly', weekdays: [weekday, otherWeekday], effectiveFrom: start, effectiveTo: null },
    ];
    const occurrences = materializeOccurrences(versions, start, day('2026-01-07'), TZ);
    // 2 matching days in the 7-day window (start day + start+3) * 2 times each.
    expect(occurrences).toHaveLength(4);
  });
});

describe('materializeOccurrences: monthly mode', () => {
  const monthly = (monthdays: number[], times = ['08:00']): DoseScheduleVersion[] => [
    { id: 'v1', dosePerIntake: 1, times, frequencyType: 'monthly', monthdays, effectiveFrom: day('2026-01-01'), effectiveTo: null },
  ];
  const localDays = (versions: DoseScheduleVersion[], from: string, to: string) =>
    materializeOccurrences(versions, day(from), day(to), TZ).map((o) => o.scheduledFor.toISOString().slice(0, 10));

  it('applies times only on the selected days of the month (5, 10 and 20)', () => {
    expect(localDays(monthly([5, 10, 20]), '2026-01-01', '2026-02-28')).toEqual([
      '2026-01-05', '2026-01-10', '2026-01-20', '2026-02-05', '2026-02-10', '2026-02-20',
    ]);
  });

  it('generates every time on each selected day', () => {
    expect(materializeOccurrences(monthly([5], ['08:00', '20:00']), day('2026-01-01'), day('2026-01-31'), TZ)).toHaveLength(2);
  });

  it('a day the month lacks falls on that month\'s last day, once, without duplicates', () => {
    expect(localDays(monthly([29, 30, 31]), '2026-02-01', '2026-02-28')).toEqual(['2026-02-28']);
    expect(localDays(monthly([31]), '2026-04-01', '2026-04-30')).toEqual(['2026-04-30']);
    expect(localDays(monthly([31]), '2026-01-01', '2026-01-31')).toEqual(['2026-01-31']);
  });
});

describe('materializeOccurrences: treatments with and without an end date', () => {
  it('stops generating past effectiveTo when the schedule has one', () => {
    const versions: DoseScheduleVersion[] = [
      { id: 'v1', dosePerIntake: 1, times: ['08:00'], frequencyType: 'daily', effectiveFrom: day('2026-01-01'), effectiveTo: day('2026-01-03') },
    ];
    const occurrences = materializeOccurrences(versions, day('2026-01-01'), day('2026-01-10'), TZ);
    expect(occurrences).toHaveLength(3);
  });

  it('keeps generating indefinitely when effectiveTo is null', () => {
    const versions: DoseScheduleVersion[] = [
      { id: 'v1', dosePerIntake: 1, times: ['08:00'], frequencyType: 'daily', effectiveFrom: day('2026-01-01'), effectiveTo: null },
    ];
    const occurrences = materializeOccurrences(versions, day('2026-01-01'), day('2026-01-10'), TZ);
    expect(occurrences).toHaveLength(10);
  });
});

describe('materializeOccurrences: changing frequency mid-treatment', () => {
  it('a new version (even of a different frequency type) never regenerates occurrences for the closed version', () => {
    const v2Anchor = zonedTimeToUtc(day('2026-01-06'), '08:00', TZ);
    const versions: DoseScheduleVersion[] = [
      { id: 'v1', dosePerIntake: 1, times: ['08:00'], frequencyType: 'daily', effectiveFrom: day('2026-01-01'), effectiveTo: day('2026-01-05') },
      { id: 'v2', dosePerIntake: 2, times: [], frequencyType: 'interval', intervalHours: 24, anchorAt: v2Anchor, effectiveFrom: day('2026-01-06'), effectiveTo: null },
    ];
    const occurrences = materializeOccurrences(versions, day('2026-01-01'), day('2026-01-10'), TZ);
    expect(occurrences).toHaveLength(10);
    const fromV1 = occurrences.filter((o) => o.doseScheduleId === 'v1');
    const fromV2 = occurrences.filter((o) => o.doseScheduleId === 'v2');
    expect(fromV1).toHaveLength(5);
    expect(fromV2).toHaveLength(5);
    const allInstants = occurrences.map((o) => o.scheduledFor.getTime());
    expect(new Set(allInstants).size).toBe(allInstants.length); // no duplicates across the version switch
  });

  it('is idempotent: materializing the same window twice yields identical occurrences (safe for skipDuplicates re-runs)', () => {
    const versions: DoseScheduleVersion[] = [
      { id: 'v1', dosePerIntake: 1, times: ['08:00', '20:00'], frequencyType: 'daily', effectiveFrom: day('2026-01-01'), effectiveTo: null },
    ];
    const first = materializeOccurrences(versions, day('2026-01-01'), day('2026-01-05'), TZ);
    const second = materializeOccurrences(versions, day('2026-01-01'), day('2026-01-05'), TZ);
    expect(first.map((o) => o.scheduledFor.getTime())).toEqual(second.map((o) => o.scheduledFor.getTime()));
  });
});

describe('equivalentIntakesPerDay', () => {
  it('daily: one intake per listed time, unaffected by this change (backward compatible)', () => {
    expect(equivalentIntakesPerDay({ frequencyType: 'daily', times: ['08:00', '14:00', '20:00'] })).toBe(3);
  });

  it('defaults to daily when frequencyType is absent, for versions created before this field existed', () => {
    expect(equivalentIntakesPerDay({ times: ['08:00', '20:00'] })).toBe(2);
  });

  it('interval: 24 / intervalHours', () => {
    expect(equivalentIntakesPerDay({ frequencyType: 'interval', times: [], intervalHours: 8 })).toBe(3);
    expect(equivalentIntakesPerDay({ frequencyType: 'interval', times: [], intervalHours: 24 * 30 })).toBeCloseTo(1 / 30, 6);
  });

  it('weekly: (times.length * weekdays.length) / 7', () => {
    expect(equivalentIntakesPerDay({ frequencyType: 'weekly', times: ['10:00'], weekdays: [4] })).toBeCloseTo(1 / 7, 6);
    expect(equivalentIntakesPerDay({ frequencyType: 'weekly', times: ['08:00', '20:00'], weekdays: [1, 4] })).toBeCloseTo(4 / 7, 6);
  });

  it('monthly: (times.length * monthdays.length) / average days per month', () => {
    expect(equivalentIntakesPerDay({ frequencyType: 'monthly', times: ['08:00'], monthdays: [5, 10, 20] })).toBeCloseTo(3 / 30.4375, 6);
  });
});
