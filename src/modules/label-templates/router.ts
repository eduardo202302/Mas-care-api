import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { optionalBranchScope } from '../../infra/branch-scope.js';
import { canAccessBranch } from '../../infra/patient-access.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import {
  labelTemplateCreate,
  labelTemplateListQuery,
  labelTemplateParams,
  labelTemplatePatch,
  labelTemplatePreviewQuery,
} from '../../schemas/label-template.js';

export const labelTemplatesRouter = Router();
labelTemplatesRouter.use(resolveTenant);

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};
const nonEmpty = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

async function findLabelTemplate(tx: Prisma.TransactionClient, tenant: NonNullable<Express.Request['tenant']>, id: string) {
  const scope = await optionalBranchScope(tx, tenant);
  return tx.labelTemplate.findFirst({ where: { AND: [{ id }, scope] } });
}

labelTemplatesRouter.get('/', validateQuery(labelTemplateListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'templates:read');
  const query = res.locals.validatedQuery as z.infer<typeof labelTemplateListQuery>;
  const data = await withTenant(tenant.organizationId, async (tx) => {
    const scope = await optionalBranchScope(tx, tenant);
    return tx.labelTemplate.findMany({
      where: {
        AND: [
          scope,
          query.branch_id ? { OR: [{ branchId: query.branch_id }, { branchId: null }] } : {},
          query.active === undefined ? {} : { isActive: query.active },
        ],
      },
      orderBy: [{ isDefault: 'desc' }, { isActive: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    });
  });
  res.json({ data });
});

labelTemplatesRouter.post('/', validateBody(labelTemplateCreate), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'templates:write');
  const input = req.body as z.infer<typeof labelTemplateCreate>;
  const template = await withTenant(tenant.organizationId, async (tx) => {
    if (input.branch_id && !await canAccessBranch(tx, tenant, input.branch_id)) {
      throw new ApiError(404, 'NOT_FOUND', 'Branch not found');
    }
    if (input.is_default) {
      await tx.labelTemplate.updateMany({
        where: { organizationId: tenant.organizationId, branchId: input.branch_id ?? null, isDefault: true },
        data: { isDefault: false },
      });
    }
    const created = await tx.labelTemplate.create({
      data: {
        organizationId: tenant.organizationId,
        branchId: input.branch_id ?? null,
        name: input.name,
        description: input.description ?? null,
        widthMm: input.width_mm,
        heightMm: input.height_mm,
        orientation: input.orientation,
        elements: input.elements as Prisma.InputJsonArray,
        isDefault: input.is_default ?? false,
        isActive: input.is_active ?? true,
      } as Prisma.LabelTemplateUncheckedCreateInput,
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'label_template.create', subjectId: created.id });
    return created;
  });
  res.status(201).json(template);
});

labelTemplatesRouter.get('/:id', validateParams(labelTemplateParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'templates:read');
  const { id } = res.locals.validatedParams as z.infer<typeof labelTemplateParams>;
  const template = await withTenant(tenant.organizationId, async (tx) => {
    const found = await findLabelTemplate(tx, tenant, id);
    if (!found) throw new ApiError(404, 'NOT_FOUND', 'Label template not found');
    return found;
  });
  res.json(template);
});

labelTemplatesRouter.patch('/:id', validateParams(labelTemplateParams), validateBody(labelTemplatePatch), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'templates:write');
  const { id } = res.locals.validatedParams as z.infer<typeof labelTemplateParams>;
  const input = req.body as z.infer<typeof labelTemplatePatch>;
  const template = await withTenant(tenant.organizationId, async (tx) => {
    const current = await findLabelTemplate(tx, tenant, id);
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Label template not found');
    if (input.branch_id && !await canAccessBranch(tx, tenant, input.branch_id)) {
      throw new ApiError(404, 'NOT_FOUND', 'Branch not found');
    }
    if (input.is_default) {
      const branchId = input.branch_id === undefined ? current.branchId : input.branch_id;
      await tx.labelTemplate.updateMany({
        where: { organizationId: tenant.organizationId, branchId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
    }
    const updated = await tx.labelTemplate.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: nonEmpty({
        branchId: input.branch_id,
        name: input.name,
        description: input.description,
        widthMm: input.width_mm,
        heightMm: input.height_mm,
        orientation: input.orientation,
        elements: input.elements as Prisma.InputJsonArray | undefined,
        isDefault: input.is_default,
        isActive: input.is_active,
      }) as Prisma.LabelTemplateUncheckedUpdateInput,
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'label_template.update', subjectId: id });
    return updated;
  });
  res.json(template);
});

