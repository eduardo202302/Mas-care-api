import { describe, expect, it } from 'vitest';
import {
  actualRatePerDay,
  currentBalance,
  daysRemainingReal,
  isBelowThreshold,
  type TakenDoseLog,
} from '../src/domain/inventory.js';

const at = (value: string) => new Date(value);
const now = at('2026-01-15T00:00:00.000Z');

describe('currentBalance', () => {
  it('sums every ledger delta regardless of origin (case 5: compras parciales)', () => {
    expect(currentBalance([{ quantityDelta: 30 }, { quantityDelta: -1 }, { quantityDelta: 2.5 }])).toBe(31.5);
  });

  it('reflects a manual negative adjustment, e.g. discarding expired stock (case 6)', () => {
    expect(currentBalance([{ quantityDelta: 10 }, { quantityDelta: -10 }])).toBe(0);
  });

  it('a reversal entry cancels its original without the original ever being removed (case 8)', () => {
    const ledger = [{ quantityDelta: 20 }, { quantityDelta: -0.5 }, { quantityDelta: 0.5 }];
    expect(currentBalance(ledger)).toBe(20);
    expect(ledger).toHaveLength(3);
  });
});

describe('actualRatePerDay', () => {
  it('falls back to the scheduled rate with zero taken doses', () => {
    expect(actualRatePerDay([], now, 2)).toEqual({ ratePerDay: 2, source: 'scheduled' });
  });

  it('uses actualQuantity over nominalQuantity for split pills (case 4)', () => {
    const logs: TakenDoseLog[] = [
      { scheduledFor: at('2026-01-14T12:00:00.000Z'), nominalQuantity: 1, actualQuantity: 0.5 },
      { scheduledFor: at('2026-01-13T12:00:00.000Z'), nominalQuantity: 1, actualQuantity: 0.5 },
    ];
    // Below the 3-log window threshold: falls back to "all available", span-based denominator.
    // Earliest log is Jan 13 12:00Z, now is Jan 15 00:00Z: a 1.5-day span.
    const result = actualRatePerDay(logs, now, 2);
    expect(result.source).toBe('actual');
    expect(result.ratePerDay).toBeCloseTo(1 / 1.5, 5); // 1 unit total over a 1.5-day span
  });

  it('uses the 14-day window once at least 3 taken doses fall inside it', () => {
    const logs: TakenDoseLog[] = [
      { scheduledFor: at('2026-01-14T00:00:00.000Z'), nominalQuantity: 1, actualQuantity: null },
      { scheduledFor: at('2026-01-13T00:00:00.000Z'), nominalQuantity: 1, actualQuantity: null },
      { scheduledFor: at('2026-01-12T00:00:00.000Z'), nominalQuantity: 1, actualQuantity: null },
    ];
    const result = actualRatePerDay(logs, now, 2);
    expect(result).toEqual({ ratePerDay: 3 / 14, source: 'actual' });
  });

  it('ignores taken doses scheduled after "now"', () => {
    const logs: TakenDoseLog[] = [{ scheduledFor: at('2026-02-01T00:00:00.000Z'), nominalQuantity: 1, actualQuantity: null }];
    expect(actualRatePerDay(logs, now, 2)).toEqual({ ratePerDay: 2, source: 'scheduled' });
  });
});

describe('daysRemainingReal', () => {
  it('floors partial days', () => {
    expect(daysRemainingReal(10, 3)).toBe(3);
  });

  it('returns 0 for an empty or negative balance', () => {
    expect(daysRemainingReal(0, 2)).toBe(0);
    expect(daysRemainingReal(-1, 2)).toBe(0);
  });

  it('returns null for a non-positive rate instead of Infinity', () => {
    expect(daysRemainingReal(10, 0)).toBeNull();
    expect(daysRemainingReal(10, -1)).toBeNull();
  });
});

describe('isBelowThreshold', () => {
  it('is false with no threshold configured', () => {
    expect(isBelowThreshold(1, null)).toBe(false);
  });

  it('treats touching the threshold exactly as low', () => {
    expect(isBelowThreshold(5, 5)).toBe(true);
    expect(isBelowThreshold(6, 5)).toBe(false);
    expect(isBelowThreshold(4, 5)).toBe(true);
  });
});
