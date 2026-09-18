import { describe, it, expect } from 'vitest';
import { definitionHash, fieldHash } from './run-verification.js';
import { gatherCandidates } from './certify.js';
import { loadShopExample, SHOP_EXAMPLE_URLS as U } from '../__fixtures__/verify/load.js';
import type { SchemaDefinitionField, VerificationSet, Mark } from './types.js';

const price: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: 'the price', concept: 'price' };
const expected = { [U[0]!]: '129.99', [U[1]!]: '219.99', [U[2]!]: '149.00' };
const base: VerificationSet = { urls: U, expected: { price: expected } };
const mark: Mark = { xpaths: ['//*[@id="main"]/div[@class="price-box"]/span[@class="now"]'], text: '$129.99', rect: { x: 1, y: 2, w: 3, h: 4 } };

describe('hashes with marks', () => {
  it('a set without marks hashes exactly as before marks existed', () => {
    expect(fieldHash(price, base)).toBe(fieldHash(price, { ...base, marks: {} }));
    expect(definitionHash([price], base)).toBe(definitionHash([price], { ...base, marks: {} }));
  });
  it('a mark changes the field hash; moving its rect does not', () => {
    const withMark = { ...base, marks: { price: { [U[0]!]: mark } } };
    expect(fieldHash(price, withMark)).not.toBe(fieldHash(price, base));
    const moved = { ...base, marks: { price: { [U[0]!]: { ...mark, rect: { x: 9, y: 9, w: 9, h: 9 } } } } };
    expect(fieldHash(price, moved)).toBe(fieldHash(price, withMark));
    const otherPath = { ...base, marks: { price: { [U[0]!]: { ...mark, xpaths: ['//body/span'] } } } };
    expect(fieldHash(price, otherPath)).not.toBe(fieldHash(price, withMark));
  });
  it('a mark on another field leaves this field alone', () => {
    const other = { ...base, marks: { title: { [U[0]!]: mark } } };
    expect(fieldHash(price, other)).toBe(fieldHash(price, base));
  });
});

describe('gatherCandidates with marks', () => {
  it('a marked page contributes the mark and skips the DOM search; unmarked pages are searched', async () => {
    const searched: string[] = [];
    const runDomSearch = async (_html: string, _n: unknown, pageUrl: string) => { searched.push(pageUrl); return []; };
    const { candidates } = await gatherCandidates(price, expected, loadShopExample(), { runDomSearch, marks: { [U[0]!]: mark } });
    expect(searched).toEqual([U[1], U[2]]);
    expect(candidates).toContainEqual({ source: 'xpath', path: mark.xpaths[0], transform: 'identity' });
    expect(candidates.some((c) => c.source === 'json-ld' && c.path === 'offers.price')).toBe(true); // structured search still runs on the marked page
  });
});
