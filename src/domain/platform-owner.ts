import { env } from '../config/env.js';

export function isPlatformOwner(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = env.PLATFORM_OWNER_EMAILS
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}
