// The one sentence each verdict gets, so the listing bar, the proof card,
// the run page and Add website never disagree (spec 2026-10-09 §A1).
import type { CaptureErrorKind, CaptureVerdict, WallVendor } from './types.js';

const VENDOR: Record<WallVendor, string> = { cloudflare: 'Cloudflare', akamai: 'Akamai', perimeterx: 'PerimeterX', datadome: 'DataDome', 'aws-waf': 'AWS WAF', unknown: '' };

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

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
    case 'crashed': return 'The browser crashed on this page. It will be retried.';
    case 'unreachable': return `${host} could not be reached (no response).`;
    case 'timeout': return `${host} did not answer in time.`;
  }
}
