import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { paginate } from '../../infra/pagination.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import { medicationCreate, medicationListQuery, medicationParams, medicationPatch } from '../../schemas/medication.js';

export const medicationsRouter = Router();
medicationsRouter.use(resolveTenant);

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

medicationsRouter.get('/', validateQuery(medicationListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'medications:read');
  const query = res.locals.validatedQuery as z.infer<typeof medicationListQuery>;
  const where: Prisma.MedicationWhereInput = {
    archivedAt: query.archived ? { not: null } : null,
    ...(query.q ? { OR: [
      { brandName: { contains: query.q, mode: 'insensitive' } },
      { genericName: { contains: query.q, mode: 'insensitive' } },
      { activeIngredient: { contains: query.q, mode: 'insensitive' } },
      { presentation: { contains: query.q, mode: 'insensitive' } },
    ] } : {}),
  };
  const result = await withTenant(tenant.organizationId, (tx) => paginate(query, (args) => tx.medication.findMany({
    where,
    orderBy: [{ genericName: 'asc' }, { brandName: 'asc' }, { id: 'asc' }],
    take: args.take,
    skip: args.skip,
    ...(args.cursor ? { cursor: { organizationId_id: { organizationId: tenant.organizationId, id: args.cursor } } } : {}),
  }), () => tx.medication.count({ where })));
  res.json(result);
});

medicationsRouter.post('/', validateBody(medicationCreate), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'medications:write');
  const input = req.body as z.infer<typeof medicationCreate>;
  const medication = await withTenant(tenant.organizationId, async (tx) => {
    const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    const created = await tx.medication.create({ data: { ...data, organizationId: tenant.organizationId } as Prisma.MedicationUncheckedCreateInput });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'medication.create', subjectId: created.id });
    return created;
  });
  res.status(201).json(medication);
});

medicationsRouter.get('/:id', validateParams(medicationParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'medications:read');
  const { id } = res.locals.validatedParams as z.infer<typeof medicationParams>;
  const medication = await withTenant(tenant.organizationId, (tx) => tx.medication.findFirst({ where: { id, archivedAt: null } }));
  if (!medication) throw new ApiError(404, 'NOT_FOUND', 'Medication not found');
  res.json(medication);
});

medicationsRouter.patch('/:id', validateParams(medicationParams), validateBody(medicationPatch), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'medications:write');
  const { id } = res.locals.validatedParams as z.infer<typeof medicationParams>;
  const input = req.body as z.infer<typeof medicationPatch>;
  const medication = await withTenant(tenant.organizationId, async (tx) => {
    const current = await tx.medication.findFirst({ where: { id, archivedAt: null } });
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Medication not found');
    const candidate = {
      brandName: input.brandName === undefined ? current.brandName : input.brandName,
      genericName: input.genericName === undefined ? current.genericName : input.genericName,
      activeIngredient: input.activeIngredient === undefined ? current.activeIngredient : input.activeIngredient,
    };
    if (!candidate.brandName && !candidate.genericName && !candidate.activeIngredient) {
      throw new ApiError(400, 'MEDICATION_NAME_REQUIRED', 'At least one medication name must remain');
    }
    const updated = await tx.medication.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Prisma.MedicationUncheckedUpdateInput,
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'medication.update', subjectId: id });
    return updated;
  });
  res.json(medication);
});

medicationsRouter.post('/:id/archive', validateParams(medicationParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'medications:write');
  const { id } = res.locals.validatedParams as z.infer<typeof medicationParams>;
  const medication = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await tx.medication.findFirst({ where: { id, archivedAt: null } });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Medication not found');
    const archived = await tx.medication.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { archivedAt: new Date() },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'medication.archive', subjectId: id });
    return archived;
  });
  res.json(medication);
});
