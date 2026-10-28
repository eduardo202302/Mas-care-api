import './db-guard.js';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Agent } from 'supertest';
import { PrismaClient } from '@prisma/client';
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

async function createBranch(agent: Agent, name: string) {
  return (await agent.post('/api/v1/branches').send({ name }).expect(201)).body as { id: string; name: string };
}

async function createTreatment(
  agent: Agent,
  context: Context,
  suffix: string,
  overrides: { branchId?: string; quantity?: number; startDate?: string } = {},
) {
  const branchId = overrides.branchId ?? context.branches[0]!.id;
  const patient = await agent.post('/api/v1/patients').send({
    primaryBranchId: branchId,
    fullName: `Phase 1.3 patient ${suffix}`,
    documentId: `P13-${suffix}`,
    phone: `730${suffix.replace(/\D/g, '').slice(0, 7).padEnd(7, '0')}`,
    responsibleUserId: context.user.id,
  }).expect(201);
  const medication = await agent.post('/api/v1/medications').send({
    genericName: `Phase 1.3 medication ${suffix}`,
    presentation: '10 mg tablets',
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
    prescriber_name: 'Dr. Phase 1.3',
    prescription_expires_on: iso(addDays(30)),
    notes: 'Fictional treatment data',
  }).expect(201);
  return {
    patientId: patient.body.patient.id as string,
    medicationId: medication.body.id as string,
    treatment: treatment.body as { id: string; coverageEndOn: string; derived_status: string; days_remaining: number },
  };
}

