import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { telegramApi } from './telegramApi.js';

/**
 * Connects a bot to the webhook: checks the token (getMe) and registers the
 * URL with the secret Telegram will send back on every call. In `fake` mode it
 * never touches the network and derives a stable fake username.
 */
export type TelegramSetup = {
  register(token: string, webhookUrl: string, secret: string): Promise<{ username: string }>;
  unregister(token: string): Promise<void>;
};

const live: TelegramSetup = {
  async register(token, webhookUrl, secret) {
    const me = await telegramApi.getMe(token);
    if (!me.is_bot || !me.username) throw new Error('El token no es de un bot de Telegram');
    await telegramApi.setWebhook(token, webhookUrl, secret);
    return { username: me.username };
  },
  async unregister(token) {
    await telegramApi.deleteWebhook(token);
  },
};

const fake: TelegramSetup = {
  async register(token) {
    return { username: `fake_${createHash('sha256').update(token).digest('hex').slice(0, 8)}_bot` };
  },
  async unregister() {},
};

export const getTelegramSetup = (): TelegramSetup => (env.MESSAGING_PROVIDER === 'fake' ? fake : live);
