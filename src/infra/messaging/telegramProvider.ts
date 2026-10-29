import { createHash, timingSafeEqual } from 'node:crypto';
import { MessagingError, type SendResult } from '../../domain/messaging/provider.js';
import type { ReplyButton, TelegramInboundEvent, TelegramOutbound, TelegramProvider } from '../../domain/messaging/telegram.js';
import { telegramApi } from './telegramApi.js';

type Update = {
  update_id: number;
  message?: { chat?: { id: number; type?: string }; text?: string; date?: number };
  callback_query?: { id: string; data?: string; message?: { chat?: { id: number; type?: string } } };
};

const buttonOf = (data: string | undefined): ReplyButton | null => (data === 'confirm' || data === 'need_help' ? data : null);

/** Constant-time comparison of the secret header Telegram echoes on every webhook call. */
export function telegramSecretMatches(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const a = createHash('sha256').update(received).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Reads the raw webhook body into events. Group chats are ignored: only a private chat can be linked to a patient. */
export function parseTelegramUpdate(rawBody: Buffer): TelegramInboundEvent[] {
  const update = JSON.parse(rawBody.toString('utf8')) as Update;
  const events: TelegramInboundEvent[] = [];
  const message = update.message;
  if (message?.chat?.id !== undefined && message.chat.type === 'private') {
    const text = message.text?.trim();
    const start = text?.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/);
    events.push({
      updateId: update.update_id,
      chatId: String(message.chat.id),
      receivedAt: new Date(message.date ? message.date * 1000 : Date.now()),
      ...(start ? { isStart: true, ...(start[1] ? { startToken: start[1] } : {}) } : text ? { text } : {}),
      callbackData: null,
    });
  }
  const callback = update.callback_query;
  const callbackChat = callback?.message?.chat;
  if (callback && callbackChat?.id !== undefined && callbackChat.type === 'private') {
    events.push({
      updateId: update.update_id,
      chatId: String(callbackChat.id),
      receivedAt: new Date(),
      callbackData: buttonOf(callback.data),
      callbackQueryId: callback.id,
    });
  }
  return events;
}

/** Telegram Bot API, with each organization own bot token. */
export class TelegramBotProvider implements TelegramProvider {
  constructor(private readonly deps: { resolveToken: (organizationId: string) => Promise<string | null>; fetchImpl?: typeof fetch }) {}

  private async token(organizationId: string): Promise<string> {
    const token = await this.deps.resolveToken(organizationId);
    if (!token) throw new MessagingError('No Telegram bot for this organization', true, 'no_credentials');
    return token;
  }

  async sendMessage(message: TelegramOutbound): Promise<SendResult> {
    const token = await this.token(message.organizationId);
    const result = await telegramApi.sendMessage(token, {
      chat_id: message.chatId,
      text: message.text,
      disable_web_page_preview: true,
      ...(message.buttons?.length
        ? { reply_markup: { inline_keyboard: [message.buttons.map((button) => ({ text: button.text, callback_data: button.callbackData }))] } }
        : {}),
    }, this.deps.fetchImpl);
    return { providerMessageId: `tg:${message.chatId}:${result.message_id}` };
  }

  parseUpdate(rawBody: Buffer): TelegramInboundEvent[] {
    return parseTelegramUpdate(rawBody);
  }

  async answerCallback(organizationId: string, callbackQueryId: string): Promise<void> {
    await telegramApi.answerCallbackQuery(await this.token(organizationId), callbackQueryId, this.deps.fetchImpl);
  }

  async sendService(organizationId: string, chatId: string, text: string): Promise<void> {
    await telegramApi.sendMessage(await this.token(organizationId), { chat_id: chatId, text, disable_web_page_preview: true }, this.deps.fetchImpl);
  }
}
