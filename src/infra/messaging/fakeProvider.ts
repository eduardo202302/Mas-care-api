import { randomUUID } from 'node:crypto';
import type {
  InboundEvent,
  MessagingProvider,
  OutboundTemplateMessage,
  SendResult,
} from '../../domain/messaging/provider.js';

/**
 * PAUSED (Fase 3, messaging): see src/domain/noticePolicy.ts. Nothing in the
 * app imports this module yet — it is never instantiated, so it cannot send
 * anything, real or fake.
 *
 * Default provider outside production: never calls Meta, always "succeeds"
 * with a synthetic message id so the rest of the pipeline (outbox, notices,
 * activities) can be exercised in dev, CI and tests without a real
 * WhatsApp account. `simulateDelivery`/`simulateRead`/`simulateReply` (added
 * once the inbound webhook pipeline exists) let tests and the dev-only
 * endpoint drive delivery events through that same real pipeline.
 */
export class FakeProvider implements MessagingProvider {
  async sendTemplate(message: OutboundTemplateMessage): Promise<SendResult> {
    void message;
    return { providerMessageId: `fake-${randomUUID()}` };
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string>): InboundEvent[] {
    void rawBody;
    void headers;
    return [];
  }

  verifySignature(rawBody: Buffer, signatureHeader: string, appSecret: string): boolean {
    void rawBody;
    void signatureHeader;
    void appSecret;
    return true;
  }
}
