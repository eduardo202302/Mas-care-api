/**
 * PAUSED (Fase 3, messaging): see src/domain/noticePolicy.ts. Nothing in the
 * app imports this module yet.
 *
 * Messaging provider boundary. Pure types only: no I/O, no business logic —
 * `FakeProvider` and `WhatsAppCloudProvider` implement this against their
 * own transport, and the notice-sending jobs only ever depend on the shape
 * below, never on a specific provider.
 */

export type OutboundTemplateMessage = {
  toPhoneE164: string;
  templateName: string;
  languageCode: string;
  /** Already-rendered values for the template's placeholders — no extra PII. */
  variables: Record<string, string>;
};

export type SendResult = {
  providerMessageId: string;
};

export type InboundDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

export type InboundEvent = {
  providerMessageId: string;
  fromPhone: string;
  receivedAt: Date;
  text?: string;
  buttonPayload?: 'confirm' | 'need_help' | null;
  statusUpdate?: { forProviderMessageId: string; status: InboundDeliveryStatus };
};

export interface MessagingProvider {
  sendTemplate(message: OutboundTemplateMessage): Promise<SendResult>;
  parseWebhook(rawBody: Buffer, headers: Record<string, string>): InboundEvent[];
  verifySignature(rawBody: Buffer, signatureHeader: string, appSecret: string): boolean;
}
