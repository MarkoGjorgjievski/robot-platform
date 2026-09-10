import { describe, it, expect } from 'vitest';
import { bindingProblems, prepareBinding } from './binding-input.js';
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
