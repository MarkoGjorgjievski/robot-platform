import { describe, it, expect } from 'vitest';
import { bindingInput, bindingProblems, prepareBinding } from './binding-input.js';
import type { ContractField } from '../contract.js';

const U = ['https://shop.example/p/1', 'https://shop.example/p/2', 'https://shop.example/p/3'];
const contract: ContractField[] = [{ key: 'price', name: 'Price', type: 'money', concept: 'price' }, { key: 'title', name: 'Title', type: 'text', concept: 'product_name' }];
const ok = {
  sourceId: '00000000-0000-0000-0000-000000000000', urls: U,
  descriptions: { price: 'green', title: 'h1' },
  expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' }, title: { [U[0]!]: 'a', [U[1]!]: 'b', [U[2]!]: 'c' } },
};

describe('bindingProblems', () => {
  it('is clean for a complete binding', () => expect(bindingProblems(ok, contract)).toEqual([]));
  it('names every gap', () => {
    expect(bindingProblems({ ...ok, urls: [U[0]!, U[1]!, 'https://other.example/p'] }, contract)).toContain('All URLs must be on the same website');
    expect(bindingProblems({ ...ok, urls: [U[0]!, U[0]!, U[2]!] }, contract)).toContain('URLs must be different pages');
    expect(bindingProblems({ ...ok, descriptions: { price: 'green' } }, contract)).toContain('Title: say where it is on this website');
    expect(bindingProblems({ ...ok, expected: { ...ok.expected, price: { [U[0]!]: 'call us', [U[1]!]: '2', [U[2]!]: '3' } } }, contract)).toEqual(expect.arrayContaining([expect.stringContaining('Price @ https://shop.example/p/1: Not a money amount')]));
    expect(bindingProblems({ ...ok, expected: { ...ok.expected, title: { [U[0]!]: '', [U[1]!]: 'b', [U[2]!]: 'c' } } }, contract)).toEqual(expect.arrayContaining([expect.stringContaining('Title @ https://shop.example/p/1: Expected value is required')]));
  });
  it('ignores keys that are not in the contract', () => {
    expect(bindingProblems({ ...ok, descriptions: { ...ok.descriptions, ghost: 'x' }, expected: { ...ok.expected, ghost: {} } }, contract)).toEqual([]);
  });
});

describe('prepareBinding', () => {
  it('builds the binding in contract order and the verification set keyed by contract key', () => {
    const r = prepareBinding({ ...ok, listingUrl: 'https://shop.example/all' }, contract);
    expect(r.fields).toEqual([
      { key: 'price', name: 'Price', type: 'money', description: 'green', concept: 'price' },
      { key: 'title', name: 'Title', type: 'text', description: 'h1', concept: 'product_name' },
    ]);
    expect(r.verificationSet).toEqual({ urls: U, expected: ok.expected, listing_url: 'https://shop.example/all' });
  });
});

const U2 = ['https://s.example/1', 'https://s.example/2', 'https://s.example/3'];
const P4 = 'https://s.example/4';
const contract2 = [
  { key: 'title', name: 'Title', type: 'text', concept: 'title' },
  { key: 'price', name: 'Price', type: 'money', concept: 'price' },
] as ContractField[];
const descriptions = { title: 'heading', price: 'green number' };
const full = (urls: string[], price4?: string) => ({
  urls, descriptions,
  expected: {
    title: Object.fromEntries(urls.map((u, i) => [u, i < 3 ? `T${i}` : ''])),
    price: Object.fromEntries(urls.map((u, i) => [u, i < 3 ? `${i + 1}.00` : price4 ?? ''])),
  },
});

describe('binding input — three to six proof pages (spec 2026-09-17 §4)', () => {
  it('accepts a fourth page with only one field filled in', () => {
    expect(bindingProblems(full([...U2, P4], '89.50'), contract2)).toEqual([]);
    const { verificationSet } = prepareBinding(full([...U2, P4], '89.50'), contract2);
    expect(verificationSet.urls).toEqual([...U2, P4]);
    expect(verificationSet.expected.title![P4]).toBe('');
    expect(verificationSet.expected.price![P4]).toBe('89.50');
  });
  it('still requires every field on each of the first three pages', () => {
    const input = full(U2);
    input.expected.title[U2[1]!] = '';
    expect(bindingProblems(input, contract2)).toEqual([expect.stringContaining('Title @ https://s.example/2')]);
  });
  it('validates a non-blank value on an extra page against the field type', () => {
    expect(bindingProblems(full([...U2, P4], 'cheap'), contract2)).toEqual([expect.stringContaining('Price @ https://s.example/4')]);
  });
  it('flags an extra page no field is checked on: it would be captured for nothing', () => {
    expect(bindingProblems(full([...U2, P4]), contract2)).toEqual([`${P4}: type at least one expected value on this page, or remove it`]);
  });
  it('schema: 3 to 6 urls', () => {
    const ok3 = (n: number) => bindingInput.safeParse({ sourceId: '00000000-0000-4000-8000-000000000000', urls: Array.from({ length: n }, (_, i) => `https://s.example/${i}`), descriptions: {}, expected: {} }).success;
    expect([2, 3, 6, 7].map(ok3)).toEqual([false, true, true, false]);
  });
});

describe('marks', () => {
  const mark = { xpaths: ['//*[@id="p"]'], text: '$1', rect: { x: 0, y: 0, w: 1, h: 1 } };
  it('are carried into the verification set for known fields and listed pages only', () => {
    const { verificationSet } = prepareBinding({ ...ok, marks: { price: { [U[0]!]: mark, 'https://other.example/': mark }, ghost: { [U[0]!]: mark } } }, contract);
    expect(verificationSet.marks).toEqual({ price: { [U[0]!]: mark } });
  });
  it('are omitted entirely when none apply', () => {
    expect('marks' in prepareBinding({ ...ok, marks: { ghost: { [U[0]!]: mark } } }, contract).verificationSet).toBe(false);
    expect('marks' in prepareBinding(ok, contract).verificationSet).toBe(false);
  });
  // A mark always carries its value (spec 2026-09-18 §3.5): Import values can rewrite a cell
  // while a client is round-tripping the mark that was on the old one.
  it('keeps a mark whose text still reads as the cell, drops one that does not', () => {
    const kept = prepareBinding({ ...ok, marks: { price: { [U[0]!]: mark } } }, contract).verificationSet;
    expect(kept.marks).toEqual({ price: { [U[0]!]: mark } }); // '$1' is the money cell '1'
    const stale = { ...mark, text: '$2' };
    expect('marks' in prepareBinding({ ...ok, marks: { price: { [U[0]!]: stale } } }, contract).verificationSet).toBe(false);
    const withOther = prepareBinding({ ...ok, marks: { price: { [U[0]!]: stale, [U[1]!]: { ...mark, text: '$2' } } } }, contract).verificationSet;
    expect(withOther.marks).toEqual({ price: { [U[1]!]: { ...mark, text: '$2' } } }); // page 2's cell IS '2'
  });
  it('keeps a mark with no text: an image or link carries its value in src/href', () => {
    const imageMark = { ...mark, text: '' };
    expect(prepareBinding({ ...ok, marks: { price: { [U[0]!]: imageMark } } }, contract).verificationSet.marks).toEqual({ price: { [U[0]!]: imageMark } });
  });
  it('a mark on a blank cell is a problem', () => {
    const blank = { ...ok, urls: [...U, 'https://test.example.com/p/4'], marks: { price: { 'https://test.example.com/p/4': mark } } };
    expect(bindingProblems(blank, contract)).toContain(`Price @ https://test.example.com/p/4: a marked element needs its value`);
  });
});
