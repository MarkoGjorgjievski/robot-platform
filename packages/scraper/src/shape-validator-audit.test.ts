// packages/scraper/src/shape-validator-audit.test.ts
import { describe, it, expect } from 'vitest';
import { validateFieldShape } from './shape-validator.js';

describe('shape-validator audit — real Amazon-class values must NOT be rejected', () => {
  const cases: Array<[string, unknown, string]> = [
    ['product_description', 'A delicious assortment of premium Belgian chocolates, hand-selected and presented in an elegant gift box suitable for any occasion.', 'string'],
    ['dimensions', '12.3 x 8.1 x 2.4 inches', 'string'],
    ['weight', '12.3 Ounce', 'string'],
    ['best_sellers_rank', '#1,234 in Grocery & Gourmet Food', 'string'],
    ['ingredients', 'Sugar, cocoa butter, chocolate, skim milk, milk, soy lecithin', 'string'],
  ];
  for (const [field, value, type] of cases) {
    it(`accepts ${field}`, () => {
      const r = validateFieldShape(value, type, { fieldName: field });
      expect(r.ok, `rejected with reason: ${r.ok ? '' : r.reason}`).toBe(true);
    });
  }
});
