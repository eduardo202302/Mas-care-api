import type { MessagingProvider } from '../../domain/messaging/provider.js';
import type { TelegramProvider } from '../../domain/messaging/telegram.js';
import { env } from '../../config/env.js';
import { decryptSecret } from '../crypto.js';
import { withTenant } from '../prisma.js';
import { FakeProvider } from './fakeProvider.js';
import { FakeTelegramProvider } from './fakeTelegramProvider.js';
import { TelegramBotProvider } from './telegramProvider.js';
import { WhatsAppCloudProvider, type WaCredentials } from './whatsappCloudProvider.js';

/**
 * The organization's own number and token first; otherwise the shared account
 * from the environment, which can send but cannot tell whose a reply is.
 */
export async function loadWhatsappCredentials(organizationId: string): Promise<WaCredentials | null> {
  const account = await withTenant(organizationId, (tx) => tx.whatsappAccount.findFirst());
  if (account) return { phoneNumberId: account.phoneNumberId, accessToken: decryptSecret(account.accessTokenEnc) };
  if (env.WA_PHONE_NUMBER_ID && env.WA_ACCESS_TOKEN) return { phoneNumberId: env.WA_PHONE_NUMBER_ID, accessToken: env.WA_ACCESS_TOKEN };
  return null;
}

/** Each organization has its own bot; there is no shared Telegram bot. */
export async function loadTelegramToken(organizationId: string): Promise<string | null> {
  const account = await withTenant(organizationId, (tx) => tx.telegramAccount.findFirst());
  return account ? decryptSecret(account.botTokenEnc) : null;
}

export const whatsappProvider = () => new WhatsAppCloudProvider({ resolveCredentials: loadWhatsappCredentials, apiVersion: env.WA_API_VERSION });
export const telegramBotProvider = () => new TelegramBotProvider({ resolveToken: loadTelegramToken });

/** `fake` (the default) never touches the network. `live` (or the older `whatsapp`) talks to Meta and Telegram. */
const isFake = () => env.MESSAGING_PROVIDER === 'fake';

export function getProvider(): MessagingProvider {
  return isFake() ? new FakeProvider() : whatsappProvider();
}

export function getTelegramProvider(): TelegramProvider {
  return isFake() ? new FakeTelegramProvider() : telegramBotProvider();
}
