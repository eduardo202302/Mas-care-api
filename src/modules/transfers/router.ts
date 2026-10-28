import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { resolvePaging } from '../../infra/pagination.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import { transferListQuery } from '../../schemas/transfer.js';

export const transfersRouter = Router();
transfersRouter.use(resolveTenant);

// Global listing is intentionally restricted to owner/admin even though
// pharmacist also holds `patient:transfer` (pharmacists can INITIATE a
// transfer from the patient record, but a cross-branch audit list is
// management-only per the block 2 spec). We check both: the permission (so a
// role that never had transfer rights at all gets a clear FORBIDDEN too) and
// an explicit role check for the global-list-only restriction.
transfersRouter.get('/', validateQuery(transferListQuery), async (req, res) => {
  const tenant = req.tenant!;
  if (!puede(tenant.role, 'patient:transfer')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  if (tenant.role !== 'owner' && tenant.role !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'Only owner or admin can view the global transfer list');
  }
  const query = res.locals.validatedQuery as z.infer<typeof transferListQuery>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const { page, rows, skip } = resolvePaging(query);
    const where: Prisma.PatientTransferWhereInput = {
      ...(query.branch_id ? { OR: [{ fromBranchId: query.branch_id }, { toBranchId: query.branch_id }] } : {}),
      ...(query.from || query.to ? {
        createdAt: {
          ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
          ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
        },
      } : {}),
    };
    const [data, total] = await Promise.all([
      tx.patientTransfer.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: rows,
        skip,
        include: {
          patient: { select: { id: true, fullName: true } },
          fromBranch: { select: { id: true, name: true } },
          toBranch: { select: { id: true, name: true } },
          createdByUser: { select: { id: true, name: true } },
        },
      }),
      tx.patientTransfer.count({ where }),
    ]);
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'transfer.list' });
    return {
      data: data.map((row) => ({
        id: row.id,
        occurred_at: row.createdAt,
        patient: { id: row.patient.id, full_name: row.patient.fullName },
        from_branch: { id: row.fromBranch.id, name: row.fromBranch.name },
        to_branch: { id: row.toBranch.id, name: row.toBranch.name },
        reason: row.reason,
        treatments_count: row.treatmentsCount,
        cycles_count: row.cyclesCount,
        created_by: { id: row.createdByUser.id, name: row.createdByUser.name },
      })),
      total,
      page,
      rows,
    };
  });
  res.json(result);
});
