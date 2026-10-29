import request from 'supertest';
import { app } from '../../src/app.js';
import { withTenant } from '../../src/infra/prisma.js';
import { planNotices } from '../../src/jobs/planNotices.js';
import type { JobQueue } from '../../src/jobs/types.js';

const password = 'MaxCareDev-2026!';

// Org B keeps these tests away from the settings other test files change in org A.
export async function loginOwnerB() {
  const agent = request.agent(app);
  await agent.post('/api/auth/sign-in/email').send({ email: 'owner.b@maxcare.test', password }).expect(200);
  const context = (await agent.get('/api/v1/me').expect(200)).body as { organization: { id: string } };
  return { agent, orgId: context.organization.id };
}

export const recordingQueue = () => {
  const jobs: { name: string; data: Record<string, unknown>; singletonKey?: string | undefined; startAfter?: Date | undefined }[] = [];
  const queue: JobQueue = {
    async enqueue(name, data, options) { jobs.push({ name, data: data as Record<string, unknown>, singletonKey: options?.singletonKey, startAfter: options?.startAfter }); },
  };
  return { queue, jobs };
};

// 14:00 UTC is 10:00 in America/Santo_Domingo, inside the default 09:00-18:00 window.
export const insideWindow = () => {
  const now = new Date();
  now.setUTCHours(14, 0, 0, 0);
  return now;
};
export const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** A patient with a treatment whose coverage ends in 2 days, so the first notice is due now. */
export async function noticeScenario(options: { consent: boolean; templateBody?: string }) {
  const { agent, orgId } = await loginOwnerB();
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const branch = (await agent.post('/api/v1/branches').send({ name: `Notice branch ${suffix}` }).expect(201)).body as { id: string };
  const patient = (await agent.post('/api/v1/patients').send({
    primaryBranchId: branch.id, fullName: `Fictional Plan ${suffix}`, phone: `809${suffix.slice(-7).padStart(7, '1')}`, phoneHasWhatsapp: true,
  }).expect(201)).body.patient as { id: string };
  if (options.consent) await agent.post(`/api/v1/patients/${patient.id}/consent`).send({ granted: true, channel: 'whatsapp' }).expect(201);
  const medication = (await agent.post('/api/v1/medications').send({ genericName: `Fictional plan med ${suffix}`, presentation: '5 mg' }).expect(201)).body as { id: string };
  const treatment = (await agent.post('/api/v1/treatments').send({
    patient_id: patient.id, medication_id: medication.id, branch_id: branch.id, dose_per_intake: 1, intakes_per_day: 1,
    quantity_per_cycle: 30, start_date: daysAgo(28),
  }).expect(201)).body as { id: string };
  const cycle = await withTenant(orgId, (tx) => tx.refillCycle.findFirstOrThrow({ where: { treatmentId: treatment.id } }));
  const template = await withTenant(orgId, (tx) => tx.messageTemplate.create({
    data: { organizationId: orgId, channel: 'whatsapp', kind: 'refill_notice', name: `plan-${suffix}`, body: options.templateBody ?? 'Hola {{paciente}}', waStatus: 'approved', waTemplateName: 'aviso_1', attemptNumber: 1 },
  }));
  const outboxFor = () => withTenant(orgId, (tx) => tx.outboxMessage.findMany({ where: { cycleId: cycle.id } }));
  const setAutomation = (body: object) => agent.patch('/api/v1/automation/settings').send(body).expect(200);
  /** Plans for this organization and returns the pending outbox message of the scenario's cycle. */
  const plan = async (now = insideWindow()) => {
    const { queue, jobs } = recordingQueue();
    await planNotices({ queue, now, organizationId: orgId });
    return { rows: await outboxFor(), jobs, queue };
  };
  const cleanup = async () => {
    await setAutomation({ automation_enabled: false, automation_dry_run: true, auto_call_task_without_consent: false });
    await withTenant(orgId, (tx) => tx.messageTemplate.update({ where: { id: template.id }, data: { isActive: false } }));
  };
  return { orgId, cycle, treatmentId: treatment.id, patientId: patient.id, templateId: template.id, outboxFor, setAutomation, plan, cleanup, agent };
}
