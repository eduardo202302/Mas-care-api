import { PgBoss } from 'pg-boss';
import { env } from './config/env.js';
import { logger } from './infra/logger.js';
import { prisma } from './infra/prisma.js';
import { getProvider } from './infra/messaging/index.js';
import { cleanOutbox, reviewPrescriptions } from './jobs/maintenance.js';
import { planNotices } from './jobs/planNotices.js';
import { processInbound } from './jobs/processInbound.js';
import { sendNotice } from './jobs/sendNotice.js';
import { JOBS, type JobName, type JobQueue, type SendNoticeData } from './jobs/types.js';
import { trackRun } from './jobs/runLog.js';
import { runScheduledAutomations } from './modules/automation/engine.js';

/**
 * Background worker: a separate process from the API (`npm run worker`, or
 * `node dist/src/worker.js` once built). Jobs live in PostgreSQL through
 * pg-boss, so no Redis is needed. Any number of replicas can run: schedules are
 * coordinated through the database, so each cron fires once, and a job is
 * handed to a single worker.
 *
 * Logs carry ids and counts only, never names, phones or message text.
 */
const boss = new PgBoss({
  // pg-boss creates its own schema and holds long sessions, so it uses the direct connection.
  connectionString: env.DIRECT_URL ?? env.DATABASE_URL,
  schema: 'pgboss',
  application_name: 'maxcare-worker',
  max: 5,
});
boss.on('error', (error) => logger.error({ err: error }, 'pg-boss error'));

const provider = getProvider();

const queue: JobQueue = {
  async enqueue(name, data, options) {
    await boss.send(name, data, {
      ...(options?.singletonKey ? { singletonKey: options.singletonKey } : {}),
      ...(options?.startAfter ? { startAfter: options.startAfter } : {}),
    });
  },
};

// A failed job is retried with exponential backoff and, once retries run out,
// moves to its `-fallidos` queue where it stays visible.
async function createQueue(name: JobName, retryLimit: number) {
  await boss.createQueue(`${name}-fallidos`);
  await boss.createQueue(name, { retryLimit, retryDelay: 60, retryBackoff: true, deadLetter: `${name}-fallidos` });
}

async function main() {
  await boss.start();
  await createQueue(JOBS.planNotices, 3);
  await createQueue(JOBS.sendNotice, 5);
  await createQueue(JOBS.processNoResponse, 3);
  await createQueue(JOBS.scheduledRules, 2);
  await createQueue(JOBS.processInbound, 3);
  await createQueue(JOBS.reviewPrescriptions, 2);
  await createQueue(JOBS.cleanOutbox, 1);

  // Cron jobs are idempotent by construction (outbox dedupe keys, unique open incidents).
  await boss.work(JOBS.planNotices, async () => {
    await trackRun(JOBS.planNotices, async () => {
      const summary = await planNotices({ queue });
      logger.info({ job: JOBS.planNotices, ...summary }, 'job finished');
    });
  });
  // One message per job. A thrown error (transient provider failure) makes pg-boss retry with backoff.
  await boss.work<SendNoticeData>(JOBS.sendNotice, { batchSize: 1 }, async ([job]) => {
    if (!job) return;
    await trackRun(JOBS.sendNotice, async () => {
      const result = await sendNotice({ ...job.data, provider, queue });
      logger.info({ job: JOBS.sendNotice, outboxId: job.data.outboxId, ...result }, 'job finished');
    });
  });
  await boss.work(JOBS.processNoResponse, async () => {
    await trackRun(JOBS.processNoResponse, async () => {
      const summary = await planNotices({ queue, onlyEscalations: true });
      logger.info({ job: JOBS.processNoResponse, ...summary }, 'job finished');
    });
  });
  await boss.work(JOBS.processInbound, async () => {
    await trackRun(JOBS.processInbound, async () => {
      const summary = await processInbound();
      logger.info({ job: JOBS.processInbound, ...summary }, 'job finished');
    });
  });
  await boss.work(JOBS.reviewPrescriptions, async () => {
    await trackRun(JOBS.reviewPrescriptions, async () => {
      const summary = await reviewPrescriptions();
      logger.info({ job: JOBS.reviewPrescriptions, ...summary }, 'job finished');
    });
  });
  await boss.work(JOBS.cleanOutbox, async () => {
    await trackRun(JOBS.cleanOutbox, async () => {
      const summary = await cleanOutbox();
      logger.info({ job: JOBS.cleanOutbox, ...summary }, 'job finished');
    });
  });
  await boss.work(JOBS.scheduledRules, async () => {
    await trackRun(JOBS.scheduledRules, async () => {
      await runScheduledAutomations();
      logger.info({ job: JOBS.scheduledRules }, 'job finished');
    });
  });

  await boss.schedule(JOBS.planNotices, '*/15 * * * *');
  await boss.schedule(JOBS.processNoResponse, '*/15 * * * *');
  await boss.schedule(JOBS.scheduledRules, '0 * * * *');
  await boss.schedule(JOBS.processInbound, '* * * * *');
  // The prescription review compares against each organization's own calendar day, so one daily run is enough.
  await boss.schedule(JOBS.reviewPrescriptions, '0 9 * * *');
  await boss.schedule(JOBS.cleanOutbox, '0 5 * * 0');
  logger.info({ provider: env.MESSAGING_PROVIDER }, 'worker started');
}

const shutdown = (signal: string) => {
  logger.info({ signal }, 'worker shutting down');
  void boss.stop({ graceful: true, timeout: 30_000 })
    .then(() => prisma.$disconnect())
    .then(() => { process.exitCode = 0; });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((error) => {
  logger.error({ err: error }, 'worker failed to start');
  process.exitCode = 1;
});
