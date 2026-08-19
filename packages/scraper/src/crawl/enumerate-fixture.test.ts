// Tier 1: link enumeration against a frozen listing capture. No network, no AI.
import { describe, it, expect } from 'vitest';
import { loadFixture } from '../__fixtures__/load.js';
import { enumerateDetailUrls, DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

const FIXTURE = 'newegg-gpu-listing';

/**
 * Pulls every product link out of the frozen HTML the way a row extraction would.
 *
 * Newegg's category page links to search-suggestion pages under the same `/p/`
 * prefix (e.g. `/p/pl?d=rtx+5090`), which are not product detail links. Real
 * product links carry Newegg's item SKU shape, `/p/N82E...`, so the pattern
 * anchors on that instead of the brief's generic `/p/` guess.
 */
function hrefsFromFixtureHtml(html: string): Array<Record<string, unknown>> {
  const hrefs = [...html.matchAll(/href="([^"]*\/p\/N82E\d+[^"]*)"/gi)].map((m) => m[1]!);
  return hrefs.map((href) => ({ [DETAIL_URL_FIELD]: href }));
}

describe('detail URL enumeration against a frozen listing capture', () => {
  const fixture = loadFixture(FIXTURE);

  it('is a listing fixture', () => {
    expect(fixture.pageType).toBe('listing');
  });

  it('finds product links in the captured page', () => {
    const rows = hrefsFromFixtureHtml(fixture.html);
    expect(rows.length).toBeGreaterThan(5);
  });

  it('turns them into absolute, deduped, budget-capped work items', () => {
    const rows = hrefsFromFixtureHtml(fixture.html);
    const result = enumerateDetailUrls({
      rows, pageUrl: fixture.url, pageNumber: 1, seen: new Set(), remaining: 10,
    });
    expect(result.items.length).toBeLessThanOrEqual(10);
    for (const item of result.items) {
      expect(item.url).toMatch(/^https:\/\//);
    }
    expect(new Set(result.items.map((i) => i.url)).size).toBe(result.items.length);
  });
});
