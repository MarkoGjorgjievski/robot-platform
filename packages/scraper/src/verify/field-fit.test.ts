import { describe, it, expect } from 'vitest';
import { isWeakField, pathFitsConcept } from './field-fit.js';

describe('pathFitsConcept', () => {
  it('matches a concept tail, ignoring array indices and case', () => {
    expect(pathFitsConcept('availability', 'offers.availability')).toBe(true);
    expect(pathFitsConcept('availability', 'offers.offers[0].availability')).toBe(true);
    expect(pathFitsConcept('availability', 'product.InStock')).toBe(true);
    expect(pathFitsConcept('availability', 'priority')).toBe(false);
    expect(pathFitsConcept('availability', '[0].cashAndCarry')).toBe(false);
    expect(pathFitsConcept('brand', 'brand.name')).toBe(true);
    expect(pathFitsConcept('no_such_concept', 'anything')).toBe(false);
  });
  it('matches whole segments only, never a substring of one', () => {
    expect(pathFitsConcept('availability', 'unavailable')).toBe(false);
    expect(pathFitsConcept('availability', 'restock')).toBe(false);
    expect(pathFitsConcept('availability', 'item.stock')).toBe(true);
  });
});

describe('isWeakField', () => {
  it('is weak for yes/no fields and for fields whose values are all the same', () => {
    expect(isWeakField('boolean', ['Available', 'no'])).toBe(true);
    expect(isWeakField('text', ['IKEA', 'ikea ', 'IKEA'])).toBe(true);
    expect(isWeakField('text', ['IKEA', 'Muji'])).toBe(false);
    expect(isWeakField('text', ['IKEA'])).toBe(false);
    expect(isWeakField('money', ['129.99', '$129.99', '219.99'])).toBe(false);
  });
});
