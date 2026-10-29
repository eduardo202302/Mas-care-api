import { Router } from 'express';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateBody, validateQuery } from '../../infra/validate.js';
import { record } from '../audit/record.js';
import { automationSettingsPatch, automationSettingsQuery, enrollInput, killSwitchInput, rulePatch, ruleParams } from '../../schemas/automation.js';
import { findOrCreateSetting, updateSetting } from '../../infra/settings.js';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { decryptSecret, encryptSecret } from '../../infra/crypto.js';
import { getTelegramSetup } from '../../infra/messaging/telegramSetup.js';
import { validateParams } from '../../infra/validate.js';
import { findAccessiblePatient } from '../../infra/patient-access.js';
import { automationRuleCatalog, automationRuleKeys, type AutomationRuleKey } from '../../domain/automationRules.js';
import { runRule, runScheduledForOrganization } from './engine.js';

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
  let cancelledCount = 0;
  await withTenant(tenant.organizationId, async (tx) => {
    const current = await findOrCreateSetting(tx, tenant.organizationId, branchId);
    await updateSetting(tx, current.id, { automationEnabled: false });
    // Whatever was waiting to go out stops now; the worker also re-checks the switch before every send.
    const cancelled = await tx.outboxMessage.updateMany({
      where: { status: 'pending', ...(branchId ? { branchId } : {}) },
      data: { status: 'cancelled', cancelledAt: new Date(), lockedAt: null, lastError: 'kill_switch' },
    });
    cancelledCount = cancelled.count;
    await record(tx, {
      organizationId: tenant.organizationId,
      actorId: tenant.userId,
      action: 'automation.kill_switch',
      metadata: { branchId, cancelled: cancelledCount },
    });
  });
  res.json({ automation_enabled: false, branch_id: branchId, cancelled_messages: cancelledCount });
});

const ruleView = (key: AutomationRuleKey, row?: { enabled: boolean; params: unknown } | null) => ({
  key,
  label: automationRuleCatalog[key].label,
  description: automationRuleCatalog[key].description,
  enabled: row?.enabled ?? false,
  params: { ...automationRuleCatalog[key].defaults, ...((row?.params ?? {}) as Record<string, number>) },
});

automationRouter.get('/rules', async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'automation:manage');
  const rows = await withTenant(tenant.organizationId, (tx) => tx.automationRule.findMany());
  res.json({ data: automationRuleKeys.map((key) => ruleView(key, rows.find((row) => row.key === key))) });
});

automationRouter.patch('/rules/:key', validateParams(ruleParams), validateBody(rulePatch), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'automation:manage');
  const { key } = res.locals.validatedParams as z.infer<typeof ruleParams>;
  const input = req.body as z.infer<typeof rulePatch>;
  const row = await withTenant(tenant.organizationId, async (tx) => {
    const current = await tx.automationRule.findFirst({ where: { key } });
    const params = { ...((current?.params ?? {}) as object), ...(input.params ?? {}) } as Prisma.InputJsonObject;
    const data = {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      // The rule acts as whoever last switched it on.
      ...(input.enabled ? { actorId: tenant.userId } : {}),
      params,
    };
    const saved = current
      ? await tx.automationRule.update({ where: { id: current.id }, data })
      : await tx.automationRule.create({ data: { organizationId: tenant.organizationId, key, ...data } });
    await record(tx, {
      organizationId: tenant.organizationId, actorId: tenant.userId, action: 'automation.rule.update',
      subjectId: saved.id, metadata: { key, enabled: saved.enabled },
    });
    return saved;
  });
  res.json(ruleView(key, row));
});

automationRouter.post('/rules/:key/enroll', validateParams(ruleParams), validateBody(enrollInput), async (req, res) => {
  const tenant = req.tenant!;
  if (!puede(tenant.role, 'automation:manage') && !puede(tenant.role, 'treatments:write')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  const { key } = res.locals.validatedParams as z.infer<typeof ruleParams>;
  const input = req.body as z.infer<typeof enrollInput>;
  const result = await withTenant(tenant.organizationId, async (tx) => {
    const patient = await findAccessiblePatient(tx, tenant, input.patientId);
    if (!patient) throw new ApiError(404, 'NOT_FOUND', 'Patient not found');
    const outcome = await runRule(tx, tenant.organizationId, key, input, { manual: true, actorId: tenant.userId });
    await record(tx, {
      organizationId: tenant.organizationId, actorId: tenant.userId, action: 'automation.enroll',
      subjectId: input.cycleId ?? input.treatmentId ?? input.patientId, metadata: { key, outcome: outcome.outcome },
    });
    return outcome;
  });
  if (result.outcome === 'rule_off') throw new ApiError(409, 'RULE_OFF', 'La automatización no está activa');
  if (result.outcome === 'disabled') throw new ApiError(409, 'AUTOMATION_OFF', 'El interruptor general de automatizaciones está apagado');
  res.status(result.outcome === 'done' ? 201 : 200).json(result);
});

/** Manual sweep of the time-based rules (also runs on a timer). */
automationRouter.post('/run', async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'automation:manage');
  res.json({ created: await runScheduledForOrganization(tenant.organizationId) });
});

