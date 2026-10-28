import { describe, expect, it } from 'vitest';
import {
  CoverageInputError,
  addDays,
  calculateCoverageEndOn,
  daysBetween,
  daysCovered,
  daysRemaining,
  deriveCoverage,
  deriveStatus,
  prescriptionFlag,
  toDateOnly,
  unitsPerDay,
  type CoverageCycle,
  type CoverageSettings,
  type CoverageTreatment,
} from '../src/domain/coverage.js';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const settings: CoverageSettings = { dueSoonDays: 3, upcomingDays: 7, prescriptionWarningDays: 15 };
const today = day('2026-01-01');

const treatment = (overrides: Partial<CoverageTreatment> = {}): CoverageTreatment => ({
  status: 'active',
  startDate: day('2026-01-01'),
  quantityPerCycle: 10,
  dosePerIntake: 0.5,
  intakesPerDay: 2,
  coverageEndOn: day('2026-01-11'),
  coverageManuallyAdjusted: false,
  prescriptionExpiresOn: null,
  ...overrides,
});

describe('coverage units and rounding', () => {
  it('supports half-tablet doses', () => {
    expect(unitsPerDay(0.5, 2)).toBe(1);
    expect(daysCovered(10, unitsPerDay(0.5, 2))).toBe(10);
  });

  it('supports weekly schedules with fractional intakes per day', () => {
    const units = unitsPerDay(1, 1 / 7);
    expect(units).toBeCloseTo(1 / 7, 12);
    expect(daysCovered(4, units)).toBe(28);
  });

  it('floors partial days and ignores binary floating-point noise', () => {
    expect(daysCovered(10, 3)).toBe(3);
    expect(daysCovered(0.3, 0.1)).toBe(3);
    expect(daysCovered(29, 1 / 7)).toBe(203);
  });

  it('rejects non-positive dose, intakes or quantity', () => {
    expect(() => unitsPerDay(0, 2)).toThrow(CoverageInputError);
    expect(() => unitsPerDay(1, -2)).toThrow(CoverageInputError);
    expect(() => daysCovered(0, 1)).toThrow(CoverageInputError);
    expect(() => daysCovered(10, 0)).toThrow(CoverageInputError);
    expect(() => calculateCoverageEndOn({ startDate: today, quantityPerCycle: -1, dosePerIntake: 1, intakesPerDay: 1 })).toThrow(CoverageInputError);
  });
});

