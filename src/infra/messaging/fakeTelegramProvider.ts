import { randomUUID } from 'node:crypto';
import type { SendResult } from '../../domain/messaging/provider.js';
import type { TelegramInboundEvent, TelegramOutbound, TelegramProvider } from '../../domain/messaging/telegram.js';
import { parseTelegramUpdate } from './telegramProvider.js';

/** Never touches the network. Records what would have gone out, and can be told to fail. */
export class FakeTelegramProvider implements TelegramProvider {
  readonly sent: TelegramOutbound[] = [];
  readonly service: { chatId: string; text: string }[] = [];
  readonly answered: string[] = [];
  failWith: Error | null = null;
  delayMs = 0;

  async sendMessage(message: TelegramOutbound): Promise<SendResult> {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
    return { providerMessageId: `tg:fake-${randomUUID()}` };
  }

  parseUpdate(rawBody: Buffer): TelegramInboundEvent[] {
    return parseTelegramUpdate(rawBody);
  }

  async answerCallback(_organizationId: string, callbackQueryId: string): Promise<void> {
    this.answered.push(callbackQueryId);
  }

  async sendService(_organizationId: string, chatId: string, text: string): Promise<void> {
    this.service.push({ chatId, text });
  }
}
