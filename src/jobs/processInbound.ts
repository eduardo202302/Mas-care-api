import type { Prisma } from '@prisma/client';
import { normalizePhone } from '../domain/notice.js';
import { logger } from '../infra/logger.js';
import { prisma, withTenant } from '../infra/prisma.js';
import { record } from '../modules/audit/record.js';
import { systemActor } from './shared.js';

type Tx = Prisma.TransactionClient;
type Inbound = Awaited<ReturnType<Tx['whatsappInbound']['findFirstOrThrow']>>;

export type InboundKind = 'unassigned' | 'confirmed' | 'need_help' | 'opt_out' | 'free_text';
export type InboundSummary = Record<InboundKind, number>;

const normalizeText = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
const OPT_OUT_EXACT = new Set(['baja', 'stop', 'parar', 'cancelar', 'cancelar suscripcion', 'darme de baja', 'quiero la baja']);
const OPT_OUT_PHRASES = ['no quiero recibir', 'no quiero mas mensajes', 'dejar de recibir', 'no me escriban', 'no me envien mas', 'no me manden mas', 'darme de baja', 'dar de baja mi numero'];

/** Deliberately narrow: a bare «baja» or «stop», or an explicit refusal of messages. Anything else is free text. */
export function isOptOut(text: string | null | undefined): boolean {
  if (!text) return false;
  const value = normalizeText(text);
  return OPT_OUT_EXACT.has(value) || OPT_OUT_PHRASES.some((phrase) => value.includes(phrase));
}

/**
 * Handles replies saved by the webhook. It never answers the patient and never
 * interprets free text: only the two template buttons and an explicit opt-out
 * change anything; the rest stops the reminder chain and asks staff to look.
 * The patient is matched only inside the message's own organization, and only
 * when exactly one patient has that number.
 */
export async function processInbound(options: { organizationId?: string } = {}): Promise<InboundSummary> {
  const total: InboundSummary = { unassigned: 0, confirmed: 0, need_help: 0, opt_out: 0, free_text: 0 };
  const organizations = await prisma.organization.findMany({
    where: { status: 'active', ...(options.organizationId ? { id: options.organizationId } : {}) },
    select: { id: true },
  });
  for (const { id } of organizations) {
    try {
      const summary = await withTenant(id, (tx) => processOrganization(tx, id));
      for (const key of Object.keys(summary) as InboundKind[]) total[key] += summary[key];
    } catch (error) {
      logger.error({ err: error, organizationId: id }, 'processing inbound messages failed');
    }
  }
  return total;
}

async function processOrganization(tx: Tx, organizationId: string): Promise<InboundSummary> {
  const summary: InboundSummary = { unassigned: 0, confirmed: 0, need_help: 0, opt_out: 0, free_text: 0 };
  const rows = await tx.whatsappInbound.findMany({ where: { processedAt: null }, orderBy: { receivedAt: 'asc' }, take: 200 });
  if (!rows.length) return summary;
  const actorId = await systemActor(tx, organizationId);
  const orgSetting = await tx.setting.findFirst({ where: { branchId: null } });
  const country = orgSetting?.defaultCountryCode ?? 'DO';
  for (const row of rows) {
    const kind = await handle(tx, { organizationId, row, actorId, country });
    summary[kind] += 1;
    await tx.whatsappInbound.update({ where: { id: row.id }, data: { processedAt: new Date() } });
  }
  return summary;
}

async function findPatient(tx: Tx, fromPhone: string, country: string): Promise<string | null> {
  const digits = fromPhone.replace(/\D/g, '');
  if (digits.length < 7) return null;
  const candidates = await tx.$queryRaw<{ id: string; phone: string | null }[]>`
    SELECT id, phone FROM patients
    WHERE archived_at IS NULL AND phone IS NOT NULL
      AND regexp_replace(phone, '\\D', '', 'g') LIKE ${`%${digits.slice(-7)}`}`;
  const target = normalizePhone(digits, country) ?? digits;
  const matches = candidates.filter((candidate) => (normalizePhone(candidate.phone, country) ?? '') === target);
  return matches.length === 1 ? matches[0]!.id : null;
}

/** A Telegram chat identifies the patient directly; two patients sharing one chat (a parent) stay unassigned. */
async function findTelegramPatient(tx: Tx, chatId: string): Promise<string | null> {
  const links = await tx.telegramLink.findMany({ where: { chatId }, select: { patientId: true }, take: 2 });
  return links.length === 1 ? links[0]!.patientId : null;
}

