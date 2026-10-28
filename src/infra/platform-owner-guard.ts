import type { Request } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth.js';
import { ApiError } from './errors.js';
import { isPlatformOwner } from '../domain/platform-owner.js';

export async function sessionIsPlatformOwner(req: Request): Promise<boolean> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  return isPlatformOwner(session?.user.email);
}

export async function requirePlatformOwner(req: Request, message = 'Solo el propietario global puede gestionar el menú.') {
  if (!await sessionIsPlatformOwner(req)) throw new ApiError(403, 'FORBIDDEN', message);
}
