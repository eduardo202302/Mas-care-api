/**
 * Cryptographic helpers for PIN-based password recovery.
 *
 * PINs are 6-digit numbers (10^6 possibilities) — low-entropy secrets.
 * We use Node's built-in scrypt (N=16384, r=8, p=1) to make offline
 * brute-force impractical even after a DB leak.  The stored format is
 * `${saltHex}:${derivedHex}` (same layout as better-auth passwords).
 *
 * Reset tokens are 256-bit random values — high entropy.  We store only
 * their SHA-256 digest so the raw token is never persisted.
 */

import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
  createHash,
  createCipheriv,
  createDecipheriv,
  createHmac,
} from 'node:crypto';
import { env } from '../config/env.js';

const SCRYPT_KEY_LEN = 32;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

// A per-user recovery PIN must be readable by managers, so it cannot be hashed.
// We encrypt it with a key derived from the application secret instead.
const PIN_CIPHER = 'aes-256-gcm';
const PIN_VERSION = 'v1';
const PIN_KEY = createHmac('sha256', env.BETTER_AUTH_SECRET)
  .update('max-care:user-recovery-pin:v1')
  .digest();

export function generatePin(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(pin, salt, SCRYPT_KEY_LEN, SCRYPT_PARAMS);
  return `${salt}:${key.toString('hex')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, keyHex] = stored.split(':');
  if (!salt || !keyHex) return false;
  try {
    const attempt = scryptSync(pin, salt, SCRYPT_KEY_LEN, SCRYPT_PARAMS);
    return timingSafeEqual(attempt, Buffer.from(keyHex, 'hex'));
  } catch {
    return false;
  }
}

export function encryptPin(pin: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(PIN_CIPHER, PIN_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(pin, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PIN_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptPin(stored: string): string | null {
  const [version, ivValue, tagValue, dataValue] = stored.split(':');
  if (version !== PIN_VERSION || !ivValue || !tagValue || !dataValue) {
    return null;
  }
  try {
    const decipher = createDecipheriv(
      PIN_CIPHER,
      PIN_KEY,
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataValue, 'base64url')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function pinsEqual(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

export function createPin(pin?: string): { pin: string; encrypted: string } {
  const value = pin ?? generatePin();
  return { pin: value, encrypted: encryptPin(value) };
}

export function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
