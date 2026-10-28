/**
 * PAUSED (Fase 3, messaging): work on the automatic WhatsApp/call notice
 * pipeline is on hold by request — resume later rather than extend it now.
 * Nothing in the app imports this module yet, so it has no runtime effect.
 *
 * Pure decision engine for automatic WhatsApp/call notices.
 *
 * `decideNextAction` takes a snapshot of one open cycle plus its treatment,
 * patient, resolved settings and notice history, and returns exactly one
 * action for the caller to apply. No database or Express imports: every
 * rule below is a plain comparison against the inputs, and `now` is the only
 * source of "the current time" so the rules are deterministic and testable
 * across timezones without touching a clock.
 */

export type NoticeActionType =
  | 'send'
  | 'wait'
  | 'create_call_task'
  | 'create_incident'
  | 'skip';

export type NoticeAction =
  | { type: 'send'; attempt: number }
  | { type: 'wait'; until: Date }
  | { type: 'create_call_task'; reason: string }
  | { type: 'create_incident' }
  | { type: 'skip'; reason: string };

export type NoticeCycleSnapshot = {
  status: 'to_notify' | 'notified' | 'confirmed' | 'prepared' | 'delivered' | 'not_picked_up' | 'cancelled';
  noticeAttempts: number;
};

export type NoticeTreatmentSnapshot = {
  status: 'active' | 'paused' | 'finished';
  automationPaused: boolean;
  coverageEndOn: Date | null;
};

export type NoticePatientSnapshot = {
  archivedAt: Date | null;
  automationPaused: boolean;
  phone: string | null;
  phoneHasWhatsapp: boolean;
  reminderConsent: boolean;
};

export type NoticeSettingsSnapshot = {
  noticeLeadDays: number;
  maxNoticeAttempts: number;
  retryAfterHours: number;
  timezone: string;
  noticeWindowStart: string; // "HH:mm"
  noticeWindowEnd: string; // "HH:mm"
  autoCallTaskWithoutConsent: boolean;
};

export type NoticeHistorySnapshot = {
  /** When the last notice (automatic or manual) for this cycle was sent/logged, if any. */
  lastNoticeAt: Date | null;
  /** Whether the last notice was logged by staff rather than sent by the engine. */
  lastNoticeWasManual: boolean;
};

const closedCycleStatuses = new Set(['confirmed', 'prepared', 'delivered', 'not_picked_up', 'cancelled']);

