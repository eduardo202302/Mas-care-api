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
import {
  doctorCreate, doctorListQuery, doctorMedicalCenterInput, doctorMedicalCenterParams, doctorMedicalCenterPatch,
  doctorParams, doctorPatch, doctorSpecialtyInput, doctorSpecialtyParams,
} from '../../schemas/doctor.js';

export const doctorsRouter = Router();
doctorsRouter.use(resolveTenant);

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};
const nonEmpty = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

function isUniqueConflict(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

async function findDoctorOrThrow(tx: Prisma.TransactionClient, id: string) {
  const doctor = await tx.doctor.findUnique({ where: { id } });
  if (!doctor) throw new ApiError(404, 'NOT_FOUND', 'Médico no encontrado.');
  return doctor;
}

doctorsRouter.get('/', validateQuery(doctorListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'doctors:read');
  const query = res.locals.validatedQuery as z.infer<typeof doctorListQuery>;
  const where: Prisma.DoctorWhereInput = {
    ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
    ...(query.specialtyId ? { specialties: { some: { specialtyId: query.specialtyId } } } : {}),
    ...(query.medicalCenterId ? { medicalCenters: { some: { medicalCenterId: query.medicalCenterId, isActive: true } } } : {}),
    ...(query.q ? { OR: [
      { firstName: { contains: query.q, mode: 'insensitive' } },
      { lastName: { contains: query.q, mode: 'insensitive' } },
      { licenseNumber: { contains: query.q, mode: 'insensitive' } },
    ] } : {}),
  };
  const { page, rows, skip } = resolvePaging(query);
  const [data, total] = await withTenant(tenant.organizationId, (tx) => Promise.all([
    tx.doctor.findMany({
      where, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], take: rows, skip,
      include: { specialties: { include: { specialty: true } }, medicalCenters: { where: { isActive: true }, include: { medicalCenter: true } } },
    }),
    tx.doctor.count({ where }),
  ]));
  res.json({ data, total, page, rows });
});

doctorsRouter.post('/', validateBody(doctorCreate), async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    requirePermission(tenant.role, 'doctors:write');
    const input = req.body as z.infer<typeof doctorCreate>;
    const doctor = await withTenant(tenant.organizationId, async (tx) => {
      let created;
      try {
        created = await tx.doctor.create({ data: { ...nonEmpty(input), organizationId: tenant.organizationId } as Prisma.DoctorUncheckedCreateInput });
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new ApiError(409, 'LICENSE_IN_USE', 'Ya existe un médico activo con este número de colegiatura.', { licenseNumber: 'Ya existe un médico activo con este número de colegiatura.' });
        }
        throw error;
      }
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'doctor.create', subjectId: created.id });
      return created;
    });
    res.status(201).json(doctor);
  } catch (error) {
    next(error);
  }
});

doctorsRouter.get('/:id', validateParams(doctorParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'doctors:read');
  const { id } = res.locals.validatedParams as z.infer<typeof doctorParams>;
  const doctor = await withTenant(tenant.organizationId, (tx) => tx.doctor.findUnique({
    where: { id },
    include: { specialties: { include: { specialty: true } }, medicalCenters: { include: { medicalCenter: true }, orderBy: { isActive: 'desc' } } },
  }));
  if (!doctor) throw new ApiError(404, 'NOT_FOUND', 'Médico no encontrado.');
  res.json(doctor);
});

doctorsRouter.patch('/:id', validateParams(doctorParams), validateBody(doctorPatch), async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    requirePermission(tenant.role, 'doctors:write');
    const { id } = res.locals.validatedParams as z.infer<typeof doctorParams>;
    const input = req.body as z.infer<typeof doctorPatch>;
    const doctor = await withTenant(tenant.organizationId, async (tx) => {
      await findDoctorOrThrow(tx, id);
      let updated;
      try {
        updated = await tx.doctor.update({ where: { organizationId_id: { organizationId: tenant.organizationId, id } }, data: nonEmpty(input) as Prisma.DoctorUncheckedUpdateInput });
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new ApiError(409, 'LICENSE_IN_USE', 'Ya existe un médico activo con este número de colegiatura.', { licenseNumber: 'Ya existe un médico activo con este número de colegiatura.' });
        }
        throw error;
      }
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'doctor.update', subjectId: id });
      return updated;
    });
    res.json(doctor);
  } catch (error) {
    next(error);
  }
});

doctorsRouter.get('/:id/patients', validateParams(doctorParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'doctors:read');
  const { id } = res.locals.validatedParams as z.infer<typeof doctorParams>;
  const links = await withTenant(tenant.organizationId, async (tx) => {
    await findDoctorOrThrow(tx, id);
    return tx.patientDoctor.findMany({
      where: { doctorId: id, isActive: true },
      orderBy: [{ isPrimary: 'desc' }, { startedAt: 'desc' }],
      include: { patient: { select: { id: true, fullName: true, phone: true } } },
    });
  });
  res.json({ data: links });
});

