import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'req.body', 'res.headers["set-cookie"]'], censor: '[REDACTED]' },
});