/** Minutes since local midnight, for comparing against a settings "HH:mm" window. */
function minutesSinceMidnight(timeOfDay: string): number {
  const [hours, minutes] = timeOfDay.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** The instant's minute-of-day in the organization's timezone, via the host's own tz database. */
function localMinutesOfDay(instant: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(instant);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  // Intl can format midnight as "24:00" depending on the locale/runtime.
  return (hour % 24) * 60 + minute;
}

/** The next instant, at or after `from`, that falls inside the notice window. */
function nextWindowOpening(from: Date, settings: NoticeSettingsSnapshot): Date {
  const windowStart = minutesSinceMidnight(settings.noticeWindowStart);
  const windowEnd = minutesSinceMidnight(settings.noticeWindowEnd);
  const nowMinutes = localMinutesOfDay(from, settings.timezone);
  if (nowMinutes >= windowStart && nowMinutes < windowEnd) return from;
  const minutesUntilOpen = nowMinutes < windowStart
    ? windowStart - nowMinutes
    : 24 * 60 - nowMinutes + windowStart;
  return new Date(from.getTime() + minutesUntilOpen * 60_000);
}

function daysUntil(target: Date, from: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((target.getTime() - from.getTime()) / msPerDay);
}

export function decideNextAction(
  cycle: NoticeCycleSnapshot,
  treatment: NoticeTreatmentSnapshot,
  patient: NoticePatientSnapshot,
  settings: NoticeSettingsSnapshot,
  history: NoticeHistorySnapshot,
  now: Date,
): NoticeAction {
  // Rule 5: nothing to notify once the cycle is past to_notify/notified, or
  // the patient/treatment is out of scope for automation entirely.
  if (closedCycleStatuses.has(cycle.status)) {
    return { type: 'skip', reason: 'cycle_closed' };
  }
  if (patient.archivedAt) {
    return { type: 'skip', reason: 'patient_archived' };
  }
  if (patient.automationPaused) {
    return { type: 'skip', reason: 'patient_automation_paused' };
  }
  if (treatment.automationPaused) {
    return { type: 'skip', reason: 'treatment_automation_paused' };
  }
  if (treatment.status !== 'active') {
    return { type: 'skip', reason: 'treatment_not_active' };
  }

  // Rule 4: no consent means no automatic message, ever — only an optional
  // call task, decided purely by the org's configured policy.
  if (!patient.reminderConsent) {
    return settings.autoCallTaskWithoutConsent
      ? { type: 'create_call_task', reason: 'no_consent' }
      : { type: 'skip', reason: 'no_consent' };
  }

  // Rule 5 (continued): no WhatsApp number means the engine cannot send
  // anything itself, but staff should still be nudged to call.
  if (!patient.phone || !patient.phoneHasWhatsapp) {
    return { type: 'create_call_task', reason: 'no_whatsapp' };
  }

  // Rule 8: a manual notice logged recently covers the same window; do not
  // pile an automatic one on top of it.
  if (history.lastNoticeWasManual && history.lastNoticeAt) {
    const hoursSinceManual = (now.getTime() - history.lastNoticeAt.getTime()) / 3_600_000;
    if (hoursSinceManual < settings.retryAfterHours) {
      return { type: 'skip', reason: 'manual_notice_recent' };
    }
  }

  // Rule 6: attempts exhausted on a cycle still waiting for a response —
  // escalate once, never leave it silent.
  if (cycle.status === 'notified' && cycle.noticeAttempts >= settings.maxNoticeAttempts) {
    return { type: 'create_incident' };
  }

  const nextAttempt = cycle.noticeAttempts + 1;

  if (cycle.status === 'to_notify') {
    // Rule 1 and 7: the first notice goes out once within `noticeLeadDays` of
    // coverage ending; an already-overdue patient still gets it immediately
    // (daysUntil is negative), just still bound by the time window.
    if (treatment.coverageEndOn) {
      const daysRemaining = daysUntil(treatment.coverageEndOn, now);
      if (daysRemaining > settings.noticeLeadDays) {
        const leadDate = new Date(treatment.coverageEndOn.getTime() - settings.noticeLeadDays * 86_400_000);
        return { type: 'wait', until: nextWindowOpening(leadDate, settings) };
      }
    }
  } else if (cycle.status === 'notified') {
    // Rule 2: a reminder only goes out after retryAfterHours of silence
    // since the last attempt.
    if (!history.lastNoticeAt) {
      return { type: 'skip', reason: 'no_previous_notice' };
    }
    const hoursSinceLast = (now.getTime() - history.lastNoticeAt.getTime()) / 3_600_000;
    if (hoursSinceLast < settings.retryAfterHours) {
      const nextTry = new Date(history.lastNoticeAt.getTime() + settings.retryAfterHours * 3_600_000);
      return { type: 'wait', until: nextWindowOpening(nextTry, settings) };
    }
  } else {
    return { type: 'skip', reason: 'unexpected_cycle_status' };
  }

  // Rule 3: only send inside the organization's local notice window.
  const windowStart = minutesSinceMidnight(settings.noticeWindowStart);
  const windowEnd = minutesSinceMidnight(settings.noticeWindowEnd);
  const nowMinutes = localMinutesOfDay(now, settings.timezone);
  if (nowMinutes < windowStart || nowMinutes >= windowEnd) {
    return { type: 'wait', until: nextWindowOpening(now, settings) };
  }

  return { type: 'send', attempt: nextAttempt };
}
