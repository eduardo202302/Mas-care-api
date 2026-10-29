import './db-guard.js';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { cycleBatchInput, cycleListQuery } from '../src/schemas/board.js';
import { savedViewCreate } from '../src/schemas/saved-view.js';

const enabled = process.env.RUN_DB_TESTS === '1';
const password = 'MaxCareDev-2026!';

async function login(role: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/sign-in/email').send({ email: `${role}.a@maxcare.test`, password }).expect(200);
  return agent;
}

describe('table schemas', () => {
  it('parses multi-sort and association sets, rejecting unknown sort fields', () => {
    const ok = cycleListQuery.parse({ sort: 'derived_status:asc,expected_on:desc', patient_ids: 'a,b', match: 'or' });
    expect(ok.sort).toEqual(['derived_status:asc', 'expected_on:desc']);
    expect(ok.patient_ids).toEqual(['a', 'b']);
    expect(cycleListQuery.parse({}).match).toBe('and');
    expect(cycleListQuery.safeParse({ sort: 'password:asc' }).success).toBe(false);
    expect(cycleListQuery.safeParse({ sort: 'a:asc,b:asc,c:asc,d:asc' }).success).toBe(false);
  });

  it('requires explicit confirmation for batch actions', () => {
    const base = { action: 'archive', ids: ['c1'] };
    expect(cycleBatchInput.safeParse(base).success).toBe(false);
    expect(cycleBatchInput.safeParse({ ...base, confirm: true }).success).toBe(true);
    expect(cycleBatchInput.safeParse({ action: 'change_stage', to_status: 'delivered', ids: ['c1'], confirm: true }).success).toBe(false);
  });

  it('accepts the cycles and column-preference saved view entities', () => {
    for (const entity of ['cycles', 'patients_columns', 'cycles_columns']) {
      expect(savedViewCreate.safeParse({ entity, name: 'x' }).success).toBe(true);
    }
    expect(savedViewCreate.safeParse({ entity: 'other', name: 'x' }).success).toBe(false);
  });
});

describe.skipIf(!enabled)('cycle table filters and batch actions', () => {
  it('sorts by several levels and filters by dates and associations', async () => {
    const agent = await login('owner');
    const res = await agent.get('/api/v1/cycles?sort=derived_status:asc,expected_on:asc&created_from=2000-01-01&match=or&branch_ids=none').expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const limited = await agent.get('/api/v1/cycles?branch_ids=does-not-exist').expect(200);
    expect(limited.body.data).toHaveLength(0);
  });

  it('applies a confirmed batch, skipping unknown ids, and rejects unconfirmed ones', async () => {
    const agent = await login('owner');
    await agent.post('/api/v1/cycles/batch').send({ action: 'archive', ids: ['nope'] }).expect(400);
    const done = await agent.post('/api/v1/cycles/batch').send({ action: 'create_tasks', title: 'Fictional batch task', ids: ['nope'], confirm: true }).expect(200);
    expect(done.body).toMatchObject({ requested: 1, applied: 0, skipped: ['nope'] });
  });

  it('keeps column preferences personal and readable for read-only roles', async () => {
    const agent = await login('read_only');
    const created = await agent.post('/api/v1/saved-views').send({ entity: 'cycles_columns', name: 'default', columns: ['patient', 'status'] }).expect(201);
    expect(created.body.columns).toEqual(['patient', 'status']);
    await agent.post('/api/v1/saved-views').send({ entity: 'cycles', name: 'No puedo' }).expect(403);
    await agent.delete(`/api/v1/saved-views/${created.body.id}`).expect(204);
  });
});

describe('patient list sort', () => {
  it('parses up to three levels and rejects unknown fields', async () => {
    const { patientListQuery } = await import('../src/schemas/patient.js');
    expect(patientListQuery.parse({ sort: 'full_name:asc,created_at:desc' }).sort).toEqual(['full_name:asc', 'created_at:desc']);
    expect(patientListQuery.safeParse({ sort: 'password:asc' }).success).toBe(false);
    expect(patientListQuery.safeParse({ sort: 'a:asc,b:asc,c:asc,d:asc' }).success).toBe(false);
  });
});

describe.skipIf(!enabled)('patient list ordering', () => {
  it('accepts a multi-level sort and still scopes to the organization', async () => {
    const agent = await login('owner');
    const res = await agent.get('/api/v1/patients?sort=full_name:asc,created_at:desc&rows=50').expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    await agent.get('/api/v1/patients?sort=password:asc').expect(400);
  });
});

describe('batch stage change and stock', () => {
  it('accepts confirm_out_of_stock on change_stage', () => {
    const base = { ids: ['c1'], confirm: true };
    expect(cycleBatchInput.safeParse({ ...base, action: 'change_stage', to_status: 'prepared', confirm_out_of_stock: true }).success).toBe(true);
  });
});
