import { describe, expect, it } from 'vitest';
import {
  AI_UNAVAILABLE_BADGE, CONFIRM_VARIANTS, FAILED_RUN_KEPT, FAILED_RUN_NOTHING_KEPT, NO_FIELDS, NOT_VERIFIED_BADGE, PAGE_NOT_READ,
  SCREENSHOT_COULD_NOT_START, SCREENSHOT_TOO_LONG, VERIFY_COULD_NOT_START,
  aiUnavailableHint, captureErrorText, failedRunSentence, notCheckedText, problemSentence, refusalFromError, refusalSentence, stageText, verifyMessage,
  type VerifyProblemLike,
} from './verify-messages';
import { hintFor, type FailReason } from './verification-view';

describe('a refused Verify in customer words (spec 2026-10-20 §3.2)', () => {
  it('a blank required cell', () => {
    expect(problemSentence({ reason: 'blank', field: 'Rating', product: 3 })).toBe('Rating on product 3 needs a value, or "Not on this product". Nothing was checked.');
  });
  it('too few values', () => {
    expect(problemSentence({ reason: 'too_few_values', field: 'Brand' })).toBe('Brand needs a value on at least two products, or "not on this product" on every one.');
  });
  it('no fields, variants, anything else', () => {
    expect(problemSentence({ reason: 'no_fields' })).toBe('This website has no fields yet. Add fields to the project, then verify.');
    expect(problemSentence({ reason: 'variants' })).toBe('Confirm the variants of every product first');
    expect(problemSentence({ reason: 'other' })).toBe('Verify could not start. Try again; if it keeps happening, contact us.');
  });
  it('says the first problem it can name', () => {
    expect(refusalSentence([{ reason: 'bogus' }, { reason: 'blank', field: 'Rating', product: 3 }, { reason: 'other' }])).toBe(problemSentence({ reason: 'blank', field: 'Rating', product: 3 }));
    expect(refusalSentence([])).toBe(VERIFY_COULD_NOT_START);
    expect(refusalSentence([{ reason: 'blank', field: '', product: 3 }])).toBe(VERIFY_COULD_NOT_START);
  });
  it('names a field before "could not start", whatever the order (a blank cell that is also marked comes as a blank and an other)', () => {
    expect(refusalSentence([{ reason: 'other' }, { reason: 'blank', field: 'Rating', product: 3 }])).toBe(problemSentence({ reason: 'blank', field: 'Rating', product: 3 }));
    expect(refusalSentence([{ reason: 'other' }])).toBe(VERIFY_COULD_NOT_START);
  });
  it("reads the server's problems off a tRPC error", () => {
    expect(refusalFromError({ message: 'Verify could not start', data: { verifyProblems: [{ reason: 'too_few_values', field: 'Brand' }] } })).toBe(problemSentence({ reason: 'too_few_values', field: 'Brand' }));
  });
  it('a Verify error without problems says could-not-start, never its message', () => {
    expect(refusalFromError(new Error('Price @ https://shop.example/p/1: Expected value is required'))).toBe(VERIFY_COULD_NOT_START);
    expect(refusalFromError({ message: 'Failed to fetch', data: { verifyProblems: null } })).toBe(VERIFY_COULD_NOT_START);
    expect(refusalFromError(null)).toBe(VERIFY_COULD_NOT_START);
    expect(refusalFromError('boom')).toBe(VERIFY_COULD_NOT_START);
  });
});

describe('the Verify bar message (spec 2026-10-20 §3.1, §3.3)', () => {
  it('a failed run keeps the results it had', () => {
    expect(failedRunSentence(true)).toBe('Verify stopped before it finished. Your last results are kept — try again.');
    expect(failedRunSentence(false)).toBe(FAILED_RUN_NOTHING_KEPT);
  });
  it('shows the newest message, and nothing while a Verify runs', () => {
    expect(verifyMessage({ refusal: null, failedRun: null, hasResults: true, running: false })).toBeNull();
    expect(verifyMessage({ refusal: null, failedRun: { id: 'r' }, hasResults: true, running: false })).toBe(FAILED_RUN_KEPT);
    expect(verifyMessage({ refusal: 'R', failedRun: { id: 'r' }, hasResults: true, running: false })).toBe('R');
    expect(verifyMessage({ refusal: 'R', failedRun: { id: 'r' }, hasResults: true, running: true })).toBeNull();
  });
});

