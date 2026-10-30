import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import type { Prisma } from '@prisma/client';
import { auth } from '../../infra/auth.js';
import { prisma } from '../../infra/prisma.js';
import { resolvePaging } from '../../infra/pagination.js';
import { ApiError } from '../../infra/errors.js';
import { generatePin } from '../../infra/pin-crypto.js';
import { companyLinks, normalizeDomain } from '../../domain/company.js';
import { companyLinkToken } from '../../infra/company-link.js';
import { isPlatformOwner } from '../../domain/platform-owner.js';
import {
  companyCreate,
  companyListQuery,
  companyParams,
  companyPatch,
} from '../../schemas/company.js';

export const companiesRouter = Router();

async function requirePlatformOwner(req: Request) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  if (!isPlatformOwner(session.user.email)) {
    throw new ApiError(403, 'FORBIDDEN', 'Solo el propietario global puede gestionar compañías.');
  }
  return session.user;
}

const companySelect = {
  id: true,
  name: true,
  email: true,
  status: true,
  pin: true,
  domain: true,
  logo: true,
  phone: true,
  ownerName: true,
  industry: true,
  type: true,
  city: true,
  state: true,
  postalCode: true,
  employeeCount: true,
  annualRevenue: true,
  timezone: true,
  description: true,
  linkedinUrl: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { members: true, branches: true } },
} satisfies Prisma.OrganizationSelect;

type CompanyRecord = Prisma.OrganizationGetPayload<{ select: typeof companySelect }>;

// A company is an organization: the platform-owner module reads and writes the
// organization row and exposes it under the company contract.
function present(company: CompanyRecord, detail = false) {
  const { _count, ...rest } = company;
  const linkToken = companyLinkToken(company.id);
  const domain = company.domain ?? '';
  return {
    ...rest,
    email: company.email ?? '',
    pin: company.pin ?? '',
    domain,
    annualRevenue: company.annualRevenue === null ? null : Number(company.annualRevenue),
    linkToken,
    ...(domain ? companyLinks(domain, linkToken) : { registrationLink: '', loginLink: '' }),
    ...(detail ? { memberCount: _count.members, branchCount: _count.branches } : {}),
  };
}

async function availablePin() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const pin = generatePin();
    const existing = await prisma.organization.findUnique({ where: { pin }, select: { id: true } });
    if (!existing) return pin;
  }
  throw new ApiError(500, 'PIN_GENERATION_FAILED', 'No pudimos generar un PIN único.');
}

function slugFor(name: string) {
  const base = name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'organization';
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function isUniqueConflict(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

companiesRouter.use(async (req, _res, next) => {
  try {
    await requirePlatformOwner(req);
    next();
  } catch (error) {
    next(error);
  }
});

companiesRouter.get('/', async (req, res, next) => {
  try {
    const query = companyListQuery.parse(req.query);
    const where: Prisma.OrganizationWhereInput | undefined = query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { email: { contains: query.q, mode: 'insensitive' } },
            { domain: { contains: query.q, mode: 'insensitive' } },
            { pin: { contains: query.q } },
          ],
        }
      : undefined;
    const { page, rows, skip } = resolvePaging(query);
    const [companies, total] = await Promise.all([
      prisma.organization.findMany({
        ...(where ? { where } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: rows,
        skip,
        select: companySelect,
      }),
      prisma.organization.count(where ? { where } : {}),
    ]);
    res.json({ data: companies.map((company) => present(company)), total, page, rows });
  } catch (error) {
    next(error);
  }
});

companiesRouter.get('/:id', async (req, res, next) => {
  try {
    const { id } = companyParams.parse(req.params);
    const company = await prisma.organization.findUnique({ where: { id }, select: companySelect });
    if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Compañía no encontrada.');
    res.json(present(company, true));
  } catch (error) {
    next(error);
  }
});

companiesRouter.post('/', async (req, res, next) => {
  try {
    const input = companyCreate.parse(req.body);
    const domain = normalizeDomain(input.domain);
    const pin = input.pin ?? (await availablePin());

    let company;
    try {
      company = await prisma.organization.create({
        data: {
          id: randomUUID(),
          name: input.name,
          slug: slugFor(input.name),
          createdAt: new Date(),
          email: input.email,
          status: input.status,
          domain,
          pin,
          logo: input.logo?.trim() || null,
          phone: input.phone ?? null,
          ownerName: input.ownerName ?? null,
          industry: input.industry ?? null,
          type: input.type ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          postalCode: input.postalCode ?? null,
          employeeCount: input.employeeCount ?? null,
          annualRevenue: input.annualRevenue ?? null,
          timezone: input.timezone ?? null,
          description: input.description ?? null,
          linkedinUrl: input.linkedinUrl ?? null,
        },
        select: companySelect,
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ApiError(409, 'PIN_IN_USE', 'Ya existe una compañía con este PIN.', {
          pin: 'Ya existe una compañía con este PIN.',
        });
      }
      throw error;
    }
    res.status(201).json(present(company));
  } catch (error) {
    next(error);
  }
});

companiesRouter.patch('/:id', async (req, res, next) => {
  try {
    const { id } = companyParams.parse(req.params);
    const input = companyPatch.parse(req.body);
    if (Object.keys(input).length === 0) {
      throw new ApiError(400, 'EMPTY_UPDATE', 'Envía al menos un campo para actualizar.');
    }

    const existing = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Compañía no encontrada.');

    const data: Prisma.OrganizationUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) data.email = input.email;
    if (input.status !== undefined) data.status = input.status;
    if (input.pin !== undefined) data.pin = input.pin;
    if (input.domain !== undefined) data.domain = normalizeDomain(input.domain);
    if (input.logo !== undefined) data.logo = input.logo?.trim() || null;
    if (input.phone !== undefined) data.phone = input.phone ?? null;
    if (input.ownerName !== undefined) data.ownerName = input.ownerName ?? null;
    if (input.industry !== undefined) data.industry = input.industry ?? null;
    if (input.type !== undefined) data.type = input.type ?? null;
    if (input.city !== undefined) data.city = input.city ?? null;
    if (input.state !== undefined) data.state = input.state ?? null;
    if (input.postalCode !== undefined) data.postalCode = input.postalCode ?? null;
    if (input.employeeCount !== undefined) data.employeeCount = input.employeeCount ?? null;
    if (input.annualRevenue !== undefined) data.annualRevenue = input.annualRevenue ?? null;
    if (input.timezone !== undefined) data.timezone = input.timezone ?? null;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.linkedinUrl !== undefined) data.linkedinUrl = input.linkedinUrl ?? null;

    let company;
    try {
      company = await prisma.organization.update({ where: { id }, data, select: companySelect });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ApiError(409, 'PIN_IN_USE', 'Ya existe una compañía con este PIN.', {
          pin: 'Ya existe una compañía con este PIN.',
        });
      }
      throw error;
    }
    res.json(present(company));
  } catch (error) {
    next(error);
  }
});
