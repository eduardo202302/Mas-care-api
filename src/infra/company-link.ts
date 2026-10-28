import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

const KEY = createHmac('sha256', env.BETTER_AUTH_SECRET)
  .update('max-care:company-link:v1')
  .digest();

function signature(id: string) {
  return createHmac('sha256', KEY).update(id).digest('base64url').slice(0, 22);
}

export function companyLinkToken(id: string) {
  return `${Buffer.from(id, 'utf8').toString('base64url')}.${signature(id)}`;
}

export function companyIdFromLinkToken(token: string): string | null {
  const separator = token.indexOf('.');
  if (separator <= 0) return null;
  const payload = token.slice(0, separator);
  const provided = token.slice(separator + 1);
  const id = Buffer.from(payload, 'base64url').toString('utf8');
  if (!id) return null;
  const expected = signature(id);
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;
  return id;
}
