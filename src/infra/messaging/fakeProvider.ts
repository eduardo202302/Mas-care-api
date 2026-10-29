import { randomUUID } from 'node:crypto';
import type {
  InboundEvent,
  MessagingProvider,
  OutboundTemplateMessage,
  SendResult,
} from '../../domain/messaging/provider.js';

/**
 * Default provider outside production: never calls Meta, never touches the
 * network. `sent` records what would have gone out (templates and rendered
 * variables, kept in memory only) and `failWith` lets tests simulate provider
 * failures. Webhook parsing is not simulated yet; the inbound pipeline adds
 * that with the webhook.
 */
export class FakeProvider implements MessagingProvider {
  readonly sent: OutboundTemplateMessage[] = [];
  /** When set, every send throws it (permanent or transient, as the test needs). */
  failWith: Error | null = null;
  /** Artificial latency, so concurrency tests can overlap two workers. */
  delayMs = 0;

  async sendTemplate(message: OutboundTemplateMessage): Promise<SendResult> {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
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
