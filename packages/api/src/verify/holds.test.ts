import { describe, it, expect, vi } from 'vitest';
import type { IBrowser } from '@robot/browser';
import type { CertifiedPath, FieldVerification, SchemaDefinitionField } from '@robot/scraper';
import { SHOP_EXAMPLE } from '../test-helpers/shop-example.js';
import { readingsOf, resultPasses, stillExtracts } from './holds.js';

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
  it('is true when nothing was captured (nothing learned) or the result has no paths', () => {
    expect(stillExtracts(withPath, {})).toBe(true);
    expect(stillExtracts({ certified: [] }, { a: { value: null, path: null, shown: null } })).toBe(true);
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
