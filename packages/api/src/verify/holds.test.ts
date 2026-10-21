import { describe, it, expect, vi } from 'vitest';
import type { IBrowser } from '@robot/browser';
import * as scraper from '@robot/scraper';
import type { CertifiedPath, FieldVerification, SchemaDefinitionField } from '@robot/scraper';
import { SHOP_EXAMPLE } from '../test-helpers/shop-example.js';
import { decideHolds, readingsOf, resultPasses, stillExtracts } from './holds.js';

const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };
const price: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' };
const browser = { setContentEvaluate: vi.fn(async () => ({})) } as unknown as IBrowser;

describe('readingsOf (spec 2026-10-21 §3.1)', () => {
  it('reads what a run writes on each captured page, with the path and whether the page shows it; no page load', async () => {
    const r = await readingsOf(browser, price, [LD], { [SHOP_EXAMPLE.p1.url]: SHOP_EXAMPLE.p1, 'https://gone.example/p/9': null });
    expect(r[SHOP_EXAMPLE.p1.url]).toEqual({ value: '129.99', path: LD, shown: true });
    expect(r['https://gone.example/p/9']).toBeUndefined();
  });
  it('reads null where no path resolves', async () => {
    const r = await readingsOf(browser, price, [{ source: 'json-ld', path: 'offers.nothing', transform: 'identity' }], { [SHOP_EXAMPLE.p1.url]: SHOP_EXAMPLE.p1 });
    expect(r[SHOP_EXAMPLE.p1.url]).toEqual({ value: null, path: null, shown: null });
  });
});

describe('stillExtracts', () => {
  const withPath = { certified: [LD] };
  it('is true when some captured page reads a value', () => {
    expect(stillExtracts(withPath, { a: { value: null, path: null, shown: null }, b: { value: '1', path: LD, shown: true } })).toBe(true);
  });
  it('is false when every captured page reads nothing', () => {
    expect(stillExtracts(withPath, { a: { value: null, path: null, shown: null } })).toBe(false);
  });
  it('Fix wave 1, item 1: no evidence, no hold — no page read is not "still extracts"', () => {
    expect(stillExtracts(withPath, {})).toBe(false);
  });
  it('is true when the result has no paths (default only, not on this website)', () => {
    expect(stillExtracts({ certified: [] }, { a: { value: null, path: null, shown: null } })).toBe(true);
    expect(stillExtracts({ certified: [] }, {})).toBe(true);
  });
});

describe('resultPasses', () => {
  const base: FieldVerification = { key: 'price', cells: { a: { status: 'pass', found: '1', path: LD } }, certified: [LD], weakEvidence: false, aiCalled: false, incomplete: false };
  it('passes a certified result whose every cell passed', () => expect(resultPasses(base)).toBe(true));
  it('fails one failing cell, no cells, or nothing certified', () => {
    expect(resultPasses({ ...base, cells: { a: { status: 'fail', reason: 'different_value' } } })).toBe(false);
    expect(resultPasses({ ...base, cells: {} })).toBe(false);
    expect(resultPasses({ ...base, certified: [] })).toBe(false);
    expect(resultPasses(undefined)).toBe(false);
  });
});

