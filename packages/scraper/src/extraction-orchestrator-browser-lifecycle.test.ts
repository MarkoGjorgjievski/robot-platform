// Regression coverage for the shared-browser lifecycle bug fixed in
// docs/handoff.md's v2 crawler phase 2: `runExtraction` used to close the
// browser it was given whenever no `capture` was injected — see
// `if (!deps.capture) await browser.close()` and the matching close on the
// capture-error path. That guard conflated "I created this capture" with "I
// own this browser". Phase 2's `startExecution` launches ONE browser and
// reuses it across an entire item loop via `extractItem`, which injects no
// capture — so item 1 succeeded, closed the shared browser, and every
// subsequent item failed with "Browser not launched".
//
// The fix: whoever launches the browser closes it. `runExtraction` never
// closes a browser it did not launch itself (it never launches one either).
// These tests exercise the NO-injected-capture path (the one the old guard
// broke) and must keep failing for the shared-browser loop to be re-broken.

import { describe, it, expect } from 'vitest';
import type { IBrowser, PageCapture, CrawlPage, CrawlOptions, CaptureOptions, ScrollOptions } from '@robot/browser';
import { runExtraction } from './extraction-orchestrator.js';

function makeCapture(url: string): PageCapture {
  return {
    url,
    html: '<html><body><h1>Widget</h1><p>Realistic on-page content so checkPageHealth sees a real page rather than an empty interstitial. This paragraph only exists to carry the fixture past the almost-no-content gate.</p></body></html>',
    markdown: '',
    screenshot: Buffer.alloc(0),
    screenshotTiles: [],
    verdict: { kind: 'ok', status: 200 },
    title: 'Widget',
    timestamp: 0,
    structuredData: {
      ldJson: [{ '@type': 'Product', name: 'Widget' }],
      nextData: null,
      initialState: null,
      meta: {},
    },
    interceptedRequests: [],
  };
}

/**
 * A fully in-memory `IBrowser` — no real Playwright — that records `close()`
 * calls and serves a fresh capture (mechanically resolvable via JSON-LD, so
 * a real field actually resolves) on every `capture()` call. This is the
 * shape of the browser `startExecution` hands to `extractItem`: launched
 * once, reused across every item, with no `capture` injected into any call.
 *
 * `close()` actually closes, the way `PlaywrightBrowser.close()` does: it
 * nulls out the underlying browser, and every subsequent `capture()` throws
 * "Browser not launched." (see packages/browser/src/playwright-browser.ts,
 * lines ~182/306/312/325). A fake that merely counted `close()` calls without
 * this would let test 2 pass against the buggy orchestrator — it needs to
 * actually reproduce "item 2 fails because item 1 closed the browser."
 */
class RecordingBrowser implements IBrowser {
  closeCalls = 0;
  captureCalls = 0;
  private closed = false;

  async launch(): Promise<void> {
    this.closed = false;
  }

  async capture(url: string, _options?: CaptureOptions): Promise<PageCapture> {
    if (this.closed) throw new Error('Browser not launched. Call launch() first.');
    this.captureCalls++;
    return makeCapture(url);
  }

  async evaluate<T = unknown>(): Promise<T> {
    if (this.closed) throw new Error('Browser not launched. Call launch() first.');
    return { data: [], fieldCount: 0 } as T;
  }

  async setContentEvaluate<T = unknown>(): Promise<T> {
    if (this.closed) throw new Error('Browser not launched. Call launch() first.');
    return { data: [], fieldCount: 0 } as T;
  }

  async close(): Promise<void> {
    this.closeCalls++;
    this.closed = true;
  }

  async *crawl(_startUrl: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {}

  // eslint-disable-next-line require-yield
  async *scrollPages(_startUrl: string, _options: ScrollOptions): AsyncGenerator<CrawlPage> {
    throw new Error('not used');
  }
}

/** Same recording behaviour, but `capture()` throws — for the error-path test. */
class ThrowingBrowser implements IBrowser {
  closeCalls = 0;

  async launch(): Promise<void> {}

  async capture(): Promise<PageCapture> {
    throw new Error('navigation failed');
  }

  async evaluate<T = unknown>(): Promise<T> {
    return { data: [], fieldCount: 0 } as T;
  }

  async setContentEvaluate<T = unknown>(): Promise<T> {
    return { data: [], fieldCount: 0 } as T;
  }

  async close(): Promise<void> {
    this.closeCalls++;
  }

  async *crawl(_startUrl: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {}

  // eslint-disable-next-line require-yield
  async *scrollPages(_startUrl: string, _options: ScrollOptions): AsyncGenerator<CrawlPage> {
    throw new Error('not used');
  }
}

const FIELDS = [{ name: 'title', type: 'string' }];

function noOpDeps(browser: IBrowser) {
  return {
    browser,
    agent: null,
    lookupCache: async () => null,
    saveCache: async () => {},
    acquireLock: async () => () => {},
  };
}

describe('runExtraction — browser lifecycle (no injected capture)', () => {
  it('does not close the browser it was given', async () => {
    const browser = new RecordingBrowser();

    await runExtraction(
      { url: 'https://example.com/p/1', fields: FIELDS, pageType: 'detail' },
      noOpDeps(browser),
    );

    expect(browser.closeCalls).toBe(0);
  });

  it('the actual regression: two sequential calls on the same browser both succeed', async () => {
    const browser = new RecordingBrowser();

    const first = await runExtraction(
      { url: 'https://example.com/p/1', fields: FIELDS, pageType: 'detail' },
      noOpDeps(browser),
    );
    // The second call is the one the old guard broke: item 1's `runExtraction`
    // closed the shared browser, so `browser.capture()` on item 2 threw
    // "Browser not launched" (or similar) instead of returning data.
    const second = await runExtraction(
      { url: 'https://example.com/p/2', fields: FIELDS, pageType: 'detail' },
      noOpDeps(browser),
    );

    expect(first.data[0]?.title).toBe('Widget');
    expect(second.data[0]?.title).toBe('Widget');
    expect(browser.captureCalls).toBe(2);
  });

  it('a capture failure propagates the error and still does not close the browser', async () => {
    const browser = new ThrowingBrowser();

    await expect(
      runExtraction(
        { url: 'https://example.com/p/1', fields: FIELDS, pageType: 'detail' },
        noOpDeps(browser),
      ),
    ).rejects.toThrow('navigation failed');

    expect(browser.closeCalls).toBe(0);
  });
});
