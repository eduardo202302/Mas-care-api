import type { Prisma } from '@prisma/client';
import type { Role } from '../domain/roles.js';

export type TenantScope = { organizationId: string; userId: string; role: Role };

export async function accessibleBranchIds(
  tx: Prisma.TransactionClient,
  tenant: TenantScope,
): Promise<string[] | null> {
  if (tenant.role === 'owner' || tenant.role === 'admin') return null;
  const memberships = await tx.branchMember.findMany({
    where: { organizationId: tenant.organizationId, userId: tenant.userId },
    select: { branchId: true },
  });
  return memberships.map(({ branchId }) => branchId);
}

/** Branch scope for models with a required branchId. */
export async function requiredBranchScope(
  tx: Prisma.TransactionClient,
  tenant: TenantScope,
): Promise<Prisma.TreatmentWhereInput> {
  const ids = await accessibleBranchIds(tx, tenant);
  return ids === null ? {} : { branchId: { in: ids } };
}

/** Branch scope for models where branchId is optional (tasks, templates). */
export async function optionalBranchScope(
  tx: Prisma.TransactionClient,
  tenant: TenantScope,
): Promise<{ OR: Array<Record<string, unknown>> }> {
  const ids = await accessibleBranchIds(tx, tenant);
  if (ids === null) return { OR: [{}] };
  return { OR: [{ branchId: { in: ids } }, { branchId: null }] };
}
