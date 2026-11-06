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

async function createTreatment(agent: Agent, context: Context, suffix: string, branchId?: string) {
  const branch = branchId ?? context.branches[0]!.id;
  const patient = await agent.post('/api/v1/patients').send({
    primaryBranchId: branch,
    fullName: `Dose patient ${suffix}`,
    documentId: `DOSE-${suffix}`,
    phone: `721${suffix.slice(0, 7)}`,
    responsibleUserId: context.user.id,
  }).expect(201);
  const medication = await agent.post('/api/v1/medications').send({
    genericName: `Dose medication ${suffix}`,
    presentation: '10 mg tablets',
    unitsPerPackage: 30,
  }).expect(201);
  const treatment = await agent.post('/api/v1/treatments').send({
    patient_id: patient.body.patient.id as string,
    medication_id: medication.body.id as string,
    branch_id: branch,
    responsible_user_id: context.user.id,
    dose_per_intake: 1,
    intakes_per_day: 2,
    quantity_per_cycle: 30,
    start_date: iso(todayOnly),
  }).expect(201);
  return { patientId: patient.body.patient.id as string, treatmentId: treatment.body.id as string };
}

/** Inserts a `scheduled` DoseLog directly - occurrences are normally materialized by the worker, never by an HTTP endpoint. */
async function insertDoseLog(organizationId: string, treatmentId: string, doseScheduleId: string, scheduledFor: Date) {
  return withTenant(organizationId, (tx) => tx.doseLog.create({
    data: { organizationId, treatmentId, doseScheduleId, scheduledFor, status: 'scheduled', nominalQuantity: 1 },
  }));
}

