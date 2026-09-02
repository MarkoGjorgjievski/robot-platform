// The cache's central promise — replayed paths earn and lose reputation — was
// broken in three quiet ways (cache-reputation fixes, 2026-09-02):
//
//   W1  the replay tiers recorded `path: ''` (and the xpath tier a source label,
//       'xpath-cached', that no stored path carries), so `mergeFieldPaths`'s
//       exact source+path identity could never credit a replayed path with a hit;
//   W2  a cached path that was tried and produced nothing (or was rejected by
//       corroboration) left no trace at all, so the conservative prune was
//       unreachable for exactly the poisoned-path class it exists for
//       (abebooks-poisoned-titles-rca.md, the half that didn't ship);
//   W3  a path that produced a perfectly good value was charged a miss whenever
//       the RUN overall fell below the success threshold — one bad page smeared
//       every working path's record.

import { describe, it, expect } from 'vitest';
import type { InterceptedRequest } from '@robot/browser';
import {
  mergeFieldPaths, resolveApiPathsFromCache, buildCachedXPathScript,
  type FieldPathSet,
} from './domain-cache.js';

const NOW = '2026-09-02T00:00:00.000Z';

function makeReq(url: string, body: object): InterceptedRequest {
  const responseBody = JSON.stringify(body);
  return {
    url,
    method: 'GET',
    resourceType: 'xhr',
    responseStatus: 200,
    responseHeaders: {},
    responseBody,
    contentType: 'application/json',
    bodySize: responseBody.length,
    isJson: true,
    parsedJson: body,
    timestamp: 0,
  };
}

const path = (over: Partial<FieldPathSet['paths'][number]> = {}) => ({
  path: 'product.title',
  source: 'api' as const,
  confidence: 0.9,
  hits: 1,
  misses: 0,
  lastValue: 'Kallax',
  lastUsedAt: NOW,
  ...over,
});

describe('W1 — replay resolvers name the winning path', () => {
  it('resolveApiPathsFromCache returns the stored path that produced the value', () => {
    const fieldPaths: Record<string, FieldPathSet> = {
      title: { paths: [path()], conflictCount: 0 },
    };
    const { resolved } = resolveApiPathsFromCache(
      fieldPaths,
      [makeReq('https://shop.example.com/api/p/1', { product: { title: 'Kallax' } })],
      ['title'],
    );
    expect(resolved['title']?.value).toBe('Kallax');
    expect(resolved['title']?.path).toBe('product.title');
  });

  it('resolveApiPathsFromCache reports attempted paths that resolved nothing', () => {
    const fieldPaths: Record<string, FieldPathSet> = {
      title: {
        paths: [
          path({ path: 'stale.gone', hits: 0 }),
          path(),
        ],
        conflictCount: 0,
      },
    };
    const { resolved, failed } = resolveApiPathsFromCache(
      fieldPaths,
      [makeReq('https://shop.example.com/api/p/1', { product: { title: 'Kallax' } })],
      ['title'],
    );
    expect(resolved['title']?.path).toBe('product.title');
    expect(failed['title']).toEqual([{ source: 'api', path: 'stale.gone' }]);
  });

  it('resolveApiPathsFromCache reports no attempts when there were no API bodies to try', () => {
    const fieldPaths: Record<string, FieldPathSet> = {
      title: { paths: [path()], conflictCount: 0 },
    };
    const { failed } = resolveApiPathsFromCache(fieldPaths, [], ['title']);
    expect(failed).toEqual({});
  });

  it('buildCachedXPathScript names the stored path chosen for each field', () => {
    const fieldPaths: Record<string, FieldPathSet> = {
      title: {
        paths: [path({ path: '//h1[@id="t"]', source: 'xpath' })],
        conflictCount: 0,
      },
    };
    const built = buildCachedXPathScript(fieldPaths, ['title']);
    expect(built?.chosen['title']).toEqual({ path: '//h1[@id="t"]', source: 'xpath' });
  });
});

describe('W1 — mergeFieldPaths credits a replayed path', () => {
  it("increments the stored path's hits when the result names it", () => {
    const existing: Record<string, FieldPathSet> = {
      title: { paths: [path({ hits: 3 })], conflictCount: 0 },
    };
    const merged = mergeFieldPaths(
      existing,
      { title: { path: 'product.title', source: 'api', value: 'Kallax', confidence: 0.9 } },
      [], NOW,
    );
    expect(merged.title!.paths).toHaveLength(1);
    expect(merged.title!.paths[0]!.hits).toBe(4);
  });

  it("maps the replay label 'xpath-cached' back onto the stored 'xpath' identity", () => {
    const existing: Record<string, FieldPathSet> = {
      title: {
        paths: [path({ path: '//h1[@id="t"]', source: 'xpath', hits: 3 })],
        conflictCount: 0,
      },
    };
    const merged = mergeFieldPaths(
      existing,
      { title: { path: '//h1[@id="t"]', source: 'xpath-cached', value: 'Kallax', confidence: 0.85 } },
      [], NOW,
    );
    // Credited in place — not appended as a phantom second identity.
    expect(merged.title!.paths).toHaveLength(1);
    expect(merged.title!.paths[0]!.source).toBe('xpath');
    expect(merged.title!.paths[0]!.hits).toBe(4);
  });
});

