import { describe, expect, it } from 'vitest';
import {
  decideNextAction,
  type NoticeCycleSnapshot,
  type NoticeHistorySnapshot,
  type NoticePatientSnapshot,
  type NoticeSettingsSnapshot,
  type NoticeTreatmentSnapshot,
} from '../src/domain/noticePolicy.js';

const settings: NoticeSettingsSnapshot = {
  noticeLeadDays: 5,
  maxNoticeAttempts: 3,
  retryAfterHours: 24,
  timezone: 'America/Santo_Domingo',
  noticeWindowStart: '09:00',
  noticeWindowEnd: '18:00',
  autoCallTaskWithoutConsent: false,
};
const patient: NoticePatientSnapshot = {
  archivedAt: null,
  automationPaused: false,
  phone: '8091234567',
  phoneHasWhatsapp: true,
  reminderConsent: true,
};
const treatment: NoticeTreatmentSnapshot = {
  status: 'active',
  automationPaused: false,
  coverageEndOn: new Date('2026-11-01T00:00:00Z'),
};
const cycle: NoticeCycleSnapshot = { status: 'to_notify', noticeAttempts: 0 };
const history: NoticeHistorySnapshot = { lastNoticeAt: null, lastNoticeWasManual: false };

// 1:30pm UTC is 9:30am in America/Santo_Domingo (UTC-4, no DST) — inside the
// default 09:00-18:00 window.
const insideWindow = new Date('2026-10-27T13:30:00Z');
// 1am UTC is 9pm the previous day in Santo Domingo — after the window closes.
const outsideWindow = new Date('2026-10-27T01:00:00Z');

