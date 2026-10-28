import './db-guard.js';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { withTenant } from '../src/infra/prisma.js';

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('real registration and authentication flow', () => {
  it('registers with the first organization, logs in, and logs out', async () => {
    const agent = request.agent(app);
    const tag = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const email = `flow-${crypto.randomUUID()}@maxcare.test`;
    const password = 'FlowTest-Password-2026!';
    const registration = await agent.post('/api/v1/register').send({
      name: 'Integration User',
      username: `flow_${tag}`,
      email,
      password,
      organizationName: 'Flow Test Pharmacy',
    }).expect(201);
    expect(registration.body.role).toBe('owner');
    expect(registration.body.organization.id).toBeTruthy();
    await agent.get('/api/v1/me').expect(200);
    const setting = await withTenant(registration.body.organization.id as string, (tx) => tx.setting.findFirst({ where: { organizationId: registration.body.organization.id as string, branchId: null } }));
    expect(setting).toMatchObject({ upcomingDays: 7, dueSoonDays: 3, noticeLeadDays: 5, maxNoticeAttempts: 3, retryAfterHours: 24 });
    await agent.post('/api/auth/sign-out').expect(200);
    await agent.post('/api/auth/sign-in/email').send({ email, password }).expect(200);
    await agent.post('/api/auth/sign-out').expect(200);
    await agent.get('/api/v1/me').expect(401);
    const auditActions = await withTenant(registration.body.organization.id as string, (tx) => tx.auditLog.findMany({ where: { actorId: registration.body.user.id as string }, select: { action: true } }));
    expect(auditActions.map(({ action }) => action)).toEqual(expect.arrayContaining(['auth.register', 'auth.logout', 'auth.login']));
  });
});

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('seeded role permissions', () => {
  const password = 'MaxCareDev-2026!';
  async function login(role: 'owner' | 'admin' | 'operator' | 'read_only') {
    const agent = request.agent(app);
    await agent.post('/api/auth/sign-in/email').send({ email: `${role}.a@maxcare.test`, password }).expect(200);
    return agent;
  }

  it('allows branch creation only for owner/admin and rejects operator/read_only writes', async () => {
    const owner = await login('owner');
    const admin = await login('admin');
    const operator = await login('operator');
    const readOnly = await login('read_only');
    const suffix = crypto.randomUUID();
    const context = (await owner.get('/api/v1/me').expect(200)).body as { user: { id: string }; organization: { id: string }; branches: { id: string }[] };
    const branchId = context.branches[0]?.id;
    if (!branchId) throw new Error('Seed did not create a branch');
    const operatorContext = (await operator.get('/api/v1/me').expect(200)).body as { user: { id: string }; branches: { id: string }[] };
    const operatorBranchId = await withTenant(context.organization.id, async (tx) => (await tx.branchMember.findFirst({ where: { userId: operatorContext.user.id }, select: { branchId: true } }))!.branchId);
    const patient = await withTenant(context.organization.id, (tx) => tx.patient.create({ data: { organizationId: context.organization.id, primaryBranchId: operatorBranchId, fullName: `Permission patient ${suffix}`, createdBy: context.user.id } }));

    for (const [agent, name] of [[owner, `Owner branch ${suffix}`], [admin, `Admin branch ${suffix}`]] as const) {
      const created = await agent.post('/api/v1/branches').send({ name }).expect(201);
      await agent.delete(`/api/v1/branches/${created.body.id}`).expect(204);
    }
    for (const agent of [operator, readOnly]) {
      await agent.post('/api/v1/branches').send({ name: `Forbidden branch ${suffix}` }).expect(403);
      if (branchId) {
        await agent.patch(`/api/v1/branches/${branchId}`).send({ name: 'Forbidden update' }).expect(403);
        await agent.delete(`/api/v1/branches/${branchId}`).expect(403);
      }
    }
    await readOnly.patch(`/api/v1/patients/${patient.id}`).send({ fullName: 'Forbidden change' }).expect(403);
    await operator.patch(`/api/v1/patients/${patient.id}`).send({ fullName: `Updated by operator ${suffix}` }).expect(200);
    await operator.post(`/api/v1/patients/${patient.id}/archive`).expect(403);
    await Promise.all([owner, admin, operator, readOnly].map((agent) => agent.post('/api/auth/sign-out').expect(200)));
  });
});
