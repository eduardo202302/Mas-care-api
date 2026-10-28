/**
 * PIN delivery interface.
 *
 * This project currently has NO email or SMS integration.  The notice system
 * (src/domain/notice.ts) only generates WhatsApp wa.me links — it does not
 * send anything.
 *
 * In development/test the PIN is logged at WARN level and returned in the API
 * response as `_devPin`.  In production this module MUST be wired to a real
 * channel (SMTP, Twilio, WhatsApp Business API, etc.) before going live.
 *
 * Integration checklist (production):
 *   1. Choose a channel: email (SMTP/SendGrid/SES) or SMS/WhatsApp (Twilio/Meta).
 *   2. Add the required env vars (see src/config/env.ts notes).
 *   3. Replace `devDeliver` with your provider SDK call.
 *   4. Remove the `_devPin` field from the forgot-password response.
 */

import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface PinDeliveryResult {
  channel: 'log';
  destination: string;
}

export async function deliverPin(
  userId: string,
  identifier: string,
  pin: string,
): Promise<PinDeliveryResult> {
  if (env.NODE_ENV === 'production') {
    // Fail loudly: a misconfigured production instance must not silently drop PINs.
    logger.error({ userId, identifier }, 'PIN delivery not configured for production');
    throw new Error('PIN_DELIVERY_NOT_CONFIGURED');
  }

  // Development / test: log only. The PIN is also returned in the API response
  // as `_devPin` so integration tests can proceed without parsing logs.
  logger.warn(
    { userId, identifier, pin },
    '[DEV] Password reset PIN — remove _devPin from response before going to production',
  );
  return { channel: 'log', destination: identifier };
}
