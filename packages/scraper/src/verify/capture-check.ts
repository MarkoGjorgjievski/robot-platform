// packages/scraper/src/verify/capture-check.ts
// Is this capture the page we asked for, and usable? Shared by verification
// (run-verification.ts) and the proof-page capture (proof-page-capture.ts) so
// the two can never disagree about what "not captured" means.
import { verdictSentence, type CaptureVerdict, type PageCapture } from '@robot/browser';

/** Same host and path (trailing slash and fragment ignored; query ignored — many shops append tracking params). */
export function samePath(finalUrl: string, requested: string): boolean {
  try {
    const a = new URL(finalUrl); const b = new URL(requested);
    const norm = (p: string) => p.replace(/\/+$/, '') || '/';
    return a.hostname.toLowerCase() === b.hostname.toLowerCase() && norm(a.pathname) === norm(b.pathname);
  } catch { return false; }
}

/** A capture that is not the requested page, usable — with the browser's verdict when that is why. */
export class CaptureProblemError extends Error {
  constructor(message: string, public readonly verdict?: CaptureVerdict) {
    super(message);
    this.name = 'CaptureProblemError';
  }
}

/**
 * null when the capture is the requested page and usable; else the reason
 * (the verdict's customer sentence when the browser's verdict says so, or the
 * path-level "redirected to …" that proof pages still need).
 *
 * The verdict is the one truth about the page (spec 2026-10-09 §A1): a block
 * page, CAPTCHA or soft 404 served AT the requested path is decided by the
 * browser's classifier, so it is `not_captured` with its own sentence rather
 * than handed to the certifier as if it were the product page. A same-host
 * landing on another path (category page) is still not this product page —
 * `PageCapture.url` is the FINAL url, so the path comparison bites.
 */
export function captureProblem(
  capture: Pick<PageCapture, 'url' | 'html' | 'title' | 'verdict'>,
  requestedUrl: string,
): { reason: string; verdict?: CaptureVerdict } | null {
  if (capture.verdict.kind !== 'ok') return { reason: verdictSentence(capture.verdict, requestedUrl), verdict: capture.verdict };
  if (!samePath(capture.url, requestedUrl)) return { reason: `redirected to ${capture.url}` };
  return null;
}
