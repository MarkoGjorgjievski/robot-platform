import { describe, expect, it } from 'vitest';
import { verifySteps } from './verify-steps';

const base = { products: 3, accepted: 0, total: 3, busy: false, stage: null, extract: false, variants: false };
const states = (a: Parameters<typeof verifySteps>[0]) => verifySteps(a).map((s) => s.state);

describe('verifySteps', () => {
  it('starts on Products until three have a page', () => {
    expect(states({ ...base, products: 2 })).toEqual(['now', 'next', 'next', 'next']);
    expect(verifySteps({ ...base, products: 2 })[0]!.sub).toBe('2 of 3');
  });

  it('is on Check values while a field is not accepted', () => {
    expect(states({ ...base, accepted: 2 })).toEqual(['done', 'now', 'next', 'next']);
    expect(verifySteps({ ...base, accepted: 2 })[1]!.sub).toBe('2 of 3 accepted');
  });

  it('is on Verify once every field is accepted, and says the running stage', () => {
    expect(states({ ...base, accepted: 3 })).toEqual(['done', 'done', 'now', 'next']);
    const running = verifySteps({ ...base, accepted: 3, busy: true, stage: 'Taking screenshot 2 of 3…' });
    expect(running[2]).toEqual({ name: 'Verify', sub: 'Taking screenshot 2 of 3…', state: 'now' });
  });

  it('is on Extract once the verification stands', () => {
    const steps = verifySteps({ ...base, accepted: 3, extract: true });
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'now']);
    expect(steps[2]!.sub).toBe('Verified');
    expect(steps[3]!.sub).toBe('Ready');
  });

  it('says when the verification that stands finished, and only while it stands', () => {
    expect(verifySteps({ ...base, accepted: 3, extract: true, verifiedAt: '13 Nov, 20:32' })[2]!.sub).toBe('Verified 13 Nov, 20:32');
    expect(verifySteps({ ...base, accepted: 2, extract: true, verifiedAt: '13 Nov, 20:32' })[2]!.sub).toBe('Every field');
  });

  it('an edit after a passing Verify goes back to Check values; Extract still reads Ready', () => {
    const steps = verifySteps({ ...base, accepted: 2, extract: true });
    expect(steps.map((s) => s.state)).toEqual(['done', 'now', 'next', 'next']);
    expect(steps[3]!.sub).toBe('Ready');
  });

  it('a re-verify of a verified website is on Verify, not Extract', () => {
    expect(states({ ...base, accepted: 3, extract: true, busy: true })).toEqual(['done', 'done', 'now', 'next']);
  });

  it('never has more or fewer than one step to work on', () => {
    for (const products of [0, 3]) for (const accepted of [0, 3]) for (const extract of [false, true]) {
      expect(states({ ...base, products, accepted, extract }).filter((s) => s === 'now')).toHaveLength(1);
    }
  });
});
