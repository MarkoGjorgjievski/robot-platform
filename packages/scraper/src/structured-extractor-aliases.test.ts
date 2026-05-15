import { describe, it, expect } from 'vitest';
import { extractFromStructuredData } from './structured-extractor.js';
import type { StructuredData } from '@robot/browser';

const emptyStructured: StructuredData = { ldJson: [], meta: {}, nextData: null, initialState: null };

describe('extractFromStructuredData — description-based matching', () => {
  it('matches field by description words when name has no alias', () => {
    const intercepted = [{
      url: 'https://api.example.com/product',
      method: 'GET',
      responseBody: '{}',
      bodySize: 100,
      contentType: 'application/json',
      parsedJson: { package_weight: '2.5 lbs' },
    }];
    const result = extractFromStructuredData(
      emptyStructured,
      [{ name: 'shipping_weight', type: 'string', description: 'the package weight of the product' }],
      intercepted as any,
    );
    expect(result.data['shipping_weight']).toBe('2.5 lbs');
  });

  it('still prefers exact name match over description match', () => {
    const intercepted = [{
      url: 'https://api.example.com/product',
      method: 'GET',
      responseBody: '{}',
      bodySize: 100,
      contentType: 'application/json',
      parsedJson: { shipping_weight: '3 lbs', package_weight: '2.5 lbs' },
    }];
    const result = extractFromStructuredData(
      emptyStructured,
      [{ name: 'shipping_weight', type: 'string', description: 'the package weight' }],
      intercepted as any,
    );
    expect(result.data['shipping_weight']).toBe('3 lbs');
  });
});
