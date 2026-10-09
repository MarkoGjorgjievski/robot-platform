// One verdict per capture (spec 2026-10-09 §A1). Order matters: the response
// status and the final host are facts; the page-health classifier is a reading
// of the body; blank is decided last and only for a 200 that showed nothing.
import { checkPageHealth, detectWall } from './page-health.js';
import type { CaptureErrorKind, CaptureVerdict } from './types.js';

export function okVerdict(status = 0): CaptureVerdict {
  return { kind: 'ok', status };
}

const host = (u: string): string => {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};

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

  // A wall is a wall whatever the status; a flat denial status is refused.
  // A challenge page served with 401/403 (Cloudflare's managed challenge to a
  // headless browser) is a denial, not a check the visitor could pass; AWS WAF
  // serves its passable CAPTCHA with 405/202 and stays a challenge.
  if (wall?.kind === 'challenge') return { kind: status === 401 || status === 403 ? 'refused' : 'challenge', status, vendor: wall.vendor };
  if (wall?.kind === 'refused') return { kind: 'refused', status, vendor: wall.vendor };
  if (status === 404 || status === 410) return { kind: 'not-found', status };
  if (status === 401 || status === 403 || status === 405 || status === 429 || status >= 500) return { kind: 'refused', status };

  const from = host(input.requestedUrl), to = host(input.finalUrl);
  if (from && to && from !== to) return { kind: 'redirected', status, to };

  const health = checkPageHealth(input.html, input.title, input.requestedUrl);
  if (!health.healthy) {
    if (health.statusCode === 404) return { kind: 'not-found', status };
    // A wall the header/body scan missed but the older patterns caught.
    if (/bot detection|captcha|human verification|access denied/i.test(health.reason ?? '')) return { kind: 'challenge', status, vendor: 'unknown' };
    return { kind: 'blank', status };
  }
  if (input.boxCount === 0) {
    const text = input.html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 1000) return { kind: 'blank', status };
  }
  return { kind: 'ok', status };
}

/** Why `page.goto` threw, in three words a consumer can act on. */
export function classifyNavigationError(err: unknown): CaptureErrorKind {
  const m = String((err as Error)?.message ?? err).toLowerCase();
  if (m.includes('crashed')) return 'crashed';
  if (m.includes('timeout') && m.includes('exceeded')) return 'timeout';
  return 'unreachable';
}
