import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { resolvePaging } from '../../infra/pagination.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import { specialtyCreate, specialtyListQuery, specialtyParams, specialtyPatch } from '../../schemas/medicalSpecialty.js';

export const medicalSpecialtiesRouter = Router();
medicalSpecialtiesRouter.use(resolveTenant);

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};
const nonEmpty = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

function isUniqueConflict(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

medicalSpecialtiesRouter.get('/', validateQuery(specialtyListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'specialties:read');
  const query = res.locals.validatedQuery as z.infer<typeof specialtyListQuery>;
  const where: Prisma.MedicalSpecialtyWhereInput = {
    ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
    ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
  };
  const { page, rows, skip } = resolvePaging(query);
  const [data, total] = await withTenant(tenant.organizationId, (tx) => Promise.all([
    tx.medicalSpecialty.findMany({ where, orderBy: [{ name: 'asc' }], take: rows, skip }),
    tx.medicalSpecialty.count({ where }),
  ]));
  res.json({ data, total, page, rows });
});

medicalSpecialtiesRouter.post('/', validateBody(specialtyCreate), async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    requirePermission(tenant.role, 'specialties:write');
    const input = req.body as z.infer<typeof specialtyCreate>;
    const specialty = await withTenant(tenant.organizationId, async (tx) => {
      let created;
      try {
        created = await tx.medicalSpecialty.create({ data: { ...nonEmpty(input), organizationId: tenant.organizationId } as Prisma.MedicalSpecialtyUncheckedCreateInput });
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new ApiError(409, 'SPECIALTY_NAME_IN_USE', 'Ya existe una especialidad con este nombre.', { name: 'Ya existe una especialidad con este nombre.' });
        }
        throw error;
      }
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'medical-specialty.create', subjectId: created.id });
      return created;
    });
    res.status(201).json(specialty);
  } catch (error) {
    next(error);
  }
});

medicalSpecialtiesRouter.get('/:id', validateParams(specialtyParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'specialties:read');
  const { id } = res.locals.validatedParams as z.infer<typeof specialtyParams>;
  const specialty = await withTenant(tenant.organizationId, (tx) => tx.medicalSpecialty.findUnique({ where: { id } }));
  if (!specialty) throw new ApiError(404, 'NOT_FOUND', 'Especialidad no encontrada.');
  res.json(specialty);
});

medicalSpecialtiesRouter.patch('/:id', validateParams(specialtyParams), validateBody(specialtyPatch), async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    requirePermission(tenant.role, 'specialties:write');
    const { id } = res.locals.validatedParams as z.infer<typeof specialtyParams>;
    const input = req.body as z.infer<typeof specialtyPatch>;
    const specialty = await withTenant(tenant.organizationId, async (tx) => {
      const existing = await tx.medicalSpecialty.findUnique({ where: { id } });
      if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Especialidad no encontrada.');
      let updated;
      try {
        updated = await tx.medicalSpecialty.update({ where: { organizationId_id: { organizationId: tenant.organizationId, id } }, data: nonEmpty(input) as Prisma.MedicalSpecialtyUncheckedUpdateInput });
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new ApiError(409, 'SPECIALTY_NAME_IN_USE', 'Ya existe una especialidad con este nombre.', { name: 'Ya existe una especialidad con este nombre.' });
        }
        throw error;
      }
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'medical-specialty.update', subjectId: id });
      return updated;
    });
    res.json(specialty);
  } catch (error) {
    next(error);
  }
});
