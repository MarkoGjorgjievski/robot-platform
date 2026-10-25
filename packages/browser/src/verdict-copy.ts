// The one sentence each verdict gets, so the listing bar, the proof card,
// the run page and Add website never disagree (spec 2026-10-09 §A1).
import type { CaptureErrorKind, CaptureVerdict, WallVendor } from './types.js';

const VENDOR: Record<WallVendor, string> = { cloudflare: 'Cloudflare', akamai: 'Akamai', perimeterx: 'PerimeterX', datadome: 'DataDome', 'aws-waf': 'AWS WAF', unknown: '' };

/**
 * The one sentence for a throw the browser layer never turned into a
 * `CaptureVerdict` or `CaptureError` — a Playwright exception before any
 * page existed (campaign 2, 2026-10-11: an orphaned api-server's Chromium
 * exiting with `STATUS_DLL_INIT_FAILED` four times in a row). The raw
 * exception text (hundreds of words, "browserType.launch: … Call log: …")
 * never reaches the customer; it is logged instead.
 */
export const BROWSER_UNAVAILABLE = "We couldn't open a browser to read this page. Try again in a minute.";

/** Spec 2026-10-24 proxy §2.2: the staff sentence for a page the proxy would not carry. A customer reads the blocked
 *  sentence instead (`captureWords`, @robot/scraper/customer-copy). */
export const PROXY_REFUSED = 'The proxy refused the connection.';

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// Staff detail: a customer never reads these as written. `@robot/app`'s
// `lib/capture-words.ts` maps each shape below to its customer sentence at
// display time (spec 2026-10-21) — change a sentence here and its
// capture-words test fails until the mapper learns the new shape.
export function verdictSentence(v: CaptureVerdict | { kind: CaptureErrorKind }, requestedUrl: string): string {
  const host = hostOf(requestedUrl);
  switch (v.kind) {
    case 'ok': return `Reached ${host} (HTTP ${v.status}).`;
    case 'refused': {
      const vendor = v.vendor && VENDOR[v.vendor] ? `, ${VENDOR[v.vendor]}` : '';
      return `${host} refused the browser (HTTP ${v.status}${vendor}). We can't read this website from here yet.`;
    }
    case 'challenge': return `${host} asked for a human check (CAPTCHA). Wait a few minutes and try again; pasting product pages won't help, they are behind the same check.`;
    case 'not-found': return `That page doesn't exist on ${host} (404). Check the address.`;
    case 'redirected': return `That address led to ${v.to}. Paste a page on ${host}.`;
    case 'blank': return `${host} sent an empty page. Try again.`;
    case 'wrong-variant': return `The page did not show the variant the address names (${v.named}).`;
    case 'crashed': return 'The browser crashed on this page. Try again.';
    case 'unreachable': return `${host} could not be reached (no response).`;
    case 'timeout': return `${host} did not answer in time.`;
    case 'proxy': return PROXY_REFUSED;
  }
}
