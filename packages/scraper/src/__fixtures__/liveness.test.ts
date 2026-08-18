// Does each corpus fixture still describe the page that URL serves today?
//
// Tier 1 replays a frozen snapshot, so it cannot notice a site turning hostile —
// it will stay green forever against a capture taken months ago. That is not
// hypothetical: on 2026-08-18 the IKEA Kallax URL began serving a CATEGORY page
// to headless browsers, so live extraction returned `category_name` and
// `subcategories` instead of product fields, while the IKEA fixture passed.
// Green tests, broken site, no signal.
//
// This closes that gap with the cheapest check that actually works: capture the
// URL and ask whether the page still contains the values the fixture calls
// golden. No AI, no judging — just "is this still the same page?".
//
// Network-bound and therefore opt-in, like the judge calibration:
//   pnpm test:liveness

import { describe, it, expect } from 'vitest';
import { PlaywrightBrowser, checkPageHealth } from '@robot/browser';
import { visibleTextFromHtml } from '../corroborate-value.js';
import { listFixtures, loadFixture } from './load.js';

const ENABLED = process.env.RUN_LIVENESS === '1';

/**
 * Below this share of golden values still findable on the live page, the fixture
 * no longer describes what the URL serves. Generous on purpose: prices and stock
 * change legitimately all the time, and a false alarm here would train everyone
 * to ignore it. IKEA scores near zero when it serves a category page.
 */
const MIN_GOLDEN_PRESENT = 0.5;

/**
 * Golden values worth looking for, calibrated against the fixture itself.
 *
 * Only values that were VISIBLE in the fixture's own capture are checked. That
 * removes the metadata false-positive without weakening the signal: Nike's
 * `category = "FOOTWEAR"` is a schema.org value that was never rendered even when
 * the fixture was taken, so demanding it live is unfair. Searching raw HTML
 * instead was tried and over-corrected — a live IKEA CATEGORY page still mentions
 * Kallax somewhere in its markup, so the check passed on a page we know is wrong.
 * Comparing like with like is what makes this discriminating.
 */
function checkableGoldens(
  expected: Record<string, unknown>,
  fixtureText: string,
): Array<[string, string]> {
  const haystack = fixtureText.toLowerCase();
  const out: Array<[string, string]> = [];
  for (const [field, value] of Object.entries(expected)) {
    if (field.startsWith('_')) continue; // fixture metadata
    if (typeof value !== 'string') continue; // numbers get reformatted on the page
    const v = value.trim();
    if (v.length < 4) continue; // too short to be evidence
    if (/^https?:\/\//i.test(v)) continue; // URLs live in markup, not visible text
    if (!haystack.includes(v.toLowerCase())) continue; // never visible even then
    out.push([field, v]);
  }
  return out;
}

describe.skipIf(!ENABLED)('corpus liveness (live network, no AI)', () => {
  for (const label of listFixtures()) {
    it(`${label} still matches the page its URL serves`, async () => {
      const fixture = loadFixture(label);
      const goldens = checkableGoldens(fixture.expected, visibleTextFromHtml(fixture.html));
      expect(goldens.length, `${label} has no checkable golden strings`).toBeGreaterThan(0);

      const browser = new PlaywrightBrowser();
      await browser.launch({ headless: true });
      let report = '';
      try {
        const capture = await browser.capture(fixture.url, { waitUntil: 'networkidle', interceptNetworkRequests: false });
        const health = checkPageHealth(capture.html ?? '', capture.title ?? '', fixture.url);
        expect(health.healthy, `${label}: live page is not healthy — ${health.reason}`).toBe(true);

        // Rendered text on both sides — the same measure used to pick the goldens
        // above, so a value is only demanded live if it was visible originally.
        const text = visibleTextFromHtml(capture.html ?? '').toLowerCase();
        const found = goldens.filter(([, v]) => text.includes(v.toLowerCase()));
        const missing = goldens.filter(([, v]) => !text.includes(v.toLowerCase()));

        report = [
          `${label}: ${found.length}/${goldens.length} golden values still on the page`,
          `  live title: ${capture.title}`,
          ...missing.map(([f, v]) => `  MISSING  ${f} = ${JSON.stringify(v.slice(0, 60))}`),
        ].join('\n');

        expect(found.length / goldens.length, report).toBeGreaterThanOrEqual(MIN_GOLDEN_PRESENT);
      } finally {
        await browser.close();
      }
    }, 240_000);
  }
});
