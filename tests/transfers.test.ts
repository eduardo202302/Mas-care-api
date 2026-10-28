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
  overrides: { quantity?: number } = {},
) {
  const patient = await agent.post('/api/v1/patients').send({
    primaryBranchId: branchId,
    fullName: `Transfer patient ${suffix}`,
    documentId: `TRF-${suffix}`,
    phone: `740${suffix.replace(/\D/g, '').slice(0, 7).padEnd(7, '0')}`,
    responsibleUserId: context.user.id,
  }).expect(201);
  const medication = await agent.post('/api/v1/medications').send({
    genericName: `Transfer medication ${suffix}`,
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
    start_date: iso(todayOnly),
    notes: 'Fictional transfer treatment data',
  }).expect(201);
  return {
    patientId: patient.body.patient.id as string,
    medicationId: medication.body.id as string,
    treatment: treatment.body as { id: string },
  };
}

describe.skipIf(!enabled)('block 2: patient transfers', () => {
  it('transfers a patient and its active treatments, moving open cycles and recording an activity', async () => {
    const { agent: owner, context } = await login('owner');
    const branchFrom = await createBranch(owner, `Origin ${crypto.randomUUID()}`);
    const branchTo = await createBranch(owner, `Destination ${crypto.randomUUID()}`);
    const suffix = crypto.randomUUID();
    const { patientId, treatment } = await createPatientWithTreatment(owner, context, branchFrom.id, suffix);

    const response = await owner.post(`/api/v1/patients/${patientId}/transfers`)
      .send({ to_branch_id: branchTo.id, reason: 'Paciente se muda de zona' })
      .expect(201);
    expect(response.body).toMatchObject({
      completed: true,
      patient_id: patientId,
      from_branch_id: branchFrom.id,
      to_branch_id: branchTo.id,
      reason: 'Paciente se muda de zona',
      treatments_count: 1,
      cycles_count: 1,
      idempotent_replay: false,
    });

    const state = await withTenant(context.organization.id, async (tx) => ({
      patient: await tx.patient.findFirstOrThrow({ where: { id: patientId } }),
      updatedTreatment: await tx.treatment.findFirstOrThrow({ where: { id: treatment.id } }),
      openCycle: await tx.refillCycle.findFirstOrThrow({ where: { treatmentId: treatment.id, closedAt: null } }),
      activities: await tx.activity.findMany({ where: { patientId, type: 'transfer' } }),
    }));
    expect(state.patient.primaryBranchId).toBe(branchTo.id);
    expect(state.updatedTreatment.branchId).toBe(branchTo.id);
    expect(state.openCycle.branchId).toBe(branchTo.id);
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]!.body).toContain(branchTo.name);

    const history = await owner.get(`/api/v1/patients/${patientId}/transfers`).expect(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0]).toMatchObject({
      from_branch: { id: branchFrom.id },
      to_branch: { id: branchTo.id },
      reason: 'Paciente se muda de zona',
    });
  });

  it('rejects a transfer without a reason', async () => {
    const { agent: owner, context } = await login('owner');
    const branchFrom = await createBranch(owner, `Origin ${crypto.randomUUID()}`);
    const branchTo = await createBranch(owner, `Destination ${crypto.randomUUID()}`);
    const suffix = crypto.randomUUID();
    const { patientId } = await createPatientWithTreatment(owner, context, branchFrom.id, suffix);

    await owner.post(`/api/v1/patients/${patientId}/transfers`)
      .send({ to_branch_id: branchTo.id, reason: '' })
      .expect(400);
    await owner.post(`/api/v1/patients/${patientId}/transfers`)
      .send({ to_branch_id: branchTo.id })
      .expect(400);
  });

  it('replays the same idempotency key and conflicts when reused for a different transfer', async () => {
    const { agent: owner, context } = await login('owner');
    const branchFrom = await createBranch(owner, `Origin ${crypto.randomUUID()}`);
    const branchTo = await createBranch(owner, `Destination ${crypto.randomUUID()}`);
    const suffix = crypto.randomUUID();
    const { patientId } = await createPatientWithTreatment(owner, context, branchFrom.id, suffix);
    const key = `transfer-${suffix}`;

    const first = await owner.post(`/api/v1/patients/${patientId}/transfers`)
      .set('Idempotency-Key', key)
      .send({ to_branch_id: branchTo.id, reason: 'Primer traspaso' })
      .expect(201);
    expect(first.body.idempotent_replay).toBe(false);

    const replay = await owner.post(`/api/v1/patients/${patientId}/transfers`)
      .set('Idempotency-Key', key)
      .send({ to_branch_id: branchTo.id, reason: 'Primer traspaso' })
      .expect(200);
    expect(replay.body.idempotent_replay).toBe(true);
    expect(replay.body.id).toBe(first.body.id);

    const transfers = await withTenant(context.organization.id, (tx) => tx.patientTransfer.findMany({ where: { patientId } }));
    expect(transfers).toHaveLength(1);

    const otherSuffix = crypto.randomUUID();
    const { patientId: otherPatientId } = await createPatientWithTreatment(owner, context, branchFrom.id, otherSuffix);
    await owner.post(`/api/v1/patients/${otherPatientId}/transfers`)
      .set('Idempotency-Key', key)
      .send({ to_branch_id: branchTo.id, reason: 'Traspaso distinto' })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('IDEMPOTENCY_CONFLICT'));
  });

  it('warns about destination stock-out and only executes after confirmation', async () => {
    const { agent: owner, context } = await login('owner');
    const branchFrom = await createBranch(owner, `Origin ${crypto.randomUUID()}`);
    const branchTo = await createBranch(owner, `Destination ${crypto.randomUUID()}`);
    const suffix = crypto.randomUUID();
    const { patientId, medicationId, treatment } = await createPatientWithTreatment(owner, context, branchFrom.id, suffix);

    await owner.put(`/api/v1/branches/${branchTo.id}/stock-marks/${medicationId}`)
      .send({ level: 'out_of_stock' })
      .expect(200);

    const key = `transfer-stockout-${suffix}`;
    const warned = await owner.post(`/api/v1/patients/${patientId}/transfers`)
      .set('Idempotency-Key', key)
      .send({ to_branch_id: branchTo.id, reason: 'Traspaso con posible falta de stock' })
      .expect(200);
    expect(warned.body.completed).toBe(false);
    expect(warned.body.warnings).toEqual([
      expect.objectContaining({ code: 'STOCK_OUT_OF_STOCK_DEST', medication_id: medicationId, branch_id: branchTo.id }),
    ]);

    const notYetMoved = await withTenant(context.organization.id, (tx) => tx.treatment.findFirstOrThrow({ where: { id: treatment.id } }));
    expect(notYetMoved.branchId).toBe(branchFrom.id);
    const noTransferYet = await withTenant(context.organization.id, (tx) => tx.patientTransfer.findMany({ where: { patientId } }));
    expect(noTransferYet).toHaveLength(0);

    const confirmed = await owner.post(`/api/v1/patients/${patientId}/transfers`)
      .set('Idempotency-Key', key)
      .send({ to_branch_id: branchTo.id, reason: 'Traspaso con posible falta de stock', confirm_stock_warning: true })
      .expect(201);
    expect(confirmed.body.completed).toBe(true);
    const moved = await withTenant(context.organization.id, (tx) => tx.treatment.findFirstOrThrow({ where: { id: treatment.id } }));
    expect(moved.branchId).toBe(branchTo.id);
  });

  it('enforces patient:transfer permission (operator and read_only forbidden, pharmacist allowed)', async () => {
    const { agent: owner, context } = await login('owner');
    const { agent: operator } = await login('operator');
    const { agent: pharmacist, context: pharmacistContext } = await login('pharmacist');
    const { agent: readOnly } = await login('read_only');

    const branchFrom = await createBranch(owner, `Origin ${crypto.randomUUID()}`);
    const branchTo = await createBranch(owner, `Destination ${crypto.randomUUID()}`);
    await withTenant(context.organization.id, (tx) => tx.branchMember.createMany({
      data: [
        { organizationId: context.organization.id, branchId: branchFrom.id, userId: pharmacistContext.user.id },
        { organizationId: context.organization.id, branchId: branchTo.id, userId: pharmacistContext.user.id },
      ],
      skipDuplicates: true,
    }));

    const suffixOp = crypto.randomUUID();
    const { patientId: opPatientId } = await createPatientWithTreatment(owner, context, branchFrom.id, suffixOp);
    await operator.post(`/api/v1/patients/${opPatientId}/transfers`)
      .send({ to_branch_id: branchTo.id, reason: 'No permitido' })
      .expect(403);
    await readOnly.post(`/api/v1/patients/${opPatientId}/transfers`)
      .send({ to_branch_id: branchTo.id, reason: 'No permitido' })
      .expect(403);

    const suffixPh = crypto.randomUUID();
    const { patientId: phPatientId } = await createPatientWithTreatment(owner, context, branchFrom.id, suffixPh);
    await pharmacist.post(`/api/v1/patients/${phPatientId}/transfers`)
      .send({ to_branch_id: branchTo.id, reason: 'Pharmacist puede iniciar' })
      .expect(201);
  });

  it('restricts GET /api/v1/transfers to owner/admin even though pharmacist has patient:transfer', async () => {
    const { agent: owner, context } = await login('owner', 'b');
    const { agent: admin } = await login('admin', 'b');
    const { agent: pharmacist } = await login('pharmacist', 'b');

    const branchFrom = await createBranch(owner, `Origin ${crypto.randomUUID()}`);
    const branchTo = await createBranch(owner, `Destination ${crypto.randomUUID()}`);
    const suffix = crypto.randomUUID();
    const { patientId } = await createPatientWithTreatment(owner, context, branchFrom.id, suffix);
    await owner.post(`/api/v1/patients/${patientId}/transfers`)
      .send({ to_branch_id: branchTo.id, reason: 'Para listado global' })
      .expect(201);

    await pharmacist.get('/api/v1/transfers').expect(403);
    await owner.get('/api/v1/transfers').expect(200)
      .expect(({ body }) => expect(body.data.some((row: { patient?: { id: string } }) => row.patient !== undefined)).toBe(true));
    await admin.get('/api/v1/transfers').expect(200);
    await owner.get(`/api/v1/transfers?branch_id=${branchTo.id}`).expect(200)
      .expect(({ body }) => expect(body.data.length).toBeGreaterThan(0));
  });

  it('rejects transferring to the same branch, an archived branch, or a branch outside the organization', async () => {
    const { agent: owner, context } = await login('owner');
    const branchFrom = await createBranch(owner, `Origin ${crypto.randomUUID()}`);
    const archived = await createBranch(owner, `Archived ${crypto.randomUUID()}`);
    await owner.delete(`/api/v1/branches/${archived.id}`).expect(204);
    const suffix = crypto.randomUUID();
    const { patientId } = await createPatientWithTreatment(owner, context, branchFrom.id, suffix);

    await owner.post(`/api/v1/patients/${patientId}/transfers`)
      .send({ to_branch_id: branchFrom.id, reason: 'Misma sucursal' })
      .expect(400);
    await owner.post(`/api/v1/patients/${patientId}/transfers`)
      .send({ to_branch_id: archived.id, reason: 'Sucursal archivada' })
      .expect(409);
    await owner.post(`/api/v1/patients/${patientId}/transfers`)
      .send({ to_branch_id: 'not-a-real-branch', reason: 'Sucursal inexistente' })
      .expect(404);
  });
});