labelTemplatesRouter.delete('/:id', validateParams(labelTemplateParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'templates:write');
  const { id } = res.locals.validatedParams as z.infer<typeof labelTemplateParams>;
  await withTenant(tenant.organizationId, async (tx) => {
    const current = await findLabelTemplate(tx, tenant, id);
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Label template not found');
    await tx.labelTemplate.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { isActive: false, isDefault: false },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'label_template.delete', subjectId: id });
  });
  res.status(204).end();
});

/**
 * Renders one label's variables against a real treatment (patient + medication
 * + prescriber), for the print preview. Values only - layout/styles stay in
 * the template's `elements` and are applied client-side.
 */
labelTemplatesRouter.get('/:id/preview', validateParams(labelTemplateParams), validateQuery(labelTemplatePreviewQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'templates:read');
  const { id } = res.locals.validatedParams as z.infer<typeof labelTemplateParams>;
  const { treatment_id } = res.locals.validatedQuery as z.infer<typeof labelTemplatePreviewQuery>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const template = await findLabelTemplate(tx, tenant, id);
    if (!template) throw new ApiError(404, 'NOT_FOUND', 'Label template not found');
    const treatment = await tx.treatment.findFirst({ where: { id: treatment_id, organizationId: tenant.organizationId } });
    if (!treatment) throw new ApiError(404, 'NOT_FOUND', 'Treatment not found');
    const [patient, medication, branch, organization, prescriberDoctor] = await Promise.all([
      tx.patient.findFirst({ where: { id: treatment.patientId } }),
      tx.medication.findFirst({ where: { id: treatment.medicationId } }),
      tx.branch.findFirst({ where: { id: treatment.branchId } }),
      tx.organization.findUnique({ where: { id: tenant.organizationId } }),
      treatment.prescriberDoctorId ? tx.doctor.findFirst({ where: { id: treatment.prescriberDoctorId } }) : null,
    ]);
    if (!patient || !medication) throw new ApiError(404, 'NOT_FOUND', 'Patient or medication not found');

    const ageLabel = (() => {
      if (!patient.birthDate) return '';
      const years = Math.floor((Date.now() - patient.birthDate.getTime()) / 31557600000);
      return `${years} ${years === 1 ? 'año' : 'años'}`;
    })();
    const doseUnit = medication.doseUnit || 'unidad';
    const intakesPerDay = Number(treatment.intakesPerDay);
    const frequencyLabel = intakesPerDay === 1 ? 'Una vez al día' : `${intakesPerDay} veces al día`;
    const durationLabel = treatment.endDate
      ? `${Math.max(1, Math.round((treatment.endDate.getTime() - treatment.startDate.getTime()) / 86400000))} días`
      : 'Indefinido';

    const values: Record<string, string> = {
      farmacia_nombre: branch?.name ?? organization?.name ?? '',
      farmacia_telefono: branch?.phone ?? '',
      farmacia_direccion: branch?.description ?? '',
      paciente_nombre: patient.fullName,
      paciente_documento: patient.documentId ?? '',
      paciente_edad: ageLabel,
      medicamento_nombre: medication.brandName ?? medication.genericName ?? medication.activeIngredient ?? medication.presentation,
      medicamento_presentacion: medication.presentation,
      dosis: `${treatment.dosePerIntake} ${doseUnit}`,
      via_administracion: 'Vía oral',
      frecuencia: frequencyLabel,
      duracion: durationLabel,
      cantidad: `${treatment.quantityPerCycle}`,
      instrucciones: treatment.notes ?? '',
      fecha_inicio: treatment.startDate.toISOString().slice(0, 10),
      fecha_fin: treatment.endDate ? treatment.endDate.toISOString().slice(0, 10) : '',
      prescriptor: treatment.prescriberName
        ?? (prescriberDoctor ? `${prescriberDoctor.firstName} ${prescriberDoctor.lastName}`.trim() : ''),
      codigo_tratamiento: treatment.id,
    };
    return { template_id: id, treatment_id, values };
  });
  res.json(result);
});
