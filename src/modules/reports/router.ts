import { Router } from 'express';
import { adherenceRouter } from './adherence.js';
import { overdueRouter } from './overdue.js';
import { noResponseRouter } from './no-response.js';
import { refillsRouter } from './refills.js';
import { treatmentsFlowRouter } from './treatments-flow.js';
import { reportsTransfersRouter } from './transfers.js';
import { reportsExportRouter } from './export.js';

/**
 * Phase 4a reports. Each report lives in its own file (adherence.ts,
 * overdue.ts, no-response.ts) specifically so a parallel/later block (4b:
 * refills/treatments-flow/transfers reports and CSV export) can add its own
 * report files under this same `src/modules/reports/` directory without
 * touching these three or this router - only new `reportsRouter.use(...)`
 * lines would need to be added here, never edits inside the 4a files.
 *
 * Permission: all three reuse the existing `dashboard:read` action rather
 * than introducing a new `reports:read` permission. `dashboard:read` is
 * already granted to every role in the system (owner, admin, pharmacist,
 * operator, read_only - see src/domain/permissions.ts), which is exactly
 * the set of roles that should be able to read these reports; a dedicated
 * `reports:read` action would end up granted to the identical role set,
 * adding a second permission name with no behavioral difference. If a
 * future report needs a narrower audience, add a new, purpose-specific
 * action then rather than overloading this one.
 */
export const reportsRouter = Router();
reportsRouter.use('/adherence', adherenceRouter);
reportsRouter.use('/overdue', overdueRouter);
reportsRouter.use('/no-response', noResponseRouter);

/**
 * Block 4b additions. New files only (refills.ts, treatments-flow.ts,
 * transfers.ts, export.ts) - none of the 4a files above were edited, per
 * this block's explicit "don't touch adherence/overdue/no-response" scope.
 * `export.ts` mounts its own sub-paths (e.g. `/export/:type`) under
 * `/reports`, so it is registered last, after the report-specific routers.
 */
reportsRouter.use('/refills', refillsRouter);
reportsRouter.use('/treatments-flow', treatmentsFlowRouter);
reportsRouter.use('/transfers', reportsTransfersRouter);
reportsRouter.use('/export', reportsExportRouter);
