import { z } from 'zod';

const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa el formato HH:mm');

export const automationSettingsQuery = z.object({
  branch_id: z.string().min(1).optional(),
}).strict();

export const automationSettingsPatch = z.object({
  branch_id: z.string().min(1).nullable().optional(),
  automation_enabled: z.boolean().optional(),
  automation_dry_run: z.boolean().optional(),
  timezone: z.string().min(1).max(64).optional(),
  notice_lead_days: z.coerce.number().int().min(0).max(365).optional(),
  max_notice_attempts: z.coerce.number().int().min(1).max(10).optional(),
  retry_after_hours: z.coerce.number().int().min(1).max(336).optional(),
  notice_window_start: timeOfDay.optional(),
  notice_window_end: timeOfDay.optional(),
  auto_call_task_without_consent: z.boolean().optional(),
  default_country_code: z.string().length(2).optional(),
}).strict().refine(
  (value) => Object.keys(value).length > (value.branch_id !== undefined ? 1 : 0),
  'Proporciona al menos un campo para actualizar',
);

export const killSwitchInput = z.object({
  branch_id: z.string().min(1).nullable().optional(),
}).strict();
