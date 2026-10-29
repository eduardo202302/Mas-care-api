import express, { Router } from 'express';
import type { InboundEvent, MessagingProvider } from '../../domain/messaging/provider.js';
import { env } from '../../config/env.js';
import { logger } from '../../infra/logger.js';
import { prisma, withTenant } from '../../infra/prisma.js';
import { whatsappProvider } from '../../infra/messaging/index.js';

export const whatsappWebhookRouter = Router();

export type IngestResult = { status: 200 | 400 | 401 | 503; stored: number; statuses: number; dropped: number };

/** Which organization an event belongs to: our number that received it, else the message it answers. */
async function organizationFor(event: InboundEvent): Promise<string | null> {
  if (event.phoneNumberId) {
    const rows = await prisma.$queryRaw<{ org: string | null }[]>`SELECT whatsapp_org_for_phone_number(${event.phoneNumberId}) AS org`;
    if (rows[0]?.org) return rows[0].org;
  }
  const messageId = event.contextMessageId ?? event.statusUpdate?.forProviderMessageId;
  if (messageId) {
    const rows = await prisma.$queryRaw<{ org: string | null }[]>`SELECT whatsapp_org_for_provider_message(${messageId}) AS org`;
    if (rows[0]?.org) return rows[0].org;
  }
  return null;
}

const rank: Record<string, number> = { sent: 0, delivered: 1, read: 2, replied: 3 };

/**
 * Verifies the signature over the raw body, then stores what arrived. Nothing
 * is interpreted here: replies are saved as unprocessed rows (idempotent by
 * provider message id) for the worker, so the endpoint answers fast and Meta's
 * retries cannot process a message twice. Delivery states update the notice.
 */
export async function ingestWhatsappWebhook(input: { rawBody: Buffer; signature: string | undefined; provider: MessagingProvider; appSecret: string | undefined }): Promise<IngestResult> {
  const result: IngestResult = { status: 200, stored: 0, statuses: 0, dropped: 0 };
  if (!input.appSecret) return { ...result, status: 503 };
  if (!input.signature || !input.provider.verifySignature(input.rawBody, input.signature, input.appSecret)) return { ...result, status: 401 };
  let events: InboundEvent[];
  try {
    events = input.provider.parseWebhook(input.rawBody, {});
  } catch {
    return { ...result, status: 400 };
  }

  for (const event of events) {
    const organizationId = await organizationFor(event);
    if (!organizationId) { result.dropped += 1; continue; }
    if (event.statusUpdate) {
      const { forProviderMessageId, status } = event.statusUpdate;
      await withTenant(organizationId, async (tx) => {
        const outbox = await tx.outboxMessage.findFirst({ where: { providerMessageId: forProviderMessageId }, include: { notice: true } });
        const notice = outbox?.notice;
        if (!notice) return;
        if (status !== 'failed' && (rank[status] ?? 0) <= (rank[notice.status] ?? 0)) return;
        await tx.notice.update({
          where: { id: notice.id },
          data: status === 'failed'
            ? { status: 'failed', failedAt: event.receivedAt }
            : { status, ...(status === 'delivered' ? { deliveredAt: event.receivedAt } : {}), ...(status === 'read' ? { readAt: event.receivedAt } : {}) },
        });
      });
      result.statuses += 1;
      continue;
    }
    const created = await withTenant(organizationId, (tx) => tx.whatsappInbound.createMany({
      data: [{
        organizationId, providerMessageId: event.providerMessageId, fromPhone: event.fromPhone, receivedAt: event.receivedAt,
        text: event.text ?? null, buttonPayload: event.buttonPayload ?? null,
      }],
      skipDuplicates: true,
    }));
    result.stored += created.count;
  }
  logger.info({ stored: result.stored, statuses: result.statuses, dropped: result.dropped }, 'whatsapp webhook');
  return result;
}

// Meta's one-time check when the webhook URL is registered.
whatsappWebhookRouter.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query as Record<string, string | undefined>;
  if (mode === 'subscribe' && env.WA_VERIFY_TOKEN && token === env.WA_VERIFY_TOKEN && challenge) {
    res.status(200).type('text/plain').send(challenge);
    return;
  }
  res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Verification failed' } });
});

// The signature covers the exact bytes, so this route reads the body raw.
whatsappWebhookRouter.post('/', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const result = await ingestWhatsappWebhook({
    rawBody, signature: req.get('x-hub-signature-256'), provider: whatsappProvider(), appSecret: env.WA_APP_SECRET,
  });
  if (result.status === 200) { res.status(200).json({ ok: true }); return; }
  res.status(result.status).json({ error: { code: result.status === 401 ? 'INVALID_SIGNATURE' : result.status === 503 ? 'WEBHOOK_NOT_CONFIGURED' : 'BAD_REQUEST', message: 'Webhook rejected' } });
});
