// Spec 2026-10-20 §5.3 (final review M2): the loading's ~10 s budget is checked before every
// settle and every click, not only between rounds — a slow scroll that spends the budget is the
// last thing the loading does. A fake page with a fake clock; no Chromium.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PlaywrightBrowser } from './playwright-browser.js';
import { LOAD_MORE_BUDGET_MS, MARK_DOCUMENT_SCRIPT, SAME_DOCUMENT_SCRIPT, STEP_SCROLL_SCRIPT } from './load-more.js';

afterEach(() => { vi.restoreAllMocks(); });

/** A page whose scroll takes `scrollMs` of fake time, with a visible "Load more" button that adds nothing. */
function slowPage(scrollMs: number) {
  let now = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const calls: Array<{ what: string; at: number }> = [];
  const page = {
    evaluate: async (script: string) => {
      if (script === STEP_SCROLL_SCRIPT) { now += scrollMs; calls.push({ what: 'scroll', at: now }); return undefined; }
      if (script === MARK_DOCUMENT_SCRIPT || script === SAME_DOCUMENT_SCRIPT) return true;
      if (script === 'PROBE') { calls.push({ what: 'probe', at: now }); return 0; }
      return { visible: true, href: null, target: null, variant: false }; // the load-more target
    },
    waitForTimeout: async (ms: number) => { now += ms; calls.push({ what: 'settle', at: now }); },
    content: async () => '<html><body><div id="grid"></div><button id="more">Load more</button></body></html>',
    locator: () => ({ first: () => ({ click: async () => { now += 200; calls.push({ what: 'click', at: now }); } }) }),
  };
  return { page, calls, elapsed: () => now };
}

async function load(page: unknown) {
  const browser = new PlaywrightBrowser();
  const run = (browser as unknown as { loadMoreOfListing: (p: unknown, u: string, o: unknown) => Promise<void> }).loadMoreOfListing.bind(browser);
  await run(page, 'https://shop.example/c/chairs', { loadMore: { rounds: 3, enough: 1_000, probe: 'PROBE', count: () => 0 } });
}

describe('loadMore budget (final review M2)', () => {
  it('a scroll that spends the budget is neither settled after nor followed by a click', async () => {
    const { page, calls, elapsed } = slowPage(LOAD_MORE_BUDGET_MS + 500);
    await load(page);
    expect(calls.map((c) => c.what)).toEqual(['probe', 'scroll', 'probe']);
    expect(elapsed()).toBe(LOAD_MORE_BUDGET_MS + 500);
  });

  it('a second round whose scroll crosses the budget stops there: no settle, no click, no third round', async () => {
    const { page, calls } = slowPage(4_000);
    await load(page);
    // Round 1: scroll (4 s), settle (5 s), click, settle (6.2 s), probe. Round 2: scroll (10.2 s) — past the budget.
    expect(calls.map((c) => c.what)).toEqual(['probe', 'scroll', 'settle', 'click', 'settle', 'probe', 'scroll', 'probe']);
    // Nothing but the closing probe happens after the budget is spent.
    expect(calls.filter((c) => c.what !== 'probe' && c.at > LOAD_MORE_BUDGET_MS).map((c) => c.what)).toEqual(['scroll']);
  });
});
