import { Router } from 'express';
import { z } from 'zod';
import { branchInput } from '../../schemas/branch.js';
import { puede } from '../../domain/permissions.js';
import { resolveTenant } from '../../infra/tenant.js';
import { withTenant } from '../../infra/prisma.js';
import { ApiError } from '../../infra/errors.js';
import { Prisma } from '@prisma/client';
import { record } from '../audit/record.js';
import { optionalPaging, sliceIfPaged } from '../../infra/pagination.js';
import { validateBody, validateParams } from '../../infra/validate.js';
import { canAccessBranch } from '../../infra/patient-access.js';
import { stockMarkInput, stockMarkParams } from '../../schemas/stock.js';

const compact = (value: object) => Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));

export const branchesRouter = Router();
branchesRouter.use(resolveTenant);
branchesRouter.get('/', async (req, res, next) => {
  try { const t = req.tenant!; if (!puede(t.role, 'branches:read')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
    const branches = await withTenant(t.organizationId, (tx) => tx.branch.findMany({ where: { organizationId: t.organizationId, archivedAt: null }, orderBy: { name: 'asc' } })); res.json(sliceIfPaged(branches, optionalPaging.parse(req.query)));
  } catch (e) { next(e); }
});
branchesRouter.post('/', validateBody(branchInput), async (req, res, next) => {
  try { const t = req.tenant!; if (!puede(t.role, 'branches:write')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
    const input = req.body as z.infer<typeof branchInput>;
    const branch = await withTenant(t.organizationId, async (tx) => {
      const created = await tx.branch.create({ data: { ...compact(input), organizationId: t.organizationId } as Prisma.BranchUncheckedCreateInput });
      await record(tx, { organizationId: t.organizationId, actorId: t.userId, action: 'branch.create', subjectId: created.id });
      return created;
    }); res.status(201).json(branch);
  } catch (e) { next(e); }
});
branchesRouter.get('/:id', validateParams(z.object({ id: z.string().min(1) })), async (req, res, next) => {
  try { const tenant = req.tenant!; if (!puede(tenant.role, 'branches:read')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied'); const params = res.locals.validatedParams as { id: string }; const branch = await withTenant(tenant.organizationId, (tx) => tx.branch.findFirst({ where: { organizationId: tenant.organizationId, id: params.id, archivedAt: null } })); if (!branch) throw new ApiError(404, 'NOT_FOUND', 'Branch not found'); res.json(branch); }
  catch (e) { next(e); }
});
const branchUpdate = branchInput.partial().strict();
branchesRouter.patch('/:id', validateParams(z.object({ id: z.string().min(1) })), validateBody(branchUpdate), async (req, res, next) => {
  try { const t = req.tenant!; if (!puede(t.role, 'branches:write')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied'); const input = compact(req.body as z.infer<typeof branchUpdate>); const params = res.locals.validatedParams as { id: string };
    const branch = await withTenant(t.organizationId, async (tx) => { const exists = await tx.branch.findFirst({ where: { organizationId: t.organizationId, id: params.id, archivedAt: null } }); if (!exists) throw new ApiError(404, 'NOT_FOUND', 'Branch not found'); const updated = await tx.branch.update({ where: { organizationId_id: { organizationId: t.organizationId, id: exists.id } }, data: input as Prisma.BranchUpdateInput }); await record(tx, { organizationId: t.organizationId, actorId: t.userId, action: 'branch.update', subjectId: exists.id }); return updated; }); res.json(branch);
  } catch (e) { next(e); }
});
branchesRouter.delete('/:id', validateParams(z.object({ id: z.string().min(1) })), async (req, res, next) => {
  try { const t = req.tenant!; if (!puede(t.role, 'branches:write')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
    const params = res.locals.validatedParams as { id: string };
    await withTenant(t.organizationId, async (tx) => {
      const exists = await tx.branch.findFirst({ where: { organizationId: t.organizationId, id: params.id, archivedAt: null } });
      if (!exists) throw new ApiError(404, 'NOT_FOUND', 'Branch not found');
      // A branch with active (non-archived) patients cannot be archived: those
      // patients would be left pointing at an archived branch. Report the blocking
      // count so the UI can tell the user how many patients to move first.
      const activePatientsCount = await tx.patient.count({ where: { organizationId: t.organizationId, primaryBranchId: exists.id, archivedAt: null } });
      if (activePatientsCount > 0) {
        throw new ApiError(409, 'BRANCH_HAS_ACTIVE_PATIENTS', 'Branch has active patients and cannot be archived', undefined, { active_patients_count: activePatientsCount });
      }
      await tx.branch.update({ where: { organizationId_id: { organizationId: t.organizationId, id: exists.id } }, data: { archivedAt: new Date() } });
      await record(tx, { organizationId: t.organizationId, actorId: t.userId, action: 'branch.archive', subjectId: exists.id });
    }); res.status(204).end();
  } catch (e) { next(e); }
});
branchesRouter.put('/:branchId/stock-marks/:medicationId', validateParams(stockMarkParams), validateBody(stockMarkInput), async (req, res, next) => {
  try {
    const tenant = req.tenant!;
    if (!puede(tenant.role, 'stock:mark')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
    const { branchId, medicationId } = res.locals.validatedParams as z.infer<typeof stockMarkParams>;
    const { level } = req.body as z.infer<typeof stockMarkInput>;
    const mark = await withTenant(tenant.organizationId, async (tx) => {
      if (!await canAccessBranch(tx, tenant, branchId)) throw new ApiError(404, 'NOT_FOUND', 'Branch not found');
      const medication = await tx.medication.findFirst({ where: { id: medicationId, archivedAt: null }, select: { id: true } });
      if (!medication) throw new ApiError(404, 'NOT_FOUND', 'Medication not found');
      const existing = await tx.medicationStockMark.findFirst({ where: { branchId, medicationId } });
      const reviewedAt = new Date();
      const saved = existing
        ? await tx.medicationStockMark.update({
          where: { organizationId_branchId_medicationId: { organizationId: tenant.organizationId, branchId, medicationId } },
          data: { level, reviewedAt, reviewedBy: tenant.userId },
        })
        : await tx.medicationStockMark.create({
          data: { organizationId: tenant.organizationId, branchId, medicationId, level, reviewedAt, reviewedBy: tenant.userId },
        });
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'stock.mark', subjectId: `${branchId}:${medicationId}` });
      return saved;
    });
    res.json(mark);
  } catch (error) { next(error); }
});