/**
 * The organization's own WhatsApp Business number. The access token is stored
 * encrypted and is never returned: reads only say whether one is saved.
 */
const whatsappAccountInput = z.object({
  phone_number_id: z.string().trim().regex(/^\d{5,30}$/, 'Es el identificador numérico del número en Meta'),
  access_token: z.string().trim().min(20).max(1000),
}).strict();

automationRouter.get('/whatsapp-account', async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'automation:manage');
  const account = await withTenant(tenant.organizationId, (tx) => tx.whatsappAccount.findFirst());
  res.json({ connected: Boolean(account), phone_number_id: account?.phoneNumberId ?? null });
});

automationRouter.put('/whatsapp-account', validateBody(whatsappAccountInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'automation:manage');
  const input = req.body as z.infer<typeof whatsappAccountInput>;
  const accessTokenEnc = encryptSecret(input.access_token);
  try {
    await withTenant(tenant.organizationId, async (tx) => {
      const current = await tx.whatsappAccount.findFirst();
      if (current) await tx.whatsappAccount.update({ where: { id: current.id }, data: { phoneNumberId: input.phone_number_id, accessTokenEnc } });
      else await tx.whatsappAccount.create({ data: { organizationId: tenant.organizationId, phoneNumberId: input.phone_number_id, accessTokenEnc } });
      // Never the token: only that the credentials changed.
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'automation.whatsapp_account.update', metadata: { phoneNumberId: input.phone_number_id } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError(409, 'PHONE_NUMBER_IN_USE', 'Ese número de WhatsApp ya está conectado a otra organización');
    }
    throw error;
  }
  res.json({ connected: true, phone_number_id: input.phone_number_id });
});

automationRouter.delete('/whatsapp-account', async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'automation:manage');
  await withTenant(tenant.organizationId, async (tx) => {
    await tx.whatsappAccount.deleteMany({});
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'automation.whatsapp_account.delete' });
  });
  res.status(204).end();
});

/**
 * The organization's own Telegram bot (created with @BotFather). Connecting it
 * checks the token with Telegram and registers the webhook; the token and the
 * webhook secret are stored encrypted and never returned.
 */
const telegramAccountInput = z.object({
  bot_token: z.string().trim().regex(/^\d{5,}:[A-Za-z0-9_-]{30,}$/, 'Es el token que entrega @BotFather, con la forma 123456:ABC...'),
}).strict();

automationRouter.get('/telegram-account', async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'automation:manage');
  const account = await withTenant(tenant.organizationId, (tx) => tx.telegramAccount.findFirst());
  res.json({ connected: Boolean(account), bot_username: account?.botUsername ?? null });
});

automationRouter.put('/telegram-account', validateBody(telegramAccountInput), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'automation:manage');
  const { bot_token: token } = req.body as z.infer<typeof telegramAccountInput>;
  const webhookKey = randomBytes(24).toString('hex');
  const webhookSecret = randomBytes(32).toString('hex');
  let username: string;
  try {
    ({ username } = await getTelegramSetup().register(token, `${env.BETTER_AUTH_URL.replace(/\/$/, '')}/webhooks/telegram/${webhookKey}`, webhookSecret));
  } catch {
    throw new ApiError(400, 'INVALID_BOT_TOKEN', 'Telegram no aceptó ese token. Revisa que sea el de tu bot.');
  }
  try {
    await withTenant(tenant.organizationId, async (tx) => {
      const current = await tx.telegramAccount.findFirst();
      const data = { botUsername: username, botTokenEnc: encryptSecret(token), webhookKey, webhookSecretEnc: encryptSecret(webhookSecret) };
      if (current) {
        await tx.telegramAccount.update({ where: { id: current.id }, data });
        // A different bot cannot reach chats opened with the old one, so those links and pending invitations are void.
        if (current.botUsername !== username) {
          await tx.telegramLink.deleteMany({});
          await tx.telegramLinkToken.deleteMany({});
        }
      } else {
        await tx.telegramAccount.create({ data: { organizationId: tenant.organizationId, ...data } });
      }
      await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'automation.telegram_account.update', metadata: { bot: username } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ApiError(409, 'BOT_IN_USE', 'Ese bot ya está conectado a otra organización');
    }
    throw error;
  }
  res.json({ connected: true, bot_username: username });
});

automationRouter.delete('/telegram-account', async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role, 'automation:manage');
  const account = await withTenant(tenant.organizationId, async (tx) => {
    const current = await tx.telegramAccount.findFirst();
    if (!current) return null;
    await tx.telegramLink.deleteMany({});
    await tx.telegramLinkToken.deleteMany({});
    await tx.telegramAccount.delete({ where: { id: current.id } });
    await record(tx, { organizationId: tenant.organizationId, actorId: tenant.userId, action: 'automation.telegram_account.delete' });
    return current;
  });
  // Best effort: stop Telegram from calling a webhook that no longer exists.
  if (account) await getTelegramSetup().unregister(decryptSecret(account.botTokenEnc)).catch(() => undefined);
  res.status(204).end();
});
