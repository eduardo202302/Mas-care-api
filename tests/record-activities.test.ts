import './db-guard.js';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { activityInput, activityListQuery } from '../src/schemas/patient.js';

const enabled = process.env.RUN_DB_TESTS === '1';
const password = 'MaxCareDev-2026!';

async function login(role: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/sign-in/email').send({ email: `${role}.a@maxcare.test`, password }).expect(200);
  return agent;
}

describe('activity schema', () => {
  it('accepts email and meeting with a date and a treatment', () => {
    for (const type of ['email', 'meeting']) {
      expect(activityInput.safeParse({ type, body: 'Resumen', occurredOn: '2026-10-01', treatmentId: 't1' }).success).toBe(true);
    }
    expect(activityInput.safeParse({ type: 'sms', body: 'x' }).success).toBe(false);
    expect(activityInput.safeParse({ type: 'email', body: '' }).success).toBe(false);
    expect(activityListQuery.parse({ treatment_id: 't1' }).treatment_id).toBe('t1');
  });
});

describe.skipIf(!enabled)('email/meeting activities and duplicate', () => {
  it('records a dated meeting with its author and filters history by treatment', async () => {
    const agent = await login('owner');
    const branch = (await agent.post('/api/v1/branches').send({ name: `Act branch ${Date.now()}` }).expect(201)).body as { id: string };
    const patient = (await agent.post('/api/v1/patients').send({ primaryBranchId: branch.id, fullName: 'Fictional activity patient' }).expect(201)).body.patient as { id: string };
    const created = await agent.post(`/api/v1/patients/${patient.id}/activities`).send({ type: 'meeting', body: 'Reunión de seguimiento', occurredOn: '2026-09-15' }).expect(201);
    expect(created.body.occurredAt).toContain('2026-09-15');
    expect(created.body.author.name).toBeTruthy();
    await agent.post(`/api/v1/patients/${patient.id}/activities`).send({ type: 'email', body: 'x', treatmentId: 'other-patient-treatment' }).expect(400);
    const filtered = await agent.get(`/api/v1/patients/${patient.id}/activities?treatment_id=none`).expect(200);
    expect(filtered.body.data).toHaveLength(0);
  });

  it('duplicates a patient without treatments, document or phone', async () => {
    const agent = await login('owner');
    const branch = (await agent.post('/api/v1/branches').send({ name: `Dup branch ${Date.now()}` }).expect(201)).body as { id: string };
    const patient = (await agent.post('/api/v1/patients').send({ primaryBranchId: branch.id, fullName: 'Fictional dup', documentId: `DUP-${Date.now()}`, phone: `6${Date.now().toString().slice(-8)}` }).expect(201)).body.patient as { id: string };
    const copy = await agent.post(`/api/v1/patients/${patient.id}/duplicate`).expect(201);
    expect(copy.body.fullName).toBe('Fictional dup (copia)');
    expect(copy.body.documentId).toBeNull();
    expect(copy.body.phone).toBeNull();
    const treatments = await agent.get(`/api/v1/treatments?patient_id=${copy.body.id}`).expect(200);
    expect(treatments.body.data).toHaveLength(0);
  });
});
