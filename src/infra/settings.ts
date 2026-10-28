import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * `branchId` can be NULL (the organization-level row), and Prisma's typed
 * compound-unique shorthand does not accept NULL for a unique field, so this
 * resolves the row with a plain `findFirst` instead of `upsert`.
 */
export async function findOrCreateSetting(tx: Tx, organizationId: string, branchId: string | null = null) {
  const existing = await tx.setting.findFirst({ where: { organizationId, branchId } });
  if (existing) return existing;
  return tx.setting.create({ data: { organizationId, branchId } });
}

export function updateSetting(tx: Tx, id: string, data: Prisma.SettingUpdateInput) {
  return tx.setting.update({ where: { id }, data });
}
