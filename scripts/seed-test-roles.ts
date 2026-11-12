import 'dotenv/config';
import { auth } from '../src/infra/auth.js';
import { prisma, withTenant } from '../src/infra/prisma.js';
import { ensureOrganizationMaster } from '../src/modules/roles/system-roles.js';
import { menuItemId } from '../src/domain/menu-defaults.js';
import { fixtureRoles } from '../tests/helpers/role-fixtures.js';

// Test-database only: creates the users the integration tests log in as. `admin.*` holds the
// Master role; the others hold ordinary dynamic roles with limited permissions.
if (process.env.NODE_ENV !== 'development') throw new Error('Refusing to seed outside development');
const password = 'MaxCareDev-2026!';

async function replaceMenu(organizationId: string, roleId: string, menu: (typeof fixtureRoles)[number]['menu']) {
  await withTenant(organizationId, async (tx) => {
    await tx.roleMenuItem.deleteMany({ where: { roleId } });
    await tx.roleMenuItem.createMany({
      data: menu.keys.map((key) => ({
        organizationId, roleId, menuItemId: menuItemId(key), canView: true,
        canCreate: menu.canCreate, canEdit: menu.canEdit, canDelete: menu.canDelete,
      })),
    });
  });
}

async function seedOrganization(code: 'a' | 'b') {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: `max-care-${code}` } });
  const organizationId = organization.id;
  const master = await ensureOrganizationMaster(organizationId);
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: `owner.${code}@maxcare.test` } });

  const fixtures = [
    { key: 'admin', roleId: master.id },
    ...await Promise.all(fixtureRoles.map(async (fixture) => {
      const role = await withTenant(organizationId, async (tx) => {
        const existing = await tx.role.findFirst({ where: { name: fixture.name } });
        const data = { permissions: [...fixture.permissions], allBranches: fixture.allBranches, isActive: true };
        return existing
          ? tx.role.update({ where: { organizationId_id: { organizationId, id: existing.id } }, data })
          : tx.role.create({ data: { organizationId, name: fixture.name, ...data } });
      });
      await replaceMenu(organizationId, role.id, fixture.menu);
      return { key: fixture.key, roleId: role.id };
    })),
  ];

  const userIds = [owner.id];
  for (const fixture of fixtures) {
    const email = `${fixture.key}.${code}@maxcare.test`;
    const user = await prisma.user.findUnique({ where: { email } }) ?? (await auth.api.signUpEmail({
      body: { name: `${fixture.key} ${code.toUpperCase()}`, email, password },
    })).user;
    const member = await prisma.member.findFirst({ where: { organizationId, userId: user.id } });
    if (member) await prisma.member.update({ where: { id: member.id }, data: { roleId: fixture.roleId } });
    else await prisma.member.create({ data: { id: crypto.randomUUID(), organizationId, userId: user.id, roleId: fixture.roleId, createdAt: new Date() } });
    userIds.push(user.id);
  }

  // Same branch layout the tests expect: users alternate between Sucursal 1 and Sucursal 2.
  await withTenant(organizationId, async (tx) => {
    for (const index of [1, 2]) {
      const branch = await tx.branch.findFirstOrThrow({ where: { name: `Sucursal ${index}` } });
      for (const [userIndex, userId] of userIds.entries()) {
        if (userIndex % 2 !== index - 1) continue;
        await tx.branchMember.upsert({
          where: { organizationId_branchId_userId: { organizationId, branchId: branch.id, userId } },
          create: { organizationId, branchId: branch.id, userId },
          update: {},
        });
      }
    }
  });
  console.info(`Seeded test roles for Max Care ${code.toUpperCase()}`);
}

try {
  await seedOrganization('a');
  await seedOrganization('b');
} finally {
  await prisma.$disconnect();
}
