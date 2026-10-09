// One verdict per capture (spec 2026-10-09 §A1). Order matters: what the page
// says (a wall's words) first, then the response status and the final site
// (facts), then the page-health classifier (a reading of the body); blank is
// decided last and only for a 2xx that showed nothing.
import { checkPageHealth, detectWall, visibleText, wallVendor } from './page-health.js';
import { rootDomain } from './root-domain.js';
import type { CaptureErrorKind, CaptureVerdict } from './types.js';

export function okVerdict(status = 0): CaptureVerdict {
  return { kind: 'ok', status };
}

const host = (u: string): string => {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};

/** Statuses a wall vendor answers with; only on these may the vendor be named without the page's words. */
const DENIAL_STATUSES = new Set([401, 403, 405, 429, 503]);

export function classifyVerdict(input: {
  requestedUrl: string;
  finalUrl: string;
  status: number | null;
  headers: Record<string, string>;
  html: string;
  title: string;
  boxCount?: number;
}): CaptureVerdict {
  const status = input.status ?? 0;
  const wall = detectWall(input.html, input.title, input.headers);

  // A wall the page says it is, whatever the status. A challenge page served
  // with 401/403 (Cloudflare's managed challenge to a headless browser) is a
  // denial, not a check the visitor could pass; AWS WAF serves its passable
  // CAPTCHA with 405/202 and stays a challenge.
  if (wall?.kind === 'challenge') return { kind: status === 401 || status === 403 ? 'refused' : 'challenge', status, vendor: wall.vendor };
  if (wall?.kind === 'refused') return { kind: 'refused', status, vendor: wall.vendor };
  if (status === 404 || status === 410) return { kind: 'not-found', status };
  // Every other 4xx (otto.de answers 400 to headless Chromium) and every 5xx
  // is the site declining to serve the page. A vendor is named only on a
  // denial status and a thin page; on a 2xx it never makes a wall.
  if (status >= 400) {
    const thin = visibleText(input.html).length < 1000;
    const vendor = DENIAL_STATUSES.has(status) && thin ? wallVendor(input.html, input.title, input.headers) : null;
    return vendor ? { kind: 'refused', status, vendor } : { kind: 'refused', status };
  }

  // A different registrable domain (a login or geo host); www2.hm.com for
  // www.hm.com, or uk.x.com for x.com, is the same site.
  const from = host(input.requestedUrl), to = host(input.finalUrl);
  if (from && to && rootDomain(from) !== rootDomain(to)) return { kind: 'redirected', status, to };

  const health = checkPageHealth(input.html, input.title, input.requestedUrl);
  if (!health.healthy) {
    if (health.statusCode === 404) return { kind: 'not-found', status };
    // A wall the header/body scan missed but the older patterns caught.
    if (/access denied/i.test(health.reason ?? '')) return { kind: 'refused', status, vendor: 'unknown' };
    if (/bot detection|captcha|human verification/i.test(health.reason ?? '')) return { kind: 'challenge', status, vendor: 'unknown' };
    return { kind: 'blank', status };
  }
  if (input.boxCount === 0 && visibleText(input.html).length < 1000) return { kind: 'blank', status };
  return { kind: 'ok', status };
}

/** Why `page.goto` threw, in three words a consumer can act on. */
export function classifyNavigationError(err: unknown): CaptureErrorKind {
  const m = String((err as Error)?.message ?? err).toLowerCase();
  if (m.includes('crashed')) return 'crashed';
  if (m.includes('timeout') && m.includes('exceeded')) return 'timeout';
  return 'unreachable';
}
