import type { Prisma } from '@prisma/client';
import { localDateString } from '../domain/localDate.js';
import {
  decideNextAction,
  type NoticeAction,
  type NoticeCycleSnapshot,
  type NoticePatientSnapshot,
  type NoticeTreatmentSnapshot,
} from '../domain/noticePolicy.js';
import { logger } from '../infra/logger.js';
import { prisma, withTenant } from '../infra/prisma.js';
import { record } from '../modules/audit/record.js';
import { asSettingsSnapshot, historyFor, systemActor, type SettingRow } from './shared.js';
import { JOBS, type JobQueue, type SendNoticeData } from './types.js';

type Tx = Prisma.TransactionClient;

export type PlanSummary = {
  organizations: number;
  planned: number;
  dryRun: number;
  callTasks: number;
  incidents: number;
  waiting: number;
  skipped: number;
  noTemplate: number;
};
const emptySummary = (): PlanSummary => ({ organizations: 0, planned: 0, dryRun: 0, callTasks: 0, incidents: 0, waiting: 0, skipped: 0, noTemplate: 0 });

export type PlanOptions = {
  now?: Date;
  queue: JobQueue;
  /** Only act on cycles whose attempts are exhausted (the `procesar-sin-respuesta` job). */
  onlyEscalations?: boolean;
  /** Restrict to one organization (tests and manual runs). */
  organizationId?: string;
};

/**
 * Looks at every open cycle waiting for a notice, asks the pure policy what to
 * do and applies it. Everything for one organization commits together, and the
 * outbox `dedupe_key` (cycle:attempt:local date) makes a second run the same
 * day a no-op. Send jobs are enqueued after the commit; the outbox row is the
 * source of truth, so a lost enqueue is recovered by the next run.
 */
export async function planNotices(options: PlanOptions): Promise<PlanSummary> {
  const now = options.now ?? new Date();
  const total = emptySummary();
  const organizations = await prisma.organization.findMany({
    where: { status: 'active', ...(options.organizationId ? { id: options.organizationId } : {}) },
    select: { id: true },
  });
  for (const { id } of organizations) {
    try {
      const { summary, toSend } = await withTenant(id, (tx) => planOrganization(tx, id, now, options.onlyEscalations ?? false));
      if (summary.organizations) total.organizations += 1;
      for (const key of Object.keys(summary) as (keyof PlanSummary)[]) if (key !== 'organizations') total[key] += summary[key];
      for (const data of toSend) {
        await options.queue.enqueue(JOBS.sendNotice, data, { singletonKey: data.outboxId });
      }
    } catch (error) {
      // One organization failing must not stop the others; log ids only.
      logger.error({ err: error, organizationId: id }, 'planning notices failed');
    }
  }
  return total;
}

