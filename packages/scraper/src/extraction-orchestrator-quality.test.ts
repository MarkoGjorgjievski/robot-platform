// Quality auto-fixes must reach the rows that are actually displayed.
//
// validateExtractedData strips HTML, normalises prices and so on, and returns a
// cleaned copy. The orchestrator then built its per-field rows from the RAW
// finalData, so every auto-fix was computed and thrown away for the one output
// anyone reads: `fieldsByTier` is what the dashboard renders and what the Tier 2
// dogfood judges. That is why the 2026-08-18 report shows
//   specifications: "<b>Max Sequential Read:</b> Up to 14700 MBps<br/>…"
// as an extracted value, with the HTML intact.

import { describe, it, expect } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import type { PageCapture } from '@robot/browser';
import { runExtraction } from './extraction-orchestrator.js';

function captureWith(ldJson: Record<string, unknown>): PageCapture {
  return {
    url: 'https://example.com/p/1',
    html: '<html><body><main><h1>Widget</h1><p>Max Sequential Read: Up to 14700 MBps</p></main></body></html>',
    markdown: '',
    screenshot: Buffer.alloc(0),
    screenshotTiles: [],
    title: 'Widget',
    timestamp: 0,
    structuredData: { ldJson: [ldJson], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [],
  };
}

async function extract(capture: PageCapture, fields: Array<{ name: string; type: string }>) {
  const browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
  try {
    return await runExtraction(
      { url: capture.url, pageType: 'detail', fields: fields.map((f) => ({ ...f, tier: 'requested' as const })) },
      {
        browser, agent: null, capture,
        lookupCache: async () => null,
        saveCache: async () => {},
        acquireLock: async () => () => {},
      },
    );
  } finally {
    await browser.close();
  }
}

describe('runExtraction — quality fixes reach the returned rows', () => {
  it('strips HTML out of the displayed value, not just the internal copy', async () => {
    const outcome = await extract(
      captureWith({ '@type': 'Product', name: 'Widget', description: '<b>Max Sequential Read:</b> Up to 14700 MBps<br/>' }),
      [{ name: 'description', type: 'string' }],
    );

    const row = outcome.fieldsByTier.requested.find((r) => r.name === 'description');
    expect(row?.value).toBe('Max Sequential Read: Up to 14700 MBps');
    // `data` was already clean; the point is that the rows agree with it.
    expect(outcome.data[0]?.description).toBe(row?.value);
  }, 60_000);

  it('reports the fix as a quality issue rather than silently rewriting', async () => {
    const outcome = await extract(
      captureWith({ '@type': 'Product', name: 'Widget', description: '<b>Bold</b> copy here for length' }),
      [{ name: 'description', type: 'string' }],
    );
    expect(outcome.qualityIssues?.some((i) => i.field === 'description' && i.autoFixed)).toBe(true);
  }, 60_000);
});
