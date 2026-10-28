import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { puede } from '../../domain/permissions.js';
import { ApiError } from '../../infra/errors.js';
import { accessibleBranchIds } from '../../infra/branch-scope.js';
import { resolvePaging } from '../../infra/pagination.js';
import { withTenant } from '../../infra/prisma.js';
import { resolveTenant } from '../../infra/tenant.js';
import { validateQuery } from '../../infra/validate.js';
import { daysBetween, toDateOnly } from '../../domain/coverage.js';
import { findOrCreateSetting } from '../../infra/settings.js';
import { parseBranchIds, reportBaseQuery, resolveReportRange } from '../../schemas/report.js';
import { resolveScopedBranchIds } from './branch-scope-helper.js';

export const noResponseRouter = Router();
noResponseRouter.use(resolveTenant);

type Tx = Prisma.TransactionClient;

const requirePermission = (role: Parameters<typeof puede>[0]) => {
  if (!puede(role, 'dashboard:read')) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
};

/**
 * "Sin respuesta" (no-response.ts, block 4a) - this rule does not exist
 * anywhere else in the system yet (dashboard-metrics.ts hardcodes
 * `no_response: 0` and explicitly defers it to "a later, separate reports
 * block"). Defined here for the first time, from the fields that actually
 * exist on Notice/OutboxMessage (prisma/schema.prisma):
 *
 *   Notice:  status (sent | delivered | read | failed | replied),
 *            attemptNumber, sentAt, deliveredAt, readAt, repliedAt, failedAt,
 *            cycleId, patientId, outboxId (1:1 to OutboxMessage).
 *   OutboxMessage: status, attempts, channel, scheduledFor, sentAt,
 *            cancelledAt - but no per-attempt "read" signal of its own; that
 *            signal lives on Notice (readAt/repliedAt), so Notice is the
 *            model this report actually queries, not OutboxMessage.
 *
 * A patient counts as "sin respuesta" when, within [from, to]:
 *   1. They have >= `maxNoticeAttempts` (Setting; the same number automation
 *      already uses to decide a patient has been notified "enough" before
 *      giving up, src/domain/noticePolicy.ts) Notice rows whose `status` is
 *      `sent` or `failed` AND whose `readAt`/`repliedAt` are both null (i.e.
 *      no confirmation the patient ever saw or answered any of them), and
 *   2. None of the RefillCycle(s) those notices point to (via `cycleId`) has
 *      a Delivery recorded after the earliest counted notice - a delivery
 *      after a notice is treated as the patient effectively responding
 *      (they picked up), even if no one logged an explicit "replied" notice
 *      status for it; `Delivery` and `Notice` both carry `cycleId`, which is
 *      how this is joined without inventing a field that is not in the
 *      schema.
 * `read`/`delivered`/`replied` notices are excluded from the failing count:
 * only `sent` (no further confirmation ever arrived) and `failed` (provider
 * could not deliver it at all) represent "no response" attempts.
 */
const NO_RESPONSE_DEFINITION =
  'Un paciente aparece como "sin respuesta" cuando tiene max_notice_attempts o más avisos (Notice) en el ' +
  'rango from/to cuyo status es "sent" o "failed" Y no tienen readAt ni repliedAt (ninguna confirmación de ' +
  'lectura o respuesta), y ninguno de los ciclos de reposición asociados a esos avisos tiene una entrega ' +
  '(Delivery) registrada después del aviso más antiguo contado - una entrega posterior se interpreta como ' +
  'que el paciente sí respondió/recogió, aunque nadie registrara una respuesta explícita.';
const AGE_DAYS_DEFINITION = 'Días transcurridos desde el aviso (Notice) más reciente sin respuesta hasta hoy.';
const HAS_OPEN_TASK_DEFINITION =
  'Indica si el paciente tiene al menos una Task con status "open" asociada a él (Task.patientId), sin ' +
  'filtrar por tipo de tarea.';

type FailedNotice = { id: string; patientId: string; cycleId: string; sentAt: Date; status: string };