describe('coverage_end_on calculation', () => {
  it('uses the start date and initial quantity when there are no deliveries', () => {
    const end = calculateCoverageEndOn({
      startDate: day('2026-01-01'),
      quantityPerCycle: 10,
      dosePerIntake: 0.5,
      intakesPerDay: 2,
    });
    expect(end.toISOString().slice(0, 10)).toBe('2026-01-11');
  });

  it('restarts from the last delivery and its delivered quantity', () => {
    const end = calculateCoverageEndOn({
      startDate: day('2026-01-01'),
      quantityPerCycle: 10,
      dosePerIntake: 1,
      intakesPerDay: 1,
      lastDeliveryOn: day('2026-01-05'),
      lastDeliveryQuantity: 14,
    });
    expect(end.toISOString().slice(0, 10)).toBe('2026-01-19');
    expect(daysBetween(day('2026-01-05'), end)).toBe(14);
  });

  it('respects a manual coverage adjustment', () => {
    const end = calculateCoverageEndOn({
      startDate: day('2026-01-01'),
      quantityPerCycle: 10,
      dosePerIntake: 1,
      intakesPerDay: 1,
      lastDeliveryOn: day('2026-01-05'),
      lastDeliveryQuantity: 14,
      coverageEndOn: day('2026-02-01'),
      coverageManuallyAdjusted: true,
    });
    expect(end.toISOString().slice(0, 10)).toBe('2026-02-01');
  });

  it('normalizes dates to UTC midnight', () => {
    const value = toDateOnly(new Date('2026-01-01T23:45:00.000-05:00'));
    expect(value.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });
});

describe('derived status precedence', () => {
  it('is vencido the day after coverage ends', () => {
    expect(deriveStatus(treatment({ coverageEndOn: day('2026-01-01') }), null, today, settings)).toBe('vence_pronto');
    expect(deriveStatus(treatment({ coverageEndOn: day('2025-12-31') }), null, today, settings)).toBe('vencido');
  });

  it('treats an exact end date of today as due soon, not expired', () => {
    const value = treatment({ coverageEndOn: day('2026-01-01') });
    expect(daysRemaining(value, today)).toBe(0);
    expect(deriveStatus(value, null, today, settings)).toBe('vence_pronto');
  });

  it('honors every boundary of the 3-day and 7-day thresholds', () => {
    const at = (date: string) => deriveStatus(treatment({ coverageEndOn: day(date) }), null, today, settings);
    expect(at('2026-01-04')).toBe('vence_pronto');
    expect(at('2026-01-05')).toBe('proxima_reposicion');
    expect(at('2026-01-08')).toBe('proxima_reposicion');
    expect(at('2026-01-09')).toBe('al_dia');
  });

  it('changes status when settings thresholds change', () => {
    const value = treatment({ coverageEndOn: day('2026-01-05') });
    expect(deriveStatus(value, null, today, settings)).toBe('proxima_reposicion');
    expect(deriveStatus(value, null, today, { ...settings, dueSoonDays: 5 })).toBe('vence_pronto');
  });

  it('reports retiro_pendiente for a prepared cycle only when it has no deliveries', () => {
    const value = treatment({ coverageEndOn: day('2026-01-08') });
    const prepared: CoverageCycle = { status: 'prepared', hasDelivery: false };
    expect(deriveStatus(value, prepared, today, settings)).toBe('retiro_pendiente');
    expect(deriveStatus(value, { status: 'prepared', hasDelivery: true }, today, settings)).toBe('proxima_reposicion');
  });

  it('prioritizes expired and due-soon over a pending pickup', () => {
    const prepared: CoverageCycle = { status: 'prepared', hasDelivery: false };
    expect(deriveStatus(treatment({ coverageEndOn: day('2025-12-30') }), prepared, today, settings)).toBe('vencido');
    expect(deriveStatus(treatment({ coverageEndOn: day('2026-01-03') }), prepared, today, settings)).toBe('vence_pronto');
  });

  it('does not derive a status for paused or finished treatments', () => {
    expect(deriveStatus(treatment({ status: 'paused' }), null, today, settings)).toBeNull();
    expect(deriveStatus(treatment({ status: 'finished' }), null, today, settings)).toBeNull();
    expect(deriveCoverage(treatment({ status: 'paused' }), null, today, settings)).toEqual({
      status: null,
      daysRemaining: null,
      prescriptionFlag: false,
    });
  });

  it('uses the stored coverage end for manually adjusted treatments', () => {
    const value = treatment({
      coverageEndOn: day('2026-02-01'),
      coverageManuallyAdjusted: true,
    });
    expect(deriveStatus(value, null, today, settings)).toBe('al_dia');
    expect(daysRemaining(value, today)).toBe(31);
  });
});

describe('prescription warning', () => {
  it('flags the exact warning boundary and not the next day', () => {
    expect(prescriptionFlag(treatment({ prescriptionExpiresOn: addDays(today, 15) }), today, settings)).toBe(true);
    expect(prescriptionFlag(treatment({ prescriptionExpiresOn: addDays(today, 16) }), today, settings)).toBe(false);
  });

  it('is independent from the coverage status', () => {
    const value = treatment({ coverageEndOn: day('2026-03-01'), prescriptionExpiresOn: addDays(today, 2) });
    expect(deriveCoverage(value, null, today, settings)).toMatchObject({
      status: 'al_dia',
      prescriptionFlag: true,
    });
  });

  it('is false without a prescription date, for finished treatments and when disabled', () => {
    expect(prescriptionFlag(treatment(), today, settings)).toBe(false);
    expect(prescriptionFlag(treatment({ status: 'finished', prescriptionExpiresOn: addDays(today, 1) }), today, settings)).toBe(false);
    expect(prescriptionFlag(treatment({ prescriptionExpiresOn: addDays(today, 30) }), today, { ...settings, prescriptionWarningDays: 0 })).toBe(false);
  });
});
