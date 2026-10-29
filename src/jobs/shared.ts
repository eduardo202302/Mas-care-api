import type { Prisma } from '@prisma/client';
import type { NoticeHistorySnapshot, NoticeSettingsSnapshot } from '../domain/noticePolicy.js';

type Tx = Prisma.TransactionClient;
export type SettingRow = Awaited<ReturnType<Tx['setting']['findMany']>>[number];

export const asSettingsSnapshot = (settings: SettingRow): NoticeSettingsSnapshot => ({
  noticeLeadDays: settings.noticeLeadDays,
  maxNoticeAttempts: settings.maxNoticeAttempts,
  retryAfterHours: settings.retryAfterHours,
  timezone: settings.timezone,
  noticeWindowStart: settings.noticeWindowStart,
  noticeWindowEnd: settings.noticeWindowEnd,
  autoCallTaskWithoutConsent: settings.autoCallTaskWithoutConsent,
});

/** Branch settings override the organization row; without an organization row automation stays off. */
export async function effectiveSettings(tx: Tx, branchId: string): Promise<SettingRow | null> {
  const rows = await tx.setting.findMany({ where: { OR: [{ branchId: null }, { branchId }] } });
  return rows.find((row) => row.branchId === branchId) ?? rows.find((row) => row.branchId === null) ?? null;
}

/** Owner who authors what the engine creates (activities and incidents need a user). */
export async function systemActor(tx: Tx, organizationId: string): Promise<string | null> {
  const owner = await tx.member.findFirst({ where: { organizationId, role: 'owner' }, orderBy: { createdAt: 'asc' }, select: { userId: true } });
  return owner?.userId ?? null;
}

/** Latest notice for a cycle: an automatic one (notices table) or a manual one staff logged (activity). */
export function historyFor(
  cycleId: string,
  notices: { cycleId: string; sentAt: Date; mode: string }[],
  activities: { cycleId: string | null; occurredAt: Date; metadata: unknown }[],
): NoticeHistorySnapshot {
  const auto = notices.find((row) => row.cycleId === cycleId && row.mode === 'automatic');
  const manual = activities.find((row) => row.cycleId === cycleId && (row.metadata as { logged?: boolean }).logged === true);
  const autoAt = auto?.sentAt ?? null;
  const manualAt = manual?.occurredAt ?? null;
  if (manualAt && (!autoAt || manualAt > autoAt)) return { lastNoticeAt: manualAt, lastNoticeWasManual: true };
  return { lastNoticeAt: autoAt, lastNoticeWasManual: false };
}