async function planOrganization(tx: Tx, organizationId: string, now: Date, onlyEscalations: boolean) {
  const summary = emptySummary();
  const toSend: SendNoticeData[] = [];
  const settingRows = await tx.setting.findMany();
  const orgSetting = settingRows.find((row) => row.branchId === null);
  if (!orgSetting) return { summary, toSend };
  const effective = (branchId: string) => settingRows.find((row) => row.branchId === branchId) ?? orgSetting;
  if (!settingRows.some((row) => row.automationEnabled)) return { summary, toSend };
  summary.organizations = 1;

  // Recovery: a pending message whose send job was lost (crash between commit and enqueue) is enqueued again.
  // The singleton key keeps this from duplicating a job that is still queued.
  const stuck = await tx.outboxMessage.findMany({ where: { status: 'pending', OR: [{ scheduledFor: { lte: new Date(now.getTime() - 10 * 60_000) } }, { lastError: 'manual_retry' }] }, select: { id: true } });
  for (const row of stuck) toSend.push({ organizationId, outboxId: row.id });

  const cycles = await tx.refillCycle.findMany({
    where: {
      closedAt: null,
      status: onlyEscalations ? 'notified' : { in: ['to_notify', 'notified'] },
      treatment: { is: { status: 'active' } },
    },
    include: { treatment: { include: { patient: true } } },
    orderBy: { id: 'asc' },
    take: 2000,
  });
  if (!cycles.length) return { summary, toSend };
  const cycleIds = cycles.map((cycle) => cycle.id);

  const [notices, activities, pendingOutbox, templates, telegramLinks] = await Promise.all([
    tx.notice.findMany({ where: { cycleId: { in: cycleIds } }, orderBy: { sentAt: 'desc' }, select: { cycleId: true, sentAt: true, mode: true, status: true } }),
    tx.activity.findMany({ where: { cycleId: { in: cycleIds }, type: { in: ['notice', 'call'] } }, orderBy: { occurredAt: 'desc' }, select: { cycleId: true, occurredAt: true, metadata: true } }),
    tx.outboxMessage.findMany({ where: { cycleId: { in: cycleIds }, status: { in: ['pending', 'sending'] } }, select: { cycleId: true } }),
    tx.messageTemplate.findMany({
      where: { isActive: true, kind: 'refill_notice', OR: [{ channel: 'whatsapp', waStatus: 'approved' }, { channel: 'telegram' }] },
    }),
    tx.telegramLink.findMany({ where: { patientId: { in: cycles.map((cycle) => cycle.treatment.patientId) } }, select: { patientId: true } }),
  ]);
  const linkedToTelegram = new Set(telegramLinks.map((link) => link.patientId));
  const inFlight = new Set(pendingOutbox.map((row) => row.cycleId));
  const actorId = await systemActor(tx, organizationId);

  // A patient who answered stops the reminder chain; staff handle it from there.
  const replied = new Set(notices.filter((notice) => notice.status === 'replied').map((notice) => notice.cycleId));
  for (const cycle of cycles) {
    const settings = effective(cycle.branchId);
    if (!settings.automationEnabled) continue;
    if (replied.has(cycle.id)) { summary.skipped += 1; continue; }
    const { treatment } = cycle;
    const { patient } = treatment;
    const action = decideNextAction(
      { status: cycle.status as NoticeCycleSnapshot['status'], noticeAttempts: cycle.noticeAttempts },
      { status: treatment.status, automationPaused: treatment.automationPaused, coverageEndOn: treatment.coverageEndOn } satisfies NoticeTreatmentSnapshot,
      { archivedAt: patient.archivedAt, automationPaused: patient.automationPaused, phone: patient.phone, phoneHasWhatsapp: patient.phoneHasWhatsapp, reminderConsent: patient.reminderConsent, preferredChannel: patient.preferredChannel, telegramLinked: linkedToTelegram.has(patient.id) } satisfies NoticePatientSnapshot,
      asSettingsSnapshot(settings),
      historyFor(cycle.id, notices, activities),
      now,
    );
    if (onlyEscalations && action.type !== 'create_incident') continue;
    await applyAction(tx, { organizationId, cycle, action, settings, now, dryRun: settings.automationDryRun, inFlight, templates, actorId, summary, toSend });
  }
  return { summary, toSend };
}

type Cycle = Awaited<ReturnType<Tx['refillCycle']['findMany']>>[number] & { treatment: { patientId: string } };

