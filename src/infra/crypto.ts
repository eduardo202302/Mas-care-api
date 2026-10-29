import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

function keyFrom(base64: string | undefined): Buffer {
  if (!base64) throw new Error('CREDENTIALS_ENCRYPTION_KEY is not set');
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('CREDENTIALS_ENCRYPTION_KEY must be 32 bytes encoded as base64');
  return key;
}

/** AES-256-GCM. Output: `v1:<iv>:<auth tag>:<ciphertext>`, each part base64. */
export function encryptSecret(plain: string, keyBase64 = env.CREDENTIALS_ENCRYPTION_KEY): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyBase64), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

export function decryptSecret(encrypted: string, keyBase64 = env.CREDENTIALS_ENCRYPTION_KEY): string {
  const [version, iv, tag, body] = encrypted.split(':');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('Unsupported encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyBase64), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
}
