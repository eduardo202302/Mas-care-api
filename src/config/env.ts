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
});

export const env = schema.parse(process.env);
export const allowedOrigins = env.WEB_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);