async function applyAction(
  tx: Tx,
  ctx: {
    organizationId: string;
    cycle: Cycle;
    action: NoticeAction;
    settings: SettingRow;
    now: Date;
    dryRun: boolean;
    inFlight: Set<string>;
    templates: Awaited<ReturnType<Tx['messageTemplate']['findMany']>>;
    actorId: string | null;
    summary: PlanSummary;
    toSend: SendNoticeData[];
  },
) {
  const { cycle, action, summary } = ctx;
  const links = { patientId: cycle.treatment.patientId, treatmentId: cycle.treatmentId, cycleId: cycle.id };

  if (action.type === 'wait') { summary.waiting += 1; return; }
  if (action.type === 'skip') { summary.skipped += 1; return; }

  if (action.type === 'send') {
    if (ctx.inFlight.has(cycle.id)) { summary.skipped += 1; return; }
    // Prefer the template for this exact attempt, falling back to the closest earlier one.
    const usable = ctx.templates
      .filter((template) => template.channel === action.channel && template.attemptNumber <= action.attempt && (template.branchId === null || template.branchId === cycle.branchId))
      .sort((a, b) => b.attemptNumber - a.attemptNumber || (b.branchId ? 1 : 0) - (a.branchId ? 1 : 0));
    const template = usable[0];
    if (!template) { summary.noTemplate += 1; return; }
    const dedupeKey = `${cycle.id}:${action.attempt}:${localDateString(ctx.now, ctx.settings.timezone)}`;
    // Today's message for this cycle was cancelled before it went out (paused, kill-switch...) and the policy now says
    // send again: bring it back instead of being blocked by its own dedupe key. A deliberate manual cancel stays cancelled.
    const earlier = await tx.outboxMessage.findFirst({ where: { dedupeKey }, select: { id: true, status: true, lastError: true } });
    if (earlier && earlier.status === 'cancelled' && earlier.lastError !== 'manual_cancel' && !ctx.dryRun) {
      await tx.outboxMessage.update({ where: { id: earlier.id }, data: { status: 'pending', cancelledAt: null, lockedAt: null, attempts: 0, lastError: null, scheduledFor: ctx.now } });
      ctx.inFlight.add(cycle.id);
      ctx.toSend.push({ organizationId: ctx.organizationId, outboxId: earlier.id });
      summary.planned += 1;
      return;
    }
    const inserted = await tx.outboxMessage.createMany({
      data: [{
        organizationId: ctx.organizationId, branchId: cycle.branchId, ...links, templateId: template.id, channel: action.channel,
        attemptNumber: action.attempt, dedupeKey, status: ctx.dryRun ? 'dry_run' : 'pending', scheduledFor: ctx.now,
      }],
      skipDuplicates: true,
    });
    if (inserted.count === 0) { summary.skipped += 1; return; }
    if (ctx.dryRun) { summary.dryRun += 1; return; }
    const row = await tx.outboxMessage.findFirstOrThrow({ where: { dedupeKey }, select: { id: true } });
    ctx.inFlight.add(cycle.id);
    ctx.toSend.push({ organizationId: ctx.organizationId, outboxId: row.id });
    summary.planned += 1;
    return;
  }

  // Call tasks and incidents change staff work, so dry-run only counts them.
  if (ctx.dryRun) { summary[action.type === 'create_incident' ? 'incidents' : 'callTasks'] += 1; return; }
  if (!ctx.actorId) { summary.skipped += 1; return; }

  const openCallTask = await tx.task.findFirst({ where: { cycleId: cycle.id, type: 'call', status: 'open', autoGenerated: true }, select: { id: true } });
  if (!openCallTask) {
    const patient = await tx.patient.findFirstOrThrow({ where: { id: links.patientId }, select: { fullName: true } });
    await tx.task.create({
      data: {
        organizationId: ctx.organizationId, branchId: cycle.branchId, type: 'call', status: 'open', autoGenerated: true, ...links,
        title: action.type === 'create_incident' ? `Llamar a ${patient.fullName}: sin respuesta a los avisos` : `Llamar a ${patient.fullName}: ${callReason(action.reason)}`,
      },
    });
    summary.callTasks += 1;
  }
  if (action.type === 'create_incident') {
    const open = await tx.incident.findFirst({ where: { cycleId: cycle.id, type: 'patient_no_response', status: { not: 'resolved' } }, select: { id: true } });
    if (!open) {
      const incident = await tx.incident.create({
        data: {
          organizationId: ctx.organizationId, branchId: cycle.branchId, ...links, type: 'patient_no_response', status: 'new',
          autoGenerated: true, createdBy: ctx.actorId, description: `Sin respuesta tras ${cycle.noticeAttempts} avisos`,
        },
      });
      await tx.activity.create({
        data: { organizationId: ctx.organizationId, ...links, type: 'incident', body: 'Incidencia automática: sin respuesta', metadata: { incident_id: incident.id, auto_generated: true }, authorId: ctx.actorId },
      });
      await record(tx, { organizationId: ctx.organizationId, actorId: ctx.actorId, action: 'incident.auto_create', subjectId: incident.id, metadata: { type: 'patient_no_response' } });
      summary.incidents += 1;
    }
  }
}

function callReason(reason: string) {
  if (reason === 'no_consent') return 'sin consentimiento de recordatorios';
  if (reason === 'no_whatsapp') return 'sin WhatsApp disponible';
  return reason;
}
