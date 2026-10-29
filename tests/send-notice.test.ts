import './db-guard.js';
import { describe, expect, it } from 'vitest';
import { MessagingError } from '../src/domain/messaging/provider.js';
import { FakeProvider } from '../src/infra/messaging/fakeProvider.js';
import { withTenant } from '../src/infra/prisma.js';
import { MAX_SEND_ATTEMPTS, STALE_SENDING_MS, sendNotice } from '../src/jobs/sendNotice.js';
import { insideWindow, noticeScenario, recordingQueue } from './helpers/notice-scenario.js';

const enabled = process.env.RUN_DB_TESTS === '1';

/** Plans one pending message with automation fully on and returns what the tests need to send it. */
async function pending(options: { consent?: boolean; templateBody?: string } = {}) {
  const s = await noticeScenario({ consent: options.consent ?? true, ...(options.templateBody ? { templateBody: options.templateBody } : {}) });
  await s.setAutomation({ automation_enabled: true, automation_dry_run: false });
  const planned = await s.plan();
  const outbox = planned.rows[0]!;
  const send = (provider: FakeProvider, now = insideWindow()) => {
    const { queue, jobs } = recordingQueue();
    return { promise: sendNotice({ organizationId: s.orgId, outboxId: outbox.id, provider, queue, now }), jobs, queue };
  };
  const reload = () => withTenant(s.orgId, (tx) => tx.outboxMessage.findFirstOrThrow({ where: { id: outbox.id } }));
  return { ...s, outbox, send, reload };
}

