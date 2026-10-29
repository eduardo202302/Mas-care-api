import { describe, expect, it } from 'vitest';
import { reminderTaskFor } from '../src/domain/automationRules.js';

describe('reminderTaskFor', () => {
  it('creates an actionable reminder when consent is current', () => {
    expect(reminderTaskFor(true, 'Ana', 'x')).toMatchObject({ type: 'other', withoutConsent: false });
  });
  it('only ever creates a call task without consent', () => {
    const task = reminderTaskFor(false, 'Ana', 'x');
    expect(task).toMatchObject({ type: 'call', withoutConsent: true });
    expect(task.title).toContain('sin consentimiento');
  });
});
