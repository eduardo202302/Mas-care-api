import { Router } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../../infra/auth.js';
import { prisma } from '../../infra/prisma.js';
import { ApiError } from '../../infra/errors.js';
import { isPlatformOwner } from '../../domain/platform-owner.js';
import { JOBS } from '../../jobs/types.js';

export const jobsRouter = Router();

// Jobs the worker schedules. A job that never ran still shows up, with zero runs.
const SCHEDULED = Object.values(JOBS).filter((name) => name !== JOBS.recalcStates);
// A job that should run every N minutes is "late" after 3 periods.
const EXPECTED_MINUTES: Record<string, number> = {
  [JOBS.planNotices]: 15, [JOBS.processNoResponse]: 15, [JOBS.processInbound]: 1,
  [JOBS.scheduledRules]: 60, [JOBS.reviewPrescriptions]: 1440, [JOBS.cleanOutbox]: 10080,
};

jobsRouter.get('/', async (req, res, next) => {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    if (!isPlatformOwner(session.user.email)) {
      throw new ApiError(403, 'FORBIDDEN', 'Solo el propietario global puede ver los trabajos.');
    }
    const rows = new Map((await prisma.jobRun.findMany()).map((row) => [row.jobName, row]));
    const now = Date.now();
    res.json({
      data: SCHEDULED.map((name) => {
        const row = rows.get(name);
        const expected = EXPECTED_MINUTES[name];
        const last = row?.lastFinishedAt?.getTime();
        // Per-message jobs have no fixed period: only the cron ones can be late.
        const late = expected !== undefined && (last === undefined || now - last > expected * 3 * 60_000);
        return {
          name,
          runs: row?.runs ?? 0,
          failures: row?.failures ?? 0,
          last_started_at: row?.lastStartedAt ?? null,
          last_finished_at: row?.lastFinishedAt ?? null,
          last_status: row?.lastStatus ?? null,
          last_error: row?.lastError ?? null,
          last_failure_at: row?.lastFailureAt ?? null,
          late,
        };
      }),
    });
  } catch (error) { next(error); }
});
