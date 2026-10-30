import { z } from 'zod';
import { pagingFields } from '../infra/pagination.js';
import { normalizeDomain } from '../domain/company.js';

export const companyStatuses = ['active', 'inactive'] as const;

export const companyPin = z
  .string()
  .trim()
  .length(6, 'El PIN debe tener 6 dígitos.')
  .regex(/^\d{6}$/, 'El PIN debe tener 6 dígitos numéricos.');

export const companyDomain = z
  .string()
  .trim()
  .min(3, 'Ingresa un dominio válido.')
  .max(300, 'Máximo 300 caracteres.')
  .refine((value) => {
    try {
      normalizeDomain(value);
      return true;
    } catch {
      return false;
    }
  }, 'Ingresa un dominio válido, por ejemplo https://farmacia.com.');

export const companyLogo = z
  .string()
  .trim()
  .max(400_000, 'La imagen del logo es demasiado grande.')
  .refine((value) => {
    if (!value) return true;
    if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return true;
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Sube una imagen PNG, JPG o WebP válida.')
  .nullable()
  .optional();

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));

export const companyCreate = z
  .object({
    name: z.string().trim().min(2, 'Ingresa al menos 2 caracteres.').max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    status: z.enum(companyStatuses).default('active'),
    pin: companyPin.optional(),
    domain: companyDomain,
    logo: companyLogo,
    phone: optionalText(30),
    ownerName: optionalText(120),
    industry: optionalText(120),
    type: optionalText(60),
    city: optionalText(120),
    state: optionalText(120),
    postalCode: optionalText(20),
    employeeCount: z.preprocess(
      (value) => (value === '' || value === null ? undefined : value),
      z.coerce.number().int().min(0).max(10_000_000).optional(),
    ),
    annualRevenue: z.preprocess(
      (value) => (value === '' || value === null ? undefined : value),
      z.coerce.number().min(0).max(1_000_000_000_000).optional(),
    ),
    timezone: optionalText(60),
    description: optionalText(2_000),
    linkedinUrl: z
      .string()
      .trim()
      .max(300)
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .strict();

export const companyPatch = companyCreate.partial().strict();

export const companyListQuery = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  ...pagingFields,
});

export const companyParams = z.object({ id: z.string().min(1) });
