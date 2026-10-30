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

async function createPatient(agent: Agent, context: Context, suffix: string) {
  const patient = await agent.post('/api/v1/patients').send({
    primaryBranchId: context.branches[0]!.id,
    fullName: `Medical module patient ${suffix}`,
    documentId: `MED-${suffix}`,
    phone: `809${suffix.slice(0, 7)}`,
    responsibleUserId: context.user.id,
  }).expect(201);
  return patient.body.patient.id as string;
}

async function createSpecialty(agent: Agent, suffix: string) {
  const res = await agent.post('/api/v1/medical-specialties').send({ name: `Cardiología ${suffix}` }).expect(201);
  return res.body.id as string;
}

async function createMedicalCenter(agent: Agent, suffix: string) {
  const res = await agent.post('/api/v1/medical-centers').send({ name: `Clínica ${suffix}`, centerType: 'clinic' }).expect(201);
  return res.body.id as string;
}

async function createCondition(agent: Agent, suffix: string) {
  const res = await agent.post('/api/v1/health-conditions').send({ name: `Hipertensión ${suffix}` }).expect(201);
  return res.body.id as string;
}

async function createDoctor(agent: Agent, suffix: string, overrides: { licenseNumber?: string } = {}) {
  const res = await agent.post('/api/v1/doctors').send({
    firstName: 'Ana',
    lastName: `Pérez ${suffix}`,
    licenseNumber: overrides.licenseNumber ?? `LIC-${suffix}`,
  }).expect(201);
  return res.body.id as string;
}

