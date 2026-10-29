import type { Prisma } from '@prisma/client';
import { propertyTypes, validateCustomValues, type PropertyDef, type PropertyEntity, type PropertyType } from '../../domain/customProperties.js';
import { ApiError } from '../../infra/errors.js';

type Tx = Prisma.TransactionClient;

/** Active definitions for one entity, in display order. */
export async function loadDefs(tx: Tx, entity: PropertyEntity): Promise<PropertyDef[]> {
  const rows = await tx.customProperty.findMany({
    where: { entity, archivedAt: null },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    type: row.type as PropertyType,
    required: row.required,
    options: Array.isArray(row.options) ? (row.options as string[]) : [],
  }));
}

/** Validates and merges values for a create or patch; throws a 400 with per-property errors. */
export async function resolveCustomValues(
  tx: Tx,
  entity: PropertyEntity,
  provided: Record<string, unknown> | undefined,
  existing: unknown,
  mode: 'create' | 'patch',
): Promise<Prisma.InputJsonObject | undefined> {
  // Nothing sent on a patch: leave stored values alone.
  if (mode === 'patch' && provided === undefined) return undefined;
  const defs = await loadDefs(tx, entity);
  const result = validateCustomValues(defs, provided, (existing ?? {}) as Record<string, unknown>, mode);
  if (!result.ok) throw new ApiError(400, 'INVALID_CUSTOM_VALUES', 'Revisa las propiedades personalizadas', result.errors);
  return result.values as Prisma.InputJsonObject;
}

/**
 * JSON filter for one property on a table. The key must match an active
 * definition, so callers cannot probe arbitrary JSON paths.
 */
export async function customFilter(
  tx: Tx,
  entity: PropertyEntity,
  key: string | undefined,
  value: string | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (!key || value === undefined || value === '') return undefined;
  const def = (await loadDefs(tx, entity)).find((item) => item.key === key);
  if (!def) throw new ApiError(400, 'UNKNOWN_PROPERTY', 'Propiedad personalizada desconocida');
  const path = [key];
  switch (def.type) {
    case 'short_text':
    case 'long_text':
      return { path, string_contains: value, mode: 'insensitive' };
    case 'number':
      return { path, equals: Number(value) };
    case 'checkbox':
      return { path, equals: value === 'true' };
    case 'multiselect':
      return { path, array_contains: [value] };
    default:
      return { path, equals: value };
  }
}

export { propertyTypes };
