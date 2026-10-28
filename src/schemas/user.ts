import { z } from 'zod';
import { pagingFields } from '../infra/pagination.js';

export const assignableRoles = ['admin', 'pharmacist', 'operator', 'read_only'] as const;

export const userListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  ...pagingFields,
});

export const userParams = z.object({ id: z.string().min(1) });

const recoveryPin = z
  .string()
  .trim()
  .length(6, 'El PIN debe tener 6 dígitos.')
  .regex(/^\d{6}$/, 'El PIN debe tener 6 dígitos numéricos.');

const username = z.string().trim().min(3, 'Mínimo 3 caracteres.').max(40).regex(/^[A-Za-z0-9._-]+$/, 'Usa letras, números, punto, guion o guion bajo.');
const phone = z.string().trim().min(7).max(20);

export const userCreate = z.object({
  name: z.string().trim().min(2).max(120),
  username,
  email: z.string().trim().toLowerCase().email().max(254),
  phone: phone.optional(),
  password: z.string().min(8).max(128),
  pin: recoveryPin.optional(),
  role: z.enum(assignableRoles).optional(),
  roleId: z.string().min(1).optional(),
  branchIds: z.array(z.string().min(1)).max(50).default([]),
}).strict().refine((value) => Boolean(value.role || value.roleId), { message: 'Selecciona un rol.', path: ['roleId'] });

export const userPatch = z.object({
  name: z.string().trim().min(2).max(120),
  username,
  email: z.string().trim().toLowerCase().email().max(254),
  phone: phone.nullable(),
  role: z.enum(assignableRoles),
  roleId: z.string().min(1).nullable(),
  branchIds: z.array(z.string().min(1)).max(50).default([]),
}).partial().strict();
