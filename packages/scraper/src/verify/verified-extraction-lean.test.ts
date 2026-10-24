// runVerifiedExtraction with a run's lean state (spec 2026-10-23 run speed §3.3): a lean capture first, today's
// full capture when the rules say so, and everything written from the capture that was used. No Chromium: a fake
// browser answers each capture from a script and records what it was asked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CaptureOptions, IBrowser, PageCapture, CaptureVerdict } from '@robot/browser';
import { runVerifiedExtraction, type VerifiedField } from './verified-extraction.js';
import { newLeanRunState } from './lean-run.js';
import { CaptureProblemError } from './capture-check.js';
import { _resetBackoffForTests } from '../domain-lock.js';

const URL_ = 'https://shop.example/p/1';
const DESC = '//div[@class="desc"]/p';
const RATING = '//span[@class="score"]';
const NAME: VerifiedField = { key: 'name', type: 'text', concept: 'name', paths: [{ source: 'json-ld', path: 'name', transform: 'identity' }] };
const DESCRIPTION: VerifiedField = { key: 'description', type: 'text', concept: 'description', paths: [{ source: 'xpath', path: DESC, transform: 'identity' }] };
const RATING_F: VerifiedField = { key: 'rating', type: 'number', concept: 'rating', paths: [{ source: 'xpath', path: RATING, transform: 'identity' }] };
const FIELDS = [NAME, DESCRIPTION, RATING_F];

