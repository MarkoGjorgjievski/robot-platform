import { describe, it, expect } from 'vitest';
import { CUSTOMER_FIELD_TYPES, deriveKey } from '@robot/scraper';
import { CATALOGUE, SCHEMA_TYPES, catalogueEntry } from './schema-catalogue.js';

const KNOWN_CONCEPTS = new Set(['product_name', 'price', 'regular_price', 'currency', 'description', 'image_url', 'additional_images', 'brand', 'sku', 'availability', 'rating', 'review_count', 'url', 'category', 'seller', 'discount_amount', 'discount_percentage', 'shipping_info', 'product_dimensions', 'product_features']);

describe('schema catalogue', () => {
  it('has every schema type, with a label', () => {
    for (const t of SCHEMA_TYPES) expect(CATALOGUE[t].label.length).toBeGreaterThan(0);
  });
  it('product has the seven groups from the spec, 20 to 30 entries in all; custom has none', () => {
    expect(CATALOGUE.product.groups.map((g) => g.name)).toEqual(['Identity', 'Price', 'Availability', 'Content', 'Media', 'Rating', 'Taxonomy']);
    const n = CATALOGUE.product.groups.flatMap((g) => g.entries).length;
    expect(n).toBeGreaterThanOrEqual(20);
    expect(n).toBeLessThanOrEqual(30);
    expect(CATALOGUE.custom.groups).toEqual([]);
  });
  it('every entry has a unique key within its type, a valid field type, a description, and a concept that is known or its own key', () => {
    for (const t of SCHEMA_TYPES) {
      const entries = CATALOGUE[t].groups.flatMap((g) => g.entries);
      expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
      for (const e of entries) {
        expect(e.key).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(e.name.trim().length).toBeGreaterThan(0);
        expect(e.name).toBe(e.name.charAt(0).toUpperCase() + e.name.slice(1)); // sentence case: first letter capital
        expect(CUSTOMER_FIELD_TYPES).toContain(e.type);
        expect(e.description.trim().length).toBeGreaterThan(0);
        expect(KNOWN_CONCEPTS.has(e.concept) || e.concept === e.key).toBe(true);
        // addField mints the key from the name; the chip's "added" state matches the contract by key, so the two must agree.
        expect(deriveKey(e.name, new Set())).toBe(e.key);
      }
    }
  });
  it('every type but product and custom has 12 to 20 entries', () => {
    for (const t of SCHEMA_TYPES) {
      if (t === 'product' || t === 'custom') continue;
      const n = CATALOGUE[t].groups.flatMap((g) => g.entries).length;
      expect(n).toBeGreaterThanOrEqual(12);
      expect(n).toBeLessThanOrEqual(20);
    }
  });
  it('the live-check concepts are right: currency is currency, product id is sku, was price is regular_price', () => {
    expect(catalogueEntry('product', 'price_currency')?.concept).toBe('currency');
    expect(catalogueEntry('product', 'sku')?.concept).toBe('sku');
    expect(catalogueEntry('product', 'was_price')?.concept).toBe('regular_price');
    expect(catalogueEntry('product', 'nope')).toBeUndefined();
  });
});
