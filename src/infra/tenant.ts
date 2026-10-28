import type { NextFunction, Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { prisma } from './prisma.js';
import { ApiError } from './errors.js';
import type { Role } from '../domain/roles.js';

declare global {
  // Express's type augmentation requires a global namespace declaration.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { tenant?: { userId: string; organizationId: string; role: Role; roleId: string | null; sessionId: string; user: { id: string; name: string; email: string } } }
  }
}

export async function resolveTenant(req: Request, _res: Response, next: NextFunction) {
  try {
    const session = await (await import('./auth.js')).auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    let orgId = session.session.activeOrganizationId;
    if (!orgId) {
      // Seeded and newly registered users commonly belong to exactly one
      // organization. Use it as their default; users with multiple memberships
      // must choose an active organization explicitly.
      const memberships = await prisma.member.findMany({
        where: { userId: session.user.id },
        select: { organizationId: true },
        take: 2,
      });
      if (memberships.length === 1) orgId = memberships[0]!.organizationId;
    }
    if (!orgId) throw new ApiError(403, 'ORGANIZATION_REQUIRED', 'Select an active organization');
    const member = await prisma.member.findFirst({ where: { userId: session.user.id, organizationId: orgId }, select: { role: true, roleId: true } });
    if (!member) throw new ApiError(403, 'TENANT_FORBIDDEN', 'Organization access denied');
    req.tenant = {
      userId: session.user.id,
      organizationId: orgId,
      role: member.role as Role,
      roleId: member.roleId,
      sessionId: session.session.id,
      user: { id: session.user.id, name: session.user.name, email: session.user.email },
    };
    next();
  } catch (error) { next(error); }
}
