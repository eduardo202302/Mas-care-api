import { Router } from 'express';
import type { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import { automationSettingsPatch, automationSettingsQuery, killSwitchInput } from '../../schemas/automation.js';
import { findOrCreateSetting, updateSetting } from '../../infra/settings.js';

export const automationRouter = Router();
automationRouter.use(resolveTenant);

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

const serialize = (row: {
  id: string;
  organizationId: string;
  branchId: string | null;
  noticeLeadDays: number;
  maxNoticeAttempts: number;
  retryAfterHours: number;
  automationEnabled: boolean;
  automationDryRun: boolean;
  timezone: string;
  noticeWindowStart: string;
  noticeWindowEnd: string;
  autoCallTaskWithoutConsent: boolean;
  defaultCountryCode: string;
}) => ({
  id: row.id,
  organization_id: row.organizationId,
  branch_id: row.branchId,
  notice_lead_days: row.noticeLeadDays,
  max_notice_attempts: row.maxNoticeAttempts,
  retry_after_hours: row.retryAfterHours,
  automation_enabled: row.automationEnabled,
  automation_dry_run: row.automationDryRun,
  timezone: row.timezone,
  notice_window_start: row.noticeWindowStart,
  notice_window_end: row.noticeWindowEnd,
  auto_call_task_without_consent: row.autoCallTaskWithoutConsent,
  default_country_code: row.defaultCountryCode,
});

automationRouter.get('/settings', validateQuery(automationSettingsQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'automation:manage');
  const query = res.locals.validatedQuery as z.infer<typeof automationSettingsQuery>;
  const branchId = query.branch_id ?? null;
  const settings = await withTenant(tenant.organizationId, (tx) => findOrCreateSetting(tx, tenant.organizationId, branchId));
  res.json(serialize(settings));
});

automationRouter.patch('/settings', validateBody(automationSettingsPatch), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'automation:manage');
  const input = req.body as z.infer<typeof automationSettingsPatch>;
  const branchId = input.branch_id ?? null;
  const settings = await withTenant(tenant.organizationId, async (tx) => {
    const current = await findOrCreateSetting(tx, tenant.organizationId, branchId);
    const updated = await updateSetting(tx, current.id, {
      ...(input.automation_enabled !== undefined ? { automationEnabled: input.automation_enabled } : {}),
      ...(input.automation_dry_run !== undefined ? { automationDryRun: input.automation_dry_run } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.notice_lead_days !== undefined ? { noticeLeadDays: input.notice_lead_days } : {}),
      ...(input.max_notice_attempts !== undefined ? { maxNoticeAttempts: input.max_notice_attempts } : {}),
      ...(input.retry_after_hours !== undefined ? { retryAfterHours: input.retry_after_hours } : {}),
      ...(input.notice_window_start !== undefined ? { noticeWindowStart: input.notice_window_start } : {}),
      ...(input.notice_window_end !== undefined ? { noticeWindowEnd: input.notice_window_end } : {}),
      ...(input.auto_call_task_without_consent !== undefined ? { autoCallTaskWithoutConsent: input.auto_call_task_without_consent } : {}),
      ...(input.default_country_code !== undefined ? { defaultCountryCode: input.default_country_code } : {}),
    });
    await record(tx, {
      organizationId: tenant.organizationId,
      actorId: tenant.userId,
      action: 'automation.settings.update',
      subjectId: updated.id,
      metadata: { branchId, fields: Object.keys(input).filter((key) => key !== 'branch_id') },
    });
    return updated;
  });
  res.json(serialize(settings));
});

automationRouter.post('/kill-switch', validateBody(killSwitchInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'automation:manage');
  const input = req.body as z.infer<typeof killSwitchInput>;
  const branchId = input.branch_id ?? null;
  await withTenant(tenant.organizationId, async (tx) => {
    const current = await findOrCreateSetting(tx, tenant.organizationId, branchId);
    await updateSetting(tx, current.id, { automationEnabled: false });
    // Pending outbox messages are cancelled once outbox_messages exists (chunk 3).
    await record(tx, {
      organizationId: tenant.organizationId,
      actorId: tenant.userId,
      action: 'automation.kill_switch',
      metadata: { branchId },
    });
  });
  res.json({ automation_enabled: false, branch_id: branchId });
});