/** `probe` undefined: the live final probe threw. */
type Page = { probe: Record<string, string | null> | undefined; text: string; heading?: string; verdict?: CaptureVerdict };
function capture(p: Page, mode: 'lean' | 'full'): PageCapture {
  return {
    url: URL_, html: `<html><body><h1>${p.heading ?? 'Lamp'}</h1><p>${p.text}</p></body></html>`, markdown: '', screenshot: Buffer.alloc(0), screenshotTiles: [],
    title: 'Lamp', timestamp: 0, structuredData: { ldJson: [{ name: 'Lamp' }], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [], verdict: p.verdict ?? { kind: 'ok', status: 200 }, mode,
    timings: { navigateMs: 1, readyMs: 0, readyState: 'ready', totalMs: mode === 'lean' ? 2000 : 6000 },
    ...(mode === 'lean' ? { probe: p.probe } : {}),
  };
}
/** The fake browser: `lean` answers lean captures, `full` answers full ones and their second render. */
function fakeBrowser(lean: Page, full: Page) {
  const asked: CaptureOptions[] = [];
  const browser = {
    capture: async (_u: string, o: CaptureOptions = {}) => { asked.push(o); return capture(o.lean ? lean : full, o.lean ? 'lean' : 'full'); },
    setContentEvaluate: async () => full.probe,
  } as unknown as IBrowser;
  return { browser, asked };
}
const noLock = async () => () => {};
const agreed: Page = { probe: { [DESC]: 'Long text', [RATING]: '4.1' }, text: 'Lamp Long text 4.1' };

beforeEach(() => { _resetBackoffForTests(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('runVerifiedExtraction — lean', () => {
  it('past its checks, a complete lean read is written alone: one capture, no second render', async () => {
    const { browser, asked } = fakeBrowser(agreed, agreed);
    const state = newLeanRunState({ checks: 0 });
    const r = await runVerifiedExtraction({ url: URL_, fields: FIELDS }, { browser, acquireLock: noLock, lean: state });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.lean).toEqual({ expand: true });
    expect(typeof asked[0]!.finalProbe).toBe('string');
    expect(r.data).toEqual({ name: 'Lamp', description: 'Long text', rating: 4.1 });
    expect(r.lean).toEqual({ mode: 'lean', reason: null, fields: [], leanMs: 2000 });
    expect(r.capture?.mode).toBe('lean');
  });

  it('a website with no certified XPath skips the expand pass', async () => {
    const { browser, asked } = fakeBrowser(agreed, agreed);
    await runVerifiedExtraction({ url: URL_, fields: [NAME] }, { browser, acquireLock: noLock, lean: newLeanRunState({ checks: 0 }) });
    expect(asked[0]!.lean).toEqual({ expand: false });
  });

  it('lean+full: data, shown and stats all come from the full capture (a rescued miss never counts against its path)', async () => {
    const lean: Page = { probe: { [DESC]: 'Long text', [RATING]: null }, text: 'Lamp Long text' };
    const { browser, asked } = fakeBrowser(lean, agreed);
    const r = await runVerifiedExtraction({ url: URL_, fields: FIELDS }, { browser, acquireLock: noLock, lean: newLeanRunState({ checks: 0 }) });
    expect(asked).toHaveLength(2);
    expect(asked[1]!.lean).toBeUndefined();
    expect(asked[1]!.pictures).toBe(false);
    expect(r.data.rating).toBe(4.1);
    expect(r.stats.filter((s) => s.key === 'rating')).toEqual([expect.objectContaining({ hit: true, value: 4.1 })]);
    expect(r.lean).toEqual({ mode: 'lean+full', reason: 'miss', fields: ['rating'], leanMs: 2000 });
    expect(r.capture?.mode).toBe('full');
  });

  it('a check item whose lean value differs writes the full value and switches the run to full', async () => {
    const lean: Page = { probe: { [DESC]: 'Long te…', [RATING]: '4.1' }, text: 'Lamp Long te… 4.1' };
    const { browser } = fakeBrowser(lean, agreed);
    const state = newLeanRunState();
    const r = await runVerifiedExtraction({ url: URL_, fields: FIELDS }, { browser, acquireLock: noLock, lean: state });
    expect(r.data.description).toBe('Long text');
    expect(r.lean).toEqual({ mode: 'lean+full', reason: 'check', fields: ['description'], leanMs: 2000 });
    expect(state.mode).toBe('full');
    const next = fakeBrowser(agreed, agreed);
    const r2 = await runVerifiedExtraction({ url: URL_, fields: FIELDS }, { browser: next.browser, acquireLock: noLock, lean: state });
    expect(next.asked).toHaveLength(1);
    expect(next.asked[0]!.lean).toBeUndefined();
    expect(r2.lean).toEqual({ mode: 'full', reason: 'switched', fields: [], leanMs: null });
  });

  it('a lean wall is thrown with its sentence and never loaded twice', async () => {
    const wall: Page = { ...agreed, verdict: { kind: 'challenge', status: 403 } };
    const { browser, asked } = fakeBrowser(wall, agreed);
    await expect(runVerifiedExtraction({ url: URL_, fields: FIELDS }, { browser, acquireLock: noLock, lean: newLeanRunState({ checks: 0 }) })).rejects.toBeInstanceOf(CaptureProblemError);
    expect(asked).toHaveLength(1);
  });

  it('another non-ok lean verdict takes the full capture, whose verdict decides', async () => {
    const blank: Page = { ...agreed, verdict: { kind: 'blank', status: 200 } };
    const { browser, asked } = fakeBrowser(blank, agreed);
    const r = await runVerifiedExtraction({ url: URL_, fields: FIELDS }, { browser, acquireLock: noLock, lean: newLeanRunState({ checks: 0 }) });
    expect(asked).toHaveLength(2);
    expect(r.lean).toEqual({ mode: 'lean+full', reason: 'verdict', fields: [], leanMs: 2000 });
  });

  it('a lean probe that threw takes the full capture, even for a field whose lean miss is trusted', async () => {
    const { browser, asked } = fakeBrowser({ probe: undefined, text: 'Lamp' }, agreed);
    const state = newLeanRunState({ checks: 0 });
    state.confirmed.set('rating', 3);
    const r = await runVerifiedExtraction({ url: URL_, fields: FIELDS }, { browser, acquireLock: noLock, lean: state });
    expect(asked).toHaveLength(2);
    expect(r.data).toEqual({ name: 'Lamp', description: 'Long text', rating: 4.1 });
    expect(r.lean).toEqual({ mode: 'lean+full', reason: 'miss', fields: ['description', 'rating'], leanMs: 2000 });
    // A failed probe read nothing: it is not evidence about any field.
    expect(state.confirmed.get('rating')).toBe(3);
    expect(state.mode).toBe('lean');
  });

  it('a lean value the page does not show takes the full capture (unshown)', async () => {
    // The JSON-LD name is not on the lean page's text (XPath values always count as shown).
    const lean: Page = { probe: agreed.probe, text: 'Long text 4.1', heading: 'Offer' };
    const { browser, asked } = fakeBrowser(lean, agreed);
    const r = await runVerifiedExtraction({ url: URL_, fields: FIELDS }, { browser, acquireLock: noLock, lean: newLeanRunState({ checks: 0 }) });
    expect(asked).toHaveLength(2);
    expect(r.shown.name).toBe(true);
    expect(r.lean).toEqual({ mode: 'lean+full', reason: 'unshown', fields: ['name'], leanMs: 2000 });
  });

  it('a field with a default whose lean read misses takes the full capture, never the default', async () => {
    const lean: Page = { probe: { [DESC]: 'Long text', [RATING]: null }, text: 'Lamp Long text' };
    const { browser, asked } = fakeBrowser(lean, agreed);
    const fields = [NAME, DESCRIPTION, { ...RATING_F, defaultValue: '0' }];
    const r = await runVerifiedExtraction({ url: URL_, fields }, { browser, acquireLock: noLock, lean: newLeanRunState({ checks: 0 }) });
    expect(asked).toHaveLength(2);
    expect(r.data.rating).toBe(4.1);
    expect(r.defaulted).toEqual([]);
    expect(r.lean).toEqual({ mode: 'lean+full', reason: 'miss', fields: ['rating'], leanMs: 2000 });
  });

  it('a miss item that also disagreed names both in its fields', async () => {
    const lean: Page = { probe: { [DESC]: 'Long te…', [RATING]: null }, text: 'Lamp Long te…' };
    const { browser } = fakeBrowser(lean, agreed);
    const state = newLeanRunState({ checks: 0 });
    const r = await runVerifiedExtraction({ url: URL_, fields: FIELDS }, { browser, acquireLock: noLock, lean: state });
    expect(r.lean).toEqual({ mode: 'lean+full', reason: 'miss', fields: ['rating', 'description'], leanMs: 2000 });
    expect(state.mode).toBe('full');
  });

  it('a website with variants: every item takes today\'s capture (no pictures), never a lean one (final review I1)', async () => {
    const { browser, asked } = fakeBrowser(agreed, agreed);
    const state = newLeanRunState({ variants: true, checks: 0 });
    for (let i = 0; i < 3; i++) {
      const r = await runVerifiedExtraction({ url: URL_, fields: FIELDS }, { browser, acquireLock: noLock, lean: state });
      expect(r.lean).toEqual({ mode: 'full', reason: 'variants', fields: [], leanMs: null });
      expect(r.capture?.mode).toBe('full');
    }
    expect(asked).toHaveLength(3);
    expect(asked.every((o) => o.lean === undefined && o.finalProbe === undefined && o.pictures === false)).toBe(true);
    expect(state.counts).toEqual({ lean: 0, leanFull: { check: 0, miss: 0, unshown: 0, verdict: 0 }, full: 3 });
  });

  it('RUN_CAPTURE=full: today\'s capture without pictures, nothing lean', async () => {
    const { browser, asked } = fakeBrowser(agreed, agreed);
    const r = await runVerifiedExtraction({ url: URL_, fields: FIELDS }, { browser, acquireLock: noLock, lean: newLeanRunState({ off: true }) });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ pictures: false });
    expect(asked[0]!.lean).toBeUndefined();
    expect(r.lean).toEqual({ mode: 'full', reason: 'off', fields: [], leanMs: null });
  });

  it('without a lean state: exactly today\'s capture options (pictures on), and no outcome', async () => {
    const { browser, asked } = fakeBrowser(agreed, agreed);
    const r = await runVerifiedExtraction({ url: URL_, fields: FIELDS }, { browser, acquireLock: noLock });
    expect(asked[0]!.pictures).toBeUndefined();
    expect(asked[0]!.lean).toBeUndefined();
    expect(r.lean).toBeUndefined();
  });
});
