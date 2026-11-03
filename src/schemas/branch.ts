import { z } from 'zod';
import { optionalPaging } from '../infra/pagination.js';
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));
// Passthrough: new address fields (e.g. a neighborhood later) are accepted without a schema change or migration.
const branchAddressDetails = z.object({
  address: z.string().trim().max(500).optional(),
  region: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  sector: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(20).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
}).partial().passthrough();
export const branchInput = z.object({ name: z.string().trim().min(1).max(120), labelColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#CDE9EC'), phone: z.string().max(40).optional(), addressDetails: branchAddressDetails.optional(), description: optionalText(2000), managerName: optionalText(120), managerPhone: optionalText(40), managerEmail: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal('').transform(() => undefined)), openingHours: z.record(z.string(), z.string()).optional() }).strict();
export const branchSchema = z.object({ id: z.string(), numericId: z.string(), organizationId: z.string(), name: z.string(), labelColor: z.string(), phone: z.string().nullable(), addressDetails: z.record(z.string(), z.unknown()).nullable(), description: z.string().nullable(), managerName: z.string().nullable(), managerPhone: z.string().nullable(), managerEmail: z.string().nullable(), openingHours: z.unknown().nullable(), archivedAt: z.date().nullable(), createdAt: z.date() });
export const branchListQuery = optionalPaging.extend({
  archived: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});
