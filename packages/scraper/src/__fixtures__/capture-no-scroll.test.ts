// Tier 1: capture must not change how much of a lazy listing exists.
//
// `capture` expands collapsed content before snapshotting the HTML, which is
// right for a detail page — specs and descriptions live behind accordions. It
// used to do that through Playwright locator clicks, and a locator click scrolls
// its element into view first. On a listing that appends products as you scroll,
// that is not a neutral act: it loads batches, and how many depends on timing.
//
// One real listing captured 144, 144, 72 and 108 rows across four runs of the
// same URL. Whatever happened to have loaded became "page 1", so the planned
// item set for a customer's run was decided by a race.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { serveFixturePages, type ServedSite } from './serve.js';

/**
 * A listing that grows near the bottom, with the two controls Phase 1 of
 * `expandHiddenContent` actually clicks (`[aria-expanded="false"]` and
 * `details summary`) placed BELOW the fold — which is where a locator click has
 * to scroll to reach them.
 */
const lazyListing = `<!doctype html>
<html><body><main>
  <div id="grid"><div data-row><a href="/p/1">card 1</a></div></div>
  <div style="height:3000px"></div>
  <button id="expander" aria-expanded="false">Filters</button>
  <div id="panel"></div>
  <div style="height:3000px"></div>
  <details><summary>Size guide</summary>SIZE GUIDE BODY</details>
  <script>
    // Assembled from fragments so the revealed text appears NOWHERE in the
    // served markup. An inline onclick="...'SPEC PANEL REVEALED'" put the
    // expected string in the page source, and the assertion below then passed
    // with expansion switched off entirely — the test asserted nothing.
    document.getElementById('expander').addEventListener('click', function () {
      this.setAttribute('aria-expanded', 'true');
      document.getElementById('panel').textContent = ['SPEC', 'PANEL', 'OK'].join('_');
    });
    var n = 1;
    addEventListener('scroll', function () {
      if (n >= 4) return;
      if (window.scrollY + window.innerHeight > document.body.scrollHeight - 1200) {
        n++;
        var d = document.createElement('div');
        d.setAttribute('data-row', '');
        d.innerHTML = '<a href="/p/' + n + '">card ' + n + '</a>';
        document.getElementById('grid').appendChild(d);
      }
    });
  </script>
</main></body></html>`;

let browser: PlaywrightBrowser;
let site: ServedSite;

beforeAll(async () => {
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
  site = await serveFixturePages([{ path: '/lazy', html: lazyListing }]);
}, 60_000);

afterAll(async () => {
  try { await browser?.close(); } finally { await site?.close(); }
});

const cards = (html: string) => (html.match(/<div data-row/g) ?? []).length;

describe('capture against a listing that loads on scroll', () => {
  it('sees the same page every time, and never more of the list than was rendered', async () => {
    // Twice, because the defect was non-deterministic: the same fixture yielded
    // 2 cards on one run and 3 on the next. A single-run assertion would have
    // passed on the broken code roughly half the time.
    const first = await browser.capture(`${site.baseUrl}/lazy`);
    const second = await browser.capture(`${site.baseUrl}/lazy`);

    expect(cards(first.html)).toBe(1);
    expect(cards(second.html)).toBe(1);
  }, 90_000);

  it('still expands collapsed content below the fold', async () => {
    // The adjacent guard, and the one that matters most: "don't scroll" is
    // trivially satisfiable by not expanding anything at all. Both controls sit
    // 3000px down, so this fails if expansion silently regresses to
    // viewport-only — which is what skipping out-of-view elements would have
    // done, and why that was not the fix chosen.
    const cap = await browser.capture(`${site.baseUrl}/lazy`);

    expect(cap.html).toContain('SPEC_PANEL_OK');
    expect(cap.html).toMatch(/<details[^>]*\sopen/);
  }, 60_000);
});