describe('hints, badges and captures (spec 2026-10-20 §3.3, §3.5)', () => {
  it('the ai_unavailable hint', () => {
    expect(aiUnavailableHint('Description')).toBe("We couldn't finish checking Description this time. Verify again — nothing else changed.");
  });
  it('not checked on a product, with its reason', () => {
    expect(notCheckedText(2, 'shop.example did not answer in time.')).toBe('Not checked on product 2 — shop.example did not answer in time.');
    expect(notCheckedText(2, undefined)).toBe(`Not checked on product 2 — ${PAGE_NOT_READ}.`);
    expect(notCheckedText(2, 'not captured')).toBe(`Not checked on product 2 — ${PAGE_NOT_READ}.`);
  });
  it('notCheckedText never repeats raw library text', () => {
    for (const raw of ['page.goto: Timeout 60000ms exceeded.', 'Error: net::ERR_CONNECTION_RESET at https://x', 'browserType.launch: Target closed\n    at Object.launch', 'stalled', 'x'.repeat(300)]) {
      expect(notCheckedText(4, raw)).toBe(`Not checked on product 4 — ${PAGE_NOT_READ}.`);
    }
  });
  it('a capture error: stalled in words; a verdict sentence as it is', () => {
    expect(captureErrorText('stalled')).toBe(SCREENSHOT_TOO_LONG);
    expect(captureErrorText(undefined)).toBeUndefined();
    expect(captureErrorText('shop.example did not answer in time.')).toBe('shop.example did not answer in time.');
    expect(SCREENSHOT_COULD_NOT_START).toBe('The screenshot could not start. Take it again.');
  });
  it('the stage line never shows a stage word, a key or "AI"', () => {
    const names = { price_eur: 'Price' };
    expect(stageText(null, names)).toBeNull();
    expect(stageText('starting', names)).toBe('Starting…');
    expect(stageText('capturing 2/3', names)).toBe('Taking screenshot 2 of 3…');
    expect(stageText('searching', names)).toBe('Looking for your values on the pages…');
    expect(stageText('asking AI for price_eur', names)).toBe('Taking a closer look at Price…');
    expect(stageText('asking AI for gone_key', names)).toBe('Taking a closer look at a field…');
    expect(stageText('checking variants', names)).toBe('Checking the variants…');
    expect(stageText('something new', names)).toBe('Verifying…');
  });
});

describe('no customer sentence names an internal (spec 2026-10-20 §5.4)', () => {
  const INTERNAL = [/https?:\/\//i, /@/, /\bHTTP\b/i, /\b[1-5]\d\d\b/, /price_eur/, /\bstalled\b/i, /\bsuperseded\b/i, /\bJev\b/, /\bAI\b/, /\bmodel\b/i, /\bError\b/, /\$\s?\d/, /\bundefined\b|\bnull\b/];
  const names = { price_eur: 'Price' };
  const problems: VerifyProblemLike[] = [{ reason: 'blank', field: 'Price', product: 2 }, { reason: 'too_few_values', field: 'Price' }, { reason: 'no_fields' }, { reason: 'variants' }, { reason: 'other' }];
  const reasons: FailReason[] = ['not_found', 'different_value', 'ambiguous', 'type_mismatch', 'no_fitting_path', 'found_unexpected', 'elsewhere'];
  const sentences: string[] = [
    VERIFY_COULD_NOT_START, NO_FIELDS, CONFIRM_VARIANTS, FAILED_RUN_KEPT, FAILED_RUN_NOTHING_KEPT, SCREENSHOT_TOO_LONG, SCREENSHOT_COULD_NOT_START, AI_UNAVAILABLE_BADGE, NOT_VERIFIED_BADGE,
    ...problems.map(problemSentence),
    refusalFromError(new Error('PRECONDITION_FAILED: price_eur @ https://shop.example/p/1: Expected value is required')),
    failedRunSentence(true), failedRunSentence(false),
    aiUnavailableHint('Price'),
    notCheckedText(2, 'page.goto: Timeout 60000ms exceeded.\n    at Page.goto'), notCheckedText(2, undefined),
    captureErrorText('stalled')!,
    ...['starting', 'capturing 2/3', 'searching', 'asking AI for price_eur', 'checking variants', 'something new'].map((s) => stageText(s, names)!),
    ...reasons.map((r) => hintFor(r, '12.50', 'a money amount', 'Price', 2)),
    hintFor('found_unexpected', undefined, undefined, 'Price', 2),
  ];
  it.each(sentences)('%s', (s) => {
    for (const re of INTERNAL) expect(s).not.toMatch(re);
  });
});
