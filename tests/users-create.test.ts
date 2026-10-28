import './db-guard.js';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { prisma } from '../src/infra/prisma.js';

const enabled = process.env.RUN_DB_TESTS === '1';
const password = 'MaxCareDev-2026!';
const createdEmails: string[] = [];

async function login(email: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/sign-in/email').send({ email, password }).expect(200);
  return agent;
}

describe.skipIf(!enabled)('user creation', () => {
  afterAll(async () => {
    if (createdEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
  });

  it('creates a member with a role and branch assignments', async () => {
    const owner = await login('owner.a@maxcare.test');
    const me = (await owner.get('/api/v1/me').expect(200)).body as {
      branches: Array<{ id: string; name: string }>;
    };
    const suffix = crypto.randomUUID();
    const email = `created-${suffix}@maxcare.test`;
    createdEmails.push(email);
    const branch = me.branches[0]!;

    const created = await owner
      .post('/api/v1/users')
      .send({
        name: 'Created Operator',
        username: `created-${suffix.slice(0, 8)}`,
        email,
        password: 'Created-Password-2026!',
        pin: '135790',
        role: 'operator',
        branchIds: [branch.id],
      })
      .expect(201);

    expect(created.body).toMatchObject({
      email,
      role: 'operator',
      username: `created-${suffix.slice(0, 8)}`,
      branches: [{ id: branch.id, name: branch.name }],
      pin: '135790',
    });

    const detail = await owner
      .get(`/api/v1/users/${created.body.id}`)
      .expect(200);
    expect(detail.body.pin).toBe('135790');

    const regenerated = await owner
      .post(`/api/v1/users/${created.body.id}/pin`)
      .expect(200);
    expect(regenerated.body.pin).toMatch(/^\d{6}$/);
    expect(regenerated.body.pin).not.toBe('135790');
    const refreshed = await owner
      .get(`/api/v1/users/${created.body.id}`)
      .expect(200);
    expect(refreshed.body.pin).toBe(regenerated.body.pin);

    const list = await owner
      .get(`/api/v1/users?q=${encodeURIComponent(email)}`)
      .expect(200);
    expect(list.body.data.map((user: { email: string }) => user.email)).toContain(email);

    const operator = await login('operator.a@maxcare.test');
    await operator
      .post('/api/v1/users')
      .send({
        name: 'Nope',
        username: `nope-${suffix.slice(0, 8)}`,
        email: `nope-${suffix}@maxcare.test`,
        password: 'Created-Password-2026!',
        role: 'read_only',
        branchIds: [branch.id],
      })
      .expect(403);
  });

  it('rejects a non-admin user without branches and rolls back the account', async () => {
    const owner = await login('owner.a@maxcare.test');
    const email = `no-branch-${crypto.randomUUID()}@maxcare.test`;
    const response = await owner
      .post('/api/v1/users')
      .send({
        name: 'No Branch',
        username: `nobranch-${crypto.randomUUID().slice(0, 8)}`,
        email,
        password: 'Created-Password-2026!',
        role: 'operator',
        branchIds: [],
      })
      .expect(400);

    expect(response.body.error.fields.branchIds).toBeTruthy();
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });
});
