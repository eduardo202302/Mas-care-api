import { z } from 'zod';

export const settingsPatch = z.object({
  due_soon_days: z.coerce.number().int().min(0).max(365).optional(),
  upcoming_days: z.coerce.number().int().min(0).max(365).optional(),
  prescription_warning_days: z.coerce.number().int().min(0).max(365).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');