describe('decideHolds (spec 2026-10-21 §3.1)', () => {
  const U = [SHOP_EXAMPLE.p1.url, SHOP_EXAMPLE.p2.url];
  const caps = { [U[0]!]: SHOP_EXAMPLE.p1, [U[1]!]: SHOP_EXAMPLE.p2 };
  const set = { urls: U, expected: { price: { [U[0]!]: '1.00', [U[1]!]: '2.00' } } };
  const passed: FieldVerification = { key: 'price', cells: { [U[0]!]: { status: 'pass', found: '1', path: LD } }, certified: [LD], weakEvidence: false, aiCalled: false, incomplete: false };
  const failed: FieldVerification = { ...passed, certified: [], cells: { [U[0]!]: { status: 'fail', reason: 'different_value', found: '129.99' } } };
  const now = (f: SchemaDefinitionField) => scraper.fieldHash(f, set);
  const certifying = (hashes: string[], result = passed) => () => ({ result, verificationId: 'v0', verifiedAt: new Date('2026-10-12T00:00:00Z'), fieldHashes: hashes });
  const base = { fields: [price], set, keys: ['price'], captures: caps, browser, failedVerificationId: 'v1' };

  it('a passing field ends its hold', async () => {
    const plan = await decideHolds({ ...base, outcome: { price: passed }, certifying: certifying([now(price)]) });
    expect(plan.remove).toEqual(['price']);
    expect(plan.upsert).toEqual([]);
  });
  it('a failing field whose last good path still reads is held, from its certifying result', async () => {
    const plan = await decideHolds({ ...base, outcome: { price: failed }, certifying: certifying([now(price)]) });
    expect(plan.upsert).toEqual([{ fieldKey: 'price', result: passed, verificationId: 'v0', verifiedAt: new Date('2026-10-12T00:00:00Z'), failedVerificationId: 'v1', fieldHashes: [now(price)] }]);
    expect(plan.readings.price![U[0]!]!.value).toBe('129.99');
  });
  it('Review Focus 4: a path that reads on one page and nothing on another keeps the hold', async () => {
    const half = { ...SHOP_EXAMPLE.p2, structuredData: { ...SHOP_EXAMPLE.p2.structuredData, ldJson: [] } };
    const plan = await decideHolds({ ...base, captures: { [U[0]!]: SHOP_EXAMPLE.p1, [U[1]!]: half }, outcome: { price: failed }, certifying: certifying([now(price)]) });
    expect(plan.upsert.map((h) => h.fieldKey)).toEqual(['price']);
  });
  it('a path that reads nothing anywhere is not held', async () => {
    const gone = { source: 'json-ld' as const, path: 'offers.nothing', transform: 'identity' as const };
    const plan = await decideHolds({ ...base, outcome: { price: failed }, certifying: certifying([now(price)], { ...passed, certified: [gone] }) });
    expect(plan.upsert).toEqual([]);
    expect(plan.remove).toEqual(['price']);
  });
  it('a field the customer changed since its pass, or one that never passed, is not held', async () => {
    expect((await decideHolds({ ...base, outcome: { price: failed }, certifying: certifying(['an-older-hash']) })).upsert).toEqual([]);
    expect((await decideHolds({ ...base, outcome: { price: failed }, certifying: () => null })).upsert).toEqual([]);
  });
  it('a hold is only ever written from a result that passes (Task 3 review)', async () => {
    const plan = await decideHolds({ ...base, outcome: { price: failed }, certifying: certifying([now(price)], failed) });
    expect(plan.upsert).toEqual([]);
    expect(plan.remove).toEqual(['price']);
  });
  it('Fix wave 1, item 1: captures {} -> not held (no evidence)', async () => {
    const plan = await decideHolds({ ...base, captures: {}, outcome: { price: failed }, certifying: certifying([now(price)]) });
    expect(plan.upsert).toEqual([]);
    expect(plan.remove).toEqual(['price']);
    expect(plan.why.price).toBe('no-evidence');
  });
  it('Fix wave 1, item 1: pages that did not load (null captures) are no evidence either', async () => {
    const plan = await decideHolds({ ...base, captures: { [U[0]!]: null, [U[1]!]: null }, outcome: { price: failed }, certifying: certifying([now(price)]) });
    expect(plan.upsert).toEqual([]);
    expect(plan.why.price).toBe('no-evidence');
  });
  it('spec §3.1: a live Verify that could capture no page keeps the hold only when it asks to (nothing learned)', async () => {
    const plan = await decideHolds({ ...base, captures: { [U[0]!]: null }, outcome: { price: failed }, certifying: certifying([now(price)]), nothingCaptured: 'hold' });
    expect(plan.upsert.map((h) => h.fieldKey)).toEqual(['price']);
    expect(plan.why.price).toBe('held');
  });
  it('says why for every field: passed, held, no certifying result, reads nothing', async () => {
    expect((await decideHolds({ ...base, outcome: { price: passed }, certifying: certifying([now(price)]) })).why).toEqual({ price: 'passed' });
    expect((await decideHolds({ ...base, outcome: { price: failed }, certifying: certifying([now(price)]) })).why).toEqual({ price: 'held' });
    expect((await decideHolds({ ...base, outcome: { price: failed }, certifying: () => null })).why).toEqual({ price: 'no-certifying' });
    const gone = { source: 'json-ld' as const, path: 'offers.nothing', transform: 'identity' as const };
    expect((await decideHolds({ ...base, outcome: { price: failed }, certifying: certifying([now(price)], { ...passed, certified: [gone] }) })).why).toEqual({ price: 'reads-nothing' });
  });
  it('touches only the fields this Verify checked', async () => {
    const plan = await decideHolds({ ...base, keys: [], outcome: { price: failed }, certifying: certifying([now(price)]) });
    expect(plan).toEqual({ upsert: [], remove: [], readings: {}, why: {} });
  });
});