describe.skipIf(!enabled)('dose tracking + inventory ledger', () => {
  it('opens a dose schedule, requires authorization to change it, and never overlaps versions', async () => {
    const { agent: owner, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const { treatmentId } = await createTreatment(owner, context, suffix);

    const first = await owner.post(`/api/v1/treatments/${treatmentId}/dose-schedules`)
      .field('dose_per_intake', '1').field('times', '08:00,20:00').field('effective_from', iso(todayOnly))
      .expect(201);
    expect(first.body.times).toEqual(['08:00', '20:00']);
    expect(first.body.effectiveTo).toBeNull();

    await owner.post(`/api/v1/treatments/${treatmentId}/dose-schedules`)
      .field('dose_per_intake', '2').field('times', '08:00').field('effective_from', iso(addDays(5)))
      .expect(400);

    const second = await owner.post(`/api/v1/treatments/${treatmentId}/dose-schedules`)
      .field('dose_per_intake', '2').field('times', '08:00').field('effective_from', iso(addDays(5)))
      .field('authorized_by', 'Dr. Example').field('authorization_note', 'Phone authorization')
      .expect(201);
    expect(second.body.effectiveTo).toBeNull();

    const schedules = await withTenant(context.organization.id, (tx) => tx.doseSchedule.findMany({ where: { treatmentId }, orderBy: { effectiveFrom: 'asc' } }));
    expect(schedules).toHaveLength(2);
    expect(iso(schedules[0]!.effectiveTo!)).toBe(iso(addDays(4)));
    expect(schedules[1]!.effectiveTo).toBeNull();
  });

  it('takes a dose (consuming inventory), skips one, reschedules one, and corrects a taken dose back to scheduled', async () => {
    const { agent: owner, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const { treatmentId } = await createTreatment(owner, context, suffix);
    const schedule = await owner.post(`/api/v1/treatments/${treatmentId}/dose-schedules`)
      .field('dose_per_intake', '1').field('times', '08:00').field('effective_from', iso(todayOnly))
      .expect(201);

    await owner.post(`/api/v1/treatments/${treatmentId}/external-purchases`)
      .send({ quantity: 10, purchased_on: iso(todayOnly) }).expect(201);

    const takeLog = await insertDoseLog(context.organization.id, treatmentId, schedule.body.id, todayOnly);
    const taken = await owner.post(`/api/v1/treatments/${treatmentId}/doses/${takeLog.id}/take`).send({}).expect(200);
    expect(taken.body.status).toBe('taken');

    const afterTake = await owner.get(`/api/v1/treatments/${treatmentId}/inventory`).expect(200);
    expect(afterTake.body.balance).toBe(9);

    const skipLog = await insertDoseLog(context.organization.id, treatmentId, schedule.body.id, todayOnly);
    await owner.post(`/api/v1/treatments/${treatmentId}/doses/${skipLog.id}/skip`)
      .send({ skip_reason_code: 'other' }).expect(400);
    const skipped = await owner.post(`/api/v1/treatments/${treatmentId}/doses/${skipLog.id}/skip`)
      .send({ skip_reason_code: 'other', skip_reason_note: 'Patient felt unwell' }).expect(200);
    expect(skipped.body.status).toBe('skipped');
    const afterSkip = await owner.get(`/api/v1/treatments/${treatmentId}/inventory`).expect(200);
    expect(afterSkip.body.balance).toBe(9); // skipped never consumes inventory

    const rescheduleLog = await insertDoseLog(context.organization.id, treatmentId, schedule.body.id, todayOnly);
    const rescheduled = await owner.post(`/api/v1/treatments/${treatmentId}/doses/${rescheduleLog.id}/reschedule`)
      .send({ rescheduled_for: addDays(1).toISOString() }).expect(200);
    expect(rescheduled.body.status).toBe('rescheduled');
    expect(rescheduled.body.new_dose_log.status).toBe('scheduled');

    const corrected = await owner.post(`/api/v1/treatments/${treatmentId}/doses/${takeLog.id}/correct`)
      .send({ correction_note: 'Marked taken by mistake' }).expect(200);
    expect(corrected.body.status).toBe('scheduled');
    const afterCorrect = await owner.get(`/api/v1/treatments/${treatmentId}/inventory`).expect(200);
    expect(afterCorrect.body.balance).toBe(10); // the reversal gave the unit back
  });

  it('never allows logging a dose scheduled for a past day', async () => {
    const { agent: owner, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const { treatmentId } = await createTreatment(owner, context, suffix);
    const schedule = await owner.post(`/api/v1/treatments/${treatmentId}/dose-schedules`)
      .field('dose_per_intake', '1').field('times', '08:00').field('effective_from', iso(addDays(-2)))
      .expect(201);
    const pastLog = await insertDoseLog(context.organization.id, treatmentId, schedule.body.id, addDays(-1));
    await owner.post(`/api/v1/treatments/${treatmentId}/doses/${pastLog.id}/take`).send({}).expect(409);
  });

  it('adjusts inventory manually, sets a low-inventory threshold, and reflects is_low', async () => {
    const { agent: owner, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const { treatmentId } = await createTreatment(owner, context, suffix);

    await owner.post(`/api/v1/treatments/${treatmentId}/inventory/adjust`)
      .send({ quantity_delta: 5, note: 'Initial count' }).expect(201);
    await owner.post(`/api/v1/treatments/${treatmentId}/inventory/adjust`)
      .send({ quantity_delta: -2, note: 'Expired tablets discarded' }).expect(201);
    const summary = await owner.get(`/api/v1/treatments/${treatmentId}/inventory`).expect(200);
    expect(summary.body.balance).toBe(3);
    expect(summary.body.is_low).toBe(false);

    await owner.patch(`/api/v1/treatments/${treatmentId}/inventory/threshold`)
      .send({ low_inventory_threshold: 3 }).expect(200);
    const lowSummary = await owner.get(`/api/v1/treatments/${treatmentId}/inventory`).expect(200);
    expect(lowSummary.body.is_low).toBe(true);

    const entries = await owner.get(`/api/v1/treatments/${treatmentId}/inventory/entries`).expect(200);
    expect(entries.body.data).toHaveLength(2);
  });

  it('enforces dose/inventory permissions per role and tenant isolation', async () => {
    const { agent: owner, context } = await login('owner');
    const { agent: operator, context: operatorContext } = await login('operator');
    const { agent: pharmacist } = await login('pharmacist');
    const { agent: readOnly } = await login('read_only');
    const { agent: ownerB } = await login('owner', 'b');

    const branchOf = async (userId: string) => {
      const membership = await withTenant(context.organization.id, (tx) => tx.branchMember.findFirst({ where: { userId }, select: { branchId: true } }));
      if (!membership) throw new Error('Seed requires every role to belong to a branch');
      return membership.branchId;
    };
    const operatorBranch = await branchOf(operatorContext.user.id);

    const suffix = crypto.randomUUID();
    const { treatmentId } = await createTreatment(owner, context, suffix, operatorBranch);
    const schedule = await owner.post(`/api/v1/treatments/${treatmentId}/dose-schedules`)
      .field('dose_per_intake', '1').field('times', '08:00').field('effective_from', iso(todayOnly))
      .expect(201);
    const doseLog = await insertDoseLog(context.organization.id, treatmentId, schedule.body.id, todayOnly);

    await readOnly.post(`/api/v1/treatments/${treatmentId}/doses/${doseLog.id}/take`).send({}).expect(403);
    await operator.post(`/api/v1/treatments/${treatmentId}/doses/${doseLog.id}/take`).send({}).expect(200);
    await operator.post(`/api/v1/treatments/${treatmentId}/doses/${doseLog.id}/correct`)
      .send({ correction_note: 'Operator should not be able to do this' }).expect(403);
    await pharmacist.post(`/api/v1/treatments/${treatmentId}/doses/${doseLog.id}/correct`)
      .send({ correction_note: 'Pharmacist can correct' }).expect(200);

    await operator.post(`/api/v1/treatments/${treatmentId}/inventory/adjust`)
      .send({ quantity_delta: 1, note: 'Operator should not be able to do this' }).expect(403);
    await pharmacist.post(`/api/v1/treatments/${treatmentId}/inventory/adjust`)
      .send({ quantity_delta: 1, note: 'Pharmacist can adjust' }).expect(201);
    await pharmacist.patch(`/api/v1/treatments/${treatmentId}/inventory/threshold`)
      .send({ low_inventory_threshold: 1 }).expect(403);
    await owner.patch(`/api/v1/treatments/${treatmentId}/inventory/threshold`)
      .send({ low_inventory_threshold: 1 }).expect(200);

    await ownerB.get(`/api/v1/treatments/${treatmentId}/inventory`).expect(404);
  });
});

describe.skipIf(!enabled)('dose schedule frequency types', () => {
  it('daily (default): persists times and keeps the pre-existing coverage math', async () => {
    const { agent: owner, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const { treatmentId } = await createTreatment(owner, context, suffix);

    const created = await owner.post(`/api/v1/treatments/${treatmentId}/dose-schedules`)
      .field('dose_per_intake', '1').field('times', '00:00,08:00,16:00').field('effective_from', iso(todayOnly))
      .expect(201);
    expect(created.body.frequencyType).toBe('daily');
    expect(created.body.times).toEqual(['00:00', '08:00', '16:00']);

    const treatment = await owner.get(`/api/v1/treatments/${treatmentId}`).expect(200);
    // quantity_per_cycle=30, dose_per_intake=1, 3 times/day -> 10 days of coverage.
    expect(iso(new Date(treatment.body.coverageEndOn))).toBe(iso(addDays(10)));
  });

  it('interval: requires interval_hours + anchor_at, rejects a schedule missing either', async () => {
    const { agent: owner, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const { treatmentId } = await createTreatment(owner, context, suffix);

    await owner.post(`/api/v1/treatments/${treatmentId}/dose-schedules`)
      .field('dose_per_intake', '1').field('frequency_type', 'interval').field('effective_from', iso(todayOnly))
      .expect(400);

    const anchor = new Date(`${iso(todayOnly)}T08:00:00.000Z`).toISOString();
    const created = await owner.post(`/api/v1/treatments/${treatmentId}/dose-schedules`)
      .field('dose_per_intake', '1').field('frequency_type', 'interval')
      .field('interval_hours', '720').field('anchor_at', anchor)
      .field('effective_from', iso(todayOnly))
      .expect(201);
    expect(created.body.frequencyType).toBe('interval');
    expect(created.body.intervalHours).toBe(720);

    const treatment = await owner.get(`/api/v1/treatments/${treatmentId}`).expect(200);
    // quantity_per_cycle=30, dose_per_intake=1, every 30 days -> 900 days of coverage.
    expect(iso(new Date(treatment.body.coverageEndOn))).toBe(iso(addDays(900)));
  });

  it('weekly: requires weekdays, persists them and the matching times', async () => {
    const { agent: owner, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const { treatmentId } = await createTreatment(owner, context, suffix);

    await owner.post(`/api/v1/treatments/${treatmentId}/dose-schedules`)
      .field('dose_per_intake', '2').field('frequency_type', 'weekly').field('times', '10:00').field('effective_from', iso(todayOnly))
      .expect(400);

    const created = await owner.post(`/api/v1/treatments/${treatmentId}/dose-schedules`)
      .field('dose_per_intake', '2').field('frequency_type', 'weekly')
      .field('times', '10:00').field('weekdays', '4').field('effective_from', iso(todayOnly))
      .expect(201);
    expect(created.body.frequencyType).toBe('weekly');
    expect(created.body.weekdays).toEqual([4]);
    expect(created.body.times).toEqual(['10:00']);
  });
});
