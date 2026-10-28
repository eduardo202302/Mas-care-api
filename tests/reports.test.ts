import './db-guard.js';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Agent } from 'supertest';
import { app } from '../src/app.js';
import { withTenant } from '../src/infra/prisma.js';

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
  overrides: { quantity?: number; startDate?: string } = {},
) {
  const patient = await agent.post('/api/v1/patients').send({
    primaryBranchId: branchId,
    fullName: `Report patient ${suffix}`,
    documentId: `RPT-${suffix}`,
    phone: `742${suffix.replace(/\D/g, '').slice(0, 7).padEnd(7, '0')}`,
    responsibleUserId: context.user.id,
  }).expect(201);
  const medication = await agent.post('/api/v1/medications').send({
    genericName: `Report medication ${suffix}`,
    presentation: '20 mg tablets',
    unitsPerPackage: 30,
  }).expect(201);
  const treatment = await agent.post('/api/v1/treatments').send({
    patient_id: patient.body.patient.id as string,
    medication_id: medication.body.id as string,
    branch_id: branchId,
    responsible_user_id: context.user.id,
    dose_per_intake: 1,
    intakes_per_day: 1,
    quantity_per_cycle: overrides.quantity ?? 30,
    start_date: overrides.startDate ?? iso(todayOnly),
    notes: 'Fictional report treatment data',
  }).expect(201);
  return {
    patientId: patient.body.patient.id as string,
    medicationId: medication.body.id as string,
    treatment: treatment.body as { id: string; coverageEndOn: string | null },
  };
}

