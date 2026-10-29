import './db-guard.js';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { withTenant } from '../src/infra/prisma.js';

const enabled = process.env.RUN_DB_TESTS === '1';
const password = 'MaxCareDev-2026!';

async function login(role: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/sign-in/email').send({ email: `${role}.a@maxcare.test`, password }).expect(200);
  const context = (await agent.get('/api/v1/me').expect(200)).body as { organization: { id: string } };
  return { agent, context };
}

describe.skipIf(!enabled)('board: column totals and cycle creation', () => {
  it('creates a cycle only for a treatment without an open one, in the chosen column', async () => {
    const { agent, context } = await login('owner');
    const suffix = Date.now();
    const branch = (await agent.post('/api/v1/branches').send({ name: `Cycle branch ${suffix}` }).expect(201)).body as { id: string };
    const patient = (await agent.post('/api/v1/patients').send({ primaryBranchId: branch.id, fullName: `Fictional cycle ${suffix}` }).expect(201)).body.patient as { id: string };
    const medication = (await agent.post('/api/v1/medications').send({ genericName: `Fictional cycle med ${suffix}`, presentation: '5 mg' }).expect(201)).body as { id: string };
    const treatment = (await agent.post('/api/v1/treatments').send({
      patient_id: patient.id, medication_id: medication.id, branch_id: branch.id, dose_per_intake: 1, intakes_per_day: 1,
      quantity_per_cycle: 30, start_date: new Date().toISOString().slice(0, 10),
    }).expect(201)).body as { id: string };

    // A new treatment already has its first open cycle, so it is not eligible yet.
    const before = (await agent.get(`/api/v1/cycles/eligible-treatments?q=${encodeURIComponent(`Fictional cycle ${suffix}`)}`).expect(200)).body.data as { id: string }[];
    expect(before.map((row) => row.id)).not.toContain(treatment.id);
    await agent.post('/api/v1/cycles').send({ treatment_id: treatment.id }).expect(409);

    // Cancel the open cycle directly, then it becomes eligible.
    await withTenant(context.organization.id, (tx) => tx.refillCycle.updateMany({ where: { treatmentId: treatment.id }, data: { status: 'cancelled', closedAt: new Date() } }));
    const after = (await agent.get(`/api/v1/cycles/eligible-treatments?q=${encodeURIComponent(`Fictional cycle ${suffix}`)}`).expect(200)).body.data as { id: string }[];
    expect(after.map((row) => row.id)).toContain(treatment.id);
    const created = await agent.post('/api/v1/cycles').send({ treatment_id: treatment.id, status: 'confirmed' }).expect(201);
    expect(created.body.status).toBe('confirmed');
  });

  it('reports total, overdue and due-soon counts per column', async () => {
    const { agent } = await login('owner');
    const board = (await agent.get('/api/v1/board').expect(200)).body as { columns: Record<string, { count: number; overdue_count: number; due_soon_count: number }> };
    for (const column of Object.values(board.columns)) {
      expect(column.overdue_count).toBeLessThanOrEqual(column.count);
      expect(column.due_soon_count).toBeLessThanOrEqual(column.count);
    }
  });

  it('blocks roles without treatments:write from creating cycles', async () => {
    const { agent } = await login('read_only');
    await agent.post('/api/v1/cycles').send({ treatment_id: 'x' }).expect(403);
  });
});
