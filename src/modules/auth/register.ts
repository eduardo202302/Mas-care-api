import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../../infra/auth.js';
import { ApiError } from '../../infra/errors.js';
import { prisma, withTenant } from '../../infra/prisma.js';
import { record } from '../audit/record.js';
import { validateBody } from '../../infra/validate.js';
import { createPin } from '../../infra/pin-crypto.js';
import { companyIdFromLinkToken } from '../../infra/company-link.js';

export const registerRouter = Router();

registerRouter.get('/company/:token', async (req, res, next) => {
  try {
    const reference = String(req.params.token);
    const organizationId = /^d{6}$/.test(reference) ? null : companyIdFromLinkToken(reference);
    const company = organizationId
      ? await prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true, logo: true, status: true },
        })
      : /^d{6}$/.test(reference)
        ? await prisma.organization.findUnique({
            where: { pin: reference },
            select: { name: true, logo: true, status: true },
          })
        : null;
    if (!company) {
      throw new ApiError(404, 'COMPANY_NOT_FOUND', 'El enlace de registro no corresponde a una compañía válida.');
    }
    if (company.status !== 'active') {
      throw new ApiError(400, 'COMPANY_INACTIVE', 'Esta compañía no está activa.');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ name: company.name, logo: company.logo });
  } catch (error) { next(error); }
});

const registration = z.object({
  name: z.string().trim().min(1).max(120),
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/, 'Solo letras, números, puntos, guiones y guiones bajos.'),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().min(7).max(20).optional(),
  password: z.string().min(8).max(128),
  pin: z.string().trim().length(6).regex(/^\d{6}$/, 'El PIN debe tener 6 dígitos numéricos.').optional(),
  companyPin: z.string().trim().length(6).regex(/^\d{6}$/).optional(),
  companyToken: z.string().trim().min(10).max(500).optional(),
  organizationName: z.string().trim().min(2).max(120),
}).strict();

registerRouter.post('/', validateBody(registration), async (req, res, next) => {
  try {
    const input = req.body as z.infer<typeof registration>;

    // Check username uniqueness before calling better-auth (which owns the user row).
    const existingUsername = await prisma.user.findFirst({
      where: { username: { equals: input.username, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existingUsername) {
      throw new ApiError(409, 'USERNAME_IN_USE', 'Este nombre de usuario ya está en uso.', {
        username: 'Este nombre de usuario ya está en uso.',
      });
    }

    let companyOrganizationId: string | undefined;
    if (input.companyToken || input.companyPin) {
      const tokenOrganizationId = input.companyToken
        ? companyIdFromLinkToken(input.companyToken)
        : null;
      const company = tokenOrganizationId
        ? await prisma.organization.findUnique({
            where: { id: tokenOrganizationId },
            select: { id: true, status: true },
          })
        : input.companyPin
          ? await prisma.organization.findUnique({
              where: { pin: input.companyPin },
              select: { id: true, status: true },
            })
          : null;
      if (!company) {
        throw new ApiError(400, 'COMPANY_NOT_FOUND', 'El enlace de registro no corresponde a una compañía válida.');
      }
      if (company.status !== 'active') {
        throw new ApiError(400, 'COMPANY_INACTIVE', 'Esta compañía no está activa.');
      }
      companyOrganizationId = company.id;
    }

    const signupResponse = await auth.api.signUpEmail({
      body: { name: input.name, email: input.email, password: input.password },
      asResponse: true,
    });
    if (!signupResponse.ok) {
      const payload = await signupResponse.json().catch(() => undefined);
      res.status(signupResponse.status).json(
        payload ?? { error: { code: 'REGISTRATION_FAILED', message: 'Could not register user' } },
      );
      return;
    }

    const signup = await signupResponse.json() as { token: string | null; user: { id: string; name: string; email: string } };
    if (!signup.token) throw new ApiError(500, 'SESSION_NOT_CREATED', 'Registration did not create a session');
    const cookieHeader = signupResponse.headers.get('set-cookie');
    if (!cookieHeader) throw new ApiError(500, 'SESSION_COOKIE_MISSING', 'Registration did not create a session cookie');

    // Persist username, phone and the encrypted recovery PIN on the user row
    // (better-auth doesn't know about these fields).
    const recoveryPin = createPin(input.pin);
    await prisma.user.update({
      where: { id: signup.user.id },
      data: {
        username: input.username.toLowerCase(),
        phone: input.phone ?? null,
        passwordPinEncrypted: recoveryPin.encrypted,
        passwordPinUpdatedAt: new Date(),
      },
    });

    const slugBase = input.organizationName
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'organization';

    // Registering through a company link joins that company's organization: the
    // first user becomes its owner, later ones start with read-only access.
    // Without a link the user gets a new organization of their own.
    let organization: { id: string; name: string };
    let role: string;
    if (companyOrganizationId) {
      const target = await prisma.organization.findUniqueOrThrow({
        where: { id: companyOrganizationId },
        select: { id: true, name: true, _count: { select: { members: true } } },
      });
      role = target._count.members === 0 ? 'owner' : 'read_only';
      await prisma.member.create({
        data: { id: crypto.randomUUID(), organizationId: target.id, userId: signup.user.id, role, createdAt: new Date() },
      });
      organization = { id: target.id, name: target.name };
    } else {
      organization = await auth.api.createOrganization({
        body: { name: input.organizationName, slug: `${slugBase}-${crypto.randomUUID().slice(0, 8)}`, userId: signup.user.id },
        headers: new Headers({ cookie: cookieHeader.split(';')[0]! }),
      });
      role = 'owner';
    }

    await withTenant(organization.id, (tx) =>
      record(tx, { organizationId: organization.id, actorId: signup.user.id, action: 'auth.register' }),
    );

    res.setHeader('Set-Cookie', cookieHeader);
    res.status(201).json({
      user: { ...signup.user, username: input.username.toLowerCase(), phone: input.phone ?? null },
      organization: { id: organization.id, name: organization.name },
      role,
    });
  } catch (error) { next(error); }
});
