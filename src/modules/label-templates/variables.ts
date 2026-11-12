import type { Prisma } from '@prisma/client';
import { ApiError } from '../../infra/errors.js';
import { findAccessiblePatient, type PatientTenant } from '../../infra/patient-access.js';
import { effectiveSettings } from '../../jobs/shared.js';
import type { LabelVariableKey } from '../../schemas/label-template.js';

export type LabelValues = Record<LabelVariableKey, string>;

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

type ScheduleLike = {
  frequencyType: 'daily' | 'interval' | 'weekly' | 'monthly';
  times: string[];
  intervalHours: number | null;
  anchorAt?: Date | null;
  weekdays: number[];
  monthdays: number[];
};

/** Clock time of an instant in the organization's time zone, e.g. "12:55 PM". */
const anchorTime = (anchorAt: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(anchorAt);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '00';
  return to12Hour(`${part('hour')}:${part('minute')}`);
};

const to12Hour = (time: string) => {
  const [hourText = '0', minute = '00'] = time.split(':');
  const hour = Number(hourText);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
};

const isEvenlySpacedDaily = (times: string[]) => {
  if (times.length < 2) return false;
  const minutes = times
    .map((time) => { const [h, m] = time.split(':'); return Number(h) * 60 + Number(m); })
    .sort((a, b) => a - b);
  const step = 1440 / minutes.length;
  return minutes.every((value, index) => value === (minutes[0]! + index * step) % 1440);
};

/** Same wording as the web app's `frequencyColumns`, so a label reads like the treatment screen. */
export function frequencyColumns(
  schedule: ScheduleLike,
  timezone = 'America/Santo_Domingo',
): { frequency: string; whenToTake: string } {
  const times = schedule.times.map(to12Hour).join(', ') || '—';
  if (schedule.frequencyType === 'interval') {
    const hours = schedule.intervalHours ?? 0;
    if (hours > 0 && hours % 24 === 0) {
      const days = hours / 24;
      return {
        frequency: `Cada ${days} ${days === 1 ? 'día' : 'días'}`,
        whenToTake: schedule.anchorAt ? anchorTime(schedule.anchorAt, timezone) : 'Según inicio',
      };
    }
    return { frequency: `Cada ${hours} ${hours === 1 ? 'hora' : 'horas'}`, whenToTake: 'Según inicio' };
  }
  if (schedule.frequencyType === 'weekly') {
    const days = [...schedule.weekdays].sort((a, b) => a - b).map((day) => WEEKDAYS[day]).join(', ');
    return { frequency: days ? `Todos los ${days}` : 'Días específicos', whenToTake: times };
  }
  if (schedule.frequencyType === 'monthly') {
    const days = [...schedule.monthdays].sort((a, b) => a - b).join(', ');
    return { frequency: days ? `Los días ${days} de cada mes` : 'Días específicos', whenToTake: times };
  }
  if (!schedule.times.length) return { frequency: 'Diario', whenToTake: 'Según indicación' };
  if (isEvenlySpacedDaily(schedule.times)) {
    const hours = 24 / schedule.times.length;
    return { frequency: `Cada ${hours} ${hours === 1 ? 'hora' : 'horas'}`, whenToTake: 'Según inicio' };
  }
  return { frequency: 'Diario', whenToTake: times };
}

