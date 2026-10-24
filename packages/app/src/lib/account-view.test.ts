import { describe, it, expect } from 'vitest';
import { ACCOUNT_MESSAGES_LINE, EMAIL_PREF_LOAD_FAILED, EMAIL_PREF_OPTIONS, EMAIL_PREF_SAVE_FAILED, emailPrefRows, nameProblem, THEME_OPTIONS } from './account-view';

describe('nameProblem', () => {
  it('wants a name, and not a novel', () => {
    expect(nameProblem('Ada')).toBeNull();
    expect(nameProblem('  Ada  ')).toBeNull();
    expect(nameProblem('')).toBe('Enter a name');
    expect(nameProblem('   ')).toBe('Enter a name');
    expect(nameProblem('a'.repeat(255))).toBeNull();
    expect(nameProblem('a'.repeat(256))).toBe('Keep it to 255 characters or fewer');
  });
});

describe('THEME_OPTIONS', () => {
  it('offers the three preferences the session stores, dark first', () => {
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual(['dark', 'light', 'system']);
    expect(THEME_OPTIONS.map((o) => o.label)).toEqual(['Dark', 'Light', 'System']);
    for (const o of THEME_OPTIONS) expect(o.hint.length).toBeGreaterThan(0);
  });
});

describe('the Email panel (spec 2026-10-24 email §3.4)', () => {
  it('two switches in this order, in these words, and the always-sent line', () => {
    expect(EMAIL_PREF_OPTIONS.map((o) => [o.key, o.label])).toEqual([['attention', 'When a website needs attention'], ['failedRuns', 'When a run fails']]);
    expect(ACCOUNT_MESSAGES_LINE).toBe('Account messages are always sent.');
    expect(EMAIL_PREF_SAVE_FAILED).toBe('The preference could not be saved. Try again.');
    expect(EMAIL_PREF_LOAD_FAILED).toBe('Your email choices could not be loaded. Reload the page.');
  });
  it('shows the saved preferences, and holds the switches still until they have loaded', () => {
    expect(emailPrefRows(undefined).map((r) => [r.checked, r.disabled])).toEqual([[true, true], [true, true]]);
    expect(emailPrefRows({ attention: false, failedRuns: true }).map((r) => [r.key, r.checked, r.disabled])).toEqual([['attention', false, false], ['failedRuns', true, false]]);
  });
});
