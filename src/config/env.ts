import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
  WEB_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  COOKIE_DOMAIN: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  IMPORTS_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  PLATFORM_OWNER_EMAILS: z.string().default(''),
  // Direct (non-pooler) connection used by the worker's queue (pg-boss needs DDL and long-lived sessions).
  DIRECT_URL: z.string().url().optional(),
  // fake: never touches the network. live (or the older whatsapp): talks to Meta and Telegram.
  MESSAGING_PROVIDER: z.enum(['fake', 'live', 'whatsapp']).default('fake'),
  // Meta app level: signs webhooks (X-Hub-Signature-256) and verifies the webhook URL (GET challenge).
  WA_APP_SECRET: z.string().optional(),
  WA_VERIFY_TOKEN: z.string().optional(),
  WA_API_VERSION: z.string().default('v21.0'),
  // Optional shared account used only to SEND for organizations without their own credentials.
  WA_PHONE_NUMBER_ID: z.string().optional(),
  WA_ACCESS_TOKEN: z.string().optional(),
  // 32 bytes, base64: encrypts the per-organization access tokens at rest.
  CREDENTIALS_ENCRYPTION_KEY: z.string().optional(),
  // SMTP for transactional mail (email verification). Unset = mail is not sent.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Max Care <no-reply@localhost>'),
});

export const env = schema.parse(process.env);
export const allowedOrigins = env.WEB_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);
