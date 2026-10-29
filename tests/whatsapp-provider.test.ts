import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MessagingError } from '../src/domain/messaging/provider.js';
import { decryptSecret, encryptSecret } from '../src/infra/crypto.js';
import { WhatsAppCloudProvider } from '../src/infra/messaging/whatsappCloudProvider.js';
import { isOptOut } from '../src/jobs/processInbound.js';

const secret = 'app-secret';
const sign = (body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
const provider = (fetchImpl?: typeof fetch, creds: { phoneNumberId: string; accessToken: string } | null = { phoneNumberId: '555', accessToken: 'token-token-token-token' }) =>
  new WhatsAppCloudProvider({ resolveCredentials: async () => creds, ...(fetchImpl ? { fetchImpl } : {}) });
const message = { organizationId: 'org', toPhoneE164: '18091234567', templateName: 'aviso_1', languageCode: 'es', variables: { paciente: 'Ana', farmacia: 'Farmacia Demo', fecha: '2026-11-01' } };
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('webhook signature', () => {
  const body = Buffer.from('{"entry":[]}');
  it('accepts the exact signature and rejects tampered, missing or malformed ones', () => {
    const p = provider();
    expect(p.verifySignature(body, sign(body.toString()), secret)).toBe(true);
    expect(p.verifySignature(Buffer.from('{"entry":[1]}'), sign(body.toString()), secret)).toBe(false);
    expect(p.verifySignature(body, sign(body.toString()), 'other-secret')).toBe(false);
    expect(p.verifySignature(body, 'sha1=abcd', secret)).toBe(false);
    expect(p.verifySignature(body, 'sha256=', secret)).toBe(false);
    expect(p.verifySignature(body, 'sha256=zz', secret)).toBe(false);
    expect(p.verifySignature(body, '', secret)).toBe(false);
  });
});

describe('parseWebhook', () => {
  const wrap = (value: object) => Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '555' }, ...value } }] }] }));
  it('reads text, button replies, the answered message and the receiving number', () => {
    const events = provider().parseWebhook(wrap({
      messages: [
        { id: 'm1', from: '18091234567', timestamp: '1790000000', type: 'text', text: { body: 'Hola' } },
        { id: 'm2', from: '18091234567', type: 'button', button: { payload: 'confirm', text: 'Confirmar' }, context: { id: 'wamid.out1' } },
        { id: 'm3', from: '18091234567', type: 'interactive', interactive: { button_reply: { id: 'x', title: 'Necesito hablar' } } },
      ],
    }));
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ providerMessageId: 'm1', text: 'Hola', buttonPayload: null, phoneNumberId: '555' });
    expect(events[0]!.receivedAt.getTime()).toBe(1_790_000_000_000);
    expect(events[1]).toMatchObject({ buttonPayload: 'confirm', contextMessageId: 'wamid.out1' });
    expect(events[2]).toMatchObject({ buttonPayload: 'need_help' });
  });
  it('reads delivery states and ignores unknown ones', () => {
    const events = provider().parseWebhook(wrap({ statuses: [{ id: 'out1', status: 'delivered' }, { id: 'out2', status: 'read' }, { id: 'out3', status: 'weird' }] }));
    expect(events.map((event) => event.statusUpdate)).toEqual([
      { forProviderMessageId: 'out1', status: 'delivered' },
      { forProviderMessageId: 'out2', status: 'read' },
    ]);
  });
});

describe('sendTemplate', () => {
  it('posts the template with the variables as ordered body parameters', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] })); }) as unknown as typeof fetch;
    expect(await provider(fetchImpl).sendTemplate(message)).toEqual({ providerMessageId: 'wamid.1' });
    expect(seen!.url).toBe('https://graph.facebook.com/v21.0/555/messages');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer token-token-token-token');
    expect(JSON.parse(String(seen!.init.body))).toMatchObject({
      to: '18091234567', type: 'template',
      template: { name: 'aviso_1', language: { code: 'es' }, components: [{ type: 'body', parameters: [{ text: 'Ana' }, { text: 'Farmacia Demo' }, { text: '2026-11-01' }] }] },
    });
  });

  it('classifies failures: bad recipient is permanent; rate limits, server errors and network are transient', async () => {
    const outcome = async (p: WhatsAppCloudProvider) => { try { await p.sendTemplate(message); return null; } catch (error) { return error as MessagingError; } };
    expect(await outcome(provider(reply(400, { error: { code: 131026, message: 'undeliverable' } })))).toMatchObject({ permanent: true, code: 'wa_131026' });
    expect(await outcome(provider(reply(400, { error: { code: 130429 } })))).toMatchObject({ permanent: false, code: 'wa_130429' });
    expect(await outcome(provider(reply(503, {})))).toMatchObject({ permanent: false, code: 'wa_503' });
    expect(await outcome(provider((async () => { throw new Error('socket'); }) as unknown as typeof fetch))).toMatchObject({ permanent: false, code: 'wa_network' });
    expect(await outcome(provider(undefined, null))).toMatchObject({ permanent: true, code: 'no_credentials' });
  });

  it('never copies the provider text (it can echo the phone number) into the error', async () => {
    try {
      await provider(reply(400, { error: { code: 131026, message: 'to 18091234567 undeliverable' } })).sendTemplate(message);
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('18091234567');
    }
  });
});

describe('credential encryption', () => {
  const key = Buffer.alloc(32, 3).toString('base64');
  it('round-trips and never stores the plain token', () => {
    const encrypted = encryptSecret('super-secret-token', key);
    expect(encrypted).not.toContain('super-secret-token');
    expect(decryptSecret(encrypted, key)).toBe('super-secret-token');
    expect(encryptSecret('super-secret-token', key)).not.toBe(encrypted);
  });
  it('fails on tampering or the wrong key', () => {
    const encrypted = encryptSecret('x', key);
    const [version, iv, tag] = encrypted.split(':');
    expect(() => decryptSecret(`${version}:${iv}:${tag}:${Buffer.from('zz').toString('base64')}`, key)).toThrow();
    expect(() => decryptSecret(encrypted, Buffer.alloc(32, 4).toString('base64'))).toThrow();
    expect(() => encryptSecret('x', 'short')).toThrow();
  });
});

describe('opt-out words', () => {
  it('matches explicit requests in Spanish and nothing else', () => {
    for (const text of ['BAJA', 'baja', '¡STOP!', 'Stop', 'No quiero recibir mensajes', 'no quiero más mensajes', 'Quiero la baja', 'dejar de recibir avisos', 'No me escriban más']) {
      expect(isOptOut(text), text).toBe(true);
    }
    for (const text of ['Gracias', 'Me baja la presión', 'ok', 'Voy mañana', 'stop por favor no, mañana paso', '', null, undefined]) {
      expect(isOptOut(text), String(text)).toBe(false);
    }
  });
});
