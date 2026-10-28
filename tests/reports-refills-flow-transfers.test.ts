import './db-guard.js';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Agent } from 'supertest';
import { app } from '../src/app.js';

const enabled = process.env.RUN_DB_TESTS === '1';
const password = 'MaxCareDev-2026!';
type Role = 'owner' | 'admin' | 'pharmacist' | 'operator' | 'read_only';
type Context = { user: { id: string }; organization: { id: string }; branches: { id: string; name: string }[] };

const today = new Date();
const todayOnly = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

async function login(role: Role, organization = 'a'): Promise<{ agent: Agent; context: Context }> {
  const agent = request.agent(app);
  await agent.post('/api/auth/sign-in/email')
    .send({ email: `${role}.${organization}@maxcare.test`, password })
    .expect(200);
  const context = (await agent.get('/api/v1/me').expect(200)).body as Context;
  return { agent, context };
}

async function createBranch(agent: Agent, name: string) {
  return (await agent.post('/api/v1/branches').send({ name }).expect(201)).body as { id: string; name: string };
}

async function createPatientWithTreatment(
  agent: Agent,
  context: Context,
  branchId: string,
  suffix: string,
  overrides: { quantity?: number; startDate?: string; unitsPerPackage?: number | null } = {},
) {
  const patient = await agent.post('/api/v1/patients').send({
    primaryBranchId: branchId,
    fullName: `Refill report patient ${suffix}`,
    documentId: `RFL-${suffix}`,
    phone: `742${suffix.replace(/\D/g, '').slice(0, 7).padEnd(7, '0')}`,
    responsibleUserId: context.user.id,
  }).expect(201);
  const medicationBody: Record<string, unknown> = {
    genericName: `Refill medication ${suffix}`,
    presentation: '20 mg tablets',
  };
  if (overrides.unitsPerPackage !== null) medicationBody.unitsPerPackage = overrides.unitsPerPackage ?? 30;
  const medication = await agent.post('/api/v1/medications').send(medicationBody).expect(201);
  const treatment = await agent.post('/api/v1/treatments').send({
    patient_id: patient.body.patient.id as string,
    medication_id: medication.body.id as string,
    branch_id: branchId,
    responsible_user_id: context.user.id,
    dose_per_intake: 1,
    intakes_per_day: 1,
    quantity_per_cycle: overrides.quantity ?? 30,
    start_date: overrides.startDate ?? iso(todayOnly),
    notes: 'Fictional refill/flow/transfers report test data',
  }).expect(201);
  return {
    patientId: patient.body.patient.id as string,
    medicationId: medication.body.id as string,
    treatment: treatment.body as { id: string; coverageEndOn: string | null },
  };
}

