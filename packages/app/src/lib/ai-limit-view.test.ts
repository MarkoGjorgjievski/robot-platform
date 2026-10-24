import { describe, expect, it } from 'vitest';
import { AI_LIMIT_TITLE, aiLimitView, capText, defaultHint, parseCapDraft, type AiLimitRow } from './ai-limit-view';

const row = (over: Partial<AiLimitRow> = {}): AiLimitRow => ({ capUsd: 25, capIsDefault: true, ownCapUsd: null, defaultCapUsd: 25, aiUsd: 3.2, remainingUsd: 21.8, reached: false, ...over });

describe('the Monthly AI limit panel (spec 2026-10-24 metering §2.4)', () => {
  it('says spent, limit and what is left, and how to go back to the default', () => {
    expect(AI_LIMIT_TITLE).toBe('Monthly AI limit');
    const v = aiLimitView(row(), null);
    expect([v.spentLine, v.capLine, v.remainingLine]).toEqual(['$3.20 spent this month', '$25 limit (default)', '$21.80 left']);
    expect(v.hint).toBe('Leave empty to use the default ($25)');
    expect(v.draft).toBe('');
    expect(v.saveReason).toBe('No changes to save');
    expect(defaultHint(null)).toBe('Leave empty for no limit');
    expect(aiLimitView(row({ capUsd: 40, capIsDefault: false, ownCapUsd: 40, remainingUsd: 0, aiUsd: 40, reached: true }), null)).toMatchObject({ draft: '40', capLine: '$40 limit', remainingLine: '$0.00 left', reached: true });
    expect(aiLimitView(row({ capUsd: null, defaultCapUsd: null, remainingUsd: null }), null)).toMatchObject({ capLine: 'No limit', remainingLine: '' });
  });

  it('Save turns on for a new amount, or for empty when the org has its own', () => {
    expect(aiLimitView(row(), '40')).toMatchObject({ saveReason: null, capUsd: 40 });
    expect(aiLimitView(row({ ownCapUsd: 40, capUsd: 40, capIsDefault: false }), '')).toMatchObject({ saveReason: null, capUsd: null });
    expect(aiLimitView(null, '40').saveReason).toBe('Loading…');
  });

  it('RF5: the panel takes dollars and cents only', () => {
    expect(parseCapDraft('')).toEqual({ ok: true, capUsd: null });
    expect(parseCapDraft(' $40.50 ')).toEqual({ ok: true, capUsd: 40.5 });
    expect(parseCapDraft('0')).toEqual({ ok: true, capUsd: 0 });
    for (const bad of ['40.555', '-1', '40.5.0', 'abc', '1e3']) expect(parseCapDraft(bad), bad).toEqual({ ok: false, reason: 'Enter an amount in dollars, like 40 or 40.50' });
    expect(parseCapDraft('1000001')).toEqual({ ok: false, reason: 'At most $1,000,000' });
    expect(aiLimitView(row(), '40.555').saveReason).toBe('Enter an amount in dollars, like 40 or 40.50');
    expect(capText(40)).toBe('$40');
    expect(capText(40.5)).toBe('$40.50');
  });
});
