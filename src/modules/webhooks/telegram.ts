import { createHash } from 'node:crypto';
import express, { Router } from 'express';
import type { TelegramProvider } from '../../domain/messaging/telegram.js';
import { decryptSecret } from '../../infra/crypto.js';
import { logger } from '../../infra/logger.js';
import { getTelegramProvider } from '../../infra/messaging/index.js';
import { telegramSecretMatches } from '../../infra/messaging/telegramProvider.js';
import { prisma, withTenant } from '../../infra/prisma.js';
import { record } from '../audit/record.js';

export const telegramWebhookRouter = Router();

export type TelegramIngestResult = { status: 200 | 400 | 401 | 404; stored: number; linked: number };

export const hashLinkToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Fixed service texts. The bot never composes a reply to what a patient writes.
const TEXT_LINKED = (pharmacy: string) => `Listo: tu Telegram quedó vinculado a ${pharmacy}. Te avisaremos por aquí cuando te toque reponer tu medicamento.`;
const TEXT_INVALID_LINK = 'Este enlace ya no es válido. Pide uno nuevo en la farmacia.';
const TEXT_NEEDS_LINK = 'Para vincular tu Telegram usa el enlace que te dio la farmacia.';

/** Never let a Telegram hiccup on a courtesy message fail the webhook: Telegram would retry the whole update. */
async function tell(task: Promise<void>) {
  try { await task; } catch (error) { logger.warn({ err: error }, 'telegram service message failed'); }
}

/**
 * One webhook per bot. The URL carries an unguessable key (it identifies the
 * organization) and Telegram echoes a secret header that must match, so a
 * request without both is rejected before anything is read. Replies are stored
 * unprocessed (idempotent by update id) for the worker; `/start <token>` links
 * the patient chat right away.
 */
export async function ingestTelegramWebhook(input: { key: string; secretHeader: string | undefined; rawBody: Buffer; provider: TelegramProvider }): Promise<TelegramIngestResult> {
  const result: TelegramIngestResult = { status: 200, stored: 0, linked: 0 };
  const rows = await prisma.$queryRaw<{ org: string | null }[]>`SELECT telegram_org_for_webhook_key(${input.key}) AS org`;
  const organizationId = rows[0]?.org;
  if (!organizationId) return { ...result, status: 404 };

  const account = await withTenant(organizationId, (tx) => tx.telegramAccount.findFirst());
  if (!account || !telegramSecretMatches(input.secretHeader, decryptSecret(account.webhookSecretEnc))) return { ...result, status: 401 };

  let events;
  try { events = input.provider.parseUpdate(input.rawBody); } catch { return { ...result, status: 400 }; }

  for (const event of events) {
    if (event.isStart) {
      // Opening the bot: redeem the link token (or explain, with a fixed text, that there is nothing to link).
      if (event.startToken === undefined) { await tell(input.provider.sendService(organizationId, event.chatId, TEXT_NEEDS_LINK)); continue; }
      const outcome = await withTenant(organizationId, async (tx) => {
        const token = await tx.telegramLinkToken.findFirst({ where: { tokenHash: hashLinkToken(event.startToken!) } });
        if (!token) return { ok: false as const };
        if (token.usedAt) {
          // The same update delivered twice: already linked to this chat, nothing more to do.
          const already = await tx.telegramLink.findFirst({ where: { patientId: token.patientId, chatId: event.chatId } });
          return already ? { ok: true as const, quiet: true, pharmacy: undefined as string | undefined } : { ok: false as const };
        }
        if (token.expiresAt < new Date()) return { ok: false as const };
        await tx.telegramLink.upsert({
          where: { organizationId_patientId: { organizationId, patientId: token.patientId } },
          create: { organizationId, patientId: token.patientId, chatId: event.chatId },
          update: { chatId: event.chatId, linkedAt: new Date() },
        });
        await tx.telegramLinkToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
        await tx.activity.create({
          data: { organizationId, patientId: token.patientId, type: 'patient_updated', body: 'Telegram vinculado por el paciente', metadata: { channel: 'telegram' }, authorId: token.createdBy },
        });
        await record(tx, { organizationId, actorId: token.createdBy, action: 'patient.telegram.linked', subjectId: token.patientId });
        const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
        return { ok: true as const, quiet: false, pharmacy: organization.name as string | undefined };
      });
      if (outcome.ok && !outcome.quiet) {
        result.linked += 1;
        await tell(input.provider.sendService(organizationId, event.chatId, TEXT_LINKED(outcome.pharmacy ?? '')));
      } else if (!outcome.ok) {
        await tell(input.provider.sendService(organizationId, event.chatId, TEXT_INVALID_LINK));
      }
      continue;
    }
    // A reply (free text or a button): store it as is. Nothing is interpreted here.
    const created = await withTenant(organizationId, (tx) => tx.whatsappInbound.createMany({
      data: [{
        organizationId, channel: 'telegram', providerMessageId: `tg:${organizationId}:${event.updateId}`, fromChatId: event.chatId,
        receivedAt: event.receivedAt, text: event.text ?? null, buttonPayload: event.callbackData ?? null,
      }],
      skipDuplicates: true,
    }));
    result.stored += created.count;
    if (event.callbackQueryId) await tell(input.provider.answerCallback(organizationId, event.callbackQueryId));
  }
  logger.info({ stored: result.stored, linked: result.linked }, 'telegram webhook');
  return result;
}

// The signature-like secret is checked against the stored one, so the body is only parsed after that.
telegramWebhookRouter.post('/:key', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const result = await ingestTelegramWebhook({
    key: String(req.params.key), secretHeader: req.get('x-telegram-bot-api-secret-token'), rawBody, provider: getTelegramProvider(),
  });
  if (result.status === 200) { res.status(200).json({ ok: true }); return; }
  res.status(result.status).json({ error: { code: result.status === 404 ? 'NOT_FOUND' : result.status === 401 ? 'INVALID_SECRET' : 'BAD_REQUEST', message: 'Webhook rejected' } });
});
