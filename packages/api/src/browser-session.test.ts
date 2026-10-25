// packages/api/src/browser-session.test.ts
//
// `withBrowserSession` is the structural half of "whoever launches the
// browser closes it": it owns launch-and-always-close so a procedure can't
// forget the `finally` (as `analyse` used to — see the router changes this
// test file accompanies). Covered here with a fake `IBrowser`, no real
// Playwright involved.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IBrowser, PageCapture, CrawlPage, CrawlOptions, CaptureOptions, BrowserOptions, ScrollOptions } from '@robot/browser';
import { withBrowserSession, setBrowserGate, NestedBrowserSessionError, type BrowserGate } from './browser-session.js';

/** Records launch/close calls; never touches a real browser. */
class RecordingBrowser implements IBrowser {
  launchCalls = 0;
  closeCalls = 0;

  launchOptions: BrowserOptions | undefined;

  async launch(options?: BrowserOptions): Promise<void> {
    this.launchCalls++;
    this.launchOptions = options;
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

  // eslint-disable-next-line require-yield
  async *scrollPages(_startUrl: string, _options: ScrollOptions): AsyncGenerator<CrawlPage> {
    throw new Error('not used in these tests');
  }
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

describe('withBrowserSession under a gate', () => {
  const fake = () => ({ launch: vi.fn(async () => {}), close: vi.fn(async () => {}) }) as unknown as IBrowser;
  afterEach(() => setBrowserGate(null));

  it('asks the gate before launching, tracks the browser, and releases after close', async () => {
    const events: string[] = [];
    const gate: BrowserGate = {
      acquire: async () => { events.push('acquire'); return () => events.push('release'); },
      track: () => { events.push('track'); return () => events.push('untrack'); },
    };
    setBrowserGate(gate);
    const b = fake();
    await withBrowserSession(async () => { events.push('work'); }, () => b);
    expect(events).toEqual(['acquire', 'track', 'work', 'untrack', 'release']);
    expect(b.close).toHaveBeenCalledOnce();
  });

  it('refuses a session opened inside another', async () => {
    setBrowserGate({ acquire: async () => () => {}, track: () => () => {} });
    await expect(withBrowserSession(() => withBrowserSession(async () => 1, fake), fake)).rejects.toBeInstanceOf(NestedBrowserSessionError);
  });

  it('without a gate, nests as before (scripts)', async () => {
    await expect(withBrowserSession(() => withBrowserSession(async () => 1, fake), fake)).resolves.toBe(1);
  });
});

describe('withBrowserSession under a gate — a factory that throws', () => {
  afterEach(() => setBrowserGate(null));

  it('gives the gate its place back', async () => {
    const events: string[] = [];
    setBrowserGate({ acquire: async () => { events.push('acquire'); return () => events.push('release'); }, track: () => () => {} });
    await expect(withBrowserSession(async () => 1, () => { throw new Error('no browser'); })).rejects.toThrow('no browser');
    expect(events).toEqual(['acquire', 'release']);
  });
});

describe('withBrowserSession in a job that is stopped while its browser launches', () => {
  it('closes the browser at once and never runs the function', async () => {
    const { runInJob } = await import('./jobs/context.js');
    const controller = new AbortController();
    const browser = new RecordingBrowser();
    browser.launch = async () => { browser.launchCalls++; controller.abort('stuck'); };  // stopped mid-launch
    const fn = vi.fn(async () => 'ran');
    const ctx = { jobId: 'j', claim: 'j#1', type: 't', lane: 'interactive' as const, attempt: 1, retry: false, signal: controller.signal, progress: () => {} };
    await expect(runInJob(ctx, () => withBrowserSession(fn, () => browser))).rejects.toThrow(/stopped/);
    expect(fn).not.toHaveBeenCalled();
    expect(browser.closeCalls).toBe(1);
  });
});

describe('withBrowserSession and the website profile (spec 2026-10-24 proxy §2.2)', () => {
  const profile = { proxy: { server: 'http://proxy.test:7000', username: 'u', password: 'pw-secret' }, locale: 'de-DE', timezoneId: 'Europe/Berlin' };

  it('launches with the profile; with none, exactly as before; a bare function is still the factory', async () => {
    const a = new RecordingBrowser();
    await withBrowserSession(async () => 'ok', { profile, factory: () => a });
    expect(a.launchOptions).toEqual({ headless: true, ...profile });
    const b = new RecordingBrowser();
    await withBrowserSession(async () => 'ok', () => b);
    expect(b.launchOptions).toEqual({ headless: true });
    const c = new RecordingBrowser();
    await withBrowserSession(async () => 'ok', { factory: () => c });
    expect(c.launchOptions).toEqual({ headless: true });
  });

  it('no error leaves a session carrying the proxy password (spec §3.2)', async () => {
    const browser = new RecordingBrowser();
    const err = await withBrowserSession(async () => { throw new Error('newContext: proxy http://u:pw-secret@proxy.test:7000 refused (pw-secret)'); },
      { profile, factory: () => browser }).catch((e: Error) => e);
    expect(err.message).not.toContain('pw-secret');
    expect(err.stack ?? '').not.toContain('pw-secret');
    expect(browser.closeCalls).toBe(1);
  });
});