describe('W2 — attempted-but-failed cached paths take a miss', () => {
  it('charges a miss to a named path without touching its lastValue', () => {
    const existing: Record<string, FieldPathSet> = {
      title: { paths: [path({ hits: 2 })], conflictCount: 0 },
    };
    const merged = mergeFieldPaths(existing, {}, [], NOW, undefined, {
      title: [{ source: 'api', path: 'product.title' }],
    });
    expect(merged.title!.paths[0]!.misses).toBe(1);
    expect(merged.title!.paths[0]!.hits).toBe(2);
    // The path produced nothing this run — there is no new observation to stamp.
    expect(merged.title!.paths[0]!.lastValue).toBe('Kallax');
  });

  it('a poisoned path that keeps failing becomes prunable: 5 charged runs → gone', () => {
    // The AbeBooks shape: a path minted on a run where it never actually
    // produced a page-corroborated value (hits 0), then rejected on every
    // subsequent run. Five charged misses reach the prune predicate
    // (≥5 uses, ≤10% hit rate) — before this fix its record stayed spotless
    // forever and the prune could never fire.
    let fieldPaths: Record<string, FieldPathSet> = {
      title: {
        paths: [
          path({ path: 'bibliographicDetail.title', hits: 0 }),
          path({ path: 'product.title', hits: 5 }),
        ],
        conflictCount: 0,
      },
    };
    for (let run = 0; run < 5; run++) {
      fieldPaths = mergeFieldPaths(fieldPaths, {}, [], NOW, undefined, {
        title: [{ source: 'api', path: 'bibliographicDetail.title' }],
      });
    }
    const remaining = fieldPaths.title!.paths.map((p) => p.path);
    expect(remaining).toEqual(['product.title']);
  });

  it('never charges a path the run did not name', () => {
    const existing: Record<string, FieldPathSet> = {
      title: { paths: [path()], conflictCount: 0 },
      price: { paths: [path({ path: 'product.price', lastValue: '9.99' })], conflictCount: 0 },
    };
    const merged = mergeFieldPaths(existing, {}, [], NOW, undefined, {
      title: [{ source: 'api', path: 'product.title' }],
    });
    expect(merged.price!.paths[0]!.misses).toBe(0);
  });

  it('a pinned path accrues misses but survives the prune', () => {
    let fieldPaths: Record<string, FieldPathSet> = {
      title: {
        paths: [path({ hits: 0, pinned: true })],
        conflictCount: 0,
      },
    };
    for (let run = 0; run < 6; run++) {
      fieldPaths = mergeFieldPaths(fieldPaths, {}, [], NOW, undefined, {
        title: [{ source: 'api', path: 'product.title' }],
      });
    }
    expect(fieldPaths.title!.paths).toHaveLength(1);
    expect(fieldPaths.title!.paths[0]!.misses).toBe(6);
  });
});

describe('W3 — path stats are per-path, not per-run', () => {
  it('a path that produced the accepted value gets a hit even on a low-coverage run', () => {
    // Before: `isSuccess` (run ≥30% coverage) gated the hit branch, so one
    // thin page charged a miss to every path that actually worked on it.
    const existing: Record<string, FieldPathSet> = {
      title: { paths: [path({ hits: 3, misses: 0 })], conflictCount: 0 },
    };
    // mergeFieldPaths no longer receives run-level success at all — the run
    // counters (totalRuns/successfulRuns/consecutiveFailures) carry it instead.
    const merged = mergeFieldPaths(
      existing,
      { title: { path: 'product.title', source: 'api', value: 'Kallax', confidence: 0.9 } },
      [], NOW,
    );
    expect(merged.title!.paths[0]!.hits).toBe(4);
    expect(merged.title!.paths[0]!.misses).toBe(0);
  });

  it('a path newly minted on a low-coverage run starts with a hit, not a miss', () => {
    const merged = mergeFieldPaths(
      {},
      { title: { path: 'product.title', source: 'api', value: 'Kallax', confidence: 0.9 } },
      [], NOW,
    );
    expect(merged.title!.paths[0]!.hits).toBe(1);
    expect(merged.title!.paths[0]!.misses).toBe(0);
  });
});
