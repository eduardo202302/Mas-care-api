import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma, withTenant } from '../../infra/prisma.js';
import { findOrCreateSetting } from '../../infra/settings.js';

type OrganizationDetails = {
  name?: string;
  email?: string;
};

function companyDomain() {
  return env.WEB_ORIGIN.split(',')[0]?.trim() || env.BETTER_AUTH_URL;
}

// Fills the company-level fields (email, domain, PIN) of a new organization.
// The PIN is unique, so a collision is retried with a fresh one.
async function applyCompanyDefaults(
  organizationId: string,
  details: { email: string; domain: string },
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await prisma.organization.update({
        where: { id: organizationId },
        data: { ...details, pin: String(randomInt(0, 1_000_000)).padStart(6, '0') },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error('Could not generate a unique company PIN');
}

export async function initializeOrganization(
  organizationId: string,
  details: OrganizationDetails = {},
) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, email: true, domain: true, pin: true },
  });
  if (!organization) throw new Error(`Organization ${organizationId} not found`);

  if (!organization.pin) {
    await applyCompanyDefaults(organizationId, {
      email:
        organization.email ??
        (details.email?.trim().toLowerCase() || `empresa-${organizationId}@maxcare.local`),
      domain: organization.domain ?? companyDomain(),
    });
  }

  return withTenant(organizationId, async (tx) => {
    await findOrCreateSetting(tx, organizationId);
  });
}
