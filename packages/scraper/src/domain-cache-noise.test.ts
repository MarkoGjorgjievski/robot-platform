import { describe, it, expect } from 'vitest';
import type { InterceptedRequest } from '@robot/browser';
import { resolveApiPathsFromCache, type FieldPathSet } from './domain-cache.js';

// Regression: a poisoned cached api_path ("name") must not resolve against
// known third-party noise such as OneTrust's otFlat.json (top-level
// {"name":"otFlat",...}). Confirmed source of the IKEA Kallax `product_name:
// "otFlat"` extraction bug.

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

const poisonedFieldPaths: Record<string, FieldPathSet> = {
  product_name: {
    paths: [{
      path: 'name',
      source: 'api',
      confidence: 0.95,
      hits: 3,
      misses: 0,
      lastValue: 'otFlat',
      lastUsedAt: new Date().toISOString(),
    }],
    conflictCount: 0,
  },
};

describe('resolveApiPathsFromCache — third-party noise rejection', () => {
  it('does not resolve a cached api path against OneTrust otFlat.json', () => {
    const requests = [
      makeReq(
        'https://cdn.cookielaw.org/scripttemplates/202508.2.0/assets/otFlat.json',
        { name: 'otFlat', html: '<div/>', css: '' },
      ),
    ];
    const { resolved } = resolveApiPathsFromCache(
      poisonedFieldPaths,
      requests,
      ['product_name'],
    );
    expect(resolved['product_name']).toBeUndefined();
  });

  it('does not resolve against first-party optimizely A/B-test asset blobs', () => {
    const requests = [
      makeReq(
        'https://www.ikea.com/global/assets/optimizely/B55RSZvdcuDQ8kD1YxvvN.json',
        { name: 'experiment-42', traffic: 100 },
      ),
    ];
    const { resolved } = resolveApiPathsFromCache(
      poisonedFieldPaths,
      requests,
      ['product_name'],
    );
    expect(resolved['product_name']).toBeUndefined();
  });

  it('still resolves against legitimate product APIs alongside filtered noise', () => {
    const requests = [
      makeReq(
        'https://cdn.cookielaw.org/scripttemplates/202508.2.0/assets/otFlat.json',
        { name: 'otFlat' },
      ),
      makeReq(
        'https://api.example.com/product/v1/details',
        { name: 'Kallax Shelf Unit' },
      ),
    ];
    const { resolved } = resolveApiPathsFromCache(
      poisonedFieldPaths,
      requests,
      ['product_name'],
    );
    expect(resolved['product_name']?.value).toBe('Kallax Shelf Unit');
  });
});
