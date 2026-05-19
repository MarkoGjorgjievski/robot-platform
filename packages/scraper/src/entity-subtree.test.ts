import { describe, it, expect } from 'vitest';
import { findEntitySubtree } from './entity-subtree.js';

describe('findEntitySubtree', () => {
  it('finds the deepest object containing the most schema-relevant keys', () => {
    const blob = {
      props: {
        pageProps: {
          product: {
            name: 'Godiva Assorted',
            price: 24.99,
            description: 'A box of chocolates',
            sku: 'B0FDLT4Y1P',
            images: ['a.jpg', 'b.jpg'],
          },
          breadcrumbs: [{ title: 'Home' }, { title: 'Food' }],
        },
        layout: { title: 'Page Title' },
      },
    };
    const result = findEntitySubtree(blob);
    expect(result.path).toBe('$.props.pageProps.product');
    expect(result.score).toBeGreaterThanOrEqual(4);
  });

  it('returns the root with score 0 when no subtree has 2+ schema keys', () => {
    const result = findEntitySubtree({ foo: 'bar', baz: 1 });
    expect(result.path).toBe('$');
    expect(result.score).toBe(0);
  });

  it('prefers a child subtree over a parent when child has more concentration of schema keys', () => {
    const blob = {
      page: { title: 'A' },
      item: { name: 'B', price: 1, description: 'C', sku: 'X' },
    };
    const result = findEntitySubtree(blob);
    expect(result.path).toBe('$.item');
  });

  it('walks into arrays — returns the path with index', () => {
    const blob = {
      products: [{ name: 'A', price: 1, sku: 'X', description: 'D' }],
    };
    const result = findEntitySubtree(blob);
    expect(result.path).toBe('$.products[0]');
  });

  it('caps recursion at a reasonable depth to avoid pathological blobs', () => {
    let nested: Record<string, unknown> = { name: 'leaf', price: 1, sku: 'X', description: 'D' };
    for (let i = 0; i < 20; i++) nested = { wrap: nested };
    const result = findEntitySubtree(nested);
    expect(result).toBeDefined();
  });
});
