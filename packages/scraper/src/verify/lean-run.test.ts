// The per-run rules that decide when a lean read is enough (spec 2026-10-23 run speed §3.3–3.4). Pure: no browser.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { newLeanRunState, leanRunStateFromEnv, fallbackFor, learn, recordOutcome, leanSummary, type FieldReading } from './lean-run.js';

// The switch logs one [lean] line by design; keep the test output clean.
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

const r = (key: string, value: unknown, shown: boolean | null = null, hasPaths = true): FieldReading => ({ key, value, shown, hasPaths });

describe('fallbackFor', () => {
  it('asks for the full capture on the run\'s check items whatever the lean read', () => {
    const s = newLeanRunState();
    expect(fallbackFor(s, [r('price', 12)])).toEqual({ reason: 'check', fields: [] });
  });
  it('past the checks: a field with paths that read nothing is a miss; one without paths is not', () => {
    const s = newLeanRunState({ checks: 0 });
    expect(fallbackFor(s, [r('price', 12), r('rating', null), r('ghost', null, null, false)])).toEqual({ reason: 'miss', fields: ['rating'] });
  });
  it('a value flagged not shown asks for the full capture', () => {
    const s = newLeanRunState({ checks: 0 });
    expect(fallbackFor(s, [r('sku', 'A1', false)])).toEqual({ reason: 'unshown', fields: ['sku'] });
  });
  it('nothing missing, nothing unshown: the lean read is enough', () => {
    expect(fallbackFor(newLeanRunState({ checks: 0 }), [r('price', 12, true), r('img', 'x', null)])).toBeNull();
  });
});

describe('learn', () => {
  it('a check item that agrees uses up one check', () => {
    const s = newLeanRunState();
    expect(learn(s, [r('price', 12, true)], [r('price', 12, true)], { check: true, url: 'u' })).toEqual({ disagreed: [], rescued: [] });
    expect(s.checksLeft).toBe(1);
    expect(s.mode).toBe('lean');
  });
  it('a lean value that differs, or one the full capture does not have, is a disagreement and switches the run to full', () => {
    const s = newLeanRunState();
    expect(learn(s, [r('desc', 'Short…'), r('brand', 'B')], [r('desc', 'Short and long'), r('brand', null)], { check: true, url: 'https://x/p/3' }).disagreed).toEqual(['desc', 'brand']);
    expect(s.mode).toBe('full');
    expect(s.why).toBe('switched');
    expect(s.note).toContain('https://x/p/3');
  });
  it('a lean "shown" the full capture does not confirm is a disagreement', () => {
    const s = newLeanRunState();
    expect(learn(s, [r('sku', 'A1', true)], [r('sku', 'A1', false)], { check: false, url: 'u' }).disagreed).toEqual(['sku']);
  });
  it('three items in a row with a rescue switch the run to full; an item without one resets the streak', () => {
    const s = newLeanRunState({ checks: 0 });
    learn(s, [r('stock', null)], [r('stock', 'In stock')], { check: false, url: 'u1' });
    learn(s, [r('stock', null)], [r('stock', 'In stock')], { check: false, url: 'u2' });
    learn(s, [r('stock', 'In stock')], [r('stock', 'In stock')], { check: false, url: 'u3' });
    expect(s.rescueStreak).toBe(0);
    for (const u of ['u4', 'u5']) learn(s, [r('stock', null)], [r('stock', 'In stock')], { check: false, url: u });
    expect(s.mode).toBe('lean');
    learn(s, [r('stock', null)], [r('stock', 'In stock')], { check: false, url: 'u6' });
    expect(s.mode).toBe('full');
  });
  it('an item written lean (no rescue) resets the rescue streak', () => {
    const s = newLeanRunState({ checks: 0 });
    learn(s, [r('stock', null)], [r('stock', 'In stock')], { check: false, url: 'u1' });
    learn(s, [r('stock', null)], [r('stock', 'In stock')], { check: false, url: 'u2' });
    recordOutcome(s, { mode: 'lean', reason: null, fields: [], leanMs: 2000 });
    expect(s.rescueStreak).toBe(0);
    learn(s, [r('stock', null)], [r('stock', 'In stock')], { check: false, url: 'u3' });
    expect(s.mode).toBe('lean');
  });
  it('three confirmed misses: the field\'s next lean miss is trusted; a rescue un-confirms it', () => {
    const s = newLeanRunState({ checks: 0 });
    for (const u of ['a', 'b', 'c']) learn(s, [r('rating', null)], [r('rating', null)], { check: false, url: u });
    expect(fallbackFor(s, [r('rating', null)])).toBeNull();
    learn(s, [r('rating', null)], [r('rating', 4.1)], { check: false, url: 'd' });
    expect(fallbackFor(s, [r('rating', null)])).toEqual({ reason: 'miss', fields: ['rating'] });
  });
  it('three confirmed not-shown flags trust the field\'s lean flag', () => {
    const s = newLeanRunState({ checks: 0 });
    for (const u of ['a', 'b', 'c']) learn(s, [r('sku', 'A', false)], [r('sku', 'A', false)], { check: false, url: u });
    expect(fallbackFor(s, [r('sku', 'B', false)])).toBeNull();
  });
});

describe('state, counts, summary', () => {
  it('RUN_CAPTURE=full starts every run on the full capture', () => {
    expect(leanRunStateFromEnv({ RUN_CAPTURE: ' Full ' })).toMatchObject({ mode: 'full', why: 'off' });
    expect(leanRunStateFromEnv({})).toMatchObject({ mode: 'lean', why: null, checksLeft: 2 });
  });
  it('counts each outcome and says them in one line', () => {
    const s = newLeanRunState();
    recordOutcome(s, { mode: 'lean', reason: null, fields: [], leanMs: 2000 });
    recordOutcome(s, { mode: 'lean+full', reason: 'check', fields: [], leanMs: 2000 });
    recordOutcome(s, { mode: 'lean+full', reason: 'miss', fields: ['rating'], leanMs: 2000 });
    recordOutcome(s, { mode: 'full', reason: 'switched', fields: [], leanMs: null });
    expect(leanSummary('r1', s)).toBe('run r1: lean 1, lean+full 2 (check 1, miss 1, unshown 0, verdict 0), full 1');
  });
});
