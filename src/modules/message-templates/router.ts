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
import {
  templateCreate,
  templateListQuery,
  templateParams,
  templatePatch,
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
    const updated = await tx.messageTemplate.update({
      where: { organizationId_id: { organizationId: tenant.organizationId, id } },
      data: nonEmpty({
        branchId: input.branch_id,
        channel: input.channel,
        kind: input.kind,
        name: input.name,
        body: input.body,
        isActive: input.is_active,
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