const formatDate = (date: Date | null | undefined) => {
  if (!date) return '';
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getUTCFullYear()}`;
};

const formatAddress = (details: unknown, fallback: string | null) => {
  const record = (details && typeof details === 'object' ? details : {}) as Record<string, unknown>;
  const parts = ['address', 'sector', 'city']
    .map((key) => record[key])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '');
  return parts.length ? parts.join(', ') : fallback ?? '';
};

/**
 * Resolves every label variable for a real patient and (optionally) one of their
 * treatments. Values never get stored in a template: templates only hold the
 * variable key, and this runs each time a label is previewed or printed.
 * A variable with no data available resolves to ''.
 */
export async function resolveLabelValues(
  tx: Prisma.TransactionClient,
  tenant: PatientTenant,
  input: { patientId: string; treatmentId?: string | undefined },
): Promise<LabelValues> {
  const patient = await findAccessiblePatient(tx, tenant, input.patientId);
  if (!patient) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
  const treatment = input.treatmentId
    ? await tx.treatment.findFirst({
        where: { id: input.treatmentId, patientId: patient.id, organizationId: tenant.organizationId },
      })
    : null;
  if (input.treatmentId && !treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');

  const [branch, organization, medication, prescriberDoctor, schedule] = await Promise.all([
    tx.branch.findFirst({ where: { id: treatment?.branchId ?? patient.primaryBranchId } }),
    tx.organization.findUnique({ where: { id: tenant.organizationId } }),
    treatment ? tx.medication.findFirst({ where: { id: treatment.medicationId } }) : null,
    treatment?.prescriberDoctorId ? tx.doctor.findFirst({ where: { id: treatment.prescriberDoctorId } }) : null,
    treatment
      ? tx.doseSchedule.findFirst({
          where: { treatmentId: treatment.id, effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
        })
      : null,
  ]);

  const age = patient.birthDate
    ? (() => {
        const years = Math.floor((Date.now() - patient.birthDate.getTime()) / 31557600000);
        return `${years} ${years === 1 ? 'año' : 'años'}`;
      })()
    : '';

  // Same source as the "Programación de Dosis" card: the active dose schedule.
  // The treatment's own dose/intakes columns are fixed placeholders, so without a schedule these stay empty.
  const unit = medication?.doseUnit?.trim() ?? '';
  const doseAmount = schedule ? `${Number(schedule.dosePerIntake)}` : '';
  let frequency = '';
  let timing = '';
  if (schedule) {
    const settings = treatment ? await effectiveSettings(tx, treatment.branchId) : null;
    ({ frequency, whenToTake: timing } = frequencyColumns(schedule, settings?.timezone ?? undefined));
  }
  let duration = '';
  if (treatment) {
    duration = treatment.endDate
      ? `${Math.max(1, Math.round((treatment.endDate.getTime() - treatment.startDate.getTime()) / 86400000))} días`
      : 'Indefinido';
  }

  return {
    farmacia_nombre: branch?.name ?? organization?.name ?? '',
    farmacia_telefono: branch?.phone ?? '',
    farmacia_direccion: formatAddress(branch?.addressDetails, branch?.description ?? null),
    paciente_nombre: patient.fullName,
    paciente_documento: patient.documentId ?? '',
    paciente_edad: age,
    paciente_telefono: patient.phone ?? '',
    tratamiento_nombre: treatment?.name ?? '',
    medicamento_nombre: medication
      ? medication.brandName ?? medication.genericName ?? medication.activeIngredient ?? medication.presentation
      : '',
    medicamento_presentacion: medication?.presentation ?? '',
    dosis: doseAmount && unit ? `${doseAmount} ${unit}` : doseAmount,
    programacion_dosis: schedule
      ? [
          ['Cantidad', doseAmount],
          ['Unidad', unit],
          ['Frecuencia', frequency],
          ['Toma', timing],
        ]
          .filter(([, value]) => value)
          .map(([label, value]) => `${label}: ${value}`)
          .join('\n')
      : '',
    dosis_cantidad: doseAmount,
    dosis_unidad: unit,
    via_administracion: '',
    frecuencia: frequency,
    horario: timing,
    duracion: duration,
    cantidad: treatment ? `${Number(treatment.quantityPerCycle)}` : '',
    instrucciones: treatment?.notes ?? '',
    fecha_inicio: formatDate(treatment?.startDate),
    fecha_fin: formatDate(treatment?.endDate),
    prescriptor: treatment
      ? treatment.prescriberName
        ?? (prescriberDoctor ? `${prescriberDoctor.firstName} ${prescriberDoctor.lastName}`.trim() : '')
      : '',
    codigo_tratamiento: treatment?.id ?? '',
  };
}
