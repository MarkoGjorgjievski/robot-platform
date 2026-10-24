import { describe, it, expect } from 'vitest';
import {
  choiceOf, scheduleFromForm, scheduleFormProblem, whenLabel, nextRunLine, lastOutcomeLine, timeZoneOptions,
  maskSecret, webhookLine, CHOICE_LABELS, WEBHOOK_HELP,
  REPLACE_SECRET_TITLE, REPLACE_SECRET_TEXT, webhookSaveReason, COPY_FAILED,
} from './recurring-view';

const MON_6 = { days: [1], time: '06:00', timeZone: 'Europe/Berlin' };

describe('the Schedule row', () => {
  it('reads a stored schedule back as its choice', () => {
    expect(choiceOf(null)).toBe('off');
    expect(choiceOf({ ...MON_6, days: [1, 2, 3, 4, 5, 6, 7] })).toBe('daily');
    expect(choiceOf({ ...MON_6, days: [1, 2, 3, 4, 5] })).toBe('weekdays');
    expect(choiceOf({ ...MON_6, days: [1, 3] })).toBe('custom');
    expect(CHOICE_LABELS).toEqual({ off: 'Off', daily: 'Every day', weekdays: 'Weekdays', custom: 'Choose days' });
  });
  it('builds what Save sends', () => {
    expect(scheduleFromForm('off', [1], '06:00', 'UTC')).toBeNull();
    expect(scheduleFromForm('daily', [3], '06:00', 'UTC')).toEqual({ days: [1, 2, 3, 4, 5, 6, 7], time: '06:00', timeZone: 'UTC' });
    expect(scheduleFromForm('weekdays', [], '07:30', 'Asia/Kolkata')).toEqual({ days: [1, 2, 3, 4, 5], time: '07:30', timeZone: 'Asia/Kolkata' });
    expect(scheduleFromForm('custom', [5, 1, 5], '06:00', 'UTC')).toEqual({ days: [1, 5], time: '06:00', timeZone: 'UTC' });
  });
  it('says what keeps Save disabled', () => {
    expect(scheduleFormProblem('custom', [], '06:00')).toBe('Choose at least one day.');
    expect(scheduleFormProblem('daily', [], '')).toBe('Use a time like 06:00.');
    expect(scheduleFormProblem('off', [], '')).toBeNull();
    expect(scheduleFormProblem('custom', [2], '23:59')).toBeNull();
  });
  it('the next run, in the schedule’s own zone', () => {
    expect(whenLabel(new Date('2026-10-26T05:00:00Z'), 'Europe/Berlin')).toBe('Monday 26 October, 06:00');
    expect(nextRunLine(new Date('2026-10-26T05:00:00Z'), 'Europe/Berlin')).toBe('Next run: Monday 26 October, 06:00 (Europe/Berlin)');
    expect(nextRunLine(new Date('2026-10-26T00:30:00Z'), 'Asia/Kolkata')).toBe('Next run: Monday 26 October, 06:00 (Asia/Kolkata)');
    expect(nextRunLine(null, 'Europe/Berlin')).toBeNull();
    expect(nextRunLine(new Date(), null)).toBeNull();
  });
  it('a zone this browser does not know reads in UTC instead of breaking the tab', () => {
    expect(nextRunLine(new Date('2026-10-26T05:00:00Z'), 'Etc/Unknown-But-Stored')).toBe('Next run: Monday 26 October, 05:00 (UTC)');
    expect(webhookLine({ state: 'delivered', at: new Date('2026-10-26T05:03:00Z') }, false, 'Etc/Unknown-But-Stored')).toBe('Webhook delivered Monday 26 October, 05:03.');
  });
  it('the last outcome, in the spec’s sentences', () => {
    expect(lastOutcomeLine({ at: '2026-10-26T05:00:00.000Z', outcome: 'started', runId: 'r1' }, 'Europe/Berlin'))
      .toEqual({ text: 'Started Monday 26 October, 06:00.', runId: 'r1' });
    expect(lastOutcomeLine({ at: '2026-10-26T05:00:00.000Z', outcome: 'skipped', reason: 'paused' }, 'UTC')).toEqual({ text: 'Skipped: the website is paused.', runId: null });
    expect(lastOutcomeLine({ at: 'x', outcome: 'skipped', reason: 'not_certified' }, 'UTC')!.text).toBe('Skipped: the website needs verifying first.');
    expect(lastOutcomeLine({ at: 'x', outcome: 'skipped', reason: 'not_confirmed' }, 'UTC')!.text).toBe('Skipped: run Extract once by hand first.');
    expect(lastOutcomeLine({ at: 'x', outcome: 'skipped', reason: 'busy' }, 'UTC')!.text).toBe('Skipped: the last run was still going.');
    expect(lastOutcomeLine(null, 'UTC')).toBeNull();
  });
  it('offers every zone Intl knows, the current one included', () => {
    const zones = timeZoneOptions('Europe/Berlin');
    expect(zones).toContain('Europe/Berlin');
    expect(zones).toContain('Australia/Lord_Howe');
    expect(timeZoneOptions('Etc/Unknown-But-Stored')).toContain('Etc/Unknown-But-Stored');
  });
});

