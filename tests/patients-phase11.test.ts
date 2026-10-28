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

describe.skipIf(!enabled)('phase 1.1 patient and medication APIs', () => {
  it('lists only login-enabled users who are members of the active organization', async () => {
    const { agent: ownerA, context } = await login('owner');
    const { context: contextB } = await login('owner', 'b');
    const { agent: readOnly } = await login('read_only');
    const list = await ownerA.get('/api/v1/users?q=operator').expect(200);
    const operator = list.body.data.find((user: { email: string }) => user.email === 'operator.a@maxcare.test');
    expect(operator).toMatchObject({ role: 'operator', id: expect.any(String), branches: expect.any(Array) });
    expect(list.body.data.every((user: { email: string }) => !user.email.endsWith('.b@maxcare.test'))).toBe(true);
    await ownerA.get(`/api/v1/users/${operator.id}`).expect(200);
    await ownerA.get(`/api/v1/users/${contextB.user.id}`).expect(404);
    await readOnly.get('/api/v1/users').expect(200);
    expect(context.organization.id).not.toBe(contextB.organization.id);
  });

  it('checks duplicates within one organization, creates full patients, records consent and history', async () => {
    const { agent: ownerA, context } = await login('owner');
    const { agent: ownerB } = await login('owner', 'b');
    const suffix = crypto.randomUUID();
    const patientInput = {
      primaryBranchId: context.branches[0]!.id,
      fullName: `Example Patient ${suffix}`,
      documentId: `DOC-${suffix}`,
      birthDate: '1988-06-15',
      phone: `700${suffix.slice(0, 7)}`,
      phoneHasWhatsapp: true,
      email: `person-${suffix}@maxcare.test`,
      address: 'Example address',
      zone: 'North',
      preferredChannel: 'whatsapp',
      careNotes: 'Fictional test data',
      responsibleUserId: context.user.id,
    };
    const created = await ownerA.post('/api/v1/patients').send(patientInput).expect(201);
    const patientId = created.body.patient.id as string;
    expect(created.body.patient).toMatchObject({ ...patientInput, birthDate: `${patientInput.birthDate}T00:00:00.000Z`, organizationId: context.organization.id, createdBy: context.user.id });
    expect(created.body.possibleDuplicates).toEqual([]);

    await ownerA.post('/api/v1/patients/check-duplicates').send({ documentId: patientInput.documentId }).expect(200)
      .expect(({ body }) => expect(body.data.map((row: { id: string }) => row.id)).toContain(patientId));
    await ownerA.post('/api/v1/patients/check-duplicates').send({ phone: patientInput.phone }).expect(200)
      .expect(({ body }) => expect(body.data.map((row: { id: string }) => row.id)).toContain(patientId));
    await ownerB.post('/api/v1/patients/check-duplicates').send({ documentId: patientInput.documentId, phone: patientInput.phone }).expect(200)
      .expect(({ body }) => expect(body.data).toEqual([]));
    const duplicateCreate = await ownerA.post('/api/v1/patients').send({ ...patientInput, fullName: `Duplicate ${suffix}` }).expect(201);
    expect(duplicateCreate.body.possibleDuplicates.map((row: { id: string }) => row.id)).toContain(patientId);

    const caregiver = await ownerA.post(`/api/v1/patients/${patientId}/caregivers`)
      .send({ fullName: 'Example caregiver', phone: '70000009', relationship: 'Sibling', isPrimary: true }).expect(201);
    await ownerA.patch(`/api/v1/patients/${patientId}/caregivers/${caregiver.body.id}`).send({ relationship: 'Relative' }).expect(200);
    await ownerB.get(`/api/v1/patients/${patientId}/caregivers`).expect(404);
    await ownerA.delete(`/api/v1/patients/${patientId}/caregivers/${caregiver.body.id}`).expect(204);

    const consent = await ownerA.post(`/api/v1/patients/${patientId}/consent`)
      .send({ granted: true, channel: 'whatsapp', evidence: 'Signed at the counter' }).expect(201);
    const updatedPatient = await ownerA.get(`/api/v1/patients/${patientId}`).expect(200);
    expect(updatedPatient.body.reminderConsent).toBe(true);
    expect(updatedPatient.body.reminderConsentAt).toBeTruthy();
    const consentRows = await withTenant(context.organization.id, (tx) => tx.patientConsent.findMany({ where: { patientId } }));
    expect(consentRows).toHaveLength(1);
    expect(consentRows[0]?.id).toBe(consent.body.id);

    await ownerA.post(`/api/v1/patients/${patientId}/activities`).send({ type: 'call', body: 'Follow-up call completed' }).expect(201);
    await ownerA.patch(`/api/v1/patients/${patientId}`).send({ zone: 'West' }).expect(200);
    const history = await ownerA.get(`/api/v1/patients/${patientId}/activities?limit=100`).expect(200);
    expect(history.body.data.map((row: { type: string }) => row.type)).toContain('call');
    expect(history.body.data.map((row: { type: string }) => row.type)).toContain('patient_created');
    expect(history.body.data.map((row: { type: string }) => row.type)).toContain('patient_updated');
    expect(history.body.data.map((row: { type: string }) => row.type)).toContain('consent_recorded');

    await ownerA.get(`/api/v1/patients/${patientId}`).expect(200);
    const audit = await withTenant(context.organization.id, (tx) => tx.auditLog.findMany({ where: { subjectId: patientId }, select: { action: true } }));
    expect(audit.map(({ action }) => action)).toEqual(expect.arrayContaining(['patient.create', 'patient.read', 'patient.update', 'patient.consent.record']));
    await ownerA.post(`/api/v1/patients/${patientId}/archive`).expect(200);
    await ownerA.get(`/api/v1/patients?archived=true`).expect(200)
      .expect(({ body }) => expect(body.data.some((row: { id: string }) => row.id === patientId)).toBe(true));
    await ownerA.post(`/api/v1/patients/${patientId}/restore`).expect(200);
  });

  it('applies role gates to medications and keeps saved views private to each user', async () => {
    const { agent: ownerA } = await login('owner');
    const { agent: ownerB } = await login('owner', 'b');
    const { agent: pharmacist } = await login('pharmacist');
    const { agent: operator } = await login('operator');
    const { agent: readOnly } = await login('read_only');
    const suffix = crypto.randomUUID();
    const medication = await ownerA.post('/api/v1/medications').send({
      brandName: `Brand ${suffix}`, genericName: `Generic ${suffix}`, activeIngredient: `Ingredient ${suffix}`,
      presentation: '20 mg capsules', unitsPerPackage: 30,
    }).expect(201);
    expect(medication.body.doseUnit).toBe('tablet');
    await ownerA.get(`/api/v1/medications?q=${encodeURIComponent(suffix)}`).expect(200)
      .expect(({ body }) => expect(body.data.map((row: { id: string }) => row.id)).toContain(medication.body.id));
    await readOnly.get(`/api/v1/medications/${medication.body.id}`).expect(200);
    await ownerB.get(`/api/v1/medications/${medication.body.id}`).expect(404);
    await operator.post('/api/v1/medications').send({ genericName: 'No permission', presentation: '10 mg tablet' }).expect(403);
    await pharmacist.patch(`/api/v1/medications/${medication.body.id}`).send({ presentation: '25 mg capsules' }).expect(200);
    await pharmacist.post(`/api/v1/medications/${medication.body.id}/archive`).expect(200);

    const { context } = await login('owner');
    const view = await ownerA.post('/api/v1/saved-views').send({
      entity: 'patients', name: `My patients ${suffix}`, filters: { zone: 'North' }, columns: ['fullName', 'phone'], sort: { fullName: 'asc' }, isDefault: true,
    }).expect(201);
    await ownerA.get('/api/v1/saved-views?entity=patients').expect(200)
      .expect(({ body }) => expect(body.data.map((row: { id: string }) => row.id)).toContain(view.body.id));
    await operator.get('/api/v1/saved-views?entity=patients').expect(200)
      .expect(({ body }) => expect(body.data).toEqual([]));
    await ownerB.get('/api/v1/saved-views?entity=patients').expect(200)
      .expect(({ body }) => expect(body.data).toEqual([]));
    await readOnly.post('/api/v1/saved-views').send({ entity: 'patients', name: `Read-only ${suffix}` }).expect(403);
    await ownerA.patch(`/api/v1/saved-views/${view.body.id}`).send({ name: `Renamed ${suffix}` }).expect(200);
    await ownerA.delete(`/api/v1/saved-views/${view.body.id}`).expect(204);
    expect(context.organization.id).toBeTruthy();
  });

  it('limits patient visibility to assigned branches for non-owner/admin users', async () => {
    const { agent: owner, context } = await login('owner');
    const { agent: admin } = await login('admin');
    const { agent: operator, context: operatorContext } = await login('operator');
    const branchIds = await withTenant(context.organization.id, async (tx) => {
      const memberships = await tx.branchMember.findMany({ where: { userId: operatorContext.user.id }, select: { branchId: true } });
      const branches = await tx.branch.findMany({ select: { id: true } });
      return { assigned: memberships.map(({ branchId }) => branchId), other: branches.map(({ id }) => id).find((id) => !memberships.some((membership) => membership.branchId === id)) };
    });
    const assignedBranch = branchIds.assigned[0];
    const otherBranch = branchIds.other;
    if (!assignedBranch || !otherBranch) throw new Error('Seed requires the operator to belong to only one of two branches');
    const suffix = crypto.randomUUID();
    const patients = await withTenant(context.organization.id, async (tx) => Promise.all([
      tx.patient.create({ data: { organizationId: context.organization.id, primaryBranchId: assignedBranch, fullName: `Assigned ${suffix}`, createdBy: context.user.id } }),
      tx.patient.create({ data: { organizationId: context.organization.id, primaryBranchId: otherBranch, fullName: `Hidden ${suffix}`, createdBy: context.user.id } }),
    ]));
    const list = await operator.get(`/api/v1/patients?q=${encodeURIComponent(suffix)}`).expect(200);
    expect(list.body.data.map((row: { id: string }) => row.id)).toContain(patients[0]!.id);
    expect(list.body.data.map((row: { id: string }) => row.id)).not.toContain(patients[1]!.id);
    await operator.get(`/api/v1/patients/${patients[1]!.id}`).expect(404);
    const ownerList = await owner.get(`/api/v1/patients?q=${encodeURIComponent(suffix)}`).expect(200);
    expect(ownerList.body.data.map((row: { id: string }) => row.id)).toEqual(expect.arrayContaining(patients.map(({ id }) => id)));
    const adminList = await admin.get(`/api/v1/patients?q=${encodeURIComponent(suffix)}`).expect(200);
    expect(adminList.body.data.map((row: { id: string }) => row.id)).toEqual(expect.arrayContaining(patients.map(({ id }) => id)));
  });
});
