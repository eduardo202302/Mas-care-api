import { z } from 'zod';
import { pagingFields } from '../infra/pagination.js';

const optionalMedicationText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const fields = {
  brandName: optionalMedicationText(160),
  genericName: optionalMedicationText(160),
  activeIngredient: optionalMedicationText(240),
  presentation: z.string().trim().min(1).max(160),
  doseUnit: z.string().trim().min(1).max(40).default('tablet'),
  unitsPerPackage: z.coerce.number().positive().max(999999.99).nullable().optional(),
};
const hasName = (value: { brandName?: string | null | undefined; genericName?: string | null | undefined; activeIngredient?: string | null | undefined }) =>
  Boolean(value.brandName || value.genericName || value.activeIngredient);

export const medicationCreate = z.object(fields).strict().refine(hasName, 'Indica marca, nombre genérico o principio activo');
export const medicationPatch = z.object({ ...fields, presentation: fields.presentation.optional() }).partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');
export const medicationParams = z.object({ id: z.string().min(1) });
export const medicationListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  archived: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  ...pagingFields,
});
