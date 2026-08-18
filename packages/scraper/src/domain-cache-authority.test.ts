// Source authority as a tie-breaker, and detection of paths that currently disagree.
//
// The motivating case, from the live www.newegg.com/detail cache on 2026-08-18:
// `product_name` held two paths with IDENTICAL statistics — json-ld `name` holding
// the real title, and api `Configs[0].name` holding "Similar Seller Recommendation
// on OrderTracking and ProductList page", a Newegg internal feature-flag label.
// The cache had even recorded conflictCount: 1. Nothing read it, and ranking gave
// source type no weight, so a tie was broken by array order.

import { describe, it, expect } from 'vitest';
import { resolveFromCache, detectPathConflicts, sourceAuthority, prunePaths } from './domain-cache.js';
import type { FieldPath, FieldPathSet, PathSource } from './domain-cache.js';

function path(source: PathSource, value: unknown, over: Partial<FieldPath> = {}): FieldPath {
  return {
    path: `${source}-path`, source, confidence: 0.8,
    hits: 1, misses: 0, lastValue: value,
    lastUsedAt: '2026-08-18T09:00:00.000Z', pinned: false,
    ...over,
  };
}
const set = (paths: FieldPath[]): FieldPathSet => ({ paths, conflictCount: 0 });

const REAL_NAME = 'SAMSUNG SSD 9100 PRO 2TB';
const GARBAGE = 'Similar Seller Recommendation on OrderTracking and ProductList page';

describe('sourceAuthority', () => {
  it('ranks a publisher declaration above a guessed API path', () => {
    expect(sourceAuthority('json-ld')).toBeGreaterThan(sourceAuthority('api'));
    expect(sourceAuthority('meta')).toBeGreaterThan(sourceAuthority('api-ai'));
  });

  it('ranks the rendered page above a model reading a picture', () => {
    expect(sourceAuthority('xpath')).toBeGreaterThan(sourceAuthority('ai-vision'));
  });

  it('puts a human override above everything', () => {
    for (const s of ['json-ld', 'meta', 'xpath', 'api', 'api-ai', 'ai-vision'] as PathSource[]) {
      expect(sourceAuthority('human')).toBeGreaterThan(sourceAuthority(s));
    }
  });
});

describe('resolveFromCache — ranking', () => {
  it('breaks a statistical tie by source authority (the Newegg case)', () => {
    // Garbage listed FIRST so array order alone would have picked it.
    const fieldPaths = {
      product_name: set([path('api', GARBAGE), path('json-ld', REAL_NAME)]),
    };
    const r = resolveFromCache(fieldPaths, { product_name: REAL_NAME }, ['product_name']);
    expect(r.resolved.product_name?.source).toBe('json-ld');
  });

  it('does NOT override a genuinely better hit rate', () => {
    // Authority is a tie-breaker, not a trump card: a json-ld path that keeps
    // missing must lose to an api path that keeps working.
    const fieldPaths = {
      price: set([
        path('json-ld', 1, { hits: 1, misses: 9 }),
        path('api', 2, { hits: 9, misses: 1 }),
      ]),
    };
    const r = resolveFromCache(fieldPaths, { price: 2 }, ['price']);
    expect(r.resolved.price?.source).toBe('api');
  });

  it('still puts a human path first regardless of statistics', () => {
    const fieldPaths = {
      title: set([
        path('json-ld', 'auto', { hits: 50, misses: 0 }),
        path('human', 'pinned', { hits: 0, misses: 0 }),
      ]),
    };
    const r = resolveFromCache(fieldPaths, { title: 'pinned' }, ['title']);
    expect(r.resolved.title?.source).toBe('human');
  });
});

describe('detectPathConflicts', () => {
  it('reports a field whose paths currently disagree', () => {
    const conflicts = detectPathConflicts({
      product_name: set([path('json-ld', REAL_NAME), path('api', GARBAGE)]),
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.field).toBe('product_name');
    expect(conflicts[0]!.candidates.map((c) => c.source).sort()).toEqual(['api', 'json-ld']);
  });

  it('is quiet when paths agree', () => {
    expect(detectPathConflicts({
      price: set([path('json-ld', 79.99), path('api', 79.99)]),
    })).toEqual([]);
  });

  it('ignores fields with only one usable value', () => {
    expect(detectPathConflicts({
      sku: set([path('json-ld', 'ABC'), path('api', null)]),
    })).toEqual([]);
  });

  it('does not treat formatting differences as disagreement', () => {
    // valuesMatch already normalises these; a conflict report must not cry wolf.
    expect(detectPathConflicts({
      price: set([path('json-ld', '79.99'), path('api', 79.99)]),
    })).toEqual([]);
  });

  it('reports the winning path first, so a reviewer sees what is being served', () => {
    const conflicts = detectPathConflicts({
      product_name: set([path('api', GARBAGE), path('json-ld', REAL_NAME)]),
    });
    expect(conflicts[0]!.candidates[0]!.source).toBe('json-ld');
  });
});

describe('prunePaths — what the cache is allowed to forget', () => {
  it('drops a path that has reliably stopped working', () => {
    const kept = prunePaths([path('api', 'x', { hits: 0, misses: 9 })]);
    expect(kept).toHaveLength(0);
  });

  it('never drops a human override, however badly it scores', () => {
    // A human pin is an explicit decision. Auto-removing it is exactly the
    // "never auto-reset" rule the cache is supposed to follow — and until now
    // both the prune and the 5-path cap could silently delete one.
    const kept = prunePaths([path('human', 'x', { hits: 0, misses: 99 })]);
    expect(kept).toHaveLength(1);
  });

  it('never drops a pinned path', () => {
    const kept = prunePaths([path('api', 'x', { hits: 0, misses: 99, pinned: true })]);
    expect(kept).toHaveLength(1);
  });

  it('caps at five paths but keeps protected ones regardless of rank', () => {
    const many = [
      path('human', 'pinned-by-human', { hits: 0, misses: 0 }),
      ...Array.from({ length: 8 }, (_, i) => path('api', `v${i}`, { hits: 9, misses: 0, path: `p${i}` })),
    ];
    const kept = prunePaths(many);
    expect(kept.length).toBeLessThanOrEqual(5);
    expect(kept.some((p) => p.source === 'human')).toBe(true);
  });
});

describe('resolveFromCache — pinned paths', () => {
  it('serves a pinned path over everything else', () => {
    const fieldPaths = {
      image_url: set([
        path('json-ld', 'https://img.youtube.com/vi/x/hqdefault.jpg', { hits: 50, misses: 0 }),
        path('meta', 'https://cdn.example.com/product.jpg', { hits: 1, misses: 0, pinned: true }),
      ]),
    };
    const r = resolveFromCache(fieldPaths, { image_url: 'https://cdn.example.com/product.jpg' }, ['image_url']);
    expect(r.resolved.image_url?.source).toBe('meta');
  });
});
