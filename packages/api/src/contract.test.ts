import { describe, it, expect } from 'vitest';
import { contractFields, contractAxes, effectiveLevel, bindingFor } from './contract.js';

describe('contractFields', () => {
  it('keeps only keyed entries, in order, with their legacy properties', () => {
    const schema = [
      { name: 'legacy', type: 'text', origin: 'listing' },
      { key: 'price', name: 'Price', type: 'money', concept: 'price', candidate: { concept: 'price', label: 'displayed' } },
      { key: 'title', name: 'Title', type: 'text', concept: 'product_name' },
    ];
    expect(contractFields(schema).map((f) => f.key)).toEqual(['price', 'title']);
    expect(contractFields(schema)[0]!.candidate).toEqual({ concept: 'price', label: 'displayed' });
  });
  it('is empty for a non-array or null schema', () => {
    expect(contractFields(null)).toEqual([]);
    expect(contractFields({ price: 'money' })).toEqual([]);
  });
});

describe('variants in the contract', () => {
  const schema = [
    { key: 'title', name: 'Title', type: 'text', concept: 'product_name' },
    { key: 'price', name: 'Price', type: 'money', concept: 'price' },
    { key: 'note', name: 'Note', type: 'text', concept: 'note', level: 'variant' },
    { key: 'colour', name: 'Colour', kind: 'axis', concept: 'axis' },
    { name: 'legacy operator field' },
  ];
  it('keeps axes out of the fields and lists them separately', () => {
    expect(contractFields(schema).map((f) => f.key)).toEqual(['title', 'price', 'note']);
    expect(contractAxes(schema)).toEqual([{ key: 'colour', name: 'Colour', kind: 'axis', concept: 'axis' }]);
  });
  it('levels come from the stored level, else from the concept', () => {
    expect(effectiveLevel({ concept: 'product_name' })).toBe('product');
    expect(effectiveLevel({ concept: 'price' })).toBe('variant');
    expect(effectiveLevel({ concept: 'sku' })).toBe('variant');
    expect(effectiveLevel({ concept: 'note' })).toBe('product');
    expect(effectiveLevel({ concept: 'note', level: 'variant' })).toBe('variant');
    expect(effectiveLevel({ concept: 'price', level: 'product' })).toBe('product');
  });
});

describe('bindingFor', () => {
  it('copies key, name, type and concept and takes descriptions by key', () => {
    const contract = [{ key: 'price', name: 'Price', type: 'money' as const, concept: 'price' }];
    expect(bindingFor(contract, { price: 'green number' })).toEqual([{ key: 'price', name: 'Price', type: 'money', description: 'green number', concept: 'price' }]);
    expect(bindingFor(contract)[0]!.description).toBe('');
  });
});
