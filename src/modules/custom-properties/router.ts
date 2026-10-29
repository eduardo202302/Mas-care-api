import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { propertyEntities, propertyKeyPattern, propertyTypes, typeNeedsOptions } from '../../domain/customProperties.js';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';

export const customPropertiesRouter = Router();
customPropertiesRouter.use(resolveTenant);

const requireManage = (role: Parameters<typeof puede>[0]) => {
  if (!puede(role, 'settings:write')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

const options = z.array(z.string().trim().min(1).max(80)).max(50).refine((items) => new Set(items).size === items.length, 'Las opciones no pueden repetirse');
const base = {
  label: z.string().trim().min(1).max(80),
  required: z.boolean().default(false),
  options: options.default([]),
  groupName: z.string().trim().min(1).max(60).default('General'),
};
const create = z.object({
  entity: z.enum(propertyEntities),
  key: z.string().regex(propertyKeyPattern, 'Usa minúsculas, números y _ (2 a 40 caracteres, empezando por letra)'),
  type: z.enum(propertyTypes),
  ...base,
}).strict().superRefine((value, ctx) => {
  if (typeNeedsOptions(value.type) && value.options.length === 0) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Define al menos una opción' });
  if (!typeNeedsOptions(value.type) && value.options.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Este tipo no usa opciones' });
});
// The key and type never change after creation, so stored values stay valid.
const patch = z.object({ ...base, position: z.number().int().min(0).max(1000) }).partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'Proporciona al menos un campo para actualizar');
const listQuery = z.object({
  entity: z.enum(propertyEntities).optional(),
  includeArchived: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});
const params = z.object({ id: z.string().min(1) });

const view = (row: Prisma.CustomPropertyGetPayload<object>) => ({
  id: row.id, entity: row.entity, key: row.key, label: row.label, type: row.type, required: row.required,
  options: row.options as string[], groupName: row.groupName, position: row.position, archivedAt: row.archivedAt,
});

// Definitions are not sensitive and every form needs them, so any member can read.
customPropertiesRouter.get('/', validateQuery(listQuery), async (req, res) => {
  const tenant = req.tenant!;
  const query = res.locals.validatedQuery as z.infer<typeof listQuery>;
  const rows = await withTenant(tenant.organizationId, (tx) => tx.customProperty.findMany({
    where: { ...(query.entity ? { entity: query.entity } : {}), ...(query.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ entity: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
  }));
  res.json({ data: rows.map(view) });
});

customPropertiesRouter.post('/', validateBody(create), async (req, res) => {
  const tenant = req.tenant!;
  requireManage(tenant.role);
  const input = req.body as z.infer<typeof create>;
  try {
    const row = await withTenant(tenant.organizationId, async (tx) => {
      const last = await tx.customProperty.aggregate({ where: { entity: input.entity }, _max: { position: true } });
      const created = await tx.customProperty.create({
        data: { organizationId: tenant.organizationId, ...input, position: (last._max.position ?? -1) + 1 },
      });
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'custom_property.create', subjectId: created.id, metadata: { entity: input.entity, key: input.key } });
      return created;
    });
    res.status(201).json(view(row));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError(409, 'PROPERTY_KEY_EXISTS', 'Ya existe una propiedad con esa clave');
    }
    throw error;
  }
});

customPropertiesRouter.patch('/:id', validateParams(params), validateBody(patch), async (req, res) => {
  const tenant = req.tenant!;
  requireManage(tenant.role);
  const { id } = res.locals.validatedParams as z.infer<typeof params>;
  const input = req.body as z.infer<typeof patch>;
  const row = await withTenant(tenant.organizationId, async (tx) => {
    const current = await tx.customProperty.findFirst({ where: { id } });
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Property not found');
    const type = current.type as (typeof propertyTypes)[number];
    if (input.options !== undefined && !typeNeedsOptions(type)) throw new ApiError(400, 'VALIDATION_ERROR', 'Este tipo no usa opciones', { options: 'Este tipo no usa opciones' });
    if (input.options !== undefined && typeNeedsOptions(type) && input.options.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'Define al menos una opción', { options: 'Define al menos una opción' });
    const updated = await tx.customProperty.update({ where: { id }, data: Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Prisma.CustomPropertyUpdateInput });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'custom_property.update', subjectId: id });
    return updated;
  });
  res.json(view(row));
});

for (const [path, archivedAt] of [['archive', () => new Date()], ['restore', () => null]] as const) {
  customPropertiesRouter.post(`/:id/${path}`, validateParams(params), async (req, res) => {
    const tenant = req.tenant!;
    requireManage(tenant.role);
    const { id } = res.locals.validatedParams as z.infer<typeof params>;
    const row = await withTenant(tenant.organizationId, async (tx) => {
      if (!await tx.customProperty.findFirst({ where: { id } })) throw new ApiError(404, 'NOT_FOUND', 'Property not found');
      const updated = await tx.customProperty.update({ where: { id }, data: { archivedAt: archivedAt() } });
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: `custom_property.${path}`, subjectId: id });
      return updated;
    });
    res.json(view(row));
  });
}

/** Deleting removes the definition and strips its stored values from every record. */
customPropertiesRouter.delete('/:id', validateParams(params), async (req, res) => {
  const tenant = req.tenant!;
  requireManage(tenant.role);
  const { id } = res.locals.validatedParams as z.infer<typeof params>;
  await withTenant(tenant.organizationId, async (tx) => {
    const current = await tx.customProperty.findFirst({ where: { id } });
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Property not found');
    if (current.entity === 'patient') {
      await tx.$executeRaw`UPDATE patients SET custom_values = custom_values - ${current.key} WHERE organization_id = ${tenant.organizationId}`;
    } else {
      await tx.$executeRaw`UPDATE treatments SET custom_values = custom_values - ${current.key} WHERE organization_id = ${tenant.organizationId}`;
    }
    await tx.customProperty.delete({ where: { id } });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'custom_property.delete', subjectId: id, metadata: { entity: current.entity, key: current.key } });
  });
  res.status(204).end();
});