async function handle(tx: Tx, ctx: { organizationId: string; row: Inbound; actorId: string | null; country: string }): Promise<InboundKind> {
  const { organizationId, row, actorId, country } = ctx;
  // A staff-assigned reply already carries its patient; otherwise match by number inside the organization.
  const patientId = row.patientId
    ?? (row.channel === 'telegram'
      ? (row.fromChatId ? await findTelegramPatient(tx, row.fromChatId) : null)
      : (row.fromPhone ? await findPatient(tx, row.fromPhone, country) : null));
  // Zero or several patients with that number: keep it for a human to assign.
  if (!patientId) return 'unassigned';

  // The open cycle the patient was last notified about.
  const notices = await tx.notice.findMany({ where: { patientId, mode: 'automatic' }, orderBy: { sentAt: 'desc' }, include: { cycle: true }, take: 10 });
  const latest = notices.find((notice) => !notice.cycle.closedAt);
  const cycle = latest?.cycle ?? null;
  await tx.whatsappInbound.update({ where: { id: row.id }, data: { patientId, cycleId: cycle?.id ?? null } });

  const patient = await tx.patient.findFirstOrThrow({ where: { id: patientId }, select: { fullName: true, primaryBranchId: true } });
  const branchId = cycle?.branchId ?? patient.primaryBranchId;
  const links = { patientId, treatmentId: cycle?.treatmentId ?? null, cycleId: cycle?.id ?? null };
  const task = async (type: 'call' | 'other', title: string) => {
    const open = await tx.task.findFirst({ where: { patientId, type, status: 'open', autoGenerated: true, title }, select: { id: true } });
    if (!open) await tx.task.create({ data: { organizationId, branchId, type, status: 'open', autoGenerated: true, title, ...links } });
  };
  const note = (body: string, metadata: Prisma.InputJsonObject) => actorId
    ? tx.activity.create({ data: { organizationId, ...links, type: 'notice', body, metadata: { inbound_id: row.id, ...metadata }, authorId: actorId } })
    : Promise.resolve(null);
  // A reply stops the reminder chain for that cycle: pending messages are cancelled and the notice is marked replied.
  const settleCycle = async () => {
    if (!cycle) return;
    await tx.outboxMessage.updateMany({ where: { cycleId: cycle.id, status: 'pending' }, data: { status: 'cancelled', cancelledAt: new Date(), lastError: 'patient_replied' } });
    if (latest) await tx.notice.update({ where: { id: latest.id }, data: { status: 'replied', repliedAt: row.receivedAt } });
  };

  if (isOptOut(row.text) && !row.buttonPayload) {
    if (actorId) {
      await tx.patientConsent.create({ data: { organizationId, patientId, granted: false, channel: 'whatsapp', evidence: 'Baja solicitada por el propio paciente por WhatsApp', recordedBy: actorId } });
    }
    await tx.patient.update({ where: { organizationId_id: { organizationId, id: patientId } }, data: { reminderConsent: false, reminderConsentAt: null } });
    await tx.outboxMessage.updateMany({ where: { patientId, status: 'pending' }, data: { status: 'cancelled', cancelledAt: new Date(), lastError: 'consent_revoked' } });
    await settleCycle();
    if (cycle) await task('call', `Llamar a ${patient.fullName}: pidió no recibir más mensajes`);
    await note('Consentimiento de recordatorios revocado por el paciente', { opt_out: true });
    await record(tx, { organizationId, ...(actorId ? { actorId } : {}), action: 'patient.consent.revoked_by_patient', subjectId: patientId });
    return 'opt_out';
  }
  if (row.buttonPayload === 'confirm' && cycle && ['to_notify', 'notified'].includes(cycle.status)) {
    await tx.refillCycle.update({ where: { organizationId_id: { organizationId, id: cycle.id } }, data: { status: 'confirmed', boardPosition: null, version: { increment: 1 } } });
    await settleCycle();
    await note('El paciente confirmó por WhatsApp', { button: 'confirm' });
    if (actorId) {
      await tx.activity.create({ data: { organizationId, ...links, type: 'cycle_moved', body: '', metadata: { from: cycle.status, to: 'confirmed', via: 'whatsapp_button' }, authorId: actorId } });
    }
    return 'confirmed';
  }
  if (row.buttonPayload === 'need_help') {
    await settleCycle();
    await task('call', `Llamar a ${patient.fullName}: pidió hablar con la farmacia`);
    await note('El paciente pidió hablar con la farmacia', { button: 'need_help' });
    return 'need_help';
  }
  // Free text, or a button with nothing to act on: save, stop the chain, ask staff to review. Never answered, never interpreted.
  await settleCycle();
  await task('other', `Revisar respuesta de ${patient.fullName}`);
  await note('Respuesta del paciente recibida', {});
  return 'free_text';
}
