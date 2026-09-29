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
  it('treats ":" as a segment separator, so meta keys match', () => {
    expect(pathFitsConcept('availability', 'product:availability')).toBe(true);
    expect(pathFitsConcept('availability', 'og:availability')).toBe(true);
    expect(pathFitsConcept('brand', 'product:brand')).toBe(true);
    expect(pathFitsConcept('brand', 'og:brand')).toBe(true);
    expect(pathFitsConcept('currency', 'og:price:currency')).toBe(true);
    expect(pathFitsConcept('currency', 'product:price:currency')).toBe(true);
    expect(pathFitsConcept('product_name', 'og:site_name')).toBe(false);
    expect(pathFitsConcept('availability', 'og:unavailability')).toBe(false);
  });
  it('knows the wider currency tails', () => {
    for (const p of ['data.currency', 'price.currencyCode', 'price.currency_code', 'price.currencySymbol', 'price.currency_symbol', 'price.currencyPrefix']) {
      expect(pathFitsConcept('currency', p)).toBe(true);
    }
  });
  it('knows the wider availability tails', () => {
    for (const p of ['product.isInStock', 'product.is_in_stock', 'product.availableForSale', 'item.isBuyable', 'item.orderable']) {
      expect(pathFitsConcept('availability', p)).toBe(true);
    }
  });
  it('knows the wider brand tails', () => {
    for (const p of ['product.manufacturer.name', 'product.vendor', 'product.brandName', 'product.brand_name']) {
      expect(pathFitsConcept('brand', p)).toBe(true);
    }
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
