import { describe, it, expect } from 'vitest';
import { stripState, verifyButton, roughTime } from './verify-button';

describe('stripState', () => {
  it('maps verification state and results', () => {
    expect(stripState({ verification: 'none', results: null })).toBe('editing');
    expect(stripState({ verification: 'active', results: null })).toBe('active');
    expect(stripState({ verification: 'stalled', results: null })).toBe('stalled');
    expect(stripState({ verification: 'failed', results: null })).toBe('failed');
    expect(stripState({ verification: 'done', results: {} })).toBe('editing');
    expect(stripState({ verification: 'done', results: { price: fv(true) } })).toBe('results');
  });
});

describe('roughTime', () => {
  it('is a few seconds when there is nothing to capture and nothing to ask AI', () => {
    expect(roughTime({ fields: 5, aiFields: 0, capturesFresh: true })).toBe('a few seconds');
  });
  it('is under a minute for a short run', () => {
    expect(roughTime({ fields: 5, aiFields: 3, capturesFresh: true })).toBe('under a minute'); // 24s
    expect(roughTime({ fields: 5, aiFields: 1, capturesFresh: false })).toBe('under a minute'); // 36 + 8 = 44s
    expect(roughTime({ fields: 5, aiFields: 0, capturesFresh: false })).toBe('under a minute'); // 36s
  });
  it('rounds whole minutes up past 45 seconds', () => {
    expect(roughTime({ fields: 5, aiFields: 2, capturesFresh: false })).toBe('about 1 min'); // 36 + 16 = 52s
    expect(roughTime({ fields: 8, aiFields: 8, capturesFresh: false })).toBe('about 2 min'); // 36 + 64 = 100s
    expect(roughTime({ fields: 8, aiFields: 8, capturesFresh: true })).toBe('about 2 min'); // 64s
    expect(roughTime({ fields: 20, aiFields: 20, capturesFresh: false })).toBe('about 4 min'); // 36 + 160 = 196s
  });
  it('ignores the field count: only AI fields and stale captures cost time', () => {
    expect(roughTime({ fields: 40, aiFields: 0, capturesFresh: true })).toBe('a few seconds');
  });
});

describe('verifyButton', () => {
  const base = { state: 'editing' as const, firstRun: true, fieldCount: 8, reverifyCount: 0, capturesFresh: false, aiAvailable: true, upperBoundUsd: 0.25, complete: true, busy: false };
  it('first run names the field count and the price: free, or the upper bound (spec §2.4)', () => {
    expect(verifyButton(base)).toEqual({ label: 'Verify 8 fields · up to $0.25', disabled: false });
    expect(verifyButton({ ...base, aiAvailable: false })).toEqual({ label: 'Verify 8 fields · free', disabled: false });
    expect(verifyButton({ ...base, upperBoundUsd: 0 })).toEqual({ label: 'Verify 8 fields · free', disabled: false });
    expect(verifyButton({ ...base, fieldCount: 1, aiAvailable: false })).toEqual({ label: 'Verify 1 field · free', disabled: false });
    expect(verifyButton({ ...base, complete: false, aiAvailable: false })).toMatchObject({ label: 'Verify 8 fields · free', disabled: true });
  });
  it('never says "mechanical only"', () => {
    expect(verifyButton({ ...base, aiAvailable: false }).label).not.toMatch(/mechanical/);
  });
  it('re-verify is free with no AI need, else priced', () => {
    expect(verifyButton({ ...base, state: 'results', firstRun: false, reverifyCount: 3, capturesFresh: false, aiAvailable: false })).toEqual({ label: 'Re-verify 3 fields · free', disabled: false });
    expect(verifyButton({ ...base, state: 'results', firstRun: false, reverifyCount: 2, capturesFresh: true, upperBoundUsd: 0 })).toEqual({ label: 'Re-verify 2 fields · free', disabled: false });
    expect(verifyButton({ ...base, state: 'results', firstRun: false, reverifyCount: 1, capturesFresh: true, upperBoundUsd: 0.05 })).toEqual({ label: 'Re-verify 1 field · up to $0.05', disabled: false });
    expect(verifyButton({ ...base, state: 'results', firstRun: false, reverifyCount: 0, capturesFresh: true, upperBoundUsd: 0 })).toEqual({ label: 'Everything is verified', disabled: true, reason: 'Nothing has changed since the last verification' });
  });
  it('is off while active or busy or incomplete, with a reason', () => {
    expect(verifyButton({ ...base, state: 'active' })).toMatchObject({ disabled: true, reason: 'Verifying' });
    expect(verifyButton({ ...base, busy: true })).toMatchObject({ disabled: true });
    // M7: this reason must not point at "the problems listed above" — that list
    // is gated on `touched` (source-schema.tsx) and is not always on screen yet
    // when this reason first shows (e.g. before the operator has touched anything).
    expect(verifyButton({ ...base, complete: false })).toMatchObject({ disabled: true, reason: 'Fill in pages one to three, and at least one value on each extra page' });
  });
});

describe('verifyButton with variants', () => {
  const base = { state: 'editing' as const, firstRun: true, fieldCount: 8, reverifyCount: 0, capturesFresh: false, aiAvailable: true, upperBoundUsd: 0.25, complete: true, busy: false };

  it('no fields pending, variants pending: the variants-only label, free, enabled', () => {
    expect(verifyButton({ ...base, state: 'results', firstRun: false, reverifyCount: 0, variants: { kind: 'pending' } })).toEqual({
      label: 'Verify variants · free', disabled: false,
    });
  });

  it('fields and variants both pending: the label gains "and variants"', () => {
    expect(verifyButton({ ...base, state: 'results', firstRun: false, reverifyCount: 2, aiAvailable: false, variants: { kind: 'pending' } })).toEqual({
      label: 'Re-verify 2 fields and variants · free', disabled: false,
    });
  });

  it('first run with variants pending: the label gains "and variants"', () => {
    expect(verifyButton({ ...base, aiAvailable: false, variants: { kind: 'pending' } })).toEqual({
      label: 'Verify 8 fields and variants · free', disabled: false,
    });
  });

  it('blocked with no field to run: the variants-only label, disabled, with the reason', () => {
    expect(verifyButton({ ...base, state: 'results', firstRun: false, reverifyCount: 0, variants: { kind: 'blocked', reason: 'Confirm the variants of every product' } })).toEqual({
      label: 'Verify variants · free', disabled: true, reason: 'Confirm the variants of every product',
    });
  });

  it('blocked with a field run possible: fields verify, the reason shows beside it', () => {
    expect(verifyButton({ ...base, variants: { kind: 'blocked', reason: 'Confirm the variants of every product' } })).toEqual({
      label: 'Verify 8 fields · up to $0.25', disabled: false, reason: 'Confirm the variants of every product',
    });
  });

  it('done or none: unchanged from the no-variants behaviour', () => {
    expect(verifyButton({ ...base, variants: { kind: 'done' } })).toEqual({ label: 'Verify 8 fields · up to $0.25', disabled: false });
    expect(verifyButton({ ...base, variants: { kind: 'none' } })).toEqual({ label: 'Verify 8 fields · up to $0.25', disabled: false });
  });
});

function fv(passed: boolean) {
  return { key: 'k', cells: {}, certified: passed ? [{}] : [], weakEvidence: false, aiCalled: false, incomplete: false };
}
