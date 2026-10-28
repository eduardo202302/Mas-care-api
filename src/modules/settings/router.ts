import { Router } from 'express';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import { settingsPatch } from '../../schemas/settings.js';
import { findOrCreateSetting, updateSetting } from '../../infra/settings.js';

export const settingsRouter = Router();
settingsRouter.use(resolveTenant);

const requirePermission = (role: Parameters<typeof puede>[0], action: Parameters<typeof puede>[1]) => {
  if (!puede(role, action)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

const serialize = (row: {
  id: string;
  organizationId: string;
  upcomingDays: number;
  dueSoonDays: number;
  noticeLeadDays: number;
  maxNoticeAttempts: number;
  retryAfterHours: number;
  prescriptionWarningDays: number;
}) => ({
  id: row.id,
  organization_id: row.organizationId,
  upcoming_days: row.upcomingDays,
  due_soon_days: row.dueSoonDays,
  notice_lead_days: row.noticeLeadDays,
  max_notice_attempts: row.maxNoticeAttempts,
  retry_after_hours: row.retryAfterHours,
  prescription_warning_days: row.prescriptionWarningDays,
});

settingsRouter.get('/', async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'settings:read');
  const settings = await withTenant(tenant.organizationId, (tx) => findOrCreateSetting(tx, tenant.organizationId));
  res.json(serialize(settings));
});

settingsRouter.patch('/', validateBody(settingsPatch), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'settings:write');
  const input = req.body as z.infer<typeof settingsPatch>;
  const settings = await withTenant(tenant.organizationId, async (tx) => {
    const current = await findOrCreateSetting(tx, tenant.organizationId);
    const dueSoonDays = input.due_soon_days ?? current.dueSoonDays;
    const upcomingDays = input.upcoming_days ?? current.upcomingDays;
    if (dueSoonDays >= upcomingDays) {
      throw new ApiError(400, 'INVALID_THRESHOLDS', 'due_soon_days must be less than upcoming_days');
    }
    const updated = await updateSetting(tx, current.id, {
      ...(input.due_soon_days !== undefined ? { dueSoonDays: input.due_soon_days } : {}),
      ...(input.upcoming_days !== undefined ? { upcomingDays: input.upcoming_days } : {}),
      ...(input.prescription_warning_days !== undefined ? { prescriptionWarningDays: input.prescription_warning_days } : {}),
    });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'settings.update', subjectId: updated.id });
    return updated;
  });
  res.json(serialize(settings));
});
