import { describe, expect, it } from 'vitest';
import { MessagingError } from '../src/domain/messaging/provider.js';
import { decideNextAction } from '../src/domain/noticePolicy.js';
import { TelegramBotProvider, parseTelegramUpdate, telegramSecretMatches } from '../src/infra/messaging/telegramProvider.js';
import { getTelegramSetup } from '../src/infra/messaging/telegramSetup.js';

const body = (update: object) => Buffer.from(JSON.stringify(update));
const reply = (status: number, payload: unknown) => (async () => new Response(JSON.stringify(payload), { status })) as unknown as typeof fetch;
const provider = (fetchImpl?: typeof fetch, token: string | null = '123456:ABCDEF-token-token-token-token-1234') =>
  new TelegramBotProvider({ resolveToken: async () => token, ...(fetchImpl ? { fetchImpl } : {}) });
const message = { organizationId: 'org', chatId: '777', text: 'Hola Ana' };

describe('parseTelegramUpdate', () => {
  const privateChat = { id: 777, type: 'private' };
  it('recognises the link token, a bare /start, free text and button presses', () => {
    expect(parseTelegramUpdate(body({ update_id: 1, message: { chat: privateChat, text: '/start abc_DEF-123' } }))[0])
      .toMatchObject({ chatId: '777', isStart: true, startToken: 'abc_DEF-123' });
    const bare = parseTelegramUpdate(body({ update_id: 2, message: { chat: privateChat, text: '/start' } }))[0];
    expect(bare).toMatchObject({ isStart: true });
    expect(bare).not.toHaveProperty('startToken');
    expect(parseTelegramUpdate(body({ update_id: 3, message: { chat: privateChat, text: '/start@mi_bot tok' } }))[0])
      .toMatchObject({ isStart: true, startToken: 'tok' });
    expect(parseTelegramUpdate(body({ update_id: 4, message: { chat: privateChat, text: 'Mañana paso' } }))[0])
      .toMatchObject({ text: 'Mañana paso', callbackData: null });
    expect(parseTelegramUpdate(body({ update_id: 5, callback_query: { id: 'cq1', data: 'confirm', message: { chat: privateChat } } }))[0])
      .toMatchObject({ callbackData: 'confirm', callbackQueryId: 'cq1', chatId: '777' });
    expect(parseTelegramUpdate(body({ update_id: 6, callback_query: { id: 'cq2', data: 'something_else', message: { chat: privateChat } } }))[0])
      .toMatchObject({ callbackData: null });
  });

  it('ignores groups and channels, which can never be linked to a patient', () => {
    expect(parseTelegramUpdate(body({ update_id: 7, message: { chat: { id: -100, type: 'group' }, text: 'hola' } }))).toEqual([]);
    expect(parseTelegramUpdate(body({ update_id: 8, message: { chat: { id: -200, type: 'supergroup' }, text: '/start x' } }))).toEqual([]);
    expect(parseTelegramUpdate(body({ update_id: 9, callback_query: { id: 'c', data: 'confirm', message: { chat: { id: -1, type: 'channel' } } } }))).toEqual([]);
    expect(parseTelegramUpdate(body({ update_id: 10 }))).toEqual([]);
  });
});

describe('webhook secret', () => {
  it('matches only the exact value', () => {
    expect(telegramSecretMatches('s3cret', 's3cret')).toBe(true);
    expect(telegramSecretMatches('s3cre', 's3cret')).toBe(false);
    expect(telegramSecretMatches('S3CRET', 's3cret')).toBe(false);
    expect(telegramSecretMatches(undefined, 's3cret')).toBe(false);
    expect(telegramSecretMatches('', 's3cret')).toBe(false);
  });
});

