import type { Prisma } from '@prisma/client';
import { MessagingError, type MessagingProvider } from '../domain/messaging/provider.js';
import type { TelegramOutbound, TelegramProvider } from '../domain/messaging/telegram.js';
import { normalizePhone, renderNoticeTemplate } from '../domain/notice.js';
import { decideNextAction, type NoticeCycleSnapshot } from '../domain/noticePolicy.js';
import { logger } from '../infra/logger.js';
import { getTelegramProvider } from '../infra/messaging/index.js';
import { withTenant } from '../infra/prisma.js';
import { record } from '../modules/audit/record.js';
import { asSettingsSnapshot, effectiveSettings, historyFor, systemActor } from './shared.js';
import { JOBS, type JobQueue, type SendNoticeData } from './types.js';

type Tx = Prisma.TransactionClient;

export type SendOutcome = {
  outcome: 'sent' | 'cancelled' | 'rescheduled' | 'dry_run' | 'failed' | 'retry' | 'not_claimed' | 'interrupted';
  reason?: string;
};

/** A message stuck in `sending` this long means the worker died mid-send. */
export const STALE_SENDING_MS = 15 * 60_000;
/** Provider attempts per message before it is parked as failed for staff. */
export const MAX_SEND_ATTEMPTS = 5;

type WhatsappPrepared = {
  kind: 'whatsapp';
  organizationId: string;
  toPhoneE164: string;
  templateName: string;
  languageCode: string;
  variables: Record<string, string>;
};
type TelegramPrepared = { kind: 'telegram' } & TelegramOutbound;
type Prepared = WhatsappPrepared | TelegramPrepared;

/**
 * Sends one planned message. The guarantees, in order:
 *  1. Claim: `FOR UPDATE SKIP LOCKED` then status `sending`, so two workers can
 *     never hold the same message.
 *  2. Re-check: the cycle, treatment, consent, pauses, switches and the notice
 *     window are evaluated again with the pure policy; if anything changed the
 *     message is cancelled (or pushed to the next window) instead of sent.
 *  3. Send outside any database transaction.
 *  4. Finish in one transaction: outbox, notice, cycle attempts and state, and
 *     the history entry. A permanent provider error never retries and leaves a
 *     call task; a transient one retries with backoff until MAX_SEND_ATTEMPTS.
 */
export async function sendNotice(options: SendNoticeData & { provider: MessagingProvider; telegram?: TelegramProvider; queue: JobQueue; now?: Date }): Promise<SendOutcome> {
  const { organizationId, outboxId, provider, queue } = options;
  const telegram = options.telegram ?? getTelegramProvider();
  const now = options.now ?? new Date();

  const claim = await withTenant(organizationId, async (tx): Promise<SendOutcome | 'claimed'> => {
    const rows = await tx.$queryRaw<{ id: string; status: string; locked_at: Date | null }[]>`
      SELECT id, status, locked_at FROM outbox_messages
      WHERE id = ${outboxId} AND organization_id = ${organizationId}
        AND (status = 'sending' OR (status = 'pending' AND scheduled_for <= ${now}))
      FOR UPDATE SKIP LOCKED`;
    const row = rows[0];
    if (!row) return { outcome: 'not_claimed' };
    if (row.status === 'sending') {
      const stale = row.locked_at !== null && now.getTime() - row.locked_at.getTime() > STALE_SENDING_MS;
      if (!stale) return { outcome: 'not_claimed' };
      // The send may or may not have reached the provider, so never resend on its own.
      await tx.outboxMessage.update({
        where: { id: outboxId },
        data: { status: 'failed', lockedAt: null, lastError: 'interrupted: confirm delivery before retrying' },
      });
      return { outcome: 'interrupted' };
    }
    await tx.outboxMessage.update({
      where: { id: outboxId },
      data: { status: 'sending', lockedAt: now, attempts: { increment: 1 } },
    });
    return 'claimed';
  });
  if (claim !== 'claimed') return claim;

  const prepared = await withTenant(organizationId, (tx) => recheck(tx, { organizationId, outboxId, now }));
  if ('outcome' in prepared) {
    if (prepared.outcome === 'rescheduled' && prepared.until) {
      await queue.enqueue(JOBS.sendNotice, { organizationId, outboxId }, { singletonKey: outboxId, startAfter: prepared.until });
    }
    return { outcome: prepared.outcome, ...(prepared.reason ? { reason: prepared.reason } : {}) };
  }

  try {
    const result = prepared.kind === 'telegram' ? await telegram.sendMessage(prepared) : await provider.sendTemplate(prepared);
    await withTenant(organizationId, (tx) => finishSent(tx, { organizationId, outboxId, providerMessageId: result.providerMessageId, now }));
    return { outcome: 'sent' };
  } catch (error) {
    const failure = await withTenant(organizationId, (tx) => finishFailed(tx, { organizationId, outboxId, error, now }));
    // Rethrow only after the transaction committed: throwing inside it would roll the retry state back.
    if ('retry' in failure) throw failure.retry;
    return failure;
  }
}

