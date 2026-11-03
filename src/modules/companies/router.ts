import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import type { Prisma } from '@prisma/client';
import { auth } from '../../infra/auth.js';
import { prisma, withTenant } from '../../infra/prisma.js';
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
import {
  companyActivityCreate,
  companyActivityListQuery,
  companyActivityParams,
  companyActivityPatch,
} from '../../schemas/company-activity.js';
import { dealCreate, dealListQuery, dealParams, dealPatch } from '../../schemas/deal.js';

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
  numericId: true,
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
  address: true,
  sector: true,
  latitude: true,
  longitude: true,
  employeeCount: true,
  annualRevenue: true,
  timezone: true,
  description: true,
  linkedinUrl: true,
  googleMapsApiKey: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { members: true, branches: true } },
} satisfies Prisma.OrganizationSelect;

type CompanyRecord = Prisma.OrganizationGetPayload<{ select: typeof companySelect }>;

// A company is an organization: the platform-owner module reads and writes the
// organization row and exposes it under the company contract.
type CompanyDetailExtra = {
  patientCount: number;
  openCycleCount: number;
  openIncidentCount: number;
  contacts: { id: string; fullName: string; email: string | null; phone: string | null }[];
};

function present(
  company: CompanyRecord,
  detail = false,
  extra?: CompanyDetailExtra,
) {
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
    ...(detail ? { memberCount: _count.members, branchCount: _count.branches, ...extra } : {}),
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

companiesRouter.use(async (req, res, next) => {
  try {
    res.locals.platformOwner = await requirePlatformOwner(req);
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
    // branches carries RLS keyed on app.organization_id; without withTenant the
    // _count.branches subquery (and the counts below) are scoped to no org and
    // always resolve to 0.
    const result = await withTenant(id, async (tx) => {
      const company = await tx.organization.findUnique({ where: { id }, select: companySelect });
      if (!company) return null;
      const [patientCount, openCycleCount, openIncidentCount, contacts] = await Promise.all([
        tx.patient.count({ where: { organizationId: id, archivedAt: null } }),
        tx.refillCycle.count({ where: { organizationId: id, closedAt: null } }),
        tx.incident.count({ where: { organizationId: id, status: { not: 'resolved' } } }),
        tx.patient.findMany({
          where: { organizationId: id, archivedAt: null },
          orderBy: [{ createdAt: 'desc' }],
          take: 2,
          select: { id: true, fullName: true, email: true, phone: true },
        }),
      ]);
      return { company, patientCount, openCycleCount, openIncidentCount, contacts };
    });
    if (!result) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Compañía no encontrada.');
    const { company, ...extra } = result;
    res.json(present(company, true, extra));
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
          address: input.address ?? null,
          sector: input.sector ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          employeeCount: input.employeeCount ?? null,
          annualRevenue: input.annualRevenue ?? null,
          timezone: input.timezone ?? null,
          description: input.description ?? null,
          linkedinUrl: input.linkedinUrl ?? null,
          googleMapsApiKey: input.googleMapsApiKey ?? null,
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
    if (input.address !== undefined) data.address = input.address ?? null;
    if (input.sector !== undefined) data.sector = input.sector ?? null;
    if (input.latitude !== undefined) data.latitude = input.latitude ?? null;
    if (input.longitude !== undefined) data.longitude = input.longitude ?? null;
    if (input.employeeCount !== undefined) data.employeeCount = input.employeeCount ?? null;
    if (input.annualRevenue !== undefined) data.annualRevenue = input.annualRevenue ?? null;
    if (input.timezone !== undefined) data.timezone = input.timezone ?? null;
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.linkedinUrl !== undefined) data.linkedinUrl = input.linkedinUrl ?? null;
    if (input.googleMapsApiKey !== undefined) data.googleMapsApiKey = input.googleMapsApiKey ?? null;

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

const companyActivitySelect = {
  id: true,
  numericId: true,
  type: true,
  title: true,
  body: true,
  contactName: true,
  dueAt: true,
  completedAt: true,
  occurredAt: true,
  createdAt: true,
  updatedAt: true,
  authorId: true,
  author: { select: { name: true } },
} satisfies Prisma.CompanyActivitySelect;

function presentActivity(activity: Prisma.CompanyActivityGetPayload<{ select: typeof companyActivitySelect }>) {
  const { author, ...rest } = activity;
  return { ...rest, authorName: author.name };
}

companiesRouter.get('/:id/activities', async (req, res, next) => {
  try {
    const { id } = companyParams.parse(req.params);
    const query = companyActivityListQuery.parse(req.query);
    const existing = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Compañía no encontrada.');
    const { page, rows, skip } = resolvePaging(query);
    const result = await withTenant(id, async (tx) => {
      const where: Prisma.CompanyActivityWhereInput = {
        organizationId: id,
        ...(query.type ? { type: query.type } : {}),
      };
      const [data, total] = await Promise.all([
        tx.companyActivity.findMany({
          where,
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: rows,
          skip,
          select: companyActivitySelect,
        }),
        tx.companyActivity.count({ where }),
      ]);
      return { data, total };
    });
    res.json({ data: result.data.map(presentActivity), total: result.total, page, rows });
  } catch (error) {
    next(error);
  }
});

companiesRouter.post('/:id/activities', async (req, res, next) => {
  try {
    const { id } = companyParams.parse(req.params);
    const input = companyActivityCreate.parse(req.body);
    const owner = res.locals.platformOwner as { id: string };
    const existing = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Compañía no encontrada.');
    const activity = await withTenant(id, async (tx) => tx.companyActivity.create({
      data: {
        organizationId: id,
        type: input.type,
        title: input.title ?? null,
        body: input.body ?? null,
        contactName: input.contactName ?? null,
        dueAt: input.dueAt ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        authorId: owner.id,
      },
      select: companyActivitySelect,
    }));
    res.status(201).json(presentActivity(activity));
  } catch (error) {
    next(error);
  }
});

companiesRouter.patch('/:id/activities/:activityId', async (req, res, next) => {
  try {
    const { id, activityId } = companyActivityParams.parse(req.params);
    const input = companyActivityPatch.parse(req.body);
    const existing = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Compañía no encontrada.');
    const activity = await withTenant(id, async (tx) => {
      const current = await tx.companyActivity.findUnique({ where: { organizationId_id: { organizationId: id, id: activityId } }, select: { id: true } });
      if (!current) throw new ApiError(404, 'ACTIVITY_NOT_FOUND', 'Actividad no encontrada.');
      const data: Prisma.CompanyActivityUpdateInput = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.body !== undefined) data.body = input.body;
      if (input.contactName !== undefined) data.contactName = input.contactName;
      if (input.dueAt !== undefined) data.dueAt = input.dueAt;
      if (input.completed !== undefined) data.completedAt = input.completed ? new Date() : null;
      return tx.companyActivity.update({
        where: { organizationId_id: { organizationId: id, id: activityId } },
        data,
        select: companyActivitySelect,
      });
    });
    res.json(presentActivity(activity));
  } catch (error) {
    next(error);
  }
});

companiesRouter.get('/:id/members', async (req, res, next) => {
  try {
    const { id } = companyParams.parse(req.params);
    const existing = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Compañía no encontrada.');
    const members = await prisma.member.findMany({
      where: { organizationId: id },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ data: members.map((member) => member.user) });
  } catch (error) {
    next(error);
  }
});

companiesRouter.get('/:id/medications', async (req, res, next) => {
  try {
    const { id } = companyParams.parse(req.params);
    const existing = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Compañía no encontrada.');
    const medications = await withTenant(id, (tx) => tx.medication.findMany({
      where: { organizationId: id, archivedAt: null },
      orderBy: [{ genericName: 'asc' }, { brandName: 'asc' }],
      select: {
        id: true,
        numericId: true,
        organizationId: true,
        brandName: true,
        genericName: true,
        activeIngredient: true,
        presentation: true,
        doseUnit: true,
        unitsPerPackage: true,
        archivedAt: true,
      },
    }));
    res.json({ data: medications });
  } catch (error) {
    next(error);
  }
});

const dealSelect = {
  id: true,
  numericId: true,
  name: true,
  pipeline: true,
  stage: true,
  dealType: true,
  priority: true,
  amount: true,
  closeDate: true,
  contactId: true,
  ownerUserId: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { name: true } },
  contact: { select: { fullName: true } },
  lineItems: { select: { id: true, name: true, quantity: true, unitPrice: true } },
} satisfies Prisma.DealSelect;

function presentDeal(deal: Prisma.DealGetPayload<{ select: typeof dealSelect }>) {
  const { owner, contact, amount, lineItems, ...rest } = deal;
  return {
    ...rest,
    amount: amount === null ? null : Number(amount),
    ownerName: owner?.name ?? null,
    contactName: contact?.fullName ?? null,
    lineItems: lineItems.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
    })),
  };
}

