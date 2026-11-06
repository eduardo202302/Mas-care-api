import { z } from 'zod';

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Hora inválida, usa HH:mm');
const isoDate = z.string().date();
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
export const skipReasonCode = z.enum(['patient_unavailable', 'side_effects', 'out_of_stock', 'medical_decision', 'other']);
export const doseFrequencyType = z.enum(['daily', 'interval', 'weekly', 'monthly']);

const commaList = <T extends z.ZodTypeAny>(item: T) =>
  z.string().trim().optional()
    .transform((value) => (value ? value.split(',').map((part) => part.trim()).filter(Boolean) : []))
    .pipe(z.array(item));

export const doseLogParams = z.object({ id: z.string().min(1), doseLogId: z.string().min(1) });
export const doseScheduleParams = z.object({ id: z.string().min(1), doseScheduleId: z.string().min(1) });

/**
 * A multipart/form-data body: fields arrive as text, `times`/`weekdays` as
 * comma-separated strings, and `authorization_document` (when present) as a
 * file field handled separately by multer before this schema sees req.body.
 * `authorized_by`/`authorization_note` are required by the router (not
 * here) only when the treatment already has an active DoseSchedule - the
 * very first schedule of a treatment needs no medical authorization.
 *
 * `frequency_type` picks which of `times`/`interval_hours`+`anchor_at`/
 * `weekdays` is required, enforced below by `.refine()` instead of a zod
 * discriminated union because every field still arrives as a flat string
 * from multipart form-data: `daily` needs `times`; `interval` needs
 * `interval_hours` + `anchor_at` (an ISO instant, e.g. new
 * Date(...).toISOString()); `weekly` needs `times` + `weekdays` (0=domingo..
 * 6=sábado); `monthly` needs `times` + `monthdays` (1-31).
 */
export const doseScheduleCreateInput = z.object({
  dose_per_intake: z.coerce.number().positive().max(99999.999),
  frequency_type: doseFrequencyType.default('daily'),
  times: commaList(timeOfDay),
  interval_hours: z.coerce.number().int().positive().max(8760).optional(),
  anchor_at: z.string().datetime().optional(),
  weekdays: commaList(z.coerce.number().int().min(0, 'Día de semana inválido').max(6, 'Día de semana inválido')),
  monthdays: commaList(z.coerce.number().int().min(1, 'Día del mes inválido').max(31, 'Día del mes inválido')),
  effective_from: isoDate,
  reason: optionalText(1000),
  authorized_by: optionalText(160),
  authorization_note: optionalText(2000),
}).strict()
  .refine((value) => value.frequency_type !== 'daily' || value.times.length > 0, { message: 'Define al menos un horario', path: ['times'] })
  .refine((value) => value.frequency_type !== 'weekly' || value.times.length > 0, { message: 'Define al menos un horario', path: ['times'] })
  .refine((value) => value.frequency_type !== 'weekly' || value.weekdays.length > 0, { message: 'Selecciona al menos un día de la semana', path: ['weekdays'] })
  .refine((value) => value.frequency_type !== 'monthly' || value.times.length > 0, { message: 'Define al menos un horario', path: ['times'] })
  .refine((value) => value.frequency_type !== 'monthly' || value.monthdays.length > 0, { message: 'Selecciona al menos un día del mes', path: ['monthdays'] })
  .refine((value) => value.frequency_type !== 'interval' || value.interval_hours !== undefined, { message: 'Define el intervalo en horas', path: ['interval_hours'] })
  .refine((value) => value.frequency_type !== 'interval' || value.anchor_at !== undefined, { message: 'Define la fecha y hora de inicio del intervalo', path: ['anchor_at'] });

export const doseTakeInput = z.object({
  actual_quantity: z.coerce.number().positive().max(99999.999).nullable().optional(),
}).strict();

export const doseSkipInput = z.object({
  skip_reason_code: skipReasonCode,
  skip_reason_note: optionalText(2000),
}).strict()
  .refine((value) => value.skip_reason_code !== 'other' || Boolean(value.skip_reason_note), {
    message: 'skip_reason_note es obligatorio cuando el motivo es "other"',
    path: ['skip_reason_note'],
  });

export const doseRescheduleInput = z.object({
  rescheduled_for: z.string().datetime(),
}).strict();

export const doseCorrectInput = z.object({
  correction_note: z.string().trim().min(1, 'Explica por qué se corrige este registro').max(2000),
}).strict();