describe('the Webhook row and the run page line', () => {
  it('masks the secret but its last four', () => {
    expect(maskSecret('ab'.repeat(30) + '1234')).toBe('••••••••••••1234');
  });
  it('the help line', () => {
    expect(WEBHOOK_HELP).toBe("We send a POST with the run's results and download links when a run finishes.");
  });
  it('one customer line per state, no code, no host, no error', () => {
    const at = new Date('2026-10-26T05:03:00Z');
    expect(webhookLine({ state: 'delivered', at }, false, 'Europe/Berlin')).toBe('Webhook delivered Monday 26 October, 06:03.');
    expect(webhookLine({ state: 'retrying', at, statusCode: 500, error: 'answered 500' }, false, 'UTC')).toBe('Webhook not delivered yet — trying again.');
    expect(webhookLine({ state: 'failed', at, statusCode: null, error: 'no answer within 10 s' }, false, 'UTC')).toBe('Webhook could not be delivered.');
    expect(webhookLine(null, false, 'UTC')).toBeNull();
  });
  it('staff also read the stored code and error', () => {
    const at = new Date('2026-10-26T05:03:00Z');
    expect(webhookLine({ state: 'retrying', at, statusCode: 503, error: 'answered 503' }, true, 'UTC')).toBe('Webhook not delivered yet — trying again. (503: answered 503)');
    expect(webhookLine({ state: 'failed', at, statusCode: null, error: 'no answer within 10 s' }, true, 'UTC')).toBe('Webhook could not be delivered. (no answer: no answer within 10 s)');
  });
});

describe('the Webhook row, review round 1', () => {
  it('Replace secret says what stops working, in plain words', () => {
    expect(REPLACE_SECRET_TITLE).toBe('Replace the signing secret?');
    expect(REPLACE_SECRET_TEXT).toBe(
      'Download links in webhooks already sent stop working, and your endpoint’s signature check fails until you give it the new secret.',
    );
  });
  it('says why Save webhook is disabled', () => {
    expect(webhookSaveReason(false, 'https://hooks.example.com/x')).toBe('No changes to save');
    expect(webhookSaveReason(true, '   ', true)).toBe('Use Remove to stop sending');
    expect(webhookSaveReason(true, '', false)).toBe('Enter your endpoint’s web address');
    expect(webhookSaveReason(true, 'https://hooks.example.com/x')).toBeNull();
  });
  it('a clipboard the browser does not offer reads as a sentence', () => {
    expect(COPY_FAILED).toBe('That could not be copied. Show the secret and copy it by hand.');
  });
});
