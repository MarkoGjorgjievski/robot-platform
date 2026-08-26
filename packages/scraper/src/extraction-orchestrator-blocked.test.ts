// A blocked capture must fail the extraction WITH ITS REASON — not produce a
// garbage row. 2026-08-26: Newegg's Cloudflare interstitial was "extracted" at
// 28% confidence into a wall of dashes, because checkPageHealth (built in v1.0
// for exactly this) was wired only into the legacy pipeline.ts, never into the
// orchestrators.
import { describe, it, expect } from 'vitest';
import type { IBrowser, PageCapture } from '@robot/browser';
import { runExtraction } from './extraction-orchestrator.js';

const BLOCKED: PageCapture = {
  url: 'https://shop.example.com/p/1',
  html: '<html><body>Unusual traffic detected. Verify you are human. Ray ID a312c62f. cloudflare</body></html>',
  markdown: '', screenshot: Buffer.from('png'), screenshotTiles: [],
  title: 'Just a moment', timestamp: 0,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
  interceptedRequests: [],
};

const browser = {
  async launch() {},
  async capture() { return BLOCKED; },
  async evaluate<T>() { return { data: [] } as T; },
  async setContentEvaluate<T>() { return { data: [] } as T; },
  async close() {},
} as unknown as IBrowser;

describe('runExtraction — blocked page', () => {
  it('rejects with the block reason instead of extracting the interstitial', async () => {
    await expect(runExtraction(
      { url: 'https://shop.example.com/p/1', fields: [{ name: 'price', type: 'price' }] },
      { browser, agent: null, lookupCache: async () => null, saveCache: async () => {}, acquireLock: async () => () => {} },
    )).rejects.toThrow(/human|cloudflare|block/i);
  });
});
