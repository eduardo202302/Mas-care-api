import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../infra/prisma.js';
import { ApiError } from '../../infra/errors.js';
import { validateBody } from '../../infra/validate.js';
import {
  decryptPin,
  encryptPin,
  generatePin,
  generateResetToken,
  hashPin,
  hashResetToken,
  pinsEqual,
} from '../../infra/pin-crypto.js';
import { normalizePhone } from '../../domain/notice.js';

export const verifyPinRouter = Router();

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

const body = z.object({
  identifier: z.string().trim().min(1).max(254),
  pin: z.string().trim().length(6).regex(/^\d{6}$/, 'El PIN debe ser 6 dígitos numéricos.'),
}).strict();

// Generic error reused for all invalid-PIN conditions (prevents enumeration).
const PIN_INVALID = new ApiError(400, 'PIN_INVALID', 'PIN incorrecto o bloqueado.');

verifyPinRouter.post('/', validateBody(body), async (req, res, next) => {
  try {
    const { identifier, pin } = req.body as z.infer<typeof body>;
    const normalized = normalizePhone(identifier);

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: identifier, mode: 'insensitive' } },
          { username: { equals: identifier, mode: 'insensitive' } },
          { phone: normalized ?? identifier },
          ...(normalized && normalized !== identifier ? [{ phone: identifier }] : []),
        ],
      },
      select: {
        id: true,
        passwordPinEncrypted: true,
        passwordPinAttempts: true,
        passwordPinLockedAt: true,
      },
    });

    if (!user?.passwordPinEncrypted) throw PIN_INVALID;
    if (user.passwordPinLockedAt && user.passwordPinLockedAt > new Date()) {
      throw PIN_INVALID;
    }

    const expectedPin = decryptPin(user.passwordPinEncrypted);
    if (!expectedPin || !pinsEqual(pin, expectedPin)) {
      const attempts = user.passwordPinAttempts + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: attempts >= MAX_ATTEMPTS
          ? {
              passwordPinAttempts: 0,
              passwordPinLockedAt: new Date(Date.now() + LOCK_MS),
            }
          : { passwordPinAttempts: attempts },
      });
      throw PIN_INVALID;
    }

    // The PIN is single-use: rotate it immediately after a successful check.
    const nextPinEncrypted = encryptPin(generatePin());
    const resetToken = generateResetToken();
    const resetTokenHash = hashResetToken(resetToken);
    const resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    const issued = await prisma.$transaction(async (tx) => {
      const rotated = await tx.user.updateMany({
        where: {
          id: user.id,
          passwordPinEncrypted: user.passwordPinEncrypted,
        },
        data: {
          passwordPinEncrypted: nextPinEncrypted,
          passwordPinAttempts: 0,
          passwordPinLockedAt: null,
          passwordPinUpdatedAt: new Date(),
        },
      });
      if (rotated.count !== 1) return false;

      await tx.passwordResetPin.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordResetPin.create({
        data: {
          userId: user.id,
          pinHash: hashPin(pin),
          expiresAt: resetTokenExpiresAt,
          usedAt: new Date(),
          resetTokenHash,
          resetTokenExpiresAt,
        },
      });
      return true;
    });

    if (!issued) throw PIN_INVALID;

    res.json({ resetToken, expiresAt: resetTokenExpiresAt });
  } catch (error) { next(error); }
});