describe.skipIf(!enabled)('phase 1.3 daily operations', () => {
  it('delivers idempotently, closes the cycle and recalculates coverage', async () => {
    const { agent: owner, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const { treatment } = await createTreatment(owner, context, suffix, { quantity: 30 });
    const openCycle = await withTenant(context.organization.id, (tx) => tx.refillCycle.findFirstOrThrow({ where: { treatmentId: treatment.id, closedAt: null } }));
    const key = `delivery-${suffix}`;

    const delivered = await owner.post(`/api/v1/treatments/${treatment.id}/deliver`)
      .set('Idempotency-Key', key)
      .send({ quantity: 30, delivered_on: iso(todayOnly), picked_up_by: 'patient' })
      .expect(201);
    expect(delivered.body.idempotent_replay).toBe(false);
    expect(delivered.body.lastDeliveryOn.slice(0, 10)).toBe(iso(todayOnly));
    expect(delivered.body.coverageEndOn.slice(0, 10)).toBe(iso(addDays(30)));
    expect(delivered.body.next_cycle).toMatchObject({ status: 'to_notify' });
    expect(delivered.body.delivery).toMatchObject({ quantity: '30', pickedUpBy: 'patient', idempotencyKey: key });

    const replay = await owner.post(`/api/v1/treatments/${treatment.id}/deliver`)
      .set('Idempotency-Key', key)
      .send({ quantity: 30, delivered_on: iso(todayOnly), picked_up_by: 'patient' })
      .expect(200);
    expect(replay.body.idempotent_replay).toBe(true);
    expect(replay.body.delivery.id).toBe(delivered.body.delivery.id);

    const cycles = await withTenant(context.organization.id, (tx) => tx.refillCycle.findMany({ where: { treatmentId: treatment.id }, orderBy: { createdAt: 'asc' } }));
    expect(cycles).toHaveLength(2);
    expect(cycles[0]).toMatchObject({ status: 'delivered' });
    expect(cycles[0]!.closedAt).not.toBeNull();
    expect(cycles[1]).toMatchObject({ status: 'to_notify' });
    expect(cycles[1]!.closedAt).toBeNull();
    expect(cycles[0]!.id).toBe(openCycle.id);

    const deliveries = await withTenant(context.organization.id, (tx) => tx.delivery.findMany({ where: { treatmentId: treatment.id } }));
    expect(deliveries).toHaveLength(1);
    const activities = await withTenant(context.organization.id, (tx) => tx.activity.findMany({ where: { treatmentId: treatment.id, type: 'delivery' } }));
    expect(activities).toHaveLength(1);

    const other = await createTreatment(owner, context, `${suffix}-conflict`);
    await owner.post(`/api/v1/treatments/${other.treatment.id}/deliver`)
      .set('Idempotency-Key', key)
      .send({ quantity: 30, delivered_on: iso(todayOnly), picked_up_by: 'patient' })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('IDEMPOTENCY_CONFLICT'));
  });

  it('recalculates coverage from the delivered quantity and clears manual adjustments', async () => {
    const { agent: owner, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const { treatment } = await createTreatment(owner, context, suffix, { quantity: 30 });
    await owner.post(`/api/v1/treatments/${treatment.id}/adjust-coverage`)
      .send({ new_end_on: iso(addDays(90)), reason: 'Manual override' })
      .expect(200);

    const delivered = await owner.post(`/api/v1/treatments/${treatment.id}/deliver`)
      .send({ quantity: 10, delivered_on: iso(todayOnly), picked_up_by: 'caregiver', picked_up_by_name: 'Ana' })
      .expect(201);
    expect(delivered.body.coverageEndOn.slice(0, 10)).toBe(iso(addDays(10)));
    expect(delivered.body.coverageManuallyAdjusted).toBe(false);
    expect(delivered.body.coverageAdjustReason).toBeNull();
    expect(delivered.body.delivery).toMatchObject({ pickedUpByName: 'Ana' });
  });

  it.skipIf(!process.env.DIRECT_URL)('rolls back delivery, cycle and coverage writes when a later step fails', async () => {
    const { agent: owner, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const { treatment } = await createTreatment(owner, context, suffix, { quantity: 30 });
    const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL! } } });
    const token = suffix.replace(/-/g, '');
    const functionName = `fail_next_cycle_${token}`;
    const triggerName = `fail_next_cycle_${token}`;
    try {
      await admin.$executeRawUnsafe(
        `CREATE FUNCTION ${functionName}() RETURNS trigger AS $$ BEGIN IF NEW.treatment_id = '${treatment.id}' THEN RAISE EXCEPTION 'forced delivery failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
      );
      await admin.$executeRawUnsafe(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON "refill_cycles" FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      );

      await owner.post(`/api/v1/treatments/${treatment.id}/deliver`)
        .send({ quantity: 30, delivered_on: iso(todayOnly), picked_up_by: 'patient' })
        .expect(500);

      const state = await withTenant(context.organization.id, async (tx) => ({
        cycles: await tx.refillCycle.findMany({ where: { treatmentId: treatment.id }, orderBy: { createdAt: 'asc' } }),
        deliveries: await tx.delivery.count({ where: { treatmentId: treatment.id } }),
        activities: await tx.activity.count({ where: { treatmentId: treatment.id, type: 'delivery' } }),
        treatment: await tx.treatment.findFirstOrThrow({ where: { id: treatment.id } }),
      }));
      expect(state.cycles).toHaveLength(1);
      expect(state.cycles[0]).toMatchObject({ status: 'to_notify' });
      expect(state.cycles[0]!.closedAt).toBeNull();
      expect(state.deliveries).toBe(0);
      expect(state.activities).toBe(0);
      expect(state.treatment.lastDeliveryOn).toBeNull();
      expect(state.treatment.coverageEndOn?.toISOString().slice(0, 10)).toBe(treatment.coverageEndOn.slice(0, 10));
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON "refill_cycles"`).catch(() => undefined);
      await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${functionName}()`).catch(() => undefined);
      await admin.$disconnect();
    }
  });

  it('marks cycles prepared and not picked up, feeding pending pickups to the dashboard', async () => {
    const { agent: owner, context } = await login('owner');
    const branch = await createBranch(owner, `Pickup branch ${crypto.randomUUID()}`);
    const { treatment } = await createTreatment(owner, context, crypto.randomUUID(), { branchId: branch.id });
    const cycle = await withTenant(context.organization.id, (tx) => tx.refillCycle.findFirstOrThrow({ where: { treatmentId: treatment.id, closedAt: null } }));

    await owner.post(`/api/v1/cycles/${cycle.id}/mark-prepared`).expect(200)
      .expect(({ body }) => expect(body.status).toBe('prepared'));

    const dashboard = await owner.get(`/api/v1/dashboard?branch_id=${branch.id}`).expect(200);
    expect(dashboard.body.counts.pending_pickups).toBe(1);
    expect(dashboard.body.lists.pending_pickups.map((row: { treatment_id: string }) => row.treatment_id)).toContain(treatment.id);
    const list = await owner.get(`/api/v1/dashboard/list?card=pending_pickups&branch_id=${branch.id}`).expect(200);
    expect(list.body.data.map((row: { treatment_id: string }) => row.treatment_id)).toContain(treatment.id);

    await owner.post(`/api/v1/cycles/${cycle.id}/mark-not-picked-up`).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'not_picked_up' }));
    const cycles = await withTenant(context.organization.id, (tx) => tx.refillCycle.findMany({ where: { treatmentId: treatment.id } }));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.closedAt).not.toBeNull();
    await owner.post(`/api/v1/cycles/${cycle.id}/mark-prepared`).expect(409);
  });

  it('builds dashboard counts and urgency lists while excluding paused and finished treatments', async () => {
    const { agent: owner, context } = await login('owner');
    const branch = await createBranch(owner, `Dashboard branch ${crypto.randomUUID()}`);
    const suffix = crypto.randomUUID();
    const moreOverdue = await createTreatment(owner, context, `${suffix}-more-overdue`, { branchId: branch.id, quantity: 3, startDate: iso(addDays(-10)) });
    const overdue = await createTreatment(owner, context, `${suffix}-overdue`, { branchId: branch.id, quantity: 5, startDate: iso(addDays(-10)) });
    const todayRefill = await createTreatment(owner, context, `${suffix}-today`, { branchId: branch.id, quantity: 1, startDate: iso(addDays(-1)) });
    const dueSoon = await createTreatment(owner, context, `${suffix}-soon`, { branchId: branch.id, quantity: 2 });
    const healthy = await createTreatment(owner, context, `${suffix}-healthy`, { branchId: branch.id, quantity: 30 });
    const finished = await createTreatment(owner, context, `${suffix}-finished`, { branchId: branch.id, quantity: 5, startDate: iso(addDays(-20)) });
    await owner.post(`/api/v1/treatments/${healthy.treatment.id}/pause`).send({ reason: 'Paused for test' }).expect(200);
    await owner.post(`/api/v1/treatments/${finished.treatment.id}/finish`).send({ reason: 'Finished for test' }).expect(200);

    const dashboard = await owner.get(`/api/v1/dashboard?branch_id=${branch.id}`).expect(200);
    expect(dashboard.body.counts).toMatchObject({ overdue: 2, today_refills: 1, due_soon: 2, pending_pickups: 0 });
    expect(dashboard.body.lists.overdue.map((row: { treatment_id: string }) => row.treatment_id)).toEqual([moreOverdue.treatment.id, overdue.treatment.id]);
    expect(dashboard.body.lists.today_refills.map((row: { treatment_id: string }) => row.treatment_id)).toEqual([todayRefill.treatment.id]);
    expect(dashboard.body.lists.due_soon.map((row: { treatment_id: string }) => row.treatment_id)).toEqual([todayRefill.treatment.id, dueSoon.treatment.id]);

    const list = await owner.get(`/api/v1/dashboard/list?card=vencidos&branch_id=${branch.id}`).expect(200);
    expect(list.body.card).toBe('overdue');
    expect(list.body.data[0]).toMatchObject({ treatment_id: moreOverdue.treatment.id, derived_status: 'vencido' });
    expect(list.body.data.map((row: { treatment_id: string }) => row.treatment_id)).not.toContain(finished.treatment.id);
    await owner.get('/api/v1/dashboard/list?card=unknown').expect(400);
  });

  it('manages tasks with filters, completion activity and permissions', async () => {
    const { agent: owner, context } = await login('owner');
    const { agent: operator } = await login('operator');
    const { agent: readOnly } = await login('read_only');
    const suffix = crypto.randomUUID();
    const { patientId, treatment } = await createTreatment(owner, context, suffix);

    const todayTask = await owner.post('/api/v1/tasks').send({
      type: 'call', title: `Call ${suffix}`, due_at: new Date(todayOnly.getTime() + 12 * 60 * 60 * 1000).toISOString(),
      patient_id: patientId, treatment_id: treatment.id,
    }).expect(201);
    const overdueTask = await owner.post('/api/v1/tasks').send({
      type: 'renew_prescription', title: `Renew ${suffix}`, due_at: addDays(-1).toISOString(), patient_id: patientId,
    }).expect(201);
    const upcomingTask = await owner.post('/api/v1/tasks').send({
      type: 'prepare_delivery', title: `Prepare ${suffix}`, due_at: addDays(2).toISOString(), patient_id: patientId,
    }).expect(201);

    const list = await owner.get(`/api/v1/tasks?filter=today&patient_id=${patientId}`).expect(200);
    expect(list.body.data.map((row: { id: string }) => row.id)).toContain(todayTask.body.id);
    expect(list.body.data.map((row: { id: string }) => row.id)).not.toContain(overdueTask.body.id);
    const overdueList = await owner.get(`/api/v1/tasks?filter=vencidas&patient_id=${patientId}`).expect(200);
    expect(overdueList.body.data.map((row: { id: string }) => row.id)).toContain(overdueTask.body.id);
    const upcomingList = await owner.get(`/api/v1/tasks?filter=proximas&patient_id=${patientId}`).expect(200);
    expect(upcomingList.body.data.map((row: { id: string }) => row.id)).toContain(upcomingTask.body.id);

    await owner.patch(`/api/v1/tasks/${todayTask.body.id}`).send({ status: 'done' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'done' }));
    const activities = await withTenant(context.organization.id, (tx) => tx.activity.findMany({ where: { patientId, type: 'task' } }));
    expect(activities).toHaveLength(1);
    expect(activities[0]!.metadata).toMatchObject({ task_id: todayTask.body.id, status: 'done' });

    await owner.patch(`/api/v1/tasks/${todayTask.body.id}`).send({ status: 'open' }).expect(200)
      .expect(({ body }) => expect(body.completedAt).toBeNull());
    await owner.post(`/api/v1/tasks/${overdueTask.body.id}/complete`).expect(200)
      .expect(({ body }) => expect(body.status).toBe('done'));

    const unlinked = await owner.post('/api/v1/tasks').send({ type: 'other', title: `Unlinked ${suffix}` }).expect(201);
    await owner.post(`/api/v1/tasks/${unlinked.body.id}/complete`).expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('TASK_WITHOUT_PATIENT'));
    await owner.patch(`/api/v1/tasks/${unlinked.body.id}`).send({ status: 'done' }).expect(409);

    await operator.post('/api/v1/tasks').send({ type: 'other', title: `Operator ${suffix}` }).expect(201);
    await readOnly.post('/api/v1/tasks').send({ type: 'other', title: `Read only ${suffix}` }).expect(403);
    await readOnly.get('/api/v1/tasks').expect(200);

    await owner.delete(`/api/v1/tasks/${upcomingTask.body.id}`).expect(204);
    await owner.get(`/api/v1/tasks/${upcomingTask.body.id}`).expect(200)
      .expect(({ body }) => expect(body.status).toBe('cancelled'));
  });

  it('manages message templates and builds consent-aware notice previews', async () => {
    const { agent: owner, context } = await login('owner');
    const { agent: pharmacist } = await login('pharmacist');
    const { agent: operator } = await login('operator');
    const suffix = crypto.randomUUID();
    const branch = await createBranch(owner, `Template branch ${suffix}`);
    const { patientId, treatment } = await createTreatment(owner, context, suffix, { branchId: branch.id });

    const created = await owner.post('/api/v1/message-templates').send({
      channel: 'whatsapp', name: `Template ${suffix}`, branch_id: branch.id,
      body: 'Hola {{paciente}}, retira {{medicamento}} el {{fecha}} en {{farmacia}}.',
    }).expect(201);
    await owner.get(`/api/v1/message-templates?channel=whatsapp&branch_id=${branch.id}`).expect(200)
      .expect(({ body }) => expect(body.data.map((row: { id: string }) => row.id)).toContain(created.body.id));
    await owner.patch(`/api/v1/message-templates/${created.body.id}`).send({ body: 'Hola {{paciente}}, tu pedido está listo.' }).expect(200);

    const preview = await owner.get(`/api/v1/treatments/${treatment.id}/notice-preview?channel=whatsapp`).expect(200);
    expect(preview.body).toMatchObject({ channel: 'whatsapp', template_id: created.body.id });
    expect(preview.body.body).toBe('Hola ' + `Phase 1.3 patient ${suffix}` + ', tu pedido está listo.');
    expect(preview.body.phone).toBeTruthy();
    expect(preview.body.wa_me_url).toContain('https://wa.me/');
    expect(preview.body.consent_warning).not.toBeNull();

    await owner.post(`/api/v1/treatments/${treatment.id}/notice-logged`).send({ channel: 'whatsapp' }).expect(201);
    const notices = await withTenant(context.organization.id, (tx) => tx.activity.findMany({ where: { patientId, type: 'notice' } }));
    expect(notices).toHaveLength(1);

    await pharmacist.post('/api/v1/message-templates').send({
      channel: 'call', name: `Pharmacist template ${suffix}`, body: 'Llamar a {{paciente}}.',
    }).expect(201);
    await operator.post('/api/v1/message-templates').send({
      channel: 'call', name: `Operator template ${suffix}`, body: 'No permitido.',
    }).expect(403);

    await owner.delete(`/api/v1/message-templates/${created.body.id}`).expect(204);
    const afterDelete = await owner.get(`/api/v1/treatments/${treatment.id}/notice-preview?channel=whatsapp`).expect(200);
    expect(afterDelete.body.template_id).not.toBe(created.body.id);
    expect(afterDelete.body.body).not.toBe('Hola ' + `Phase 1.3 patient ${suffix}` + ', tu pedido está listo.');
  });

  it('previews and imports CSV patients, reporting duplicate and invalid rows', async () => {
    const { agent: owner, context } = await login('owner');
    const { agent: operator } = await login('operator');
    const suffix = crypto.randomUUID();
    const branch = await createBranch(owner, `Import branch ${suffix}`);
    const document = `IMP-${suffix}`;
    const fullName = `Import Uno ${suffix}`;
    const phoneBase = `3${suffix.replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`;
    const csv = [
      'nombre,documento,telefono,correo,fecha_nacimiento,whatsapp,sucursal',
      `${fullName},${document},${phoneBase}1,uno-${suffix}@example.com,1990-01-02,si,${branch.name}`,
      `Duplicado,${document},${phoneBase}2,dup-${suffix}@example.com,1990-01-02,no,`,
      `Correo malo,${document}-bad,${phoneBase}3,no-es-email,1990-01-02,no,`,
      `Sucursal mala,${document}-branch,${phoneBase}4,branch-${suffix}@example.com,1990-01-02,no,No existe`,
    ].join('\n');
    const mapping = {
      full_name: 'nombre', document_id: 'documento', phone: 'telefono', email: 'correo',
      birth_date: 'fecha_nacimiento', phone_has_whatsapp: 'whatsapp', primary_branch_id: 'sucursal',
    };

    const preview = await owner.post('/api/v1/imports/patients/preview')
      .attach('file', Buffer.from(csv), 'patients.csv')
      .expect(200);
    expect(preview.body).toMatchObject({ total_rows: 4 });
    expect(preview.body.columns).toEqual(['nombre', 'documento', 'telefono', 'correo', 'fecha_nacimiento', 'whatsapp', 'sucursal']);
    expect(preview.body.rows[0]).toMatchObject({ nombre: fullName, documento: document });

    await operator.post('/api/v1/imports/patients/preview')
      .attach('file', Buffer.from(csv), 'patients.csv')
      .expect(403);

    const imported = await owner.post('/api/v1/imports/patients')
      .field('column_mapping', JSON.stringify(mapping))
      .attach('file', Buffer.from(csv), 'patients.csv')
      .expect(201);
    expect(imported.body.summary).toEqual({ total_rows: 4, imported_rows: 1, error_rows: 3 });
    expect(imported.body.errors.map((error: { code: string }) => error.code)).toEqual(
      expect.arrayContaining(['DUPLICATE_DOCUMENT', 'INVALID_ROW', 'INVALID_BRANCH']),
    );
    expect(imported.body.import_job).toMatchObject({ totalRows: 4, importedRows: 1, errorRows: 3 });

    const patients = await owner.get(`/api/v1/patients?q=${encodeURIComponent(fullName)}`).expect(200);
    expect(patients.body.data).toHaveLength(1);
    expect(patients.body.data[0]).toMatchObject({ documentId: document, phone: `${phoneBase}1`, primaryBranchId: branch.id });

    const job = await withTenant(context.organization.id, (tx) => tx.importJob.findFirstOrThrow({ where: { id: imported.body.import_job.id } }));
    expect(job.finishedAt).not.toBeNull();
    expect(job.errors).toHaveLength(3);
  });

  it('isolates dashboard, tasks, templates and deliveries between organizations', async () => {
    const { agent: ownerA, context: contextA } = await login('owner', 'a');
    const { agent: ownerB, context: contextB } = await login('owner', 'b');
    const suffix = crypto.randomUUID();
    const branch = await createBranch(ownerA, `Isolation branch ${suffix}`);
    const { patientId, treatment } = await createTreatment(ownerA, contextA, suffix, { branchId: branch.id });
    const task = await ownerA.post('/api/v1/tasks').send({ type: 'call', title: `Isolation ${suffix}`, patient_id: patientId }).expect(201);
    const template = await ownerA.post('/api/v1/message-templates').send({ channel: 'call', name: `Isolation ${suffix}`, body: 'Hola.' }).expect(201);
    const importJob = await withTenant(contextA.organization.id, (tx) => tx.importJob.create({
      data: {
        organizationId: contextA.organization.id,
        entity: 'patients',
        filename: 'isolation.csv',
        columnMapping: {},
        createdBy: contextA.user.id,
      },
    }));
    const cycle = await withTenant(contextA.organization.id, (tx) => tx.refillCycle.findFirstOrThrow({ where: { treatmentId: treatment.id, closedAt: null } }));

    await ownerB.get(`/api/v1/tasks/${task.body.id}`).expect(404);
    await ownerB.get(`/api/v1/message-templates/${template.body.id}`).expect(404);
    await ownerB.get(`/api/v1/dashboard?branch_id=${branch.id}`).expect(200)
      .expect(({ body }) => expect(body.counts.overdue + body.counts.today_refills + body.counts.due_soon).toBe(0));
    await ownerB.post(`/api/v1/treatments/${treatment.id}/deliver`)
      .send({ quantity: 30, delivered_on: iso(todayOnly), picked_up_by: 'patient' })
      .expect(404);
    await ownerB.post(`/api/v1/cycles/${cycle.id}/mark-prepared`).expect(404);
    await ownerB.get(`/api/v1/treatments/${treatment.id}/notice-preview`).expect(404);
    const hiddenJob = await withTenant(contextB.organization.id, (tx) => tx.importJob.findFirst({ where: { id: importJob.id } }));
    expect(hiddenJob).toBeNull();
  });

  it('keeps dashboard queries responsive with 5,000 treatments', async () => {
    const { agent: owner, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const branch = await createBranch(owner, `Performance branch ${suffix}`);
    const seed = await createTreatment(owner, context, suffix, { branchId: branch.id });
    const rows = Array.from({ length: 5000 }, (_, index) => ({
      organizationId: context.organization.id,
      patientId: seed.patientId,
      medicationId: seed.medicationId,
      branchId: branch.id,
      dosePerIntake: 1,
      intakesPerDay: 1,
      quantityPerCycle: 30,
      startDate: addDays(-60),
      coverageEndOn: addDays((index % 90) - 45),
      status: 'active' as const,
    }));
    await withTenant(context.organization.id, (tx) => tx.treatment.createMany({ data: rows }));

    const planRows = await withTenant(context.organization.id, async (tx) => {
      // Refresh planner statistics after the bulk insert so the EXPLAIN is stable.
      await tx.$executeRawUnsafe('ANALYZE treatments');
      return tx.$queryRaw<Array<Record<string, string>>>`
        EXPLAIN SELECT id FROM treatments
        WHERE organization_id = ${context.organization.id}
          AND branch_id = ${branch.id}
          AND status = 'active'
          AND coverage_end_on < ${iso(todayOnly)}::date
        ORDER BY coverage_end_on ASC, id ASC
        LIMIT 200
      `;
    });
    const plan = planRows.map((row) => Object.values(row).join(' ')).join('\n');
    console.info(plan);
    expect(plan).toContain('treatments_organization_id_branch_id_coverage_end_on_idx');

    const started = performance.now();
    const dashboard = await owner.get(`/api/v1/dashboard?branch_id=${branch.id}`).expect(200);
    const elapsed = performance.now() - started;
    expect(dashboard.body.counts.overdue + dashboard.body.counts.due_soon).toBeGreaterThan(0);
    expect(dashboard.body.lists.overdue.length).toBeLessThanOrEqual(200);
    expect(elapsed).toBeLessThan(1500);
    console.info(`Dashboard with 5,001 treatments responded in ${elapsed.toFixed(0)} ms`);

    await withTenant(context.organization.id, async (tx) => {
      await tx.treatment.deleteMany({ where: { branchId: branch.id } });
      await tx.patient.delete({ where: { organizationId_id: { organizationId: context.organization.id, id: seed.patientId } } });
      await tx.medication.delete({ where: { organizationId_id: { organizationId: context.organization.id, id: seed.medicationId } } });
      await tx.branch.delete({ where: { organizationId_id: { organizationId: context.organization.id, id: branch.id } } });
    });
  }, 120000);
});