doctorsRouter.post('/:id/specialties', validateParams(doctorParams), validateBody(doctorSpecialtyInput), async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    requirePermission(tenant.role, 'doctors:write');
    const { id } = res.locals.validatedParams as z.infer<typeof doctorParams>;
    const input = req.body as z.infer<typeof doctorSpecialtyInput>;
    const link = await withTenant(tenant.organizationId, async (tx) => {
      await findDoctorOrThrow(tx, id);
      const specialty = await tx.medicalSpecialty.findUnique({ where: { id: input.specialtyId } });
      if (!specialty) throw new ApiError(404, 'SPECIALTY_NOT_FOUND', 'Especialidad no encontrada.');
      let created;
      try {
        created = await tx.doctorSpecialty.create({ data: { organizationId: tenant.organizationId, doctorId: id, specialtyId: input.specialtyId } });
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new ApiError(409, 'SPECIALTY_ALREADY_LINKED', 'El médico ya tiene esta especialidad asignada.');
        }
        throw error;
      }
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'doctor.specialty.add', subjectId: id, metadata: { specialtyId: input.specialtyId } });
      return created;
    });
    res.status(201).json(link);
  } catch (error) {
    next(error);
  }
});

doctorsRouter.delete('/:id/specialties/:specialtyId', validateParams(doctorSpecialtyParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'doctors:write');
  const { id, specialtyId } = res.locals.validatedParams as z.infer<typeof doctorSpecialtyParams>;
  await withTenant(tenant.organizationId, async (tx) => {
    await findDoctorOrThrow(tx, id);
    const deleted = await tx.doctorSpecialty.deleteMany({ where: { organizationId: tenant.organizationId, doctorId: id, specialtyId } });
    if (deleted.count === 0) throw new ApiError(404, 'NOT_FOUND', 'El médico no tiene esta especialidad asignada.');
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'doctor.specialty.remove', subjectId: id, metadata: { specialtyId } });
  });
  res.status(204).end();
});

doctorsRouter.post('/:id/medical-centers', validateParams(doctorParams), validateBody(doctorMedicalCenterInput), async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    requirePermission(tenant.role, 'doctors:write');
    const { id } = res.locals.validatedParams as z.infer<typeof doctorParams>;
    const input = req.body as z.infer<typeof doctorMedicalCenterInput>;
    const link = await withTenant(tenant.organizationId, async (tx) => {
      await findDoctorOrThrow(tx, id);
      const center = await tx.medicalCenter.findUnique({ where: { id: input.medicalCenterId } });
      if (!center) throw new ApiError(404, 'MEDICAL_CENTER_NOT_FOUND', 'Centro médico no encontrado.');
      let created;
      try {
        created = await tx.doctorMedicalCenter.create({
          data: { organizationId: tenant.organizationId, doctorId: id, ...nonEmpty(input) } as Prisma.DoctorMedicalCenterUncheckedCreateInput,
        });
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new ApiError(409, 'MEDICAL_CENTER_ALREADY_LINKED', 'El médico ya está activo en este centro médico.');
        }
        throw error;
      }
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'doctor.medical-center.add', subjectId: id, metadata: { medicalCenterId: input.medicalCenterId } });
      return created;
    });
    res.status(201).json(link);
  } catch (error) {
    next(error);
  }
});

doctorsRouter.patch('/:id/medical-centers/:medicalCenterId', validateParams(doctorMedicalCenterParams), validateBody(doctorMedicalCenterPatch), async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    requirePermission(tenant.role, 'doctors:write');
    const { id, medicalCenterId } = res.locals.validatedParams as z.infer<typeof doctorMedicalCenterParams>;
    const input = req.body as z.infer<typeof doctorMedicalCenterPatch>;
    const link = await withTenant(tenant.organizationId, async (tx) => {
      await findDoctorOrThrow(tx, id);
      const existing = await tx.doctorMedicalCenter.findFirst({ where: { doctorId: id, medicalCenterId, isActive: true } });
      if (!existing) throw new ApiError(404, 'NOT_FOUND', 'El médico no tiene un vínculo activo con este centro médico.');
      let updated;
      try {
        updated = await tx.doctorMedicalCenter.update({ where: { organizationId_id: { organizationId: tenant.organizationId, id: existing.id } }, data: nonEmpty(input) as Prisma.DoctorMedicalCenterUncheckedUpdateInput });
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new ApiError(409, 'MEDICAL_CENTER_ALREADY_LINKED', 'El médico ya está activo en este centro médico.');
        }
        throw error;
      }
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'doctor.medical-center.update', subjectId: id, metadata: { medicalCenterId } });
      return updated;
    });
    res.json(link);
  } catch (error) {
    next(error);
  }
});
