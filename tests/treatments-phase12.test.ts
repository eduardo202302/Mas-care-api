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
const addDays = (days: number) => new Date(todayOnly.getTime() + days * 24 * 60 * 60 * 1000);

async function login(role: Role, organization = 'a'): Promise<{ agent: Agent; context: Context }> {
  const agent = request.agent(app);
  await agent.post('/api/auth/sign-in/email')
    .send({ email: `${role}.${organization}@maxcare.test`, password })
    .expect(200);
  const context = (await agent.get('/api/v1/me').expect(200)).body as Context;
  return { agent, context };
}

async function createTreatment(
  agent: Agent,
  context: Context,
  suffix: string,
  overrides: { branchId?: string; quantity?: number; startDate?: string; prescriptionExpiresOn?: string } = {},
) {
  const branchId = overrides.branchId ?? context.branches[0]!.id;
  const patient = await agent.post('/api/v1/patients').send({
    primaryBranchId: branchId,
    fullName: `Treatment patient ${suffix}`,
    documentId: `TRT-${suffix}`,
    phone: `720${suffix.slice(0, 7)}`,
    responsibleUserId: context.user.id,
  }).expect(201);
  const medication = await agent.post('/api/v1/medications').send({
    genericName: `Treatment medication ${suffix}`,
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
    prescriber_name: 'Dr. Example',
    prescription_expires_on: overrides.prescriptionExpiresOn ?? iso(addDays(30)),
    notes: 'Fictional treatment data',
  }).expect(201);
  return {
    patientId: patient.body.patient.id as string,
    medicationId: medication.body.id as string,
    treatment: treatment.body as { id: string; coverageEndOn: string; derived_status: string; days_remaining: number; prescription_flag: boolean },
  };
}

