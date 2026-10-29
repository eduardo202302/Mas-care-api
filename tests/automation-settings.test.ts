import './db-guard.js';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Agent } from 'supertest';
import { app } from '../src/app.js';
import { withTenant } from '../src/infra/prisma.js';

const enabled = process.env.RUN_DB_TESTS === '1';
const password = 'MaxCareDev-2026!';
type Role = 'owner' | 'admin' | 'pharmacist' | 'operator' | 'read_only';
type Context = { user: { id: string }; organization: { id: string }; branches: { id: string; name: string }[] };

async function login(role: Role, organization = 'a'): Promise<{ agent: Agent; context: Context }> {
  const agent = request.agent(app);
  await agent.post('/api/auth/sign-in/email')
    .send({ email: `${role}.${organization}@maxcare.test`, password })
    .expect(200);
  const context = (await agent.get('/api/v1/me').expect(200)).body as Context;
  return { agent, context };
}

describe.skipIf(!enabled)('automation settings and kill-switch', () => {
  // The test below changes the notice window and the switches; put the defaults back so it can run again.
  afterAll(async () => {
    const { agent } = await login('owner');
    await agent.patch('/api/v1/automation/settings').send({
      automation_enabled: false, automation_dry_run: true, notice_window_start: '09:00', notice_window_end: '18:00', auto_call_task_without_consent: false,
    });
  });

  it('only owner/admin can read or change automation settings, and the kill-switch turns automation off', async () => {
    const owner = await login('owner');

    for (const role of ['pharmacist', 'operator', 'read_only'] as const) {
      const { agent } = await login(role);
      await agent.get('/api/v1/automation/settings').expect(403);
      await agent.patch('/api/v1/automation/settings').send({ automation_enabled: true }).expect(403);
      await agent.post('/api/v1/automation/kill-switch').send({}).expect(403);
    }

    const defaults = await owner.agent.get('/api/v1/automation/settings').expect(200);
    expect(defaults.body).toMatchObject({
      automation_enabled: false,
      automation_dry_run: true,
      timezone: 'America/Santo_Domingo',
      notice_window_start: '09:00',
      notice_window_end: '18:00',
      auto_call_task_without_consent: false,
      default_country_code: 'DO',
      branch_id: null,
    });

    const updated = await owner.agent.patch('/api/v1/automation/settings').send({
      automation_enabled: true,
      automation_dry_run: false,
      notice_window_start: '08:30',
      notice_window_end: '19:00',
    }).expect(200);
    expect(updated.body).toMatchObject({
      automation_enabled: true,
      automation_dry_run: false,
      notice_window_start: '08:30',
      notice_window_end: '19:00',
    });

    await owner.agent.patch('/api/v1/automation/settings').send({ notice_window_start: 'not-a-time' }).expect(400);

    const branchId = owner.context.branches[0]!.id;
    const branchOverride = await owner.agent.patch('/api/v1/automation/settings').send({
      branch_id: branchId,
      automation_enabled: false,
    }).expect(200);
    expect(branchOverride.body).toMatchObject({ branch_id: branchId, automation_enabled: false });

    const orgStillOn = await owner.agent.get('/api/v1/automation/settings').expect(200);
    expect(orgStillOn.body).toMatchObject({ branch_id: null, automation_enabled: true });

    const killed = await owner.agent.post('/api/v1/automation/kill-switch').send({}).expect(200);
    expect(killed.body).toMatchObject({ automation_enabled: false, branch_id: null, cancelled_messages: expect.any(Number) });
    const afterKill = await owner.agent.get('/api/v1/automation/settings').expect(200);
    expect(afterKill.body.automation_enabled).toBe(false);

    const auditEntry = await withTenant(owner.context.organization.id, (tx) => tx.auditLog.findFirst({
      where: { organizationId: owner.context.organization.id, action: 'automation.kill_switch' },
      orderBy: { createdAt: 'desc' },
    }));
    expect(auditEntry).not.toBeNull();
    expect(auditEntry?.metadata).toMatchObject({ branchId: null });
  }, 60_000);
});
