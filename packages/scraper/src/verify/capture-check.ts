// packages/scraper/src/verify/capture-check.ts
// Is this capture the page we asked for, and usable? Shared by verification
// (run-verification.ts) and the proof-page capture (proof-page-capture.ts) so
// the two can never disagree about what "not captured" means.
import { checkPageHealth, type PageCapture } from '@robot/browser';

/** Same host and path (trailing slash and fragment ignored; query ignored — many shops append tracking params). */
export function samePath(finalUrl: string, requested: string): boolean {
  try {
    const a = new URL(finalUrl); const b = new URL(requested);
    const norm = (p: string) => p.replace(/\/+$/, '') || '/';
    return a.hostname.toLowerCase() === b.hostname.toLowerCase() && norm(a.pathname) === norm(b.pathname);
  } catch { return false; }
}

/** null when the capture is the requested page and usable; else the reason. */
export function captureProblem(capture: Pick<PageCapture, 'url' | 'html' | 'title'>, requestedUrl: string): string | null {
  // Spec §4.1: a capture that landed on a different path (category page,
  // block page) is not this product page. `PageCapture.url` is the FINAL
  // url — `PlaywrightBrowser.capture` sets it from `page.url()` after
  // navigation (playwright-browser.ts ~265) — so this comparison bites.
  if (!samePath(capture.url, requestedUrl)) return `redirected to ${capture.url}`;
  // I4: a block page, CAPTCHA interstitial or soft 404 served AT the
  // requested path passes `samePath` and used to be handed to the
  // certifier as if it were the product page — where every field then
  // failed `not_found`, blaming the customer's expected values for a
  // page we never actually got. The same `checkPageHealth` the extraction
  // chain has always used says so plainly: `not_captured`, with the
  // block's own reason, and the amber "could not be captured" banner the
  // Schema screen already renders for a redirect.
  const health = checkPageHealth(capture.html, capture.title, requestedUrl);
  return health.healthy ? null : health.reason ?? 'page is not usable';
}