noResponseRouter.get('/', validateQuery(reportBaseQuery), async (req, res) => {
  const tenant = req.tenant!;
  requirePermission(tenant.role);
  const query = res.locals.validatedQuery as z.infer<typeof reportBaseQuery>;
  const requestedBranchIds = parseBranchIds(query.branch_id);

  const result = await withTenant(tenant.organizationId, async (tx: Tx) => {
    const settings = await findOrCreateSetting(tx, tenant.organizationId);
    const today = toDateOnly(new Date());
    const scope = await accessibleBranchIds(tx, tenant);
    const branchIds = resolveScopedBranchIds(scope, requestedBranchIds);
    const { from, to } = resolveReportRange(query, today);

    const noticeWhere: Prisma.NoticeWhereInput = {
      status: { in: ['sent', 'failed'] },
      readAt: null,
      repliedAt: null,
      sentAt: { gte: from, lte: to },
      ...(branchIds ? { cycle: { branchId: { in: branchIds } } } : {}),
    };

    const failedNotices = (await tx.notice.findMany({
      where: noticeWhere,
      select: { id: true, patientId: true, cycleId: true, sentAt: true, status: true },
      orderBy: [{ sentAt: 'asc' }],
    })) as FailedNotice[];

    const byPatient = new Map<string, FailedNotice[]>();
    for (const notice of failedNotices) {
      const list = byPatient.get(notice.patientId) ?? [];
      list.push(notice);
      byPatient.set(notice.patientId, list);
    }

    const candidatePatientIds = [...byPatient.entries()]
      .filter(([, notices]) => notices.length >= settings.maxNoticeAttempts)
      .map(([patientId]) => patientId);

    if (!candidatePatientIds.length) {
      const { page, rows } = resolvePaging(query);
      return { data: [], total: 0, page, rows, definitions: { no_response: NO_RESPONSE_DEFINITION, age_days: AGE_DAYS_DEFINITION, has_open_task: HAS_OPEN_TASK_DEFINITION } };
    }

    // Exclude a patient whose notice-linked cycles received a delivery after
    // the earliest counted notice (treated as "they responded/picked up").
    const cycleIds = [...new Set(failedNotices.filter((n) => candidatePatientIds.includes(n.patientId)).map((n) => n.cycleId))];
    const deliveries = cycleIds.length
      ? await tx.delivery.findMany({ where: { cycleId: { in: cycleIds } }, select: { cycleId: true, deliveredOn: true } })
      : [];
    const latestDeliveryByCycle = new Map<string, Date>();
    for (const delivery of deliveries) {
      const current = latestDeliveryByCycle.get(delivery.cycleId);
      if (!current || delivery.deliveredOn.getTime() > current.getTime()) latestDeliveryByCycle.set(delivery.cycleId, delivery.deliveredOn);
    }

    const respondedPatientIds = new Set<string>();
    for (const patientId of candidatePatientIds) {
      const notices = byPatient.get(patientId)!;
      const earliestNotice = notices[0]!.sentAt;
      const responded = notices.some((notice) => {
        const delivery = latestDeliveryByCycle.get(notice.cycleId);
        return delivery && delivery.getTime() > earliestNotice.getTime();
      });
      if (responded) respondedPatientIds.add(patientId);
    }

    const finalPatientIds = candidatePatientIds.filter((id) => !respondedPatientIds.has(id));

    const { page, rows, skip } = resolvePaging(query);
    const pageIds = finalPatientIds.slice(skip, skip + rows);

    const patients = pageIds.length
      ? await tx.patient.findMany({
          where: { id: { in: pageIds } },
          select: { id: true, fullName: true, primaryBranch: { select: { id: true, name: true, labelColor: true } } },
        })
      : [];
    const patientById = new Map(patients.map((p) => [p.id, p]));

    const openTasks = pageIds.length
      ? await tx.task.findMany({ where: { patientId: { in: pageIds }, status: 'open' }, select: { patientId: true } })
      : [];
    const hasOpenTask = new Set(openTasks.map((t) => t.patientId));

    // Patient phone is deliberately NEVER included in this response (block
    // 4a spec: no phone numbers or message content in reports/exports, even
    // for a non-CSV JSON endpoint, because a frontend could log the response
    // body and leak it).
    const data = pageIds.map((patientId) => {
      const notices = byPatient.get(patientId)!;
      const lastNoticeAt = notices.reduce((latest, n) => (n.sentAt.getTime() > latest.getTime() ? n.sentAt : latest), notices[0]!.sentAt);
      const patient = patientById.get(patientId);
      return {
        patient: { id: patientId, full_name: patient?.fullName ?? null },
        branch: patient?.primaryBranch ? { id: patient.primaryBranch.id, name: patient.primaryBranch.name, label_color: patient.primaryBranch.labelColor } : null,
        attempts_count: notices.length,
        last_notice_at: lastNoticeAt.toISOString(),
        age_days: daysBetween(lastNoticeAt, today),
        has_open_task: hasOpenTask.has(patientId),
      };
    });

    return {
      data,
      total: finalPatientIds.length,
      page,
      rows,
      definitions: { no_response: NO_RESPONSE_DEFINITION, age_days: AGE_DAYS_DEFINITION, has_open_task: HAS_OPEN_TASK_DEFINITION },
    };
  });

  res.json(result);
});
