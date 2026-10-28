import { Router } from 'express';
import type { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { accessibleBranchIds } from '../../infra/branch-scope.js';
import { ApiError } from '../../infra/errors.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateQuery } from '../../infra/validate.js';
import { stockMarkQuery } from '../../schemas/stock.js';

export const stockMarksRouter = Router();
stockMarksRouter.use(resolveTenant);

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

stockMarksRouter.get('/', validateQuery(stockMarkQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'treatments:read');
  const query = res.locals.validatedQuery as z.infer<typeof stockMarkQuery>;
  const data = await withTenant(tenant.organizationId, async (tx) => {
    const ids = await accessibleBranchIds(tx, tenant);
    if (ids !== null && ids.length === 0) return [];
    const marks = await tx.medicationStockMark.findMany({
      where: {
        AND: [
          ...(query.branch_id ? [{ branchId: query.branch_id }] : []),
          ...(query.medication_id ? [{ medicationId: query.medication_id }] : []),
          ...(ids === null ? [] : [{ branchId: { in: ids } }]),
        ],
      },
      orderBy: [{ branchId: 'asc' }, { medicationId: 'asc' }],
      include: {
        branch: { select: { id: true, name: true } },
        medication: { select: { id: true, brandName: true, genericName: true, presentation: true } },
      },
    });
    return marks.map((mark) => ({
      branch_id: mark.branchId,
      medication_id: mark.medicationId,
      level: mark.level,
      reviewed_at: mark.reviewedAt.toISOString(),
      reviewed_by: mark.reviewedBy,
      branch: mark.branch,
      medication: mark.medication,
    }));
  });
  res.json({ data });
});
