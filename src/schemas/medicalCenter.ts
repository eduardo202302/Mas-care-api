import { z } from 'zod';
import { pagingFields } from '../infra/pagination.js';

export const medicalCenterTypes = ['clinic', 'hospital', 'medical_center', 'private_office', 'other'] as const;
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const medicalCenterFields = {
  name: z.string().trim().min(1).max(160),
  centerType: z.enum(medicalCenterTypes).optional(),
  rnc: optionalText(40),
  phone: optionalText(40),
  email: z.string().trim().email().max(254).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  province: optionalText(120),
  municipality: optionalText(120),
  notes: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
};

export const medicalCenterCreate = z.object(medicalCenterFields).strict();
export const medicalCenterPatch = z.object(medicalCenterFields).partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');
export const medicalCenterParams = z.object({ id: z.string().min(1) });
export const medicalCenterListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  centerType: z.enum(medicalCenterTypes).optional(),
  ...pagingFields,
});
