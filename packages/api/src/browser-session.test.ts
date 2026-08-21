// packages/api/src/browser-session.test.ts
//
// `withBrowserSession` is the structural half of "whoever launches the
// browser closes it": it owns launch-and-always-close so a procedure can't
// forget the `finally` (as `analyse` used to — see the router changes this
// test file accompanies). Covered here with a fake `IBrowser`, no real
// Playwright involved.

import { describe, it, expect } from 'vitest';
import type { IBrowser, PageCapture, CrawlPage, CrawlOptions, CaptureOptions, BrowserOptions } from '@robot/browser';
import { withBrowserSession } from './browser-session.js';

/** Records launch/close calls; never touches a real browser. */
class RecordingBrowser implements IBrowser {
  launchCalls = 0;
  closeCalls = 0;

  async launch(_options?: BrowserOptions): Promise<void> {
    this.launchCalls++;
  }

  async capture(): Promise<PageCapture> {
    throw new Error('not used in these tests');
  }

  async evaluate<T = unknown>(): Promise<T> {
    return {} as T;
  }

  async setContentEvaluate<T = unknown>(): Promise<T> {
    return {} as T;
  }

  async close(): Promise<void> {
    this.closeCalls++;
  }

  async *crawl(_startUrl: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {}
}

/**
 * `launch()` throws part-way. This is not hypothetical: `PlaywrightBrowser
 * .launch` is two steps — `launcher.launch()` then `newContext()` — so a
 * failure in the second leaves a live chromium process behind that only
 * `close()` will reap.
 */
class ThrowingLaunchBrowser extends RecordingBrowser {
  override async launch(): Promise<void> {
    this.launchCalls++;
    throw new Error('launch failed');
  }
}

/** Same as RecordingBrowser, but `close()` itself throws. */
class ThrowingCloseBrowser extends RecordingBrowser {
  override async close(): Promise<void> {
    this.closeCalls++;
    throw new Error('close failed');
  }
}

describe('withBrowserSession', () => {
  it('closes the browser after the function resolves, and returns its result', async () => {
    const browser = new RecordingBrowser();

    const result = await withBrowserSession(async (b) => {
      expect(b).toBe(browser);
      return 42;
    }, () => browser);

    expect(result).toBe(42);
    expect(browser.launchCalls).toBe(1);
    expect(browser.closeCalls).toBe(1);
  });

  it('closes the browser when the function throws, and propagates the error', async () => {
    const browser = new RecordingBrowser();

    await expect(
      withBrowserSession(async () => {
        throw new Error('fn failed');
      }, () => browser),
    ).rejects.toThrow('fn failed');

    expect(browser.closeCalls).toBe(1);
  });

  it('a throwing close() does not mask the function error', async () => {
    const browser = new ThrowingCloseBrowser();

    await expect(
      withBrowserSession(async () => {
        throw new Error('fn failed');
      }, () => browser),
    ).rejects.toThrow('fn failed');
  });

  it('closes the browser when launch() itself throws, and propagates the error', async () => {
    // `launch()` used to sit OUTSIDE the try, so a launch that failed after
    // spawning the process leaked a live chromium with no close() ever called
    // — and every subsequent call leaked another. PlaywrightBrowser.close() is
    // null-safe, so closing a half-launched browser is always allowed.
    const browser = new ThrowingLaunchBrowser();

    await expect(
      withBrowserSession(async () => 'never runs', () => browser),
    ).rejects.toThrow('launch failed');

    expect(browser.launchCalls).toBe(1);
    expect(browser.closeCalls).toBe(1);
  });

  it('does not run the function when launch() throws', async () => {
    const browser = new ThrowingLaunchBrowser();
    let ran = false;

    await expect(
      withBrowserSession(async () => { ran = true; }, () => browser),
    ).rejects.toThrow('launch failed');

    expect(ran).toBe(false);
  });

  it('a throwing close() does not mask a launch error either', async () => {
    class BothThrow extends ThrowingLaunchBrowser {
      override async close(): Promise<void> {
        this.closeCalls++;
        throw new Error('close failed');
      }
    }
    const browser = new BothThrow();

    await expect(
      withBrowserSession(async () => 'never runs', () => browser),
    ).rejects.toThrow('launch failed');
    expect(browser.closeCalls).toBe(1);
  });

  it('a throwing close() after a successful function still surfaces the result path cleanly (does not throw the close error)', async () => {
    const browser = new ThrowingCloseBrowser();

    // close() throwing on the success path must not reject the whole call —
    // the caller's real work already succeeded; a broken cleanup shouldn't
    // turn a good result into a failure.
    const result = await withBrowserSession(async () => 'ok', () => browser);

    expect(result).toBe('ok');
    expect(browser.closeCalls).toBe(1);
  });
});