describe('decideNextAction', () => {
  it('rule 1: sends the first notice once within noticeLeadDays of coverage ending', () => {
    expect(decideNextAction(cycle, treatment, patient, settings, history, insideWindow))
      .toEqual({ type: 'send', attempt: 1 });
  });

  it('rule 1: waits until the lead window opens when coverage ends far in the future', () => {
    const farTreatment = { ...treatment, coverageEndOn: new Date('2026-11-10T00:00:00Z') };
    const result = decideNextAction(cycle, farTreatment, patient, settings, history, insideWindow);
    expect(result.type).toBe('wait');
    if (result.type !== 'wait') return;
    // noticeLeadDays before 2026-11-10 is 2026-11-05, inside the notice window.
    expect(result.until.toISOString().slice(0, 10)).toBe('2026-11-05');
  });

  it('rule 2: sends a reminder once retryAfterHours have passed since the last attempt', () => {
    const notifiedCycle: NoticeCycleSnapshot = { status: 'notified', noticeAttempts: 1 };
    const longAgo: NoticeHistorySnapshot = {
      lastNoticeAt: new Date(insideWindow.getTime() - 25 * 3_600_000),
      lastNoticeWasManual: false,
    };
    expect(decideNextAction(notifiedCycle, treatment, patient, settings, longAgo, insideWindow))
      .toEqual({ type: 'send', attempt: 2 });
  });

  it('rule 2: waits for retryAfterHours before a reminder, bound by the notice window', () => {
    const notifiedCycle: NoticeCycleSnapshot = { status: 'notified', noticeAttempts: 1 };
    const recent: NoticeHistorySnapshot = {
      lastNoticeAt: new Date(insideWindow.getTime() - 2 * 3_600_000),
      lastNoticeWasManual: false,
    };
    const result = decideNextAction(notifiedCycle, treatment, patient, settings, recent, insideWindow);
    expect(result.type).toBe('wait');
  });

  it('rule 2: a cycle in notified with no recorded notice yet is a data inconsistency, so it skips', () => {
    const notifiedCycle: NoticeCycleSnapshot = { status: 'notified', noticeAttempts: 1 };
    expect(decideNextAction(notifiedCycle, treatment, patient, settings, history, insideWindow))
      .toEqual({ type: 'skip', reason: 'no_previous_notice' });
  });

  it('rule 3: never sends outside the local notice window, and waits until it opens', () => {
    const result = decideNextAction(cycle, treatment, patient, settings, history, outsideWindow);
    expect(result.type).toBe('wait');
    if (result.type !== 'wait') return;
    expect(result.until.getTime()).toBeGreaterThan(outsideWindow.getTime());
  });

  it('rule 3: respects a different timezone for the same wall-clock settings', () => {
    const bogotaSettings: NoticeSettingsSnapshot = { ...settings, timezone: 'America/Bogota' };
    // 1:30pm UTC is 8:30am in Bogota (UTC-5) — still inside 09:00-18:00? No: 8:30 < 9:00.
    const result = decideNextAction(cycle, treatment, patient, bogotaSettings, history, insideWindow);
    expect(result.type).toBe('wait');
  });

  it('rule 4: no consent means no automatic message, and no call task unless configured', () => {
    const noConsent = { ...patient, reminderConsent: false };
    expect(decideNextAction(cycle, treatment, noConsent, settings, history, insideWindow))
      .toEqual({ type: 'skip', reason: 'no_consent' });
  });

  it('rule 4: no consent creates a call task when the org opts into it', () => {
    const noConsent = { ...patient, reminderConsent: false };
    const callSettings = { ...settings, autoCallTaskWithoutConsent: true };
    expect(decideNextAction(cycle, treatment, noConsent, callSettings, history, insideWindow))
      .toEqual({ type: 'create_call_task', reason: 'no_consent' });
  });

  it('rule 5: skips a cycle that already moved past to_notify/notified', () => {
    for (const status of ['confirmed', 'prepared', 'delivered', 'not_picked_up', 'cancelled'] as const) {
      const closedCycle: NoticeCycleSnapshot = { status, noticeAttempts: 0 };
      expect(decideNextAction(closedCycle, treatment, patient, settings, history, insideWindow))
        .toEqual({ type: 'skip', reason: 'cycle_closed' });
    }
  });

  it('rule 5: skips a paused treatment or patient', () => {
    expect(decideNextAction(cycle, { ...treatment, automationPaused: true }, patient, settings, history, insideWindow))
      .toEqual({ type: 'skip', reason: 'treatment_automation_paused' });
    expect(decideNextAction(cycle, treatment, { ...patient, automationPaused: true }, settings, history, insideWindow))
      .toEqual({ type: 'skip', reason: 'patient_automation_paused' });
  });

  it('rule 5: skips a paused or finished treatment, and an archived patient', () => {
    expect(decideNextAction(cycle, { ...treatment, status: 'paused' }, patient, settings, history, insideWindow))
      .toEqual({ type: 'skip', reason: 'treatment_not_active' });
    expect(decideNextAction(cycle, { ...treatment, status: 'finished' }, patient, settings, history, insideWindow))
      .toEqual({ type: 'skip', reason: 'treatment_not_active' });
    expect(decideNextAction(cycle, treatment, { ...patient, archivedAt: new Date() }, settings, history, insideWindow))
      .toEqual({ type: 'skip', reason: 'patient_archived' });
  });

  it('rule 5: a missing phone or a phone without WhatsApp creates a call task instead of sending', () => {
    expect(decideNextAction(cycle, treatment, { ...patient, phone: null }, settings, history, insideWindow))
      .toEqual({ type: 'create_call_task', reason: 'no_whatsapp' });
    expect(decideNextAction(cycle, treatment, { ...patient, phoneHasWhatsapp: false }, settings, history, insideWindow))
      .toEqual({ type: 'create_call_task', reason: 'no_whatsapp' });
  });

  it('rule 6: exhausting attempts on a cycle still waiting for a response escalates to an incident', () => {
    const exhausted: NoticeCycleSnapshot = { status: 'notified', noticeAttempts: 3 };
    expect(decideNextAction(exhausted, treatment, patient, settings, history, insideWindow))
      .toEqual({ type: 'create_incident' });
  });

  it('rule 7: an overdue treatment still sends immediately, not after a wait', () => {
    const overdue = { ...treatment, coverageEndOn: new Date('2026-10-20T00:00:00Z') };
    expect(decideNextAction(cycle, overdue, patient, settings, history, insideWindow))
      .toEqual({ type: 'send', attempt: 1 });
  });

  it('rule 8: a recent manual notice suppresses the automatic one for retryAfterHours', () => {
    const recentManual: NoticeHistorySnapshot = {
      lastNoticeAt: new Date(insideWindow.getTime() - 2 * 3_600_000),
      lastNoticeWasManual: true,
    };
    expect(decideNextAction(cycle, treatment, patient, settings, recentManual, insideWindow))
      .toEqual({ type: 'skip', reason: 'manual_notice_recent' });
  });

  it('rule 8: an old manual notice no longer blocks the automatic one', () => {
    const oldManual: NoticeHistorySnapshot = {
      lastNoticeAt: new Date(insideWindow.getTime() - 25 * 3_600_000),
      lastNoticeWasManual: true,
    };
    expect(decideNextAction(cycle, treatment, patient, settings, oldManual, insideWindow))
      .toEqual({ type: 'send', attempt: 1 });
  });
});
