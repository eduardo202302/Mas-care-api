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

async function login(role: Role, organization = 'a'): Promise<{ agent: Agent; context: Context }> {
  const agent = request.agent(app);
  await agent.post('/api/auth/sign-in/email')
    .send({ email: `${role}.${organization}@maxcare.test`, password })
    .expect(200);
  const context = (await agent.get('/api/v1/me').expect(200)).body as Context;
  return { agent, context };
}

async function createBranch(agent: Agent, name: string) {
  return (await agent.post('/api/v1/branches').send({ name }).expect(201)).body as {
    id: string;
    name: string;
    labelColor: string;
  };
}

async function createPatientWithTreatment(agent: Agent, context: Context, branchId: string, suffix: string) {
  const patient = await agent.post('/api/v1/patients').send({
    primaryBranchId: branchId,
    fullName: `Consolidated patient ${suffix}`,
    documentId: `CONS-${suffix}`,
    phone: `741${suffix.replace(/\D/g, '').slice(0, 7).padEnd(7, '0')}`,
    responsibleUserId: context.user.id,
  }).expect(201);
  const medication = await agent.post('/api/v1/medications').send({
    genericName: `Consolidated medication ${suffix}`,
    presentation: '20 mg tablets',
    unitsPerPackage: 30,
  }).expect(201);
  const today = new Date();
  const todayOnly = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const iso = todayOnly.toISOString().slice(0, 10);
  const treatment = await agent.post('/api/v1/treatments').send({
    patient_id: patient.body.patient.id as string,
    medication_id: medication.body.id as string,
    branch_id: branchId,
    responsible_user_id: context.user.id,
    dose_per_intake: 1,
    intakes_per_day: 1,
    quantity_per_cycle: 1, // coverage_end_on = start_date -> counts as today_refills
    start_date: iso,
    notes: 'Fictional consolidated-dashboard treatment data',
  }).expect(201);
  return { patientId: patient.body.patient.id as string, treatment: treatment.body as { id: string } };
}

describe.skipIf(!enabled)('block 3: consolidated dashboard', () => {
  it('returns the exact same per-branch counts as /dashboard?branch_id=X for the same branch and date', async () => {
    const { agent: owner, context } = await login('owner');
    const branch = await createBranch(owner, `Consolidated single ${crypto.randomUUID()}`);
    const suffix = crypto.randomUUID();
    await createPatientWithTreatment(owner, context, branch.id, suffix);

    const daily = await owner.get(`/api/v1/dashboard?branch_id=${branch.id}`).expect(200);
    const consolidated = await owner.get('/api/v1/dashboard/consolidated').expect(200);

    const row = consolidated.body.branches.find((b: { branch_id: string }) => b.branch_id === branch.id);
    expect(row).toBeDefined();
    expect({
      today_refills: row.today_refills,
      due_soon: row.due_soon,
      overdue: row.overdue,
      pending_pickups: row.pending_pickups,
      prescriptions_to_renew: row.prescriptions_to_renew,
      no_response: row.no_response,
    }).toEqual(daily.body.counts);
  });

  it('sums branch rows correctly into the TOTAL row', async () => {
    const { agent: owner, context } = await login('owner');
    const branchOne = await createBranch(owner, `Consolidated total one ${crypto.randomUUID()}`);
    const branchTwo = await createBranch(owner, `Consolidated total two ${crypto.randomUUID()}`);
    await createPatientWithTreatment(owner, context, branchOne.id, crypto.randomUUID());
    await createPatientWithTreatment(owner, context, branchTwo.id, crypto.randomUUID());

    const consolidated = await owner.get('/api/v1/dashboard/consolidated').expect(200);
    const rowOne = consolidated.body.branches.find((b: { branch_id: string }) => b.branch_id === branchOne.id);
    const rowTwo = consolidated.body.branches.find((b: { branch_id: string }) => b.branch_id === branchTwo.id);
    expect(rowOne).toBeDefined();
    expect(rowTwo).toBeDefined();

    const keys = ['today_refills', 'due_soon', 'overdue', 'pending_pickups', 'prescriptions_to_renew', 'no_response', 'open_incidents', 'failed_messages'] as const;
    for (const key of keys) {
      const expectedSum = consolidated.body.branches.reduce((sum: number, b: Record<string, number>) => sum + (b[key] ?? 0), 0);
      expect(consolidated.body.total[key]).toBe(expectedSum);
    }
    expect(consolidated.body.total.stock_check_age_days).toBeUndefined();
  });

  it('restricts a single-branch operator to only their accessible branch, ignoring any branch_id they might try to pass', async () => {
    const { agent: owner, context } = await login('owner');
    const { agent: operator, context: operatorContext } = await login('operator');
    const allowedBranch = await createBranch(owner, `Operator allowed ${crypto.randomUUID()}`);
    const otherBranch = await createBranch(owner, `Operator other ${crypto.randomUUID()}`);
    await withTenant(context.organization.id, (tx) => tx.branchMember.create({
      data: { organizationId: context.organization.id, branchId: allowedBranch.id, userId: operatorContext.user.id },
    }));

    const response = await operator.get(`/api/v1/dashboard/consolidated?branch_id=${otherBranch.id}`).expect(200);
    const branchIds = response.body.branches.map((b: { branch_id: string }) => b.branch_id);
    expect(branchIds).toContain(allowedBranch.id);
    expect(branchIds).not.toContain(otherBranch.id);
    // Other test files also grant this shared operator branches, so compare with the real memberships.
    const memberships = await withTenant(context.organization.id, (tx) => tx.branchMember.findMany({
      where: { userId: operatorContext.user.id }, select: { branchId: true },
    }));
    expect([...branchIds].sort()).toEqual(memberships.map((m) => m.branchId).sort());
  });

  it('shows every non-archived organization branch to an owner/admin', async () => {
    const { agent: owner } = await login('owner');
    const branchOne = await createBranch(owner, `Owner visibility one ${crypto.randomUUID()}`);
    const branchTwo = await createBranch(owner, `Owner visibility two ${crypto.randomUUID()}`);

    const response = await owner.get('/api/v1/dashboard/consolidated').expect(200);
    const branchIds = response.body.branches.map((b: { branch_id: string }) => b.branch_id);
    expect(branchIds).toContain(branchOne.id);
    expect(branchIds).toContain(branchTwo.id);

    const admin = await login('admin');
    const adminResponse = await admin.agent.get('/api/v1/dashboard/consolidated').expect(200);
    const adminBranchIds = adminResponse.body.branches.map((b: { branch_id: string }) => b.branch_id);
    expect(adminBranchIds).toContain(branchOne.id);
    expect(adminBranchIds).toContain(branchTwo.id);
  });

  it('excludes archived branches from the consolidated panel', async () => {
    const { agent: owner, context } = await login('owner');
    const archived = await createBranch(owner, `To archive ${crypto.randomUUID()}`);
    await withTenant(context.organization.id, (tx) => tx.branch.update({
      where: { organizationId_id: { organizationId: context.organization.id, id: archived.id } },
      data: { archivedAt: new Date() },
    }));

    const response = await owner.get('/api/v1/dashboard/consolidated').expect(200);
    const branchIds = response.body.branches.map((b: { branch_id: string }) => b.branch_id);
    expect(branchIds).not.toContain(archived.id);
  });
});
