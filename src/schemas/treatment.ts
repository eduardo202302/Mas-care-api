import { z } from 'zod';
import { derivedStatuses } from '../domain/coverage.js';

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const isoDate = z.string().date();

const treatmentFields = {
  patient_id: z.string().min(1),
  medication_id: z.string().min(1),
  branch_id: z.string().min(1),
  responsible_user_id: z.string().min(1).nullable().optional(),
  dose_per_intake: z.coerce.number().positive().max(99999.999),
  intakes_per_day: z.coerce.number().positive().max(999.999),
  quantity_per_cycle: z.coerce.number().positive().max(99999999.99),
  start_date: isoDate,
  end_date: isoDate.nullable().optional(),
  prescriber_name: optionalText(160),
  prescription_expires_on: isoDate.nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  custom_values: z.record(z.string(), z.unknown()).optional(),
};

export const treatmentCreate = z.object(treatmentFields).strict();
export const treatmentPatch = z.object(treatmentFields).partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');
export const treatmentParams = z.object({ id: z.string().min(1) });

export const treatmentListQuery = z.object({
  patient_id: z.string().optional(),
  branch_id: z.string().optional(),
  responsible_user_id: z.string().optional(),
  derived_status: z.enum(derivedStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

const reason = z.string().trim().min(1, 'El motivo es obligatorio').max(1000);

export const statusReasonInput = z.object({ reason }).strict();
export const coverageAdjustInput = z.object({ new_end_on: isoDate, reason }).strict();
export const prescriptionRenewInput = z.object({ new_expiry: isoDate }).strict();