describe('sendMessage', () => {
  it('posts the text with the two answer buttons and returns a message id', async () => {
    let seen: { url: string; body: Record<string, unknown> } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }));
    }) as unknown as typeof fetch;
    const result = await provider(fetchImpl).sendMessage({ ...message, buttons: [{ text: 'Confirmar', callbackData: 'confirm' }, { text: 'Necesito hablar', callbackData: 'need_help' }] });
    expect(result).toEqual({ providerMessageId: 'tg:777:42' });
    expect(seen!.url).toBe('https://api.telegram.org/bot123456:ABCDEF-token-token-token-token-1234/sendMessage');
    expect(seen!.body).toMatchObject({
      chat_id: '777', text: 'Hola Ana',
      reply_markup: { inline_keyboard: [[{ text: 'Confirmar', callback_data: 'confirm' }, { text: 'Necesito hablar', callback_data: 'need_help' }]] },
    });
  });

  it('classifies failures: a blocked bot or missing chat is permanent; rate limits, server errors and network are transient', async () => {
    const outcome = async (p: TelegramBotProvider) => { try { await p.sendMessage(message); return null; } catch (error) { return error as MessagingError; } };
    expect(await outcome(provider(reply(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' })))).toMatchObject({ permanent: true, code: 'tg_403' });
    expect(await outcome(provider(reply(400, { ok: false, error_code: 400, description: 'chat not found' })))).toMatchObject({ permanent: true, code: 'tg_400' });
    expect(await outcome(provider(reply(401, { ok: false, error_code: 401 })))).toMatchObject({ permanent: true, code: 'tg_401' });
    expect(await outcome(provider(reply(429, { ok: false, error_code: 429, parameters: { retry_after: 5 } })))).toMatchObject({ permanent: false, code: 'tg_429' });
    expect(await outcome(provider(reply(502, {})))).toMatchObject({ permanent: false, code: 'tg_502' });
    expect(await outcome(provider((async () => { throw new Error('socket'); }) as unknown as typeof fetch))).toMatchObject({ permanent: false, code: 'tg_network' });
    expect(await outcome(provider(undefined, null))).toMatchObject({ permanent: true, code: 'no_credentials' });
  });

  it('never copies the Telegram description (it can echo chat data) into the error', async () => {
    try {
      await provider(reply(403, { ok: false, error_code: 403, description: 'Forbidden: user 777 blocked the bot' })).sendMessage(message);
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('777');
    }
  });
});

describe('fake setup', () => {
  it('derives a stable fake username without touching the network', async () => {
    const setup = getTelegramSetup();
    const a = await setup.register('123456:AAA', 'https://x/y', 's');
    const b = await setup.register('123456:AAA', 'https://x/y', 's');
    const c = await setup.register('123456:BBB', 'https://x/y', 's');
    expect(a.username).toBe(b.username);
    expect(a.username).not.toBe(c.username);
    expect(a.username).toMatch(/^fake_[0-9a-f]{8}_bot$/);
  });
});

describe('channel choice in the notice policy', () => {
  const settings = { noticeLeadDays: 5, maxNoticeAttempts: 3, retryAfterHours: 24, timezone: 'America/Santo_Domingo', noticeWindowStart: '09:00', noticeWindowEnd: '18:00', autoCallTaskWithoutConsent: false };
  const treatment = { status: 'active' as const, automationPaused: false, coverageEndOn: new Date('2026-11-01T00:00:00Z') };
  const cycle = { status: 'to_notify' as const, noticeAttempts: 0 };
  const history = { lastNoticeAt: null, lastNoticeWasManual: false };
  const now = new Date('2026-10-27T13:30:00Z');
  const base = { archivedAt: null, automationPaused: false, phone: '8091234567', phoneHasWhatsapp: true, reminderConsent: true };
  const decide = (patient: object) => decideNextAction(cycle, treatment, { ...base, ...patient }, settings, history, now);

  it('uses Telegram when the patient prefers it and linked a chat', () => {
    expect(decide({ preferredChannel: 'telegram', telegramLinked: true })).toEqual({ type: 'send', attempt: 1, channel: 'telegram' });
  });
  it('falls back to WhatsApp when Telegram is preferred but not linked', () => {
    expect(decide({ preferredChannel: 'telegram', telegramLinked: false })).toEqual({ type: 'send', attempt: 1, channel: 'whatsapp' });
  });
  it('keeps WhatsApp for a patient who prefers it, even with Telegram linked', () => {
    expect(decide({ preferredChannel: 'whatsapp', telegramLinked: true })).toEqual({ type: 'send', attempt: 1, channel: 'whatsapp' });
  });
  it('uses Telegram when WhatsApp is not available but a chat is linked', () => {
    expect(decide({ phoneHasWhatsapp: false, telegramLinked: true })).toEqual({ type: 'send', attempt: 1, channel: 'telegram' });
    expect(decide({ phone: null, preferredChannel: 'whatsapp', telegramLinked: true })).toEqual({ type: 'send', attempt: 1, channel: 'telegram' });
  });
  it('creates a call task when no channel can reach the patient', () => {
    expect(decide({ phoneHasWhatsapp: false, telegramLinked: false })).toEqual({ type: 'create_call_task', reason: 'no_whatsapp' });
    expect(decide({ preferredChannel: 'telegram' })).toMatchObject({ type: 'send', channel: 'whatsapp' });
  });
  it('never sends on any channel without consent', () => {
    expect(decide({ reminderConsent: false, preferredChannel: 'telegram', telegramLinked: true })).toEqual({ type: 'skip', reason: 'no_consent' });
  });
});