describe.skipIf(!enabled)('sendNotice', () => {
  it('sends once and records the notice, the cycle state and the history', async () => {
    const s = await pending();
    try {
      const provider = new FakeProvider();
      expect(await s.send(provider).promise).toEqual({ outcome: 'sent' });
      expect(provider.sent).toHaveLength(1);
      expect(provider.sent[0]).toMatchObject({ templateName: 'aviso_1', languageCode: 'es' });

      const outbox = await s.reload();
      expect(outbox.status).toBe('sent');
      expect(outbox.providerMessageId).toMatch(/^fake-/);
      expect(outbox.attempts).toBe(1);
      const cycle = await withTenant(s.orgId, (tx) => tx.refillCycle.findFirstOrThrow({ where: { id: s.cycle.id } }));
      expect(cycle).toMatchObject({ status: 'notified', noticeAttempts: 1 });
      const notices = await withTenant(s.orgId, (tx) => tx.notice.findMany({ where: { outboxId: outbox.id } }));
      expect(notices).toMatchObject([{ mode: 'automatic', status: 'sent', attemptNumber: 1 }]);
      const activities = await withTenant(s.orgId, (tx) => tx.activity.findMany({ where: { cycleId: s.cycle.id, type: 'notice' } }));
      expect(activities).toHaveLength(1);
    } finally { await s.cleanup(); }
  });

  it('puts only the first name and the pharmacy in the message, and the medication only if the template asks', async () => {
    const plain = await pending();
    try {
      const provider = new FakeProvider();
      await plain.send(provider).promise;
      expect(provider.sent[0]!.variables).not.toHaveProperty('medicamento');
      expect(provider.sent[0]!.variables.paciente).toBe('Fictional');
      expect(JSON.stringify(provider.sent[0]!.variables)).not.toContain(plain.patientId);
    } finally { await plain.cleanup(); }

    const withMedication = await pending({ templateBody: 'Hola {{paciente}}, tu {{medicamento}} vence' });
    try {
      const provider = new FakeProvider();
      await withMedication.send(provider).promise;
      expect(provider.sent[0]!.variables.medicamento).toContain('Fictional plan med');
    } finally { await withMedication.cleanup(); }
  });

  it('never lets two workers send the same message', async () => {
    const s = await pending();
    try {
      const provider = new FakeProvider();
      provider.delayMs = 400;
      const results = await Promise.all([s.send(provider).promise, s.send(provider).promise, s.send(provider).promise]);
      expect(provider.sent).toHaveLength(1);
      expect(results.filter((result) => result.outcome === 'sent')).toHaveLength(1);
      expect(results.filter((result) => result.outcome === 'not_claimed')).toHaveLength(2);
      expect((await s.reload()).attempts).toBe(1);
    } finally { await s.cleanup(); }
  });

  it('cancels instead of sending when the cycle moved on, the treatment paused or consent was revoked', async () => {
    const moved = await pending();
    try {
      await withTenant(moved.orgId, (tx) => tx.refillCycle.update({ where: { id: moved.cycle.id }, data: { status: 'prepared' } }));
      const provider = new FakeProvider();
      expect(await moved.send(provider).promise).toMatchObject({ outcome: 'cancelled', reason: 'cycle_closed' });
      expect(provider.sent).toHaveLength(0);
      expect((await moved.reload()).status).toBe('cancelled');
    } finally { await moved.cleanup(); }

    const paused = await pending();
    try {
      await withTenant(paused.orgId, (tx) => tx.treatment.update({ where: { id: paused.treatmentId }, data: { automationPaused: true } }));
      const provider = new FakeProvider();
      expect(await paused.send(provider).promise).toMatchObject({ outcome: 'cancelled', reason: 'treatment_automation_paused' });
      expect(provider.sent).toHaveLength(0);
    } finally { await paused.cleanup(); }

    const revoked = await pending();
    try {
      await withTenant(revoked.orgId, (tx) => tx.patient.update({ where: { id: revoked.patientId }, data: { reminderConsent: false } }));
      const provider = new FakeProvider();
      expect(await revoked.send(provider).promise).toMatchObject({ outcome: 'cancelled' });
      expect(provider.sent).toHaveLength(0);
    } finally { await revoked.cleanup(); }
  });

  it('cancels when the master switch is turned off and keeps dry-run from sending', async () => {
    const off = await pending();
    try {
      await off.setAutomation({ automation_enabled: false });
      const provider = new FakeProvider();
      expect(await off.send(provider).promise).toMatchObject({ outcome: 'cancelled', reason: 'automation_disabled' });
      expect(provider.sent).toHaveLength(0);
    } finally { await off.cleanup(); }

    const dry = await pending();
    try {
      await dry.setAutomation({ automation_dry_run: true });
      const provider = new FakeProvider();
      expect(await dry.send(provider).promise).toEqual({ outcome: 'dry_run' });
      expect(provider.sent).toHaveLength(0);
      expect((await dry.reload()).status).toBe('dry_run');
    } finally { await dry.cleanup(); }
  });

  it('pushes a message to the next window instead of sending outside it', async () => {
    const s = await pending();
    try {
      // 03:00 UTC the next day is 23:00 local: after the planned time and outside the window.
      const night = insideWindow();
      night.setUTCDate(night.getUTCDate() + 1);
      night.setUTCHours(3, 0, 0, 0);
      const provider = new FakeProvider();
      const attempt = s.send(provider, night);
      expect(await attempt.promise).toMatchObject({ outcome: 'rescheduled', reason: 'outside_window' });
      expect(provider.sent).toHaveLength(0);
      const outbox = await s.reload();
      expect(outbox.status).toBe('pending');
      expect(outbox.attempts).toBe(0);
      expect(outbox.scheduledFor.getTime()).toBeGreaterThan(night.getTime());
      expect(attempt.jobs).toHaveLength(1);
      expect(attempt.jobs[0]!.startAfter!.getTime()).toBe(outbox.scheduledFor.getTime());
    } finally { await s.cleanup(); }
  });

  it('does not touch a message that is not due yet or is being sent by someone else', async () => {
    const s = await pending();
    try {
      await withTenant(s.orgId, (tx) => tx.outboxMessage.update({ where: { id: s.outbox.id }, data: { scheduledFor: new Date(Date.now() + 3_600_000) } }));
      const provider = new FakeProvider();
      // Real time on purpose: these cases compare against Date.now(), and the 14:00 UTC helper can lie on either side of it.
      expect(await s.send(provider, new Date()).promise).toEqual({ outcome: 'not_claimed' });

      await withTenant(s.orgId, (tx) => tx.outboxMessage.update({ where: { id: s.outbox.id }, data: { status: 'sending', lockedAt: new Date(), scheduledFor: new Date() } }));
      expect(await s.send(provider, new Date()).promise).toEqual({ outcome: 'not_claimed' });
      expect(provider.sent).toHaveLength(0);
    } finally { await s.cleanup(); }
  });

  it('parks a message stuck in sending as failed instead of resending it blindly', async () => {
    const s = await pending();
    try {
      await withTenant(s.orgId, (tx) => tx.outboxMessage.update({ where: { id: s.outbox.id }, data: { status: 'sending', lockedAt: new Date(Date.now() - STALE_SENDING_MS - 60_000), scheduledFor: new Date() } }));
      const provider = new FakeProvider();
      expect(await s.send(provider, new Date()).promise).toEqual({ outcome: 'interrupted' });
      expect(provider.sent).toHaveLength(0);
      expect((await s.reload()).status).toBe('failed');
    } finally { await s.cleanup(); }
  });

  it('retries a transient provider failure, then fails visibly and leaves one call task', async () => {
    const s = await pending();
    try {
      const provider = new FakeProvider();
      provider.failWith = new MessagingError('rate limited', false, 'rate_limited');
      for (let attempt = 1; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
        await expect(s.send(provider).promise).rejects.toThrow('rate limited');
        const row = await s.reload();
        expect(row).toMatchObject({ status: 'pending', attempts: attempt, lastError: 'rate_limited' });
      }
      expect(await s.send(provider).promise).toEqual({ outcome: 'failed', reason: 'rate_limited' });
      expect((await s.reload()).status).toBe('failed');
      const tasks = await withTenant(s.orgId, (tx) => tx.task.findMany({ where: { cycleId: s.cycle.id, type: 'call' } }));
      expect(tasks).toHaveLength(1);
      const cycle = await withTenant(s.orgId, (tx) => tx.refillCycle.findFirstOrThrow({ where: { id: s.cycle.id } }));
      expect(cycle).toMatchObject({ status: 'to_notify', noticeAttempts: 0 });
    } finally { await s.cleanup(); }
  });

  it('does not retry a permanent failure (invalid number): it fails at once and asks staff to call', async () => {
    const s = await pending();
    try {
      const provider = new FakeProvider();
      provider.failWith = new MessagingError('invalid recipient', true, 'invalid_number');
      expect(await s.send(provider).promise).toEqual({ outcome: 'failed', reason: 'invalid_number' });
      const row = await s.reload();
      expect(row).toMatchObject({ status: 'failed', attempts: 1, lastError: 'invalid_number' });
      const tasks = await withTenant(s.orgId, (tx) => tx.task.findMany({ where: { cycleId: s.cycle.id, type: 'call' } }));
      expect(tasks).toHaveLength(1);
    } finally { await s.cleanup(); }
  });
});
