/**
 * Tests for user registration (username/phone/PIN) and PIN-based password recovery.
 *
 * Run DB tests:  RUN_DB_TESTS=1 npm test
 * Unit tests run always (no DB required).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import {
  generatePin,
  hashPin,
  verifyPin,
  generateResetToken,
  hashResetToken,
  encryptPin,
  decryptPin,
} from '../src/infra/pin-crypto.js';
import { prisma } from '../src/infra/prisma.js';

// ---------------------------------------------------------------------------
// Unit tests (no DB)
// ---------------------------------------------------------------------------

describe('pin-crypto unit tests', () => {
  it('generatePin returns a 6-digit zero-padded string', () => {
    for (let i = 0; i < 20; i++) {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{6}$/);
    }
  });

  it('hashPin / verifyPin round-trip succeeds', () => {
    const pin = '042817';
    const stored = hashPin(pin);
    expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(verifyPin(pin, stored)).toBe(true);
  });

  it('verifyPin rejects a wrong PIN', () => {
    const stored = hashPin('123456');
    expect(verifyPin('999999', stored)).toBe(false);
  });

  it('two calls to hashPin produce different hashes (salt is random)', () => {
    const h1 = hashPin('123456');
    const h2 = hashPin('123456');
    expect(h1).not.toBe(h2);
    expect(verifyPin('123456', h1)).toBe(true);
    expect(verifyPin('123456', h2)).toBe(true);
  });

  it('encryptPin / decryptPin round-trip succeeds', () => {
    const stored = encryptPin('042817');
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain('042817');
    expect(decryptPin(stored)).toBe('042817');
  });

  it('decryptPin rejects tampered payloads', () => {
    const [version, iv, tag, data] = encryptPin('042817').split(':');
    const tagBytes = Buffer.from(tag!, 'base64url');
    tagBytes[0] = tagBytes[0]! ^ 0xff;
    const tamperedTag = tagBytes.toString('base64url');
    expect(decryptPin([version, iv, tamperedTag, data].join(':'))).toBeNull();
  });

  it('generateResetToken is 64 hex chars', () => {
    const token = generateResetToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashResetToken is deterministic', () => {
    const token = generateResetToken();
    expect(hashResetToken(token)).toBe(hashResetToken(token));
  });

  it('different tokens produce different hashes', () => {
    expect(hashResetToken(generateResetToken())).not.toBe(hashResetToken(generateResetToken()));
  });
});

// ---------------------------------------------------------------------------
// Integration tests (require DB)
// ---------------------------------------------------------------------------

const enabled = process.env.RUN_DB_TESTS === '1';

const unique = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

describe.skipIf(!enabled)('POST /api/v1/register', () => {
  it('rejects missing fields', async () => {
    const res = await request(app).post('/api/v1/register').send({ email: 'bad' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields).toHaveProperty('name');
    expect(res.body.error.fields).toHaveProperty('username');
    expect(res.body.error.fields).toHaveProperty('organizationName');
  });

  it('rejects invalid username characters', async () => {
    const res = await request(app).post('/api/v1/register').send({
      name: 'Test',
      username: 'hello world!',
      email: 'x@example.com',
      password: 'password123',
      organizationName: 'Farmacia',
    }).expect(400);
    expect(res.body.error.fields).toHaveProperty('username');
  });

  it('rejects an invalid recovery PIN', async () => {
    const res = await request(app).post('/api/v1/register').send({
      name: 'Test',
      username: `pin_${unique()}`,
      email: `pin_${unique()}@example.com`,
      password: 'password123',
      pin: '12ab',
      organizationName: 'Farmacia',
    }).expect(400);
    expect(res.body.error.fields).toHaveProperty('pin');
  });

  it('creates user + org and stores the encrypted PIN', async () => {
    const tag = unique();
    const pin = '042817';
    const res = await request(app).post('/api/v1/register').send({
      name: 'Test User',
      username: `testuser_${tag}`,
      email: `test_${tag}@example.com`,
      phone: '3101234567',
      password: 'Password123!',
      pin,
      organizationName: `Farmacia ${tag}`,
    }).expect(201);

    expect(res.body.user.username).toBe(`testuser_${tag}`);
    expect(res.body.user.phone).toBe('3101234567');
    expect(res.body.organization).toHaveProperty('id');
    expect(res.body.role).toBe('owner');
    expect(res.headers['set-cookie']).toBeDefined();

    const stored = await prisma.user.findUnique({
      where: { email: `test_${tag}@example.com` },
      select: { passwordPinEncrypted: true },
    });
    expect(stored?.passwordPinEncrypted).toBeTruthy();
    expect(stored?.passwordPinEncrypted).not.toContain(pin);
    expect(decryptPin(stored!.passwordPinEncrypted!)).toBe(pin);
  });

  it('rejects duplicate email', async () => {
    const tag = unique();
    const body = {
      name: 'A', username: `a_${tag}`, email: `dup_${tag}@example.com`,
      password: 'Password123!', organizationName: `Org ${tag}`,
    };
    await request(app).post('/api/v1/register').send(body).expect(201);
    const res = await request(app).post('/api/v1/register').send({ ...body, username: `b_${tag}` });
    // Better Auth owns the duplicate-email status; the contract only requires a 4xx.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body).toBeDefined();
  });

  it('rejects duplicate username', async () => {
    const tag = unique();
    const uname = `shared_${tag}`;
    await request(app).post('/api/v1/register').send({
      name: 'First', username: uname, email: `first_${tag}@example.com`,
      password: 'Password123!', organizationName: `Org 1 ${tag}`,
    }).expect(201);
    const res = await request(app).post('/api/v1/register').send({
      name: 'Second', username: uname, email: `second_${tag}@example.com`,
      password: 'Password123!', organizationName: `Org 2 ${tag}`,
    }).expect(409);
    expect(res.body.error.code).toBe('USERNAME_IN_USE');
  });
});

describe.skipIf(!enabled)('password recovery full flow', () => {
  const pin = '042817';
  let email: string;
  let username: string;
  let agent: ReturnType<typeof request.agent>;

  async function resetStoredPin(value: string) {
    await prisma.user.update({
      where: { email },
      data: {
        passwordPinEncrypted: encryptPin(value),
        passwordPinAttempts: 0,
        passwordPinLockedAt: null,
      },
    });
  }

  beforeAll(async () => {
    const tag = unique();
    email = `recovery_${tag}@example.com`;
    username = `recovery_${tag}`;
    await request(app).post('/api/v1/register').send({
      name: 'Recovery Test',
      username,
      email,
      phone: '3009876543',
      password: 'OldPassword1!',
      pin,
      organizationName: `Farmacia Recovery ${tag}`,
    }).expect(201);
    agent = request.agent(app);
  });

  beforeEach(async () => {
    await resetStoredPin(pin);
  });

  it('forgot-password returns 202 for unknown identifier (no enumeration)', async () => {
    const res = await request(app).post('/api/v1/auth/forgot-password')
      .send({ identifier: 'nobody@nowhere.com' }).expect(202);
    expect(res.body.message).toContain('PIN');
    expect(res.body._devPin).toBeUndefined();
  });

  it('forgot-password never returns the PIN', async () => {
    const res = await request(app).post('/api/v1/auth/forgot-password')
      .send({ identifier: email }).expect(202);
    expect(res.body.message).toContain('PIN');
    expect(res.body._devPin).toBeUndefined();
  });

  it('verify-pin rejects a wrong PIN', async () => {
    const res = await request(app).post('/api/v1/auth/verify-pin')
      .send({ identifier: email, pin: '000000' }).expect(400);
    expect(res.body.error.code).toBe('PIN_INVALID');
  });

  it('full flow: verify PIN, reset password and login with new password', async () => {
    const vpRes = await request(app).post('/api/v1/auth/verify-pin')
      .send({ identifier: username, pin }).expect(200);
    const { resetToken, expiresAt } = vpRes.body;
    expect(resetToken).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    const rpRes = await request(app).post('/api/v1/auth/reset-password')
      .send({ resetToken, newPassword: 'NewPassword2!' }).expect(200);
    expect(rpRes.body.message).toContain('sesión');

    await agent.post('/api/auth/sign-in/email')
      .send({ email, password: 'NewPassword2!' }).expect(200);

    await request(app).post('/api/auth/sign-in/email')
      .send({ email, password: 'OldPassword1!' }).expect(401);
  });

  it('rotates the PIN immediately after a successful verification', async () => {
    await request(app).post('/api/v1/auth/verify-pin')
      .send({ identifier: email, pin }).expect(200);

    const res = await request(app).post('/api/v1/auth/verify-pin')
      .send({ identifier: email, pin }).expect(400);
    expect(res.body.error.code).toBe('PIN_INVALID');
  });

  it('reset token is single-use', async () => {
    await resetStoredPin('135790');
    const vpRes = await request(app).post('/api/v1/auth/verify-pin')
      .send({ identifier: email, pin: '135790' }).expect(200);
    const { resetToken } = vpRes.body;

    await request(app).post('/api/v1/auth/reset-password')
      .send({ resetToken, newPassword: 'YetAnother3!' }).expect(200);

    const res = await request(app).post('/api/v1/auth/reset-password')
      .send({ resetToken, newPassword: 'YetAnother3!' }).expect(400);
    expect(res.body.error.code).toBe('RESET_TOKEN_INVALID');
  });

  afterAll(async () => {
    await agent.post('/api/auth/sign-out').send({}).catch(() => undefined);
  });
});

describe.skipIf(!enabled)('verify-pin validation', () => {
  it('rejects non-numeric PIN', async () => {
    const res = await request(app).post('/api/v1/auth/verify-pin')
      .send({ identifier: 'x@y.com', pin: 'abcdef' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects PIN with wrong length', async () => {
    const res = await request(app).post('/api/v1/auth/verify-pin')
      .send({ identifier: 'x@y.com', pin: '12345' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe.skipIf(!enabled)('reset-password validation', () => {
  it('rejects invalid token format', async () => {
    const res = await request(app).post('/api/v1/auth/reset-password')
      .send({ resetToken: 'short', newPassword: 'Password1!' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects password shorter than 8 characters', async () => {
    const token = generateResetToken();
    const res = await request(app).post('/api/v1/auth/reset-password')
      .send({ resetToken: token, newPassword: '1234567' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown (but well-formed) token', async () => {
    const token = generateResetToken();
    const res = await request(app).post('/api/v1/auth/reset-password')
      .send({ resetToken: token, newPassword: 'SomePassword1!' }).expect(400);
    expect(res.body.error.code).toBe('RESET_TOKEN_INVALID');
  });
});
