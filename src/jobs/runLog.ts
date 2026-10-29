import { prisma } from '../infra/prisma.js';
import { logger } from '../infra/logger.js';

/**
 * Wraps a job handler so every run leaves a row for the health panel. Only the
 * error class is stored (messages from providers can carry phones or text).
 * A bookkeeping failure never breaks the job itself.
 */
export async function trackRun<T>(job: string, run: () => Promise<T>): Promise<T> {
  const startedAt = new Date();
  try {
    const result = await run();
    await prisma.jobRun.upsert({
      where: { jobName: job },
      create: { jobName: job, runs: 1, lastStartedAt: startedAt, lastFinishedAt: new Date(), lastStatus: 'ok' },
      update: { runs: { increment: 1 }, lastStartedAt: startedAt, lastFinishedAt: new Date(), lastStatus: 'ok' },
    }).catch((error) => logger.warn({ err: error, job }, 'job run not recorded'));
    return result;
  } catch (error) {
    const kind = error instanceof Error ? error.name : 'Error';
    await prisma.jobRun.upsert({
      where: { jobName: job },
      create: { jobName: job, runs: 1, failures: 1, lastStartedAt: startedAt, lastFinishedAt: new Date(), lastStatus: 'failed', lastError: kind, lastFailureAt: new Date() },
      update: { runs: { increment: 1 }, failures: { increment: 1 }, lastStartedAt: startedAt, lastFinishedAt: new Date(), lastStatus: 'failed', lastError: kind, lastFailureAt: new Date() },
    }).catch((err) => logger.warn({ err, job }, 'job run not recorded'));
    throw error;
  }
}
