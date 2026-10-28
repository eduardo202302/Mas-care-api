import { Router } from 'express';
import { z } from 'zod';
import { hashPassword } from '@better-auth/utils/password';
import { prisma } from '../../infra/prisma.js';
import { ApiError } from '../../infra/errors.js';
import { validateBody } from '../../infra/validate.js';
import { hashResetToken } from '../../infra/pin-crypto.js';

export const resetPasswordRouter = Router();

const body = z.object({
  resetToken: z.string().trim().length(64).regex(/^[0-9a-f]{64}$/, 'Token inválido.'),
  newPassword: z.string().min(8).max(128),
}).strict();

const TOKEN_INVALID = new ApiError(400, 'RESET_TOKEN_INVALID', 'Token inválido o expirado.');

resetPasswordRouter.post('/', validateBody(body), async (req, res, next) => {
  try {
    const { resetToken, newPassword } = req.body as z.infer<typeof body>;

    const tokenHash = hashResetToken(resetToken);

    const record = await prisma.passwordResetPin.findUnique({
      where: { resetTokenHash: tokenHash },
    });

    if (
      !record ||
      !record.usedAt ||                               // PIN was never verified
      record.passwordChangedAt !== null ||             // password already changed
      !record.resetTokenExpiresAt ||
      record.resetTokenExpiresAt < new Date()         // token expired
    ) {
      throw TOKEN_INVALID;
    }

    // Hash the new password with the exact same algorithm better-auth uses
    // (scrypt, N=16384, r=16, p=1, stored as "saltHex:derivedHex").
    const passwordHash = await hashPassword(newPassword);

    await prisma.$transaction(async (tx) => {
      // Update the credential account password.
      const updated = await tx.account.updateMany({
        where: { userId: record.userId, providerId: 'credential' },
        data: { password: passwordHash, updatedAt: new Date() },
      });

      if (updated.count === 0) {
        throw new ApiError(400, 'NO_CREDENTIAL_ACCOUNT', 'Esta cuenta no tiene contraseña configurada.');
      }

      // Invalidate all existing sessions (security: revoke stale sessions).
      await tx.session.deleteMany({ where: { userId: record.userId } });

      // Mark the reset record as completed (single-use enforcement).
      await tx.passwordResetPin.update({
        where: { id: record.id },
        data: { passwordChangedAt: new Date() },
      });
    });

    res.json({ message: 'Contraseña actualizada. Por favor inicia sesión.' });
  } catch (error) { next(error); }
});
