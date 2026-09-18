import { describe, it, expect } from 'vitest';
import type { ReadySnapshot } from '@robot/browser';
import { buildProofPageReadyCheck } from './proof-page-ready.js';

const empty = { ldJson: [], nextData: null, initialState: null, meta: {} };
const snap = (textLength: number, opts: Partial<ReadySnapshot> = {}): ReadySnapshot => ({
  probe: { textLength }, structuredData: empty, interceptedRequests: [], ...opts,
});
const jsonResponse = { url: 'https://s/api', method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, responseBody: '{}', contentType: 'application/json', bodySize: 2, isJson: true, parsedJson: {}, timestamp: 0 };

describe('buildProofPageReadyCheck', () => {
  it('is not ready on the first poll, nor while the text keeps growing', () => {
    const r = buildProofPageReadyCheck('https://s/p/1');
    expect(r.isReady(snap(100, { structuredData: { ...empty, ldJson: [{ '@type': 'Product' }] } }))).toBe(false);
    expect(r.isReady(snap(200, { structuredData: { ...empty, ldJson: [{ '@type': 'Product' }] } }))).toBe(false);
  });
  it('is ready once the text is unchanged between polls and a structured source has landed', () => {
    const r = buildProofPageReadyCheck('https://s/p/1');
    r.isReady(snap(200));
    expect(r.isReady(snap(200))).toBe(false);                                  // stable text, no structured source yet
    expect(r.isReady(snap(200, { interceptedRequests: [jsonResponse] }))).toBe(true);
  });
  it('a meta description counts as a structured source', () => {
    const r = buildProofPageReadyCheck('https://s/p/1');
    r.isReady(snap(50));
    expect(r.isReady(snap(50, { structuredData: { ...empty, meta: { description: 'x' } } }))).toBe(true);
  });
  it('a structured source seen once stays seen', () => {
    const r = buildProofPageReadyCheck('https://s/p/1');
    r.isReady(snap(50, { interceptedRequests: [jsonResponse] }));
    expect(r.isReady(snap(50))).toBe(true);
  });
  it('polls after the expand rounds and takes the verification grace', () => {
    const r = buildProofPageReadyCheck('https://s/p/1');
    expect(r.when).toBe('after-expand');
    expect(r.graceQuietMs).toBe(750);
    expect(r.script).toContain('innerText');
  });
});
