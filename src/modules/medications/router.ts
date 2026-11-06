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
import { medicationAttachmentParams, medicationCreate, medicationListQuery, medicationParams, medicationPatch } from '../../schemas/medication.js';
import {
  medicationAttachmentAbsolutePath,
  medicationAttachmentKind,
  medicationAttachmentRelativePath,
  medicationAttachmentUpload,
  removeStoredFile,
} from '../../infra/fileStorage.js';

const attachmentSelect = {
  id: true, kind: true, originalName: true, mimeType: true, sizeBytes: true, isPrimary: true, createdAt: true,
} satisfies Prisma.MedicationAttachmentSelect;

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
    include: { attachments: { where: { isPrimary: true }, select: { id: true }, take: 1 } },
    ...(args.cursor ? { cursor: { organizationId_id: { organizationId: tenant.organizationId, id: args.cursor } } } : {}),
  }), () => tx.medication.count({ where })));
  res.json({
    ...result,
    data: result.data.map(({ attachments, ...medication }) => ({ ...medication, primaryImageId: attachments[0]?.id ?? null })),
  });
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
  const medication = await withTenant(tenant.organizationId, (tx) => tx.medication.findFirst({
    where: { id, archivedAt: null },
    include: { attachments: { where: { isPrimary: true }, select: { id: true }, take: 1 } },
  }));
  if (!medication) throw new ApiError(404, 'NOT_FOUND', 'Medication not found');
  const { attachments, ...rest } = medication;
  res.json({ ...rest, primaryImageId: attachments[0]?.id ?? null });
});

medicationsRouter.get('/:id/attachments', validateParams(medicationParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'medications:read');
  const { id } = res.locals.validatedParams as z.infer<typeof medicationParams>;
  const data = await withTenant(tenant.organizationId, async (tx) => {
    const medication = await tx.medication.findFirst({ where: { id } });
    if (!medication) throw new ApiError(404, 'NOT_FOUND', 'Medication not found');
    return tx.medicationAttachment.findMany({
      where: { medicationId: id },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: attachmentSelect,
    });
  });
  res.json({ data });
});

medicationsRouter.post('/:id/attachments', validateParams(medicationParams), medicationAttachmentUpload, async (req, res) => {
  const tenant = req.tenant!;
  const file = req.file;
  try {
    requirePermission(tenant.role, 'medications:write');
    const { id } = res.locals.validatedParams as z.infer<typeof medicationParams>;
    if (!file) throw new ApiError(400, 'VALIDATION_ERROR', 'Adjunta una imagen (JPG, PNG, WEBP, GIF) o un documento (PDF, Word, Excel, TXT) de hasta 10 MB');
    const kind = medicationAttachmentKind(file.mimetype);
    if (!kind) throw new ApiError(400, 'VALIDATION_ERROR', 'Tipo de archivo no permitido');
    const created = await withTenant(tenant.organizationId, async (tx) => {
      const medication = await tx.medication.findFirst({ where: { id, archivedAt: null } });
      if (!medication) throw new ApiError(404, 'NOT_FOUND', 'Medication not found');
      const hasPrimary = kind === 'image'
        ? (await tx.medicationAttachment.count({ where: { medicationId: id, isPrimary: true } })) > 0
        : true;
      const row = await tx.medicationAttachment.create({
        data: {
          organizationId: tenant.organizationId,
          medicationId: id,
          kind,
          originalName: file.originalname.slice(0, 255),
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storagePath: medicationAttachmentRelativePath(tenant.organizationId, file.filename),
          isPrimary: !hasPrimary,
        },
        select: attachmentSelect,
      });
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'medication.attachment.add', subjectId: id });
      return row;
    });
    res.status(201).json(created);
  } catch (error) {
    if (file) await removeStoredFile(medicationAttachmentRelativePath(tenant.organizationId, file.filename));
    throw error;
  }
});

medicationsRouter.get('/:id/attachments/:attachmentId/file', validateParams(medicationAttachmentParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'medications:read');
  const { id, attachmentId } = res.locals.validatedParams as z.infer<typeof medicationAttachmentParams>;
  const attachment = await withTenant(tenant.organizationId, (tx) => tx.medicationAttachment.findFirst({ where: { id: attachmentId, medicationId: id } }));
  if (!attachment) throw new ApiError(404, 'NOT_FOUND', 'Attachment not found');
  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`);
  res.sendFile(medicationAttachmentAbsolutePath(attachment.storagePath));
});

medicationsRouter.post('/:id/attachments/:attachmentId/primary', validateParams(medicationAttachmentParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'medications:write');
  const { id, attachmentId } = res.locals.validatedParams as z.infer<typeof medicationAttachmentParams>;
  const updated = await withTenant(tenant.organizationId, async (tx) => {
    const attachment = await tx.medicationAttachment.findFirst({ where: { id: attachmentId, medicationId: id } });
    if (!attachment) throw new ApiError(404, 'NOT_FOUND', 'Attachment not found');
    if (attachment.kind !== 'image') throw new ApiError(400, 'ATTACHMENT_NOT_IMAGE', 'Solo las imágenes pueden ser la principal');
    await tx.medicationAttachment.updateMany({ where: { medicationId: id, isPrimary: true }, data: { isPrimary: false } });
    const row = await tx.medicationAttachment.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id: attachmentId } },
      data: { isPrimary: true },
      select: attachmentSelect,
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'medication.attachment.primary', subjectId: id });
    return row;
  });
  res.json(updated);
});

medicationsRouter.delete('/:id/attachments/:attachmentId', validateParams(medicationAttachmentParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'medications:write');
  const { id, attachmentId } = res.locals.validatedParams as z.infer<typeof medicationAttachmentParams>;
  const storagePath = await withTenant(tenant.organizationId, async (tx) => {
    const attachment = await tx.medicationAttachment.findFirst({ where: { id: attachmentId, medicationId: id } });
    if (!attachment) throw new ApiError(404, 'NOT_FOUND', 'Attachment not found');
    await tx.medicationAttachment.delete({ where: { organizationId_id: { organizationId: tenant.organizationId, id: attachmentId } } });
    if (attachment.isPrimary) {
      const next = await tx.medicationAttachment.findFirst({ where: { medicationId: id, kind: 'image' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      if (next) {
        await tx.medicationAttachment.update({
          where: { organizationId_id: { organizationId: tenant.organizationId, id: next.id } },
          data: { isPrimary: true },
        });
      }
    }
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'medication.attachment.remove', subjectId: id });
    return attachment.storagePath;
  });
  await removeStoredFile(storagePath);
  res.status(204).end();
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

medicationsRouter.post('/:id/restore', validateParams(medicationParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'medications:write');
  const { id } = res.locals.validatedParams as z.infer<typeof medicationParams>;
  const medication = await withTenant(tenant.organizationId, async (tx) => {
    const existing = await tx.medication.findFirst({ where: { id, archivedAt: { not: null } } });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Medication not found');
    const restored = await tx.medication.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { archivedAt: null },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'medication.restore', subjectId: id });
    return restored;
  });
  res.json(medication);
});
