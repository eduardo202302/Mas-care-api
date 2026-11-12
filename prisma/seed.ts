import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '@better-auth/utils/password';
import { prisma, withTenant } from '../src/infra/prisma.js';
import { menuItemId, menuSeeds } from '../src/domain/menu-defaults.js';
import { createPin } from '../src/infra/pin-crypto.js';
import { initializeOrganization } from '../src/modules/organizations/initialize.js';

// Minimal seed: the menu, one company ("master") with one branch ("master"), its Master role and
// one user ("master"). No patients, medications or templates. Idempotent.
if (process.env.NODE_ENV !== 'development') throw new Error('Refusing to seed outside development');

const EMAIL = 'master@maxcare.test';
const USERNAME = 'master';
const PASSWORD = 'ik2020';
const ORGANIZATION = 'master';
const BRANCH = 'master';

/** Adds any menu entry the migrations did not create; existing entries (and their labels) are left alone. */
async function seedMenu() {
  const toRow = (seed: (typeof menuSeeds)[number]) => ({
    id: menuItemId(seed.key),
    key: seed.key,
    label: seed.label,
    path: seed.path,
    icon: seed.icon,
    order: seed.order,
    permission: seed.permission,
    parentId: seed.parentKey ? menuItemId(seed.parentKey) : null,
    isActive: true,
  });
  // Groups first so children can point at them.
  await prisma.menuItem.createMany({ data: menuSeeds.filter((seed) => !seed.parentKey).map(toRow), skipDuplicates: true });
  await prisma.menuItem.createMany({ data: menuSeeds.filter((seed) => seed.parentKey).map(toRow), skipDuplicates: true });
  return prisma.menuItem.count({ where: { isActive: true } });
}

/**
 * The account is written directly instead of through sign-up: Better Auth rejects passwords
 * shorter than 8 characters on sign-up, and this dev password has 6. Signing in does not
 * apply that rule.
 */
async function seedUser() {
  const passwordHash = await hashPassword(PASSWORD);
  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { name: USERNAME, username: USERNAME, emailVerified: true } });
    const account = await prisma.account.findFirst({ where: { userId: existing.id, providerId: 'credential' } });
    if (account) await prisma.account.update({ where: { id: account.id }, data: { password: passwordHash } });
    else await prisma.account.create({ data: { id: randomUUID(), accountId: existing.id, providerId: 'credential', userId: existing.id, password: passwordHash } });
    return { id: existing.id, pin: null };
  }
  const id = randomUUID();
  const pin = createPin();
  await prisma.user.create({
    data: {
      id,
      name: USERNAME,
      email: EMAIL,
      emailVerified: true,
      username: USERNAME,
      passwordPinEncrypted: pin.encrypted,
      passwordPinUpdatedAt: new Date(),
      accounts: { create: { id: randomUUID(), accountId: id, providerId: 'credential', password: passwordHash } },
    },
  });
  return { id, pin: pin.pin };
}

async function seedOrganization(userId: string) {
  const organization = await prisma.organization.findFirst({ where: { slug: ORGANIZATION } })
    ?? await prisma.organization.create({ data: { id: randomUUID(), name: ORGANIZATION, slug: ORGANIZATION, createdAt: new Date() } });
  const member = await prisma.member.findFirst({ where: { organizationId: organization.id, userId } });
  if (!member) await prisma.member.create({ data: { id: randomUUID(), organizationId: organization.id, userId, createdAt: new Date() } });
  // Company PIN, domain and settings, plus the Master role (all permissions, branches and menu),
  // which goes to the first member without a role.
  await initializeOrganization(organization.id, { name: ORGANIZATION, email: EMAIL });
  await withTenant(organization.id, async (tx) => {
    const branch = await tx.branch.findFirst({ where: { name: BRANCH, archivedAt: null } });
    if (!branch) await tx.branch.create({ data: { organizationId: organization.id, name: BRANCH } });
  });
  return prisma.organization.findUniqueOrThrow({ where: { id: organization.id }, select: { id: true, pin: true } });
}

try {
  const menuItems = await seedMenu();
  const user = await seedUser();
  const organization = await seedOrganization(user.id);
  console.info(`Seeded: ${menuItems} menu items, company "${ORGANIZATION}" (PIN ${organization.pin}), branch "${BRANCH}", role Master`);
  console.info(`Login: ${EMAIL} / ${PASSWORD}${user.pin ? ` (recovery PIN ${user.pin})` : ''}`);
} finally {
  await prisma.$disconnect();
}