type RecheckResult = Prepared | { outcome: 'cancelled' | 'rescheduled' | 'dry_run'; reason?: string; until?: Date };

async function recheck(tx: Tx, ctx: { organizationId: string; outboxId: string; now: Date }): Promise<RecheckResult> {
  const { organizationId, outboxId, now } = ctx;
  const key = { id: outboxId };
  const outbox = await tx.outboxMessage.findFirstOrThrow({
    where: { id: outboxId },
    include: { patient: { include: { telegramLinks: true } }, treatment: { include: { medication: true } }, cycle: true, template: true },
  });
  const cancel = async (reason: string): Promise<RecheckResult> => {
    await tx.outboxMessage.update({ where: key, data: { status: 'cancelled', cancelledAt: now, lockedAt: null, lastError: reason } });
    return { outcome: 'cancelled', reason };
  };

  const settings = await effectiveSettings(tx, outbox.branchId);
  if (!settings || !settings.automationEnabled) return cancel('automation_disabled');
  if (settings.automationDryRun) {
    await tx.outboxMessage.update({ where: key, data: { status: 'dry_run', lockedAt: null } });
    return { outcome: 'dry_run' };
  }
  const { template, patient, treatment, cycle } = outbox;
  // WhatsApp templates must be approved by Meta; a Telegram message is plain text and needs no approval.
  const templateUsable = template.isActive && (outbox.channel === 'telegram' || (template.waStatus === 'approved' && Boolean(template.waTemplateName)));
  if (!templateUsable) return cancel('template_unavailable');
  if (cycle.closedAt) return cancel('cycle_closed');

  const [notices, activities] = await Promise.all([
    tx.notice.findMany({ where: { cycleId: cycle.id }, orderBy: { sentAt: 'desc' }, select: { cycleId: true, sentAt: true, mode: true, status: true } }),
    tx.activity.findMany({ where: { cycleId: cycle.id, type: { in: ['notice', 'call'] } }, orderBy: { occurredAt: 'desc' }, select: { cycleId: true, occurredAt: true, metadata: true } }),
  ]);
  if (notices.some((notice) => notice.status === 'replied')) return cancel('patient_replied');
  const decision = decideNextAction(
    { status: cycle.status as NoticeCycleSnapshot['status'], noticeAttempts: cycle.noticeAttempts },
    { status: treatment.status, automationPaused: treatment.automationPaused, coverageEndOn: treatment.coverageEndOn },
    { archivedAt: patient.archivedAt, automationPaused: patient.automationPaused, phone: patient.phone, phoneHasWhatsapp: patient.phoneHasWhatsapp, reminderConsent: patient.reminderConsent, preferredChannel: patient.preferredChannel, telegramLinked: patient.telegramLinks.length > 0 },
    asSettingsSnapshot(settings),
    historyFor(cycle.id, notices, activities),
    now,
  );

  if (decision.type === 'wait') {
    // Still valid, just not now (outside the window): come back when it opens.
    await tx.outboxMessage.update({ where: key, data: { status: 'pending', lockedAt: null, scheduledFor: decision.until, attempts: { decrement: 1 } } });
    return { outcome: 'rescheduled', reason: 'outside_window', until: decision.until };
  }
  if (decision.type === 'create_call_task') {
    await ensureCallTask(tx, { organizationId, outbox, reason: decision.reason });
    return cancel(decision.reason);
  }
  if (decision.type !== 'send') return cancel(decision.type === 'skip' ? decision.reason : 'escalation_pending');
  if (decision.attempt !== outbox.attemptNumber) return cancel('attempt_changed');
  if (decision.channel !== outbox.channel) return cancel('channel_changed');

  const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
  // Privacy: first name and pharmacy only. The medication is health data, so it goes out only if the template asks for it.
  const variables: Record<string, string> = { paciente: patient.fullName.trim().split(/\s+/)[0] ?? '', farmacia: organization.name };
  if (template.body.includes('{{medicamento}}')) {
    const medication = treatment.medication;
    variables.medicamento = medication.brandName ?? medication.genericName ?? medication.activeIngredient ?? medication.presentation;
  }
  if (treatment.coverageEndOn) variables.fecha = treatment.coverageEndOn.toISOString().slice(0, 10);
  if (decision.channel === 'telegram') {
    const chatId = patient.telegramLinks[0]?.chatId;
    if (!chatId) return cancel('telegram_not_linked');
    const medication = treatment.medication;
    return {
      kind: 'telegram', organizationId, chatId,
      text: renderNoticeTemplate(template.body, {
        patient: variables.paciente ?? '', pharmacy: organization.name, date: variables.fecha ?? '',
        medication: medication.brandName ?? medication.genericName ?? medication.activeIngredient ?? medication.presentation,
      }),
      buttons: [{ text: 'Confirmar', callbackData: 'confirm' }, { text: 'Necesito hablar', callbackData: 'need_help' }],
    };
  }
  const phone = normalizePhone(patient.phone, settings.defaultCountryCode);
  if (!phone) return cancel('invalid_phone');
  return { kind: 'whatsapp', organizationId, toPhoneE164: phone, templateName: template.waTemplateName!, languageCode: template.waLanguage, variables };
}

