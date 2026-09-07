import { describe, it, expect } from 'vitest';
import { deriveConcept, deriveKey, customerTypeToFieldType } from './derive-concept.js';

describe('deriveConcept', () => {
  it('maps price-like names to price', () => {
    for (const n of ['Price', 'unit cost', 'Sale price', 'current_price']) expect(deriveConcept(n, 'money')).toBe('price');
  });
  it('maps name-like names to product_name', () => {
    for (const n of ['Title', 'Product name', 'name']) expect(deriveConcept(n, 'text')).toBe('product_name');
  });
  it('falls back to the slug', () => expect(deriveConcept('Warranty period', 'text')).toBe('warranty_period'));
  it('type steers: any money field with an unknown name is still a price concept', () => expect(deriveConcept('MSRP', 'money')).toBe('price'));
});
describe('deriveKey', () => {
  it('slugs and disambiguates', () => {
    const taken = new Set(['unit_cost']);
    expect(deriveKey('Unit cost', new Set())).toBe('unit_cost');
    expect(deriveKey('Unit cost', taken)).toBe('unit_cost_2');
    expect(deriveKey('  ', new Set())).toBe('field');
  });
});
describe('customerTypeToFieldType', () => {
  it('maps to the agent FieldType vocabulary', () => {
    expect(customerTypeToFieldType('money')).toBe('price');
    expect(customerTypeToFieldType('text_list')).toBe('array');
    expect(customerTypeToFieldType('image')).toBe('image_url');
    expect(customerTypeToFieldType('text')).toBe('string');
    expect(customerTypeToFieldType('date')).toBe('date');
  });
});
