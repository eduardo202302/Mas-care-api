import { describe, expect, it } from 'vitest';
import { frequencyColumns } from '../src/modules/label-templates/variables.js';
import { labelTemplateCreate, labelVariableKey } from '../src/schemas/label-template.js';

const schedule = (overrides: Partial<Parameters<typeof frequencyColumns>[0]> = {}) => ({
  frequencyType: 'daily' as const,
  times: [] as string[],
  intervalHours: null,
  weekdays: [] as number[],
  monthdays: [] as number[],
  ...overrides,
});

describe('label variables: frequencyColumns', () => {
  it('describes fixed daily times in 12-hour format', () => {
    expect(frequencyColumns(schedule({ times: ['08:00', '20:30'] }))).toEqual({
      frequency: 'Diario',
      whenToTake: '8:00 AM, 8:30 PM',
    });
  });

  it('treats evenly spaced daily times as "every N hours"', () => {
    expect(frequencyColumns(schedule({ times: ['00:00', '08:00', '16:00'] }))).toEqual({
      frequency: 'Cada 8 horas',
      whenToTake: 'Según inicio',
    });
  });

  it('describes hour and day intervals', () => {
    expect(frequencyColumns(schedule({ frequencyType: 'interval', intervalHours: 12 })).frequency).toBe('Cada 12 horas');
    expect(frequencyColumns(schedule({ frequencyType: 'interval', intervalHours: 48 })).frequency).toBe('Cada 2 días');
  });

  it('shows the start time of a day interval in the organization time zone', () => {
    const anchorAt = new Date('2026-11-11T16:55:00.000Z');
    const columns = frequencyColumns(schedule({ frequencyType: 'interval', intervalHours: 72, anchorAt }), 'America/Santo_Domingo');
    expect(columns).toEqual({ frequency: 'Cada 3 días', whenToTake: '12:55 PM' });
  });

  it('describes weekly and monthly schedules', () => {
    expect(frequencyColumns(schedule({ frequencyType: 'weekly', weekdays: [3, 1], times: ['09:00'] }))).toEqual({
      frequency: 'Todos los Lunes, Miércoles',
      whenToTake: '9:00 AM',
    });
    expect(frequencyColumns(schedule({ frequencyType: 'monthly', monthdays: [15, 1], times: ['21:00'] }))).toEqual({
      frequency: 'Los días 1, 15 de cada mes',
      whenToTake: '9:00 PM',
    });
  });
});

describe('label template schemas', () => {
  const base = { name: 'Etiqueta', orientation: 'landscape', elements: [] };

  it('stores sizes in inches', () => {
    expect(labelTemplateCreate.safeParse({ ...base, width_in: 3, height_in: 3 }).success).toBe(true);
    expect(labelTemplateCreate.safeParse({ ...base, width_mm: 100, height_mm: 60 }).success).toBe(false);
  });

  it('accepts the new patient phone and schedule variables', () => {
    expect(labelVariableKey.safeParse('paciente_telefono').success).toBe(true);
    expect(labelVariableKey.safeParse('horario').success).toBe(true);
  });

  it('keeps references to variables, never patient values, inside elements', () => {
    const parsed = labelTemplateCreate.parse({
      ...base,
      width_in: 4,
      height_in: 4,
      elements: [{
        id: 1, type: 'variable', key: 'paciente_nombre', showLabel: true,
        x: 10, y: 10, w: 80, h: 18,
      }],
    });
    expect(JSON.stringify(parsed.elements)).toContain('paciente_nombre');
  });
});