async function finishSent(tx: Tx, ctx: { organizationId: string; outboxId: string; providerMessageId: string; now: Date }) {
  const { organizationId, outboxId, providerMessageId, now } = ctx;
  const outbox = await tx.outboxMessage.findFirstOrThrow({ where: { id: outboxId }, include: { cycle: true } });
  await tx.outboxMessage.update({
    where: { id: outboxId },
    data: { status: 'sent', providerMessageId, sentAt: now, lockedAt: null, lastError: null },
  });
  await tx.notice.create({
    data: { organizationId, outboxId, cycleId: outbox.cycleId, patientId: outbox.patientId, mode: 'automatic', status: 'sent', attemptNumber: outbox.attemptNumber, sentAt: now },
  });
  await tx.refillCycle.update({
    where: { organizationId_id: { organizationId, id: outbox.cycleId } },
    data: {
      noticeAttempts: { increment: 1 },
      ...(outbox.cycle.status === 'to_notify' ? { status: 'notified' } : {}),
      version: { increment: 1 },
    },
  });
  const actorId = await systemActor(tx, organizationId);
  if (actorId) {
    await tx.activity.create({
      data: {
        organizationId, patientId: outbox.patientId, treatmentId: outbox.treatmentId, cycleId: outbox.cycleId, type: 'notice',
        body: 'Aviso automático enviado', metadata: { automatic: true, outbox_id: outboxId, attempt: outbox.attemptNumber }, authorId: actorId,
      },
    });
  }
  await record(tx, { organizationId, ...(actorId ? { actorId } : {}), action: 'notice.auto_send', subjectId: outboxId, metadata: { attempt: outbox.attemptNumber } });
}

async function finishFailed(tx: Tx, ctx: { organizationId: string; outboxId: string; error: unknown; now: Date }): Promise<SendOutcome | { retry: unknown }> {
  const { organizationId, outboxId, error, now } = ctx;
  const key = { id: outboxId };
  const outbox = await tx.outboxMessage.findFirstOrThrow({ where: { id: outboxId } });
  const permanent = error instanceof MessagingError && error.permanent;
  // Codes only: provider messages can echo the phone number.
  const code = error instanceof MessagingError ? (error.code ?? (permanent ? 'permanent' : 'transient')) : 'provider_error';
  logger.warn({ outboxId, organizationId, code, permanent, attempts: outbox.attempts }, 'notice send failed');

  if (!permanent && outbox.attempts < MAX_SEND_ATTEMPTS) {
    // Claimable again right away; pg-boss spaces the retries with exponential backoff.
    await tx.outboxMessage.update({ where: key, data: { status: 'pending', lockedAt: null, lastError: code, scheduledFor: now } });
    return { retry: error };
  }
  await tx.outboxMessage.update({ where: key, data: { status: 'failed', lockedAt: null, lastError: code } });
  // The patient blocked the bot or deleted the chat: forget the link so the next notice falls back to another channel.
  if (permanent && outbox.channel === 'telegram' && code === 'tg_403') await tx.telegramLink.deleteMany({ where: { patientId: outbox.patientId } });
  await ensureCallTask(tx, { organizationId, outbox, reason: permanent ? (outbox.channel === 'telegram' ? 'no_telegram' : 'no_whatsapp') : 'send_failed' });
  return { outcome: 'failed', reason: code };
}

async function ensureCallTask(
  tx: Tx,
  ctx: { organizationId: string; outbox: { branchId: string; patientId: string; treatmentId: string; cycleId: string }; reason: string },
) {
  const { organizationId, outbox, reason } = ctx;
  const existing = await tx.task.findFirst({ where: { cycleId: outbox.cycleId, type: 'call', status: 'open', autoGenerated: true }, select: { id: true } });
  if (existing) return;
  const patient = await tx.patient.findFirstOrThrow({ where: { id: outbox.patientId }, select: { fullName: true } });
  const why = reason === 'send_failed' ? 'el aviso automático no pudo enviarse' : reason === 'no_consent' ? 'sin consentimiento de recordatorios' : reason === 'no_telegram' ? 'Telegram no disponible' : 'sin WhatsApp disponible';
  await tx.task.create({
    data: {
      organizationId, branchId: outbox.branchId, type: 'call', status: 'open', autoGenerated: true,
      patientId: outbox.patientId, treatmentId: outbox.treatmentId, cycleId: outbox.cycleId, title: `Llamar a ${patient.fullName}: ${why}`,
    },
  });
}
