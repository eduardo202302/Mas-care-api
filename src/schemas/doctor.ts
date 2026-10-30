import { z } from 'zod';
import { pagingFields } from '../infra/pagination.js';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const doctorFields = {
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  licenseNumber: optionalText(60),
  phone: optionalText(40),
  email: z.string().trim().email().max(254).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
};

export const doctorCreate = z.object(doctorFields).strict();
export const doctorPatch = z.object(doctorFields).partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');
export const doctorParams = z.object({ id: z.string().min(1) });
export const doctorListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  specialtyId: z.string().optional(),
  medicalCenterId: z.string().optional(),
  ...pagingFields,
});

export const doctorSpecialtyInput = z.object({ specialtyId: z.string().min(1) }).strict();
export const doctorSpecialtyParams = doctorParams.extend({ specialtyId: z.string().min(1) });

export const doctorMedicalCenterInput = z.object({
  medicalCenterId: z.string().min(1),
  officeNumber: optionalText(40),
  position: optionalText(80),
  scheduleNotes: z.string().trim().max(500).nullable().optional(),
  phoneExtension: optionalText(20),
}).strict();
export const doctorMedicalCenterPatch = doctorMedicalCenterInput.omit({ medicalCenterId: true }).partial().extend({
  isActive: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');
export const doctorMedicalCenterParams = doctorParams.extend({ medicalCenterId: z.string().min(1) });
