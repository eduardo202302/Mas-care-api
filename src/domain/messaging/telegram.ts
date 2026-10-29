import type { SendResult } from './provider.js';

/** The two answers the notice offers as buttons. Same meaning as the WhatsApp quick replies. */
export type ReplyButton = 'confirm' | 'need_help';

export type TelegramOutbound = {
  /** Tenant the message belongs to, so the provider picks that organization bot. */
  organizationId: string;
  chatId: string;
  text: string;
  buttons?: { text: string; callbackData: ReplyButton }[];
};

export type TelegramInboundEvent = {
  updateId: number;
  chatId: string;
  receivedAt: Date;
  text?: string;
  /** The patient opened the bot (`/start`), with or without the link token. */
  isStart?: boolean;
  /** `/start <token>`: the patient opened the link staff gave them. */
  startToken?: string;
  callbackData?: ReplyButton | null;
  callbackQueryId?: string;
};

/** Boundary to Telegram. No business logic: the notice jobs depend only on this shape. */
export interface TelegramProvider {
  sendMessage(message: TelegramOutbound): Promise<SendResult>;
  parseUpdate(rawBody: Buffer): TelegramInboundEvent[];
  /** Tells Telegram the button press was received (stops the spinner on the patient phone). */
  answerCallback(organizationId: string, callbackQueryId: string): Promise<void>;
  /** Sends one fixed service message, e.g. the confirmation after linking. Never free-form replies. */
  sendService(organizationId: string, chatId: string, text: string): Promise<void>;
}
