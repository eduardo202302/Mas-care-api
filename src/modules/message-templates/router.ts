import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { optionalBranchScope } from '../../infra/branch-scope.js';
import { canAccessBranch } from '../../infra/patient-access.js';
import { optionalPaging, sliceIfPaged } from '../../infra/pagination.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateParams, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import { MessagingError } from '../../domain/messaging/provider.js';
import { normalizePhone } from '../../domain/notice.js';
import { getProvider } from '../../infra/messaging/index.js';
import {
  templateCreate,
  templateListQuery,
  templateParams,
  templatePatch,
  templateTestSend,
} from '../../schemas/message-template.js';

export const templatesRouter = Router();
templatesRouter.use(resolveTenant);

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};
const nonEmpty = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

async function findTemplate(tx: Prisma.TransactionClient, tenant: NonNullable<Express.Request['tenant']>, id: string) {
  const scope = await optionalBranchScope(tx, tenant);
  return tx.messageTemplate.findFirst({ where: { AND: [{ id }, scope] } });
}

templatesRouter.get('/', validateQuery(templateListQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'templates:read');
  const query = res.locals.validatedQuery as z.infer<typeof templateListQuery>;
  const data = await withTenant(tenant.organizationId, async (tx) => {
    const scope = await optionalBranchScope(tx, tenant);
    return tx.messageTemplate.findMany({
      where: {
        AND: [
          scope,
          query.channel ? { channel: query.channel } : {},
          query.kind ? { kind: query.kind } : {},
          query.branch_id ? { OR: [{ branchId: query.branch_id }, { branchId: null }] } : {},
          query.active === undefined ? {} : { isActive: query.active },
        ],
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    });
  });
  res.json(sliceIfPaged(data, optionalPaging.parse(req.query)));
});

templatesRouter.post('/', validateBody(templateCreate), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'templates:write');
  const input = req.body as z.infer<typeof templateCreate>;
  const template = await withTenant(tenant.organizationId, async (tx) => {
    if (input.branch_id && !await canAccessBranch(tx, tenant, input.branch_id)) {
      throw new ApiError(404, 'NOT_FOUND', 'Branch not found');
    }
    const created = await tx.messageTemplate.create({
      data: {
        organizationId: tenant.organizationId,
        branchId: input.branch_id ?? null,
        channel: input.channel,
        kind: input.kind,
        name: input.name,
        body: input.body,
        isActive: input.is_active ?? true,
        ...(input.wa_template_name !== undefined ? { waTemplateName: input.wa_template_name } : {}),
        ...(input.wa_language ? { waLanguage: input.wa_language } : {}),
        ...(input.wa_status ? { waStatus: input.wa_status } : {}),
        ...(input.wa_category !== undefined ? { waCategory: input.wa_category } : {}),
        ...(input.attempt_number ? { attemptNumber: input.attempt_number } : {}),
      } as Prisma.MessageTemplateUncheckedCreateInput,
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'template.create', subjectId: created.id });
    return created;
  });
  res.status(201).json(template);
});

templatesRouter.get('/:id', validateParams(templateParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'templates:read');
  const { id } = res.locals.validatedParams as z.infer<typeof templateParams>;
  const template = await withTenant(tenant.organizationId, async (tx) => {
    const found = await findTemplate(tx, tenant, id);
    if (!found) throw new ApiError(404, 'NOT_FOUND', 'Message template not found');
    return found;
  });
  res.json(template);
});

templatesRouter.patch('/:id', validateParams(templateParams), validateBody(templatePatch), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'templates:write');
  const { id } = res.locals.validatedParams as z.infer<typeof templateParams>;
  const input = req.body as z.infer<typeof templatePatch>;
  const template = await withTenant(tenant.organizationId, async (tx) => {
    const current = await findTemplate(tx, tenant, id);
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Message template not found');
    if (input.branch_id && !await canAccessBranch(tx, tenant, input.branch_id)) {
      throw new ApiError(404, 'NOT_FOUND', 'Branch not found');
    }
    const finalStatus = input.wa_status ?? current.waStatus;
    const finalName = input.wa_template_name === undefined ? current.waTemplateName : input.wa_template_name;
    if (finalStatus === 'approved' && !finalName) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Una plantilla aprobada necesita el nombre registrado en Meta', { wa_template_name: 'Obligatorio para una plantilla aprobada' });
    }
    const updated = await tx.messageTemplate.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: nonEmpty({
        branchId: input.branch_id,
        channel: input.channel,
        kind: input.kind,
        name: input.name,
        body: input.body,
        isActive: input.is_active,
        waTemplateName: input.wa_template_name,
        waLanguage: input.wa_language,
        waStatus: input.wa_status,
        waCategory: input.wa_category,
        attemptNumber: input.attempt_number,
      }) as Prisma.MessageTemplateUncheckedUpdateInput,
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'template.update', subjectId: id });
    return updated;
  });
  res.json(template);
});

templatesRouter.delete('/:id', validateParams(templateParams), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'templates:write');
  const { id } = res.locals.validatedParams as z.infer<typeof templateParams>;
  await withTenant(tenant.organizationId, async (tx) => {
    const current = await findTemplate(tx, tenant, id);
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Message template not found');
    await tx.messageTemplate.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: { isActive: false },
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'template.delete', subjectId: id });
  });
  res.status(204).end();
});

/**
 * Sends the template to one number the owner or admin types, to check it
 * before it is used for patients. Only approved templates; the phone number is
 * not written to the audit log.
 */
templatesRouter.post('/:id/test-send', validateParams(templateParams), validateBody(templateTestSend), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'automation:manage');
  const { id } = res.locals.validatedParams as z.infer<typeof templateParams>;
  const input = req.body as z.infer<typeof templateTestSend>;
  const prepared = await withTenant(tenant.organizationId, async (tx) => {
    const template = await findTemplate(tx, tenant, id);
    if (!template) throw new ApiError(404, 'NOT_FOUND', 'Message template not found');
    if (template.channel === 'telegram') throw new ApiError(409, 'TEST_SEND_UNSUPPORTED', 'La prueba de envío solo existe para plantillas de WhatsApp: en Telegram el paciente debe vincular su chat primero');
    if (template.waStatus !== 'approved' || !template.waTemplateName) throw new ApiError(409, 'TEMPLATE_NOT_APPROVED', 'Solo se pueden probar plantillas aprobadas por Meta');
    const settings = await tx.setting.findFirst({ where: { branchId: null }, select: { defaultCountryCode: true } });
    const phone = normalizePhone(input.phone, settings?.defaultCountryCode ?? 'DO');
    if (!phone) throw new ApiError(400, 'VALIDATION_ERROR', 'Teléfono inválido', { phone: 'Teléfono inválido' });
    const organization = await tx.organization.findUniqueOrThrow({ where: { id: tenant.organizationId }, select: { name: true } });
    const variables: Record<string, string> = { paciente: 'Prueba', farmacia: organization.name };
    if (template.body.includes('{{medicamento}}')) variables.medicamento = 'Medicamento de prueba';
    variables.fecha = new Date().toISOString().slice(0, 10);
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'template.test_send', subjectId: id });
    return { organizationId: tenant.organizationId, toPhoneE164: phone, templateName: template.waTemplateName, languageCode: template.waLanguage, variables };
  });
  try {
    const result = await getProvider().sendTemplate(prepared);
    res.json({ sent: true, provider_message_id: result.providerMessageId });
  } catch (error) {
    if (error instanceof MessagingError) throw new ApiError(502, 'PROVIDER_ERROR', 'El proveedor rechazó el envío de prueba', { code: error.code ?? 'provider_error' });
    throw error;
  }
});
