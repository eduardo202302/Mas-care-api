import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  MessagingError,
  type InboundDeliveryStatus,
  type InboundEvent,
  type MessagingProvider,
  type OutboundTemplateMessage,
  type SendResult,
} from '../../domain/messaging/provider.js';

export type WaCredentials = { phoneNumberId: string; accessToken: string };

/**
 * Meta error codes that retrying cannot fix (bad recipient, template or
 * parameters): the message fails at once and staff are asked to call.
 */
const PERMANENT_CODES = new Set([100, 131009, 131021, 131026, 131030, 132000, 132001, 132005, 132007, 132012, 132015, 132016]);

const statusMap: Record<string, InboundDeliveryStatus> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** The quick-reply buttons of the notice template: payloads we define, with Spanish titles as a fallback. */
function buttonKind(payload: string | undefined, title: string | undefined): 'confirm' | 'need_help' | null {
  for (const raw of [payload, title]) {
    if (!raw) continue;
    const value = normalize(raw);
    if (value === 'confirm' || value === 'confirmar') return 'confirm';
    if (value === 'need_help' || value === 'necesito hablar') return 'need_help';
  }
  return null;
}

type WaWebhook = {
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: {
          id: string;
          from: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          button?: { payload?: string; text?: string };
          interactive?: { button_reply?: { id?: string; title?: string } };
          context?: { id?: string };
        }[];
        statuses?: { id: string; status: string; timestamp?: string }[];
      };
    }[];
  }[];
};

/**
 * WhatsApp Business Cloud API (Meta). Credentials come from a resolver, one
 * set per organization (or a shared account for sending). Template variables
 * are sent as the body parameters {{1}}, {{2}}… in the order they appear in
 * `variables`: paciente, farmacia, then medicamento and fecha when present.
 * Error text from Meta is never copied into our errors or logs: it can echo
 * the recipient's number.
 */
export class WhatsAppCloudProvider implements MessagingProvider {
  constructor(private readonly deps: {
    resolveCredentials: (organizationId: string) => Promise<WaCredentials | null>;
    apiVersion?: string;
    fetchImpl?: typeof fetch;
  }) {}

  async sendTemplate(message: OutboundTemplateMessage): Promise<SendResult> {
    const credentials = await this.deps.resolveCredentials(message.organizationId);
    if (!credentials) throw new MessagingError('No WhatsApp credentials for this organization', true, 'no_credentials');
    const doFetch = this.deps.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await doFetch(`https://graph.facebook.com/${this.deps.apiVersion ?? 'v21.0'}/${credentials.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: message.toPhoneE164,
          type: 'template',
          template: {
            name: message.templateName,
            language: { code: message.languageCode },
            components: [{ type: 'body', parameters: Object.values(message.variables).map((text) => ({ type: 'text', text })) }],
          },
        }),
      });
    } catch {
      throw new MessagingError('WhatsApp request failed', false, 'wa_network');
    }
    const payload = (await response.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { code?: number } };
    if (!response.ok) {
      const code = payload.error?.code;
      const permanent = code !== undefined && PERMANENT_CODES.has(code);
      throw new MessagingError('WhatsApp rejected the message', permanent, `wa_${code ?? response.status}`);
    }
    const id = payload.messages?.[0]?.id;
    if (!id) throw new MessagingError('WhatsApp returned no message id', false, 'wa_no_id');
    return { providerMessageId: id };
  }

  parseWebhook(rawBody: Buffer): InboundEvent[] {
    const body = JSON.parse(rawBody.toString('utf8')) as WaWebhook;
    const events: InboundEvent[] = [];
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;
        const phoneNumberId = value.metadata?.phone_number_id;
        for (const message of value.messages ?? []) {
          const reply = message.interactive?.button_reply;
          const text = message.text?.body ?? message.button?.text ?? reply?.title;
          events.push({
            providerMessageId: message.id,
            fromPhone: message.from,
            receivedAt: new Date(message.timestamp ? Number(message.timestamp) * 1000 : Date.now()),
            ...(text ? { text } : {}),
            buttonPayload: buttonKind(message.button?.payload ?? reply?.id, message.button?.text ?? reply?.title),
            ...(phoneNumberId ? { phoneNumberId } : {}),
            ...(message.context?.id ? { contextMessageId: message.context.id } : {}),
          });
        }
        for (const status of value.statuses ?? []) {
          const mapped = statusMap[status.status];
          if (!mapped) continue;
          events.push({
            providerMessageId: status.id,
            fromPhone: '',
            receivedAt: new Date(status.timestamp ? Number(status.timestamp) * 1000 : Date.now()),
            statusUpdate: { forProviderMessageId: status.id, status: mapped },
            ...(phoneNumberId ? { phoneNumberId } : {}),
          });
        }
      }
    }
    return events;
  }

  verifySignature(rawBody: Buffer, signatureHeader: string, appSecret: string): boolean {
    const [scheme, received] = signatureHeader.split('=');
    if (scheme !== 'sha256' || !received) return false;
    const expected = createHmac('sha256', appSecret).update(rawBody).digest();
    let actual: Buffer;
    try { actual = Buffer.from(received, 'hex'); } catch { return false; }
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
