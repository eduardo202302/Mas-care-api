import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from './logger.js';

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

/** Without SMTP_HOST nothing is sent (dev/test): only the fact is logged, never address or link. */
export async function sendMail(to: string, subject: string, text: string) {
  if (!transport) {
    logger.warn({ subject }, 'mail not sent: SMTP_HOST not configured');
    return false;
  }
  await transport.sendMail({ from: env.SMTP_FROM, to, subject, text });
  return true;
}
