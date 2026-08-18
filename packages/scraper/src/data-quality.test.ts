import { describe, it, expect } from 'vitest';
import { validateExtractedData } from './data-quality.js';
import type { SchemaField } from '@robot/agent';

const priceField: SchemaField = { name: 'price', type: 'price', description: 'Product price', required: true };

describe('validateExtractedData', () => {
  describe('price fields', () => {
    it('passes valid prices through unchanged', () => {
      const { data, issues } = validateExtractedData(
        [{ price: 29.99 }],
        [priceField],
      );
      expect(data[0].price).toBe(29.99);
      expect(issues).toHaveLength(0);
    });

    it('strips currency symbols and parses to number', () => {
      const { data, issues } = validateExtractedData(
        [{ price: '$29.99' }],
        [priceField],
      );
      expect(data[0].price).toBe(29.99);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        field: 'price',
        type: 'warning',
        autoFixed: true,
        originalValue: '$29.99',
      });
    });

    it('handles EUR and GBP symbols', () => {
      const { data: d1 } = validateExtractedData([{ price: '€49.00' }], [priceField]);
      expect(d1[0].price).toBe(49.00);

      const { data: d2 } = validateExtractedData([{ price: '£12.50' }], [priceField]);
      expect(d2[0].price).toBe(12.50);
    });

    it('handles comma-formatted prices', () => {
      const { data } = validateExtractedData([{ price: '1,299.99' }], [priceField]);
      expect(data[0].price).toBe(1299.99);
    });

    it('warns on price = 0', () => {
      const { data, issues } = validateExtractedData([{ price: 0 }], [priceField]);
      expect(data[0].price).toBe(0);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ field: 'price', type: 'warning', message: expect.stringContaining('zero') });
    });

    it('errors on negative price', () => {
      const { issues } = validateExtractedData([{ price: -5 }], [priceField]);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ field: 'price', type: 'error' });
    });

    it('errors on non-numeric price', () => {
      const { issues } = validateExtractedData([{ price: 'not a price' }], [priceField]);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ field: 'price', type: 'error' });
    });

    it('errors on price > 1000000', () => {
      const { issues } = validateExtractedData([{ price: 9999999 }], [priceField]);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ field: 'price', type: 'error' });
    });
  });

  const stringField: SchemaField = { name: 'title', type: 'string', description: 'Product title', required: false };
  const urlField: SchemaField = { name: 'url', type: 'url', description: 'Product URL', required: false };
  const imageField: SchemaField = { name: 'image', type: 'image_url', description: 'Image', required: false };
  const numberField: SchemaField = { name: 'rating', type: 'number', description: 'Rating', required: false };

  describe('string fields', () => {
    it('passes clean strings through', () => {
      const { data, issues } = validateExtractedData([{ title: 'iPhone 15' }], [stringField]);
      expect(data[0].title).toBe('iPhone 15');
      expect(issues).toHaveLength(0);
    });

    it('strips HTML tags', () => {
      const { data, issues } = validateExtractedData(
        [{ title: '<span class="bold">iPhone</span> 15 <br/>' }],
        [stringField],
      );
      expect(data[0].title).toBe('iPhone 15');
      expect(issues[0]).toMatchObject({ autoFixed: true });
    });

    it('errors on whitespace-only after stripping', () => {
      const { issues } = validateExtractedData([{ title: '<div>  </div>' }], [stringField]);
      expect(issues.some(i => i.type === 'error')).toBe(true);
    });

    it('warns on very long strings', () => {
      const { issues } = validateExtractedData([{ title: 'x'.repeat(6000) }], [stringField]);
      expect(issues.some(i => i.type === 'warning' && i.message.includes('long'))).toBe(true);
    });
  });

  describe('url fields', () => {
    it('passes valid URLs', () => {
      const { issues } = validateExtractedData([{ url: 'https://example.com/product' }], [urlField]);
      expect(issues).toHaveLength(0);
    });

    it('errors on non-http URLs', () => {
      const { issues } = validateExtractedData([{ url: 'javascript:void(0)' }], [urlField]);
      expect(issues[0]).toMatchObject({ type: 'error' });
    });

    it('errors on unparseable URLs', () => {
      const { issues } = validateExtractedData([{ url: 'not a url at all' }], [urlField]);
      expect(issues[0]).toMatchObject({ type: 'error' });
    });

    it('auto-fixes trimming whitespace', () => {
      const { data, issues } = validateExtractedData([{ url: '  https://example.com  ' }], [urlField]);
      expect(data[0].url).toBe('https://example.com');
      expect(issues[0]).toMatchObject({ autoFixed: true });
    });

    it('validates image_url same as url', () => {
      const { issues } = validateExtractedData([{ image: 'not-a-url' }], [imageField]);
      expect(issues[0]).toMatchObject({ type: 'error' });
    });
  });

  describe('number fields', () => {
    it('passes valid numbers', () => {
      const { issues } = validateExtractedData([{ rating: 4.5 }], [numberField]);
      expect(issues).toHaveLength(0);
    });

    it('parses string numbers', () => {
      const { data, issues } = validateExtractedData([{ rating: '4.5' }], [numberField]);
      expect(data[0].rating).toBe(4.5);
      expect(issues[0]).toMatchObject({ autoFixed: true });
    });

    it('strips commas from numbers', () => {
      const { data } = validateExtractedData([{ rating: '1,234' }], [numberField]);
      expect(data[0].rating).toBe(1234);
    });

    it('parses word numbers like "star-rating Three"', () => {
      const { data, issues } = validateExtractedData([{ rating: 'star-rating Three' }], [numberField]);
      expect(data[0].rating).toBe(3);
      expect(issues[0]).toMatchObject({ autoFixed: true, originalValue: 'star-rating Three' });
    });

    it('parses word numbers case-insensitively', () => {
      const { data } = validateExtractedData([{ rating: 'FIVE stars' }], [numberField]);
      expect(data[0].rating).toBe(5);
    });

    it('errors on non-numeric', () => {
      const { issues } = validateExtractedData([{ rating: 'high' }], [numberField]);
      expect(issues[0]).toMatchObject({ type: 'error' });
    });

    it('errors on absurdly large numbers', () => {
      const { issues } = validateExtractedData([{ rating: 2e10 }], [numberField]);
      expect(issues[0]).toMatchObject({ type: 'error' });
    });
  });

  const boolField: SchemaField = { name: 'in_stock', type: 'boolean', description: 'In stock', required: false };
  const dateField: SchemaField = { name: 'published', type: 'date', description: 'Date', required: false };

  describe('boolean fields', () => {
    it('passes actual booleans', () => {
      const { data, issues } = validateExtractedData([{ in_stock: true }], [boolField]);
      expect(data[0].in_stock).toBe(true);
      expect(issues).toHaveLength(0);
    });

    it('converts "yes"/"true"/"1" to true', () => {
      for (const val of ['yes', 'Yes', 'true', 'True', '1']) {
        const { data, issues } = validateExtractedData([{ in_stock: val }], [boolField]);
        expect(data[0].in_stock).toBe(true);
        expect(issues[0]).toMatchObject({ autoFixed: true });
      }
    });

    it('converts "no"/"false"/"0" to false', () => {
      for (const val of ['no', 'No', 'false', 'False', '0']) {
        const { data, issues } = validateExtractedData([{ in_stock: val }], [boolField]);
        expect(data[0].in_stock).toBe(false);
        expect(issues[0]).toMatchObject({ autoFixed: true });
      }
    });

    it('errors on unconvertible values', () => {
      const { issues } = validateExtractedData([{ in_stock: 'maybe' }], [boolField]);
      expect(issues[0]).toMatchObject({ type: 'error' });
    });
  });

  describe('date fields', () => {
    it('passes valid date strings', () => {
      const { issues } = validateExtractedData([{ published: '2025-01-15' }], [dateField]);
      expect(issues).toHaveLength(0);
    });

    it('errors on unparseable dates', () => {
      const { issues } = validateExtractedData([{ published: 'not-a-date' }], [dateField]);
      expect(issues[0]).toMatchObject({ type: 'error' });
    });

    it('warns on dates far in the future', () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 2);
      const { issues } = validateExtractedData([{ published: future.toISOString() }], [dateField]);
      expect(issues.some(i => i.type === 'warning' && i.message.includes('future'))).toBe(true);
    });
  });

  describe('cross-row checks', () => {
    it('warns when all rows have identical value for a field', () => {
      const { issues } = validateExtractedData(
        [{ title: 'Same' }, { title: 'Same' }, { title: 'Same' }],
        [stringField],
      );
      expect(issues.some(i => i.message.includes('identical'))).toBe(true);
    });

    it('warns when required field missing in > 50% of rows', () => {
      const reqField: SchemaField = { name: 'price', type: 'price', description: '', required: true };
      const { issues } = validateExtractedData(
        [{ price: 10 }, {}, {}, {}],
        [reqField],
      );
      expect(issues.some(i => i.message.includes('missing'))).toBe(true);
    });

    it('does not warn on single-row data', () => {
      const { issues } = validateExtractedData([{ title: 'Only one' }], [stringField]);
      expect(issues).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty data array', () => {
      const { data, issues } = validateExtractedData([], [priceField]);
      expect(data).toHaveLength(0);
      expect(issues).toHaveLength(0);
    });

    it('handles empty fields array', () => {
      const { data, issues } = validateExtractedData([{ price: 10 }], []);
      expect(data[0].price).toBe(10);
      expect(issues).toHaveLength(0);
    });

    it('skips null/undefined values', () => {
      const { issues } = validateExtractedData([{ price: null }], [priceField]);
      expect(issues).toHaveLength(0);
    });
  });
});

describe('validateExtractedData — array fields', () => {
  // `array` fell through to the default case, so list values were never cleaned.
  // Newegg returns bullet_points and specifications as markup-laden strings, and
  // array is exactly the type those fields carry.
  it('strips HTML from each element of an array', () => {
    const { data } = validateExtractedData(
      [{ specifications: ['<b>Read:</b> 14700 MBps', '<b>Write:</b> 13400 MBps'] }],
      [{ name: 'specifications', type: 'array', description: '', required: true }] as never,
    );
    expect(data[0]!.specifications).toEqual(['Read: 14700 MBps', 'Write: 13400 MBps']);
  });

  it('drops elements that are empty once stripped', () => {
    const { data } = validateExtractedData(
      [{ features: ['<br/>', 'Real feature'] }],
      [{ name: 'features', type: 'array', description: '', required: true }] as never,
    );
    expect(data[0]!.features).toEqual(['Real feature']);
  });

  it('leaves non-string elements alone', () => {
    const { data } = validateExtractedData(
      [{ sizes: [1, 2, 3] }],
      [{ name: 'sizes', type: 'array', description: '', required: true }] as never,
    );
    expect(data[0]!.sizes).toEqual([1, 2, 3]);
  });
});
