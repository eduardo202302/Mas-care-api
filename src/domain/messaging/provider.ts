/**
 * Messaging provider boundary. Pure types only: no I/O, no business logic —
 * `FakeProvider` and `WhatsAppCloudProvider` implement this against their
 * own transport, and the notice-sending jobs only ever depend on the shape
 * below, never on a specific provider.
 */

export type OutboundTemplateMessage = {
  /** Tenant the message belongs to, so a provider can pick that organization's credentials. */
  organizationId: string;
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
  /** Phone number of ours that received the message (identifies the organization). */
  phoneNumberId?: string;
  /** Id of the message of ours this one answers, when the sender used "reply" or a button. */
  contextMessageId?: string;
  statusUpdate?: { forProviderMessageId: string; status: InboundDeliveryStatus };
};

export interface MessagingProvider {
  sendTemplate(message: OutboundTemplateMessage): Promise<SendResult>;
  parseWebhook(rawBody: Buffer, headers: Record<string, string>): InboundEvent[];
  verifySignature(rawBody: Buffer, signatureHeader: string, appSecret: string): boolean;
}

/**
 * A failure reported by a provider. `permanent` errors (invalid number, no
 * WhatsApp account) are never retried: staff get a call task instead.
 */
export class MessagingError extends Error {
  constructor(message: string, readonly permanent: boolean, readonly code?: string) {
    super(message);
    this.name = 'MessagingError';
  }
}