describe.skipIf(!enabled)('block 4b: refills, treatments-flow, transfers reports and CSV export', () => {
  describe('GET /api/v1/reports/refills', () => {
    it('includes estimated_packages when the medication has unitsPerPackage, and omits it when null', async () => {
      const { agent: owner, context } = await login('owner');
      const branch = await createBranch(owner, `Refills pkg ${crypto.randomUUID()}`);
      const withPkg = await createPatientWithTreatment(owner, context, branch.id, crypto.randomUUID(), { unitsPerPackage: 10 });
      const withoutPkg = await createPatientWithTreatment(owner, context, branch.id, crypto.randomUUID(), { unitsPerPackage: null });

      await owner.post(`/api/v1/treatments/${withPkg.treatment.id}/deliver`).send({
        quantity: 30, delivered_on: iso(todayOnly), picked_up_by: 'patient',
      }).expect(201);
      await owner.post(`/api/v1/treatments/${withoutPkg.treatment.id}/deliver`).send({
        quantity: 30, delivered_on: iso(todayOnly), picked_up_by: 'patient',
      }).expect(201);

      const response = await owner.get(
        `/api/v1/reports/refills?branch_id=${branch.id}&from=${iso(addDays(todayOnly, -1))}&to=${iso(todayOnly)}`,
      ).expect(200);

      const rowWithPkg = response.body.data.find((r: { medication_id: string }) => r.medication_id === withPkg.medicationId);
      const rowWithoutPkg = response.body.data.find((r: { medication_id: string }) => r.medication_id === withoutPkg.medicationId);
      expect(rowWithPkg.estimated_packages).toBe(3); // ceil(30 / 10)
      expect(rowWithoutPkg).not.toHaveProperty('estimated_packages');
      expect(response.body.horizons_days).toEqual([7, 14, 30, 60]);
      expect(response.body.notes.forecast).toContain('no incluye tratamientos sin ciclo');
    });

    it('rejects a from/to range longer than 24 months with 400', async () => {
      const { agent: owner } = await login('owner');
      const response = await owner.get('/api/v1/reports/refills?from=2000-01-01&to=2023-01-01').expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/reports/treatments-flow', () => {
    it('counts only the four Activity-sourced categories and documents the source note', async () => {
      const { agent: owner, context } = await login('owner');
      const branch = await createBranch(owner, `Flow ${crypto.randomUUID()}`);
      const { treatment } = await createPatientWithTreatment(owner, context, branch.id, crypto.randomUUID());

      await owner.post(`/api/v1/treatments/${treatment.id}/pause`).send({ reason: 'Test pause' }).expect(200);
      await owner.post(`/api/v1/treatments/${treatment.id}/resume`).send({}).expect(200);
      await owner.post(`/api/v1/treatments/${treatment.id}/finish`).send({ reason: 'Test finish' }).expect(200);

      const response = await owner.get(
        `/api/v1/reports/treatments-flow?branch_id=${branch.id}&from=${iso(addDays(todayOnly, -1))}&to=${iso(addDays(todayOnly, 1))}`,
      ).expect(200);

      expect(response.body.categories_included.sort()).toEqual(['altas', 'finalizaciones', 'pausas', 'reanudaciones'].sort());
      expect(response.body.totals.altas).toBeGreaterThanOrEqual(1);
      expect(response.body.totals.pausas).toBeGreaterThanOrEqual(1);
      expect(response.body.totals.reanudaciones).toBeGreaterThanOrEqual(1);
      expect(response.body.totals.finalizaciones).toBeGreaterThanOrEqual(1);
      expect(response.body.notes.source).toContain('treatment_created');
    });

    it('rejects a from/to range longer than 24 months with 400', async () => {
      const { agent: owner } = await login('owner');
      const response = await owner.get('/api/v1/reports/treatments-flow?from=2000-01-01&to=2023-01-01').expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/reports/transfers', () => {
    it('aggregates by origin/destination branch, month, and documents the free-text reason limitation', async () => {
      const { agent: owner, context } = await login('owner');
      const fromBranch = await createBranch(owner, `Transfer from ${crypto.randomUUID()}`);
      const toBranch = await createBranch(owner, `Transfer to ${crypto.randomUUID()}`);
      const patient = await owner.post('/api/v1/patients').send({
        primaryBranchId: fromBranch.id,
        fullName: `Transfer patient ${crypto.randomUUID()}`,
        documentId: `TRF-${crypto.randomUUID()}`,
        phone: `7421112233`,
        responsibleUserId: context.user.id,
      }).expect(201);

      await owner.post(`/api/v1/patients/${patient.body.patient.id}/transfers`).send({
        to_branch_id: toBranch.id,
        reason: 'Cambio de domicilio',
      }).expect(201);

      const response = await owner.get(
        `/api/v1/reports/transfers?branch_id=${fromBranch.id}&from=${iso(addDays(todayOnly, -1))}&to=${iso(addDays(todayOnly, 1))}`,
      ).expect(200);

      expect(response.body.summary.total_transfers).toBeGreaterThanOrEqual(1);
      const originRow = response.body.by_origin_branch.find((r: { branch_id: string }) => r.branch_id === fromBranch.id);
      expect(originRow.count).toBeGreaterThanOrEqual(1);
      expect(response.body.notes.reason_limitation).toContain('texto libre');
      expect(response.body.by_reason.some((r: { reason: string }) => r.reason === 'cambio de domicilio')).toBe(true);
    });

    it('rejects a from/to range longer than 24 months with 400', async () => {
      const { agent: owner } = await login('owner');
      const response = await owner.get('/api/v1/reports/transfers?from=2000-01-01&to=2023-01-01').expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/reports/export/:type (CSV export)', () => {
    it('returns 403 for a role without export:csv (pharmacist)', async () => {
      const { agent: pharmacist } = await login('pharmacist');
      await pharmacist.get('/api/v1/reports/export/refills').expect(403);
    });

    it('returns a CSV with the requested separator for owner (who holds export:csv)', async () => {
      const { agent: owner, context } = await login('owner');
      const branch = await createBranch(owner, `Export sep ${crypto.randomUUID()}`);
      await createPatientWithTreatment(owner, context, branch.id, crypto.randomUUID());

      const commaResponse = await owner.get(`/api/v1/reports/export/treatments-flow?branch_id=${branch.id}`).expect(200);
      expect(commaResponse.headers['content-type']).toContain('text/csv');
      expect(commaResponse.text.split('\r\n')[0]).toContain(',');

      const semicolonResponse = await owner.get(`/api/v1/reports/export/treatments-flow?branch_id=${branch.id}&separator=;`).expect(200);
      expect(semicolonResponse.text.split('\r\n')[0]).toContain(';');
      expect(semicolonResponse.text.split('\r\n')[0]).not.toContain(',');
    });

    it('sets X-Contains-Patient-Data for overdue/no-response but not for aggregate-only reports', async () => {
      const { agent: owner } = await login('owner');
      const overdueResponse = await owner.get('/api/v1/reports/export/overdue').expect(200);
      expect(overdueResponse.headers['x-contains-patient-data']).toBe('true');

      const transfersResponse = await owner.get('/api/v1/reports/export/transfers').expect(200);
      expect(transfersResponse.headers['x-contains-patient-data']).toBeUndefined();
    });

    it('never includes a phone number in the no-response export', async () => {
      const { agent: owner, context } = await login('owner');
      const branch = await createBranch(owner, `Export phone ${crypto.randomUUID()}`);
      await createPatientWithTreatment(owner, context, branch.id, crypto.randomUUID());

      const response = await owner.get(`/api/v1/reports/export/no-response?branch_id=${branch.id}`).expect(200);
      expect(response.text).not.toMatch(/742\d{7}/);
      expect(response.text.toLowerCase()).not.toContain('phone');
    });

    it('rejects an unknown report type with 400', async () => {
      const { agent: owner } = await login('owner');
      await owner.get('/api/v1/reports/export/not-a-real-type').expect(400);
    });

    it('requires authentication (401 with no session)', async () => {
      await request(app).get('/api/v1/reports/export/refills').expect(401);
    });
  });
});
