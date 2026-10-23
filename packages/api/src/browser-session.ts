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
import type { IBrowser } from '@robot/browser';
import { PlaywrightBrowser } from '@robot/browser';
import { currentJob } from './jobs/context.js';

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

/**
 * Launch a browser, run `fn` with it, and always close it in a `finally` —
 * regardless of whether `fn` resolves or throws.
 *
 * `browserFactory` defaults to the real `PlaywrightBrowser` but is injectable
 * so tests can pass a fake; that injectability is the whole point, since it's
 * what makes the close-on-every-path guarantee testable without a real
 * browser.
 */
export async function withBrowserSession<T>(
  fn: (browser: IBrowser) => Promise<T>,
  browserFactory: () => IBrowser = () => new PlaywrightBrowser(),
): Promise<T> {
  const g = gate;
  if (g && inSession.getStore()) throw new NestedBrowserSessionError();
  const release = g ? await g.acquire() : () => {};
  let browser: IBrowser;
  let untrack: () => void;
  try {
    browser = browserFactory();
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
    await browser.launch({ headless: true });
    // A job stopped while its browser launched (stuck, lease lost, shutdown): the gate's close may have
    // come before Chromium was there to close, so close it here, at once, and do nothing with it.
    if (currentJob()?.signal.aborted) throw new Error('The job was stopped while its browser started.');
    return await inSession.run(true, () => fn(browser));
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
