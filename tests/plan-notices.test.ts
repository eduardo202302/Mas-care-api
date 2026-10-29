import './db-guard.js';
import { describe, expect, it } from 'vitest';
import { withTenant } from '../src/infra/prisma.js';
import { planNotices } from '../src/jobs/planNotices.js';
import { insideWindow, noticeScenario, recordingQueue } from './helpers/notice-scenario.js';

const enabled = process.env.RUN_DB_TESTS === '1';

const scenario = noticeScenario;

describe.skipIf(!enabled)('planNotices', () => {
  it('plans nothing while the master switch is off', async () => {
    const s = await scenario({ consent: true });
    try {
      await s.setAutomation({ automation_enabled: false });
      const { queue, jobs } = recordingQueue();
      await planNotices({ queue, now: insideWindow(), organizationId: s.orgId });
      expect(await s.outboxFor()).toHaveLength(0);
      expect(jobs).toHaveLength(0);
    } finally { await s.cleanup(); }
  });

  it('records a dry_run row without enqueueing a send', async () => {
    const s = await scenario({ consent: true });
    try {
      await s.setAutomation({ automation_enabled: true, automation_dry_run: true });
      const { queue, jobs } = recordingQueue();
      await planNotices({ queue, now: insideWindow(), organizationId: s.orgId });
      const rows = await s.outboxFor();
      expect(rows.map((row) => row.status)).toEqual(['dry_run']);
      // Other pending messages left by earlier tests may be re-enqueued by the recovery pass; this cycle must add none.
      expect(jobs.filter((job) => rows.some((row) => row.id === job.data.outboxId))).toHaveLength(0);
    } finally { await s.cleanup(); }
  });

  it('plans one pending message and enqueues it once, even when run twice the same day', async () => {
    const s = await scenario({ consent: true });
    try {
      await s.setAutomation({ automation_enabled: true, automation_dry_run: false });
      const { queue, jobs } = recordingQueue();
      const now = insideWindow();
      await planNotices({ queue, now, organizationId: s.orgId });
      await planNotices({ queue, now, organizationId: s.orgId });
      const rows = await s.outboxFor();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'pending', attemptNumber: 1 });
      expect(rows[0]!.dedupeKey).toBe(`${s.cycle.id}:1:${now.toISOString().slice(0, 10)}`);
      const forThisCycle = jobs.filter((job) => job.data.outboxId === rows[0]!.id);
      expect(forThisCycle).toHaveLength(1);
      expect(forThisCycle[0]!.singletonKey).toBe(rows[0]!.id);
    } finally { await s.cleanup(); }
  });

  it('waits outside the notice window', async () => {
    const s = await scenario({ consent: true });
    try {
      await s.setAutomation({ automation_enabled: true, automation_dry_run: false });
      const { queue } = recordingQueue();
      const night = insideWindow();
      night.setUTCHours(3, 0, 0, 0);
      await planNotices({ queue, now: night, organizationId: s.orgId });
      expect(await s.outboxFor()).toHaveLength(0);
    } finally { await s.cleanup(); }
  });

  it('never messages a patient without consent; it only creates one call task when configured', async () => {
    const s = await scenario({ consent: false });
    try {
      await s.setAutomation({ automation_enabled: true, automation_dry_run: false, auto_call_task_without_consent: false });
      const first = recordingQueue();
      await planNotices({ queue: first.queue, now: insideWindow(), organizationId: s.orgId });
      expect(await s.outboxFor()).toHaveLength(0);
      const tasks = () => withTenant(s.orgId, (tx) => tx.task.findMany({ where: { cycleId: s.cycle.id, type: 'call' } }));
      expect(await tasks()).toHaveLength(0);

      await s.setAutomation({ auto_call_task_without_consent: true });
      const second = recordingQueue();
      await planNotices({ queue: second.queue, now: insideWindow(), organizationId: s.orgId });
      await planNotices({ queue: second.queue, now: insideWindow(), organizationId: s.orgId });
      expect(await s.outboxFor()).toHaveLength(0);
      expect(await tasks()).toHaveLength(1);
    } finally { await s.cleanup(); }
  });
});
