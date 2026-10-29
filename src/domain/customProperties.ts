/**
 * Custom properties: organization-defined fields for patients and treatments.
 * Values live in a JSON column keyed by the property key. This module is the
 * single place that decides whether a set of values is valid, so the API and
 * the form checks cannot drift apart.
 */
export const propertyEntities = ['patient', 'treatment'] as const;
export type PropertyEntity = (typeof propertyEntities)[number];

export const propertyTypes = ['short_text', 'long_text', 'number', 'date', 'datetime', 'checkbox', 'select', 'multiselect'] as const;
export type PropertyType = (typeof propertyTypes)[number];

export const typeNeedsOptions = (type: PropertyType) => type === 'select' || type === 'multiselect';

export type PropertyDef = {
  key: string;
  label: string;
  type: PropertyType;
  required: boolean;
  options: string[];
};

export const propertyKeyPattern = /^[a-z][a-z0-9_]{1,39}$/;

const isDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const isDateTime = (value: unknown) => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
const isEmpty = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

/** Returns an error message for one value, or null when it is valid for the definition. */
export function checkValue(def: PropertyDef, value: unknown): string | null {
  switch (def.type) {
    case 'short_text':
      return typeof value === 'string' && value.length <= 200 ? null : 'Texto de hasta 200 caracteres';
    case 'long_text':
      return typeof value === 'string' && value.length <= 5000 ? null : 'Texto de hasta 5000 caracteres';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'Debe ser un número';
    case 'date':
      return isDate(value) ? null : 'Fecha con formato AAAA-MM-DD';
    case 'datetime':
      return isDateTime(value) ? null : 'Fecha y hora válidas';
    case 'checkbox':
      return typeof value === 'boolean' ? null : 'Debe ser verdadero o falso';
    case 'select':
      return typeof value === 'string' && def.options.includes(value) ? null : 'Elige una de las opciones';
    case 'multiselect':
      return Array.isArray(value) && value.every((item) => typeof item === 'string' && def.options.includes(item)) ? null : 'Elige solo opciones disponibles';
  }
}

export type ValidationResult =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> };

/**
 * `create` requires every required property. `patch` merges `provided` into
 * `existing` and only checks the required properties it touches, so adding a
 * required property later does not block unrelated edits of older records.
 * `null`/empty clears a value. Unknown or archived keys are rejected.
 */
export function validateCustomValues(
  defs: PropertyDef[],
  provided: Record<string, unknown> | undefined,
  existing: Record<string, unknown> = {},
  mode: 'create' | 'patch' = 'create',
): ValidationResult {
  const errors: Record<string, string> = {};
  const byKey = new Map(defs.map((def) => [def.key, def]));
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(provided ?? {})) {
    const def = byKey.get(key);
    if (!def) { errors[key] = 'Propiedad desconocida o archivada'; continue; }
    if (isEmpty(value)) { delete merged[key]; continue; }
    const problem = checkValue(def, value);
    if (problem) errors[key] = problem;
    else merged[key] = value;
  }
  for (const def of defs) {
    const checked = mode === 'create' || (provided !== undefined && def.key in provided);
    if (checked && def.required && isEmpty(merged[def.key]) && !errors[def.key]) errors[def.key] = 'Este campo es obligatorio';
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values: merged };
}