describe.skipIf(!enabled)('phase 1.2 treatment coverage APIs', () => {
  it('derives status on read, creates the first open cycle and records every lifecycle action', async () => {
    const { agent: owner, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const { treatment } = await createTreatment(owner, context, suffix, { quantity: 30 });

    expect(treatment.derived_status).toBe('al_dia');
    expect(treatment.days_remaining).toBe(30);
    expect(treatment.prescription_flag).toBe(false);
    expect(treatment.coverageEndOn.slice(0, 10)).toBe(iso(addDays(30)));

    const cycles = await withTenant(context.organization.id, (tx) => tx.refillCycle.findMany({ where: { treatmentId: treatment.id } }));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({ status: 'to_notify', branchId: context.branches[0]!.id });
    expect(iso(cycles[0]!.expectedOn)).toBe(iso(addDays(30)));

    await owner.post(`/api/v1/treatments/${treatment.id}/pause`).send({}).expect(400);
    await owner.post(`/api/v1/treatments/${treatment.id}/pause`).send({ reason: '   ' }).expect(400);
    await owner.post(`/api/v1/treatments/${treatment.id}/pause`).send({ reason: 'Patient travelling' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'paused', derived_status: null, days_remaining: null }));
    await owner.post(`/api/v1/treatments/${treatment.id}/resume`).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'active', derived_status: 'al_dia' }));
    await owner.post(`/api/v1/treatments/${treatment.id}/finish`).send({}).expect(400);
    await owner.post(`/api/v1/treatments/${treatment.id}/finish`).send({ reason: 'Treatment completed' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'finished', derived_status: null }));

    const second = await createTreatment(owner, context, `${suffix}-adjust`, { quantity: 5 });
    expect(second.treatment.derived_status).toBe('proxima_reposicion');
    await owner.post(`/api/v1/treatments/${second.treatment.id}/adjust-coverage`)
      .send({ new_end_on: iso(addDays(-1)), reason: 'Pharmacist review' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({
        derived_status: 'vencido',
        coverageManuallyAdjusted: true,
        coverageAdjustReason: 'Pharmacist review',
      }));
    await owner.post(`/api/v1/treatments/${second.treatment.id}/renew-prescription`)
      .send({ new_expiry: iso(addDays(2)) }).expect(200)
      .expect(({ body }) => expect(body.prescription_flag).toBe(true));

    const firstActivities = await withTenant(context.organization.id, (tx) => tx.activity.findMany({
      where: { treatmentId: treatment.id },
      select: { type: true },
    }));
    expect(firstActivities.map(({ type }) => type)).toEqual(expect.arrayContaining([
      'treatment_created', 'treatment_paused', 'treatment_resumed', 'treatment_finished',
    ]));
    const secondActivities = await withTenant(context.organization.id, (tx) => tx.activity.findMany({
      where: { treatmentId: second.treatment.id },
      select: { type: true },
    }));
    expect(secondActivities.map(({ type }) => type)).toEqual(expect.arrayContaining([
      'treatment_created', 'coverage_adjusted', 'prescription_renewed',
    ]));
  });

  it('changes derived status when due_soon_days changes and restricts settings to owner/admin', async () => {
    const { agent: owner, context } = await login('owner', 'b');
    const { agent: operator } = await login('operator', 'b');
    const suffix = crypto.randomUUID();
    const { treatment, patientId } = await createTreatment(owner, context, suffix, { quantity: 4 });

    expect(treatment.derived_status).toBe('proxima_reposicion');
    await operator.get('/api/v1/settings').expect(403);
    await operator.patch('/api/v1/settings').send({ due_soon_days: 5 }).expect(403);

    const before = await owner.get('/api/v1/settings').expect(200);
    expect(before.body.due_soon_days).toBe(3);
    expect(before.body.prescription_warning_days).toBe(15);

    await owner.patch('/api/v1/settings').send({ due_soon_days: 4 }).expect(200)
      .expect(({ body }) => expect(body.due_soon_days).toBe(4));
    await owner.get(`/api/v1/treatments/${treatment.id}`).expect(200)
      .expect(({ body }) => expect(body.derived_status).toBe('vence_pronto'));
    await owner.get(`/api/v1/treatments?patient_id=${patientId}&derived_status=vence_pronto`).expect(200)
      .expect(({ body }) => expect(body.data.map((row: { id: string }) => row.id)).toContain(treatment.id));
    await owner.get(`/api/v1/treatments?patient_id=${patientId}&derived_status=vencido`).expect(200)
      .expect(({ body }) => expect(body.data.map((row: { id: string }) => row.id)).not.toContain(treatment.id));
    await owner.patch('/api/v1/settings').send({ due_soon_days: 7, upcoming_days: 7 }).expect(400);
    await owner.patch('/api/v1/settings').send({ due_soon_days: 3 }).expect(200);
  });

  it('enforces treatment permissions, branch visibility and tenant isolation', async () => {
    const { agent: owner, context } = await login('owner');
    const { agent: ownerB, context: contextB } = await login('owner', 'b');
    const { agent: operator, context: operatorContext } = await login('operator');
    const { agent: pharmacist, context: pharmacistContext } = await login('pharmacist');
    const { agent: readOnly, context: readOnlyContext } = await login('read_only');

    const branchOf = async (userId: string) => {
      const membership = await withTenant(context.organization.id, (tx) => tx.branchMember.findFirst({
        where: { userId },
        select: { branchId: true },
      }));
      if (!membership) throw new Error('Seed requires every role to belong to a branch');
      return membership.branchId;
    };
    const [operatorBranch, pharmacistBranch, readOnlyBranch] = await Promise.all([
      branchOf(operatorContext.user.id),
      branchOf(pharmacistContext.user.id),
      branchOf(readOnlyContext.user.id),
    ]);

    const suffix = crypto.randomUUID();
    const { treatment } = await createTreatment(owner, context, suffix, { branchId: operatorBranch });
    const pharmacistTreatment = await createTreatment(owner, context, `${suffix}-pharmacist`, { branchId: pharmacistBranch });
    const readOnlyTreatment = await createTreatment(owner, context, `${suffix}-readonly`, { branchId: readOnlyBranch });

    await operator.get(`/api/v1/treatments/${treatment.id}`).expect(200);
    await operator.patch(`/api/v1/treatments/${treatment.id}`).send({ dose_per_intake: 2 }).expect(200);
    await operator.post(`/api/v1/treatments/${treatment.id}/pause`).send({ reason: 'Not allowed' }).expect(403);
    await operator.post(`/api/v1/treatments/${treatment.id}/finish`).send({ reason: 'Not allowed' }).expect(403);
    await operator.post(`/api/v1/treatments/${treatment.id}/adjust-coverage`)
      .send({ new_end_on: iso(addDays(10)), reason: 'Not allowed' }).expect(403);
    await operator.post(`/api/v1/treatments/${treatment.id}/renew-prescription`)
      .send({ new_expiry: iso(addDays(20)) }).expect(403);

    await readOnly.get(`/api/v1/treatments/${readOnlyTreatment.treatment.id}`).expect(200);
    await readOnly.get('/api/v1/treatments').expect(200);
    await readOnly.post('/api/v1/treatments').send({
      patient_id: 'not-relevant',
      medication_id: 'not-relevant',
      branch_id: readOnlyBranch,
      dose_per_intake: 1,
      intakes_per_day: 1,
      quantity_per_cycle: 10,
      start_date: iso(todayOnly),
    }).expect(403);
    await pharmacist.post(`/api/v1/treatments/${pharmacistTreatment.treatment.id}/pause`)
      .send({ reason: 'Pharmacist review' }).expect(200);
    await pharmacist.post(`/api/v1/treatments/${pharmacistTreatment.treatment.id}/resume`).expect(200);
    await pharmacist.post(`/api/v1/treatments/${pharmacistTreatment.treatment.id}/finish`)
      .send({ reason: 'Completed' }).expect(200);

    await ownerB.get(`/api/v1/treatments/${treatment.id}`).expect(404);
    await ownerB.get('/api/v1/treatments').expect(200)
      .expect(({ body }) => expect(body.data.map((row: { id: string }) => row.id)).not.toContain(treatment.id));
    expect(contextB.organization.id).not.toBe(context.organization.id);
  });

  it('allows only one open refill cycle per treatment at the database level', async () => {
    const { agent: owner, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const { treatment } = await createTreatment(owner, context, suffix);
    const cycles = await withTenant(context.organization.id, (tx) => tx.refillCycle.findMany({ where: { treatmentId: treatment.id } }));
    expect(cycles).toHaveLength(1);
    const first = cycles[0]!;

    await expect(withTenant(context.organization.id, (tx) => tx.refillCycle.create({
      data: {
        organizationId: context.organization.id,
        treatmentId: treatment.id,
        branchId: context.branches[0]!.id,
        status: 'to_notify',
        expectedOn: addDays(60),
        expectedQuantity: 30,
      },
    }))).rejects.toThrow();

    await withTenant(context.organization.id, (tx) => tx.refillCycle.update({
      where: { organizationId_id: { organizationId: context.organization.id, id: first.id } },
      data: { status: 'delivered', closedAt: new Date() },
    }));
    await expect(withTenant(context.organization.id, async (tx) => {
      const second = await tx.refillCycle.create({
        data: {
          organizationId: context.organization.id,
          treatmentId: treatment.id,
          branchId: context.branches[0]!.id,
          status: 'to_notify',
          expectedOn: addDays(60),
          expectedQuantity: 30,
        },
      });
      return second.id;
    })).resolves.toEqual(expect.any(String));
  });
});
