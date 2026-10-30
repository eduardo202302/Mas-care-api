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
import { medicalCenterCreate, medicalCenterListQuery, medicalCenterParams, medicalCenterPatch } from '../../schemas/medicalCenter.js';

export const medicalCentersRouter = Router();
medicalCentersRouter.use(resolveTenant);

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};
const nonEmpty = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

medicalCentersRouter.get('/', validateQuery(medicalCenterListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'medical-centers:read');
  const query = res.locals.validatedQuery as z.infer<typeof medicalCenterListQuery>;
  const where: Prisma.MedicalCenterWhereInput = {
    ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
    ...(query.centerType ? { centerType: query.centerType } : {}),
    ...(query.q ? { OR: [
      { name: { contains: query.q, mode: 'insensitive' } },
      { rnc: { contains: query.q, mode: 'insensitive' } },
    ] } : {}),
  };
  const { page, rows, skip } = resolvePaging(query);
  const [data, total] = await withTenant(tenant.organizationId, (tx) => Promise.all([
    tx.medicalCenter.findMany({ where, orderBy: [{ name: 'asc' }], take: rows, skip }),
    tx.medicalCenter.count({ where }),
  ]));
  res.json({ data, total, page, rows });
});

medicalCentersRouter.post('/', validateBody(medicalCenterCreate), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'medical-centers:write');
  const input = req.body as z.infer<typeof medicalCenterCreate>;
  const center = await withTenant(tenant.organizationId, async (tx) => {
    const created = await tx.medicalCenter.create({ data: { ...nonEmpty(input), organizationId: tenant.organizationId } as Prisma.MedicalCenterUncheckedCreateInput });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'medical-center.create', subjectId: created.id });
    return created;
  });
  res.status(201).json(center);
});

medicalCentersRouter.get('/:id', validateParams(medicalCenterParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'medical-centers:read');
  const { id } = res.locals.validatedParams as z.infer<typeof medicalCenterParams>;
  const center = await withTenant(tenant.organizationId, (tx) => tx.medicalCenter.findUnique({ where: { id } }));
  if (!center) throw new ApiError(404, 'NOT_FOUND', 'Centro médico no encontrado.');
  res.json(center);
});

medicalCentersRouter.patch('/:id', validateParams(medicalCenterParams), validateBody(medicalCenterPatch), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'medical-centers:write');
  const { id } = res.locals.validatedParams as z.infer<typeof medicalCenterParams>;
  const input = req.body as z.infer<typeof medicalCenterPatch>;
  const center = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await tx.medicalCenter.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Centro médico no encontrado.');
    const updated = await tx.medicalCenter.update({ where: { organizationId_id: { organizationId: tenant.organizationId, id } }, data: nonEmpty(input) as Prisma.MedicalCenterUncheckedUpdateInput });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'medical-center.update', subjectId: id });
    return updated;
  });
  res.json(center);
});

medicalCentersRouter.get('/:id/doctors', validateParams(medicalCenterParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'medical-centers:read');
  const { id } = res.locals.validatedParams as z.infer<typeof medicalCenterParams>;
  const links = await withTenant(tenant.organizationId, async (tx) => {
    const center = await tx.medicalCenter.findUnique({ where: { id } });
    if (!center) throw new ApiError(404, 'NOT_FOUND', 'Centro médico no encontrado.');
    return tx.doctorMedicalCenter.findMany({
      where: { medicalCenterId: id },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: { doctor: true },
    });
  });
  res.json({ data: links });
});
