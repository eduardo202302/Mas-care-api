import './db-guard.js';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { withTenant } from '../src/infra/prisma.js';

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('tenant boundary through the API', () => {
  it('does not reveal another tenant patient by ID, search, or manipulated tenant inputs', async () => {
    const agentA = request.agent(app);
    const agentB = request.agent(app);
    const suffix = crypto.randomUUID();
    const tag = suffix.replace(/-/g, '').slice(0, 12);
    const password = 'IsolationTest-Password-2026!';
    const accountA = await agentA.post('/api/v1/register').send({
      name: 'Tenant A',
      username: `tenant_a_${tag}`,
      email: `tenant-a-${suffix}@maxcare.test`,
      password,
      organizationName: `Tenant A ${suffix}`,
    }).expect(201);
    const accountB = await agentB.post('/api/v1/register').send({
      name: 'Tenant B',
      username: `tenant_b_${tag}`,
      email: `tenant-b-${suffix}@maxcare.test`,
      password,
      organizationName: `Tenant B ${suffix}`,
    }).expect(201);
    expect(accountA.body.organization.id).not.toBe(accountB.body.organization.id);
    const patient = await withTenant(accountB.body.organization.id as string, async (tx) => {
      const branch = await tx.branch.create({ data: { organizationId: accountB.body.organization.id as string, name: 'B only' } });
      return tx.patient.create({ data: { organizationId: accountB.body.organization.id as string, primaryBranchId: branch.id, fullName: `Secret Patient ${suffix}`, documentId: `S-${suffix}`, createdBy: accountB.body.user.id as string } });
    });
    await agentA.get(`/api/v1/patients/${patient.id}`).set('organization_id', accountB.body.organization.id).expect(404);
    await agentA.get(`/api/v1/patients/${patient.id}`).query({ organization_id: accountB.body.organization.id }).expect(404);
    const results = await agentA.get('/api/v1/patients').query({ q: `Secret Patient ${suffix}`, organization_id: accountB.body.organization.id }).expect(200);
    expect(results.body.data).toEqual([]);
    await agentA.get('/api/v1/patients').set('organization_id', accountB.body.organization.id).expect(200).expect(({ body }) => expect(body.data).toEqual([]));
    const branches = await agentA.get('/api/v1/branches').query({ organization_id: accountB.body.organization.id }).expect(200);
    expect(branches.body.data.every((branch: { organizationId: string }) => branch.organizationId === accountA.body.organization.id)).toBe(true);
    await agentA.patch(`/api/v1/patients/${patient.id}`).set('organization_id', accountB.body.organization.id).send({ fullName: 'Changed', organization_id: accountB.body.organization.id }).expect(404);
    await agentA.delete(`/api/v1/patients/${patient.id}`).query({ organization_id: accountB.body.organization.id }).set('organization_id', accountB.body.organization.id).send({ organization_id: accountB.body.organization.id }).expect(404);
    const stillOwnedByB = await agentB.get(`/api/v1/patients/${patient.id}`).expect(200);
    expect(stillOwnedByB.body.fullName).toBe(`Secret Patient ${suffix}`);
  });
});