describe.skipIf(!enabled)('block 4a: reports', () => {
  describe('GET /api/v1/reports/adherence', () => {
    it('returns percentage: null (never 0 or 100) when the denominator is 0, in every aggregation', async () => {
      const { agent: owner } = await login('owner');
      const branch = await createBranch(owner, `Adherence empty ${crypto.randomUUID()}`);
      // Range far in the past, long before any cycle's expected_on could fall into it.
      const response = await owner.get(`/api/v1/reports/adherence?branch_id=${branch.id}&from=1999-01-01&to=1999-01-31`).expect(200);
      expect(response.body.summary.denominator).toBe(0);
      expect(response.body.summary.percentage).toBeNull();
      for (const row of response.body.by_month) expect(row.percentage === null || row.denominator > 0).toBe(true);
      for (const row of response.body.by_branch) expect(row.percentage === null || row.denominator > 0).toBe(true);
      for (const row of response.body.by_medication) expect(row.percentage === null || row.denominator > 0).toBe(true);
    });

    it('includes previous_period only when compare_previous=true', async () => {
      const { agent: owner } = await login('owner');
      const branch = await createBranch(owner, `Adherence compare ${crypto.randomUUID()}`);
      const from = iso(addDays(todayOnly, -10));
      const to = iso(todayOnly);
      const withoutCompare = await owner.get(`/api/v1/reports/adherence?branch_id=${branch.id}&from=${from}&to=${to}`).expect(200);
      expect(withoutCompare.body.previous_period).toBeNull();
      const withCompare = await owner.get(`/api/v1/reports/adherence?branch_id=${branch.id}&from=${from}&to=${to}&compare_previous=true`).expect(200);
      expect(withCompare.body.previous_period).not.toBeNull();
      expect(withCompare.body.previous_period).toHaveProperty('percentage');
    });

    it('rejects a from/to range longer than 24 months with 400', async () => {
      const { agent: owner } = await login('owner');
      const response = await owner.get('/api/v1/reports/adherence?from=2000-01-01&to=2023-01-01').expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('restricts a single-branch operator to only their accessible branch, even if another branch_id is requested', async () => {
      const { agent: owner, context } = await login('owner');
      const { agent: operator, context: operatorContext } = await login('operator');
      const allowedBranch = await createBranch(owner, `Adherence allowed ${crypto.randomUUID()}`);
      const otherBranch = await createBranch(owner, `Adherence other ${crypto.randomUUID()}`);
      await withTenant(context.organization.id, (tx) => tx.branchMember.create({
        data: { organizationId: context.organization.id, branchId: allowedBranch.id, userId: operatorContext.user.id },
      }));
      const suffixOther = crypto.randomUUID();
      await createPatientWithTreatment(owner, context, otherBranch.id, suffixOther, { quantity: 1 });

      const response = await operator.get(`/api/v1/reports/adherence?branch_id=${otherBranch.id}&from=${iso(addDays(todayOnly, -5))}&to=${iso(todayOnly)}`).expect(200);
      const branchIds = response.body.by_branch.map((row: { branch_id: string }) => row.branch_id);
      expect(branchIds).not.toContain(otherBranch.id);
    });
  });

  describe('GET /api/v1/reports/overdue', () => {
    it('returns an empty summary (no 0/100 percentage artifacts) when nothing is overdue in range', async () => {
      const { agent: owner } = await login('owner');
      const branch = await createBranch(owner, `Overdue empty ${crypto.randomUUID()}`);
      const response = await owner.get(`/api/v1/reports/overdue?branch_id=${branch.id}&from=1999-01-01&to=1999-01-31`).expect(200);
      expect(response.body.summary).toEqual({ total_overdue: 0, delivered_late: 0, still_pending: 0 });
      expect(response.body.avg_delay_days).toBeNull();
    });

    it('rejects a from/to range longer than 24 months with 400', async () => {
      const { agent: owner } = await login('owner');
      const response = await owner.get('/api/v1/reports/overdue?from=2000-01-01&to=2023-01-01').expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('restricts a single-branch operator to only their accessible branch', async () => {
      const { agent: owner, context } = await login('owner');
      const { agent: operator, context: operatorContext } = await login('operator');
      const allowedBranch = await createBranch(owner, `Overdue allowed ${crypto.randomUUID()}`);
      const otherBranch = await createBranch(owner, `Overdue other ${crypto.randomUUID()}`);
      await withTenant(context.organization.id, (tx) => tx.branchMember.create({
        data: { organizationId: context.organization.id, branchId: allowedBranch.id, userId: operatorContext.user.id },
      }));

      const response = await operator.get(`/api/v1/reports/overdue?branch_id=${otherBranch.id}&from=${iso(addDays(todayOnly, -30))}&to=${iso(todayOnly)}`).expect(200);
      const branchIds = response.body.by_branch.map((row: { branch_id: string }) => row.branch_id);
      expect(branchIds).not.toContain(otherBranch.id);
    });
  });

  describe('GET /api/v1/reports/no-response', () => {
    it('never includes the patient phone number in the response body', async () => {
      const { agent: owner, context } = await login('owner');
      const branch = await createBranch(owner, `No response phone ${crypto.randomUUID()}`);
      const suffix = crypto.randomUUID();
      await createPatientWithTreatment(owner, context, branch.id, suffix);

      const response = await owner.get(`/api/v1/reports/no-response?branch_id=${branch.id}&from=${iso(addDays(todayOnly, -30))}&to=${iso(todayOnly)}`).expect(200);
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toMatch(/742\d{7}/);
      expect(serialized.includes('phone')).toBe(false);
    });

    it('rejects a from/to range longer than 24 months with 400', async () => {
      const { agent: owner } = await login('owner');
      const response = await owner.get('/api/v1/reports/no-response?from=2000-01-01&to=2023-01-01').expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('restricts a single-branch operator to only their accessible branch', async () => {
      const { agent: owner, context } = await login('owner');
      const { agent: operator, context: operatorContext } = await login('operator');
      const allowedBranch = await createBranch(owner, `No response allowed ${crypto.randomUUID()}`);
      const otherBranch = await createBranch(owner, `No response other ${crypto.randomUUID()}`);
      await withTenant(context.organization.id, (tx) => tx.branchMember.create({
        data: { organizationId: context.organization.id, branchId: allowedBranch.id, userId: operatorContext.user.id },
      }));

      const response = await operator.get(`/api/v1/reports/no-response?branch_id=${otherBranch.id}&from=${iso(addDays(todayOnly, -30))}&to=${iso(todayOnly)}`).expect(200);
      expect(response.body.data).toEqual([]);
    });

    it('requires authentication (401 with no session)', async () => {
      // Every seeded role (owner/admin/pharmacist/operator/read_only) already
      // holds dashboard:read (see src/domain/permissions.ts), so there is no
      // role fixture that exercises a 403 here; what IS directly testable is
      // that resolveTenant/requirePermission are actually wired on this
      // router rather than the route being open to anonymous callers.
      await request(app).get('/api/v1/reports/no-response').expect(401);
    });
  });
});
