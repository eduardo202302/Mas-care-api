import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { allowedOrigins, env } from '../config/env.js';
import { prisma, withTenant } from './prisma.js';
import { accessControl, organizationRoles } from '../domain/auth-roles.js';
import { record } from '../modules/audit/record.js';
import { initializeOrganization } from '../modules/organizations/initialize.js';
import { sendMail } from './mailer.js';

async function recordSessionEvent(userId: string, action: 'auth.login' | 'auth.logout') {
  const memberships = await prisma.member.findMany({ where: { userId }, select: { organizationId: true } });
  await Promise.all(memberships.map(({ organizationId }) =>
    withTenant(organizationId, (tx) => record(tx, { organizationId, actorId: userId, action })),
  ));
}

export const auth = betterAuth({
  appName: 'Max Care',
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: allowedOrigins,
  databaseHooks: {
    session: {
      create: { after: async (session) => recordSessionEvent(session.userId, 'auth.login') },
      delete: { before: async (session) => recordSessionEvent(session.userId, 'auth.logout') },
    },
  },
  emailAndPassword: { enabled: true },
  // Sent explicitly after self-registration (register.ts), not on every sign-up: staff accounts are created already verified.
  emailVerification: {
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendMail(user.email, 'Confirma tu correo en Max Care', `Hola ${user.name}, confirma tu correo con este enlace:
${url}

Si no creaste la cuenta, ignora este mensaje.`);
    },
  },
  advanced: {
    ...(env.COOKIE_DOMAIN ? { crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN } } : {}),
    defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production' },
  },
  plugins: [organization({
    allowUserToCreateOrganization: true,
    organizationLimit: 1,
    ac: accessControl,
    roles: organizationRoles,
    organizationHooks: {
      afterCreateOrganization: async ({ organization: created, user }) =>
        initializeOrganization(created.id, {
          name: created.name,
          email: user.email,
        }),
    },
  })],
});
