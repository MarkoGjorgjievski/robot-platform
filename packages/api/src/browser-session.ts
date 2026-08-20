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

import type { IBrowser } from '@robot/browser';
import { PlaywrightBrowser } from '@robot/browser';

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
  const browser = browserFactory();
  await browser.launch({ headless: true });
  try {
    return await fn(browser);
  } finally {
    try {
      await browser.close();
    } catch (err) {
      // A broken close() must not replace fn's real outcome (result or
      // error) — log it and move on rather than letting it escape the
      // `finally` and mask whatever `fn` actually did.
      console.error('[browser-session] browser.close() failed (non-fatal):', err);
    }
  }
}
