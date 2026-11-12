import type { Prisma } from '@prisma/client';

export type PatientTenant = { organizationId: string; userId: string; allBranches: boolean };

/** Central branch-aware scope used by every patient and nested-resource route. */
export async function patientWhere(
  tx: Prisma.TransactionClient,
  tenant: PatientTenant,
  filter: Prisma.PatientWhereInput = {},
): Promise<Prisma.PatientWhereInput> {
  if (tenant.allBranches) {
    return { AND: [filter], organizationId: tenant.organizationId };
  }
  const memberships = await tx.branchMember.findMany({
    where: { organizationId: tenant.organizationId, userId: tenant.userId },
    select: { branchId: true },
  });
  return {
    AND: [filter, { primaryBranchId: { in: memberships.map(({ branchId }) => branchId) } }],
    organizationId: tenant.organizationId,
  };
}

export async function findAccessiblePatient(
  tx: Prisma.TransactionClient,
  tenant: PatientTenant,
  patientId: string,
  extra: Prisma.PatientWhereInput = {},
) {
  return tx.patient.findFirst({
    where: await patientWhere(tx, tenant, { ...extra, id: patientId }),
  });
}

export async function canAccessBranch(
  tx: Prisma.TransactionClient,
  tenant: PatientTenant,
  branchId: string,
): Promise<boolean> {
  const branch = await tx.branch.findFirst({ where: { id: branchId, archivedAt: null }, select: { id: true } });
  if (!branch) return false;
  if (tenant.allBranches) return true;
  const membership = await tx.branchMember.findFirst({ where: { branchId, userId: tenant.userId }, select: { branchId: true } });
  return Boolean(membership);
}