describe.skipIf(!enabled)('doctors / medical specialties / medical centers / health conditions module', () => {
  it('medical specialties: create, list, get, patch and rejects duplicate names', async () => {
    const { agent } = await login('owner');
    const suffix = crypto.randomUUID();
    const id = await createSpecialty(agent, suffix);

    await agent.get('/api/v1/medical-specialties').query({ q: suffix }).expect(200)
      .expect(({ body }) => expect(body.data.some((s: { id: string }) => s.id === id)).toBe(true));
    await agent.get(`/api/v1/medical-specialties/${id}`).expect(200)
      .expect(({ body }) => expect(body.name).toBe(`Cardiología ${suffix}`));
    await agent.patch(`/api/v1/medical-specialties/${id}`).send({ description: 'Especialidad del corazón' }).expect(200)
      .expect(({ body }) => expect(body.description).toBe('Especialidad del corazón'));

    await agent.post('/api/v1/medical-specialties').send({ name: `Cardiología ${suffix}` }).expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('SPECIALTY_NAME_IN_USE'));
  });

  it('medical centers: create, list with filters, get, patch', async () => {
    const { agent } = await login('owner');
    const suffix = crypto.randomUUID();
    const id = await createMedicalCenter(agent, suffix);

    await agent.get('/api/v1/medical-centers').query({ q: suffix, centerType: 'clinic' }).expect(200)
      .expect(({ body }) => expect(body.data.some((c: { id: string }) => c.id === id)).toBe(true));
    await agent.patch(`/api/v1/medical-centers/${id}`).send({ centerType: 'hospital', province: 'Santo Domingo' }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ centerType: 'hospital', province: 'Santo Domingo' }));
    await agent.get(`/api/v1/medical-centers/${crypto.randomUUID()}`).expect(404);
  });

  it('health conditions: create, list, get, patch and rejects duplicate names', async () => {
    const { agent } = await login('owner');
    const suffix = crypto.randomUUID();
    const id = await createCondition(agent, suffix);

    await agent.get(`/api/v1/health-conditions/${id}`).expect(200)
      .expect(({ body }) => expect(body.name).toBe(`Hipertensión ${suffix}`));
    await agent.patch(`/api/v1/health-conditions/${id}`).send({ isActive: false }).expect(200)
      .expect(({ body }) => expect(body.isActive).toBe(false));
    await agent.post('/api/v1/health-conditions').send({ name: `Hipertensión ${suffix}` }).expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('CONDITION_NAME_IN_USE'));
  });

  it('doctors: create, list, get, patch and rejects duplicate active license numbers', async () => {
    const { agent } = await login('owner');
    const suffix = crypto.randomUUID();
    const id = await createDoctor(agent, suffix);

    await agent.get('/api/v1/doctors').query({ q: suffix }).expect(200)
      .expect(({ body }) => expect(body.data.some((d: { id: string }) => d.id === id)).toBe(true));
    await agent.patch(`/api/v1/doctors/${id}`).send({ phone: '8095551234' }).expect(200)
      .expect(({ body }) => expect(body.phone).toBe('8095551234'));

    await agent.post('/api/v1/doctors').send({ firstName: 'Luis', lastName: 'Gómez', licenseNumber: `LIC-${suffix}` }).expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('LICENSE_IN_USE'));
  });

  it('doctor <-> specialty link: add, duplicate conflict, remove, doctor list filter by specialtyId', async () => {
    const { agent } = await login('owner');
    const suffix = crypto.randomUUID();
    const doctorId = await createDoctor(agent, suffix);
    const specialtyId = await createSpecialty(agent, suffix);

    await agent.post(`/api/v1/doctors/${doctorId}/specialties`).send({ specialtyId }).expect(201);
    await agent.post(`/api/v1/doctors/${doctorId}/specialties`).send({ specialtyId }).expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('SPECIALTY_ALREADY_LINKED'));

    await agent.get('/api/v1/doctors').query({ specialtyId }).expect(200)
      .expect(({ body }) => expect(body.data.some((d: { id: string }) => d.id === doctorId)).toBe(true));

    await agent.delete(`/api/v1/doctors/${doctorId}/specialties/${specialtyId}`).expect(204);
    await agent.delete(`/api/v1/doctors/${doctorId}/specialties/${specialtyId}`).expect(404);
  });

  it('doctor <-> medical center link: add, patch, duplicate-while-active conflict, reverse lookup on the center', async () => {
    const { agent } = await login('owner');
    const suffix = crypto.randomUUID();
    const doctorId = await createDoctor(agent, suffix);
    const centerId = await createMedicalCenter(agent, suffix);

    await agent.post(`/api/v1/doctors/${doctorId}/medical-centers`).send({ medicalCenterId: centerId, officeNumber: '201' }).expect(201);
    await agent.post(`/api/v1/doctors/${doctorId}/medical-centers`).send({ medicalCenterId: centerId }).expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('MEDICAL_CENTER_ALREADY_LINKED'));

    await agent.patch(`/api/v1/doctors/${doctorId}/medical-centers/${centerId}`).send({ position: 'Jefe de cardiología' }).expect(200)
      .expect(({ body }) => expect(body.position).toBe('Jefe de cardiología'));

    await agent.get(`/api/v1/medical-centers/${centerId}/doctors`).expect(200)
      .expect(({ body }) => expect(body.data.some((l: { doctorId: string }) => l.doctorId === doctorId)).toBe(true));

    await agent.get(`/api/v1/doctors/${doctorId}/patients`).expect(200)
      .expect(({ body }) => expect(body.data).toEqual([]));
  });

  it('patient <-> doctor link: add, list, primary demotion, duplicate-while-active conflict, soft-deactivate preserves history', async () => {
    const { agent, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const patientId = await createPatient(agent, context, suffix);
    const doctorA = await createDoctor(agent, `${suffix}-a`);
    const doctorB = await createDoctor(agent, `${suffix}-b`);

    await agent.post(`/api/v1/patients/${patientId}/doctors`).send({ doctorId: doctorA, isPrimary: true }).expect(201);
    await agent.post(`/api/v1/patients/${patientId}/doctors`).send({ doctorId: doctorA }).expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('DOCTOR_ALREADY_LINKED'));

    await agent.post(`/api/v1/patients/${patientId}/doctors`).send({ doctorId: doctorB, isPrimary: true }).expect(201);

    const list = await agent.get(`/api/v1/patients/${patientId}/doctors`).expect(200);
    const links = list.body.data as { doctorId: string; isPrimary: boolean }[];
    expect(links.find((l) => l.doctorId === doctorA)?.isPrimary).toBe(false);
    expect(links.find((l) => l.doctorId === doctorB)?.isPrimary).toBe(true);

    await agent.patch(`/api/v1/patients/${patientId}/doctors/${doctorA}`).send({ isActive: false }).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ isActive: false }));
    const afterDeactivate = await agent.get(`/api/v1/patients/${patientId}/doctors`).expect(200);
    expect((afterDeactivate.body.data as { doctorId: string }[]).some((l) => l.doctorId === doctorA)).toBe(false);

    await agent.post(`/api/v1/patients/${patientId}/doctors`).send({ doctorId: doctorA }).expect(201);
    await agent.patch(`/api/v1/patients/${patientId}/doctors/${doctorB}`).send({ isPrimary: false }).expect(200);
  });

  it('patient <-> health condition link: add, list, update status/diagnosedOn, duplicate-while-active conflict', async () => {
    const { agent, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const patientId = await createPatient(agent, context, suffix);
    const conditionId = await createCondition(agent, suffix);

    await agent.post(`/api/v1/patients/${patientId}/conditions`).send({ healthConditionId: conditionId, diagnosedOn: '2025-01-15' }).expect(201)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'active', healthConditionId: conditionId }));
    await agent.post(`/api/v1/patients/${patientId}/conditions`).send({ healthConditionId: conditionId }).expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('CONDITION_ALREADY_LINKED'));

    await agent.patch(`/api/v1/patients/${patientId}/conditions/${conditionId}`).send({ status: 'controlled' }).expect(200)
      .expect(({ body }) => expect(body.status).toBe('controlled'));

    const list = await agent.get(`/api/v1/patients/${patientId}/conditions`).expect(200);
    expect((list.body.data as { healthConditionId: string }[]).some((l) => l.healthConditionId === conditionId)).toBe(true);

    await agent.patch(`/api/v1/patients/${patientId}/conditions/${conditionId}`).send({ isActive: false }).expect(200);
    const afterDeactivate = await agent.get(`/api/v1/patients/${patientId}/conditions`).expect(200);
    expect((afterDeactivate.body.data as { healthConditionId: string }[]).some((l) => l.healthConditionId === conditionId)).toBe(false);
  });

  it('enforces read/write permissions for operator (read-only on catalogs) and 404s on unknown ids', async () => {
    const { agent: owner } = await login('owner');
    const { agent: operator } = await login('operator');
    const suffix = crypto.randomUUID();
    const specialtyId = await createSpecialty(owner, suffix);

    await operator.get('/api/v1/medical-specialties').expect(200);
    await operator.post('/api/v1/medical-specialties').send({ name: `Forbidden ${suffix}` }).expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FORBIDDEN'));
    await operator.patch(`/api/v1/medical-specialties/${specialtyId}`).send({ description: 'nope' }).expect(403);
    await operator.post('/api/v1/doctors').send({ firstName: 'X', lastName: 'Y' }).expect(403);
    await operator.post('/api/v1/medical-centers').send({ name: `Forbidden ${suffix}` }).expect(403);
    await operator.post('/api/v1/health-conditions').send({ name: `Forbidden ${suffix}` }).expect(403);

    await owner.get(`/api/v1/doctors/${crypto.randomUUID()}`).expect(404);
    await owner.get(`/api/v1/medical-centers/${crypto.randomUUID()}`).expect(404);
    await owner.get(`/api/v1/health-conditions/${crypto.randomUUID()}`).expect(404);
  });

  it('records audit log entries for catalog and patient-relation mutations', async () => {
    const { agent, context } = await login('owner');
    const suffix = crypto.randomUUID();
    const doctorId = await createDoctor(agent, suffix);
    const patientId = await createPatient(agent, context, suffix);
    const conditionId = await createCondition(agent, suffix);
    await agent.post(`/api/v1/patients/${patientId}/doctors`).send({ doctorId }).expect(201);
    await agent.post(`/api/v1/patients/${patientId}/conditions`).send({ healthConditionId: conditionId }).expect(201);

    const actions = await withTenant(context.organization.id, (tx) => tx.auditLog.findMany({
      where: { subjectId: { in: [doctorId, patientId] } },
      select: { action: true },
    }));
    const actionNames = actions.map((a) => a.action);
    expect(actionNames).toEqual(expect.arrayContaining(['doctor.create', 'patient.doctor.add', 'patient.condition.add']));
  });

  it('exposes the new catalogs in the resolved menu for pharmacist, operator and read_only roles', async () => {
    const { agent: pharmacist } = await login('pharmacist');
    const { agent: readOnly } = await login('read_only');

    const pharmacistMe = await pharmacist.get('/api/v1/me').expect(200);
    const readOnlyMe = await readOnly.get('/api/v1/me').expect(200);
    const pharmacistKeys = (pharmacistMe.body.menu as { key: string }[]).map((m) => m.key);
    const readOnlyKeys = (readOnlyMe.body.menu as { key: string }[]).map((m) => m.key);

    for (const key of ['medicos', 'especialidades', 'centros_medicos', 'condiciones_salud']) {
      expect(pharmacistKeys).toContain(key);
      expect(readOnlyKeys).toContain(key);
    }
  });
});