companiesRouter.get('/:id/deals', async (req, res, next) => {
  try {
    const { id } = companyParams.parse(req.params);
    const query = dealListQuery.parse(req.query);
    const existing = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Compañía no encontrada.');
    const { page, rows, skip } = resolvePaging(query);
    const result = await withTenant(id, async (tx) => {
      const where: Prisma.DealWhereInput = { organizationId: id };
      const [data, total] = await Promise.all([
        tx.deal.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: rows,
          skip,
          select: dealSelect,
        }),
        tx.deal.count({ where }),
      ]);
      return { data, total };
    });
    res.json({ data: result.data.map(presentDeal), total: result.total, page, rows });
  } catch (error) {
    next(error);
  }
});

companiesRouter.post('/:id/deals', async (req, res, next) => {
  try {
    const { id } = companyParams.parse(req.params);
    const input = dealCreate.parse(req.body);
    const owner = res.locals.platformOwner as { id: string };
    const existing = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Compañía no encontrada.');
    const data: Prisma.DealUncheckedCreateInput = {
      organizationId: id,
      name: input.name,
      amount: input.amount ?? null,
      closeDate: input.closeDate ?? null,
      contactId: input.contactId ?? null,
      ownerUserId: input.ownerUserId ?? owner.id,
    };
    if (input.pipeline !== undefined) data.pipeline = input.pipeline;
    if (input.stage !== undefined) data.stage = input.stage;
    if (input.dealType !== undefined) data.dealType = input.dealType;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.lineItems?.length) {
      data.lineItems = {
        create: input.lineItems.map((item) => ({
          organizationId: id,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      };
    }
    const deal = await withTenant(id, async (tx) => tx.deal.create({ data, select: dealSelect }));
    res.status(201).json(presentDeal(deal));
  } catch (error) {
    next(error);
  }
});

companiesRouter.patch('/:id/deals/:dealId', async (req, res, next) => {
  try {
    const { id, dealId } = dealParams.parse(req.params);
    const input = dealPatch.parse(req.body);
    const existing = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Compañía no encontrada.');
    const deal = await withTenant(id, async (tx) => {
      const current = await tx.deal.findUnique({ where: { organizationId_id: { organizationId: id, id: dealId } }, select: { id: true } });
      if (!current) throw new ApiError(404, 'DEAL_NOT_FOUND', 'Oferta no encontrada.');
      const data: Prisma.DealUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.pipeline !== undefined) data.pipeline = input.pipeline;
      if (input.stage !== undefined) data.stage = input.stage;
      if (input.dealType !== undefined) data.dealType = input.dealType;
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.amount !== undefined) data.amount = input.amount;
      if (input.closeDate !== undefined) data.closeDate = input.closeDate;
      if (input.ownerUserId !== undefined) data.owner = input.ownerUserId ? { connect: { id: input.ownerUserId } } : { disconnect: true };
      if (input.contactId !== undefined) data.contact = input.contactId ? { connect: { id: input.contactId } } : { disconnect: true };
      return tx.deal.update({
        where: { organizationId_id: { organizationId: id, id: dealId } },
        data,
        select: dealSelect,
      });
    });
    res.json(presentDeal(deal));
  } catch (error) {
    next(error);
  }
});
