// The other half of "whoever launches the browser closes it" (see
// `ExtractionDeps.browser` in `@robot/scraper`'s extraction-orchestrator.ts
// and `AnalysisDeps.browser` in analysis-orchestrator.ts): those orchestrators
// never launch or close a browser, so every procedure that DOES launch one is
// on the hook for closing it — on every exit path, including a throw. That
// used to be a hand-written `finally` per procedure, and one procedure
// (`scraper.ts`'s `analyse`) didn't have one at all: its early-throw path
// (no cached schema, no agent) leaked the browser outright.
//
// Making this structural instead of a convention means a new browser-owning
// procedure gets the close for free instead of needing to remember it.
//
// A process may install a gate (the worker does, spec 2026-10-23 §4.3): every
// session then waits for it, is tracked by it, and may not be opened inside
// another session.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { BrowserProfile, IBrowser } from '@robot/browser';
import { PlaywrightBrowser } from '@robot/browser';
import { currentJob } from './jobs/context.js';
import { redactProxy } from './proxy/proxy-url.js';

/** The worker's limit on browsers (jobs/browser-gate.ts). Unset: every session launches at once, as before. */
export type BrowserGate = { acquire(): Promise<() => void>; track(browser: IBrowser): () => void };

let gate: BrowserGate | null = null;
const inSession = new AsyncLocalStorage<true>();

export function setBrowserGate(next: BrowserGate | null): void { gate = next; }

export class NestedBrowserSessionError extends Error {
  constructor() {
    super('A browser session was opened inside another one: a job must never wait for a second browser while holding one.');
    this.name = 'NestedBrowserSessionError';
  }
}

export type SessionOptions = {
  /** The website's proxy, locale and time zone (spec 2026-10-24 proxy §2.2). None: direct, en-US / New York, as before. */
  profile?: BrowserProfile;
  /** The browser to launch; a fake in tests. Default: the real `PlaywrightBrowser`. */
  factory?: () => IBrowser;
};

/**
 * Spec 2026-10-24 proxy §3.2: no error leaves a session carrying the proxy's credentials (a launch error can quote
 * them, as written or URL-encoded). Any address's userinfo becomes `***` (`redactProxy`), and the username and the
 * password themselves are starred wherever they appear — in the message, the stack, a CaptureError's staff `detail`,
 * and one level down in `cause` and an AggregateError's `errors`; a bare string thrown is scrubbed too. A secret of
 * one or two characters is not starred on its own (it would star every such letter in a stack); its address still is.
 */
function withoutSecret(err: unknown, proxy: BrowserProfile['proxy']): unknown {
  if (!proxy) return err;
  const forms = [...new Set([proxy.password, proxy.username].filter((v): v is string => !!v && v.length > 2)
    .flatMap((v) => [v, encodeURIComponent(v)]))].sort((a, b) => b.length - a.length);
  const scrub = (text: string) => forms.reduce((acc, f) => acc.split(f).join('***'), redactProxy(text));
  const clean = (e: unknown, depth: number): unknown => {
    if (typeof e === 'string') return scrub(e);
    if (!(e instanceof Error)) return e;
    const fields = e as Error & { detail?: unknown; cause?: unknown; errors?: unknown };
    e.message = scrub(e.message);
    if (typeof e.stack === 'string') e.stack = scrub(e.stack);
    if (typeof fields.detail === 'string') fields.detail = scrub(fields.detail);
    if (depth > 0) {
      if (fields.cause !== undefined) fields.cause = clean(fields.cause, depth - 1);
      if (Array.isArray(fields.errors)) fields.errors = fields.errors.map((x) => clean(x, depth - 1));
    }
    return e;
  };
  return clean(err, 1);
}

/**
 * Launch a browser, run `fn` with it, and always close it in a `finally` —
 * regardless of whether `fn` resolves or throws.
 *
 * `opts.factory` defaults to the real `PlaywrightBrowser` but is injectable
 * so tests can pass a fake; that injectability is the whole point, since it's
 * what makes the close-on-every-path guarantee testable without a real
 * browser.
 *
 * `opts.profile` is the website's browser (spec 2026-10-24 proxy §2.2) — a website-scoped caller opens its session
 * through `forWebsite` (proxy/website-session.ts), which reads it. A bare function as `opts` is the factory (the older
 * form tests use).
 */
export async function withBrowserSession<T>(
  fn: (browser: IBrowser) => Promise<T>,
  opts: SessionOptions | (() => IBrowser) = {},
): Promise<T> {
  const { profile = {}, factory = () => new PlaywrightBrowser() }: SessionOptions = typeof opts === 'function' ? { factory: opts } : opts;
  const g = gate;
  if (g && inSession.getStore()) throw new NestedBrowserSessionError();
  const release = g ? await g.acquire() : () => {};
  let browser: IBrowser;
  let untrack: () => void;
  try {
    browser = factory();
    untrack = g ? g.track(browser) : () => {};
  } catch (err) {
    release(); // a factory that throws must not keep the gate's place
    throw err;
  }
  try {
    // `launch()` belongs INSIDE the try. `PlaywrightBrowser.launch` is two
    // steps — `launcher.launch()` then `newContext()` — so a throw from the
    // second leaves a live chromium process that only `close()` reaps. With
    // the launch outside, that process leaked with no close ever called, and
    // every subsequent call leaked another. `PlaywrightBrowser.close()` is
    // null-safe, so closing a browser that never finished launching is fine.
    await browser.launch({ headless: true, ...profile });
    // A job stopped while its browser launched (stuck, lease lost, shutdown): the gate's close may have
    // come before Chromium was there to close, so close it here, at once, and do nothing with it.
    if (currentJob()?.signal.aborted) throw new Error('The job was stopped while its browser started.');
    return await inSession.run(true, () => fn(browser));
  } catch (err) {
    throw withoutSecret(err, profile.proxy);
  } finally {
    try {
      await browser.close();
    } catch (err) {
      // A broken close() must not replace fn's real outcome (result or
      // error) — log it and move on rather than letting it escape the
      // `finally` and mask whatever `fn` actually did.
      console.error('[browser-session] browser.close() failed (non-fatal):', err);
    }
    untrack();
    release();
  }
}
