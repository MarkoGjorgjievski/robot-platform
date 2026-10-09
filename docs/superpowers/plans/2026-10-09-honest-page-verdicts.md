# Honest page verdicts — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page capture carries one honest verdict that every surface shows in the same words, hosts that challenge us are backed off, Add website checks reachability for free, and a structured suggestion no element shows is never "agreed".

**Architecture:** The browser package decides a `CaptureVerdict` once inside `capture()` from the main response, the final URL and the (extended) page-health classifier, and resolves with it; only "no document" rejects, as a classified `CaptureError`. One pure module turns a verdict into the customer sentence. The scraper's existing health-check call sites read the verdict instead; `domain-lock` gains per-host backoff fed by verdicts. The API's finder, proof-page capture and run planning/finalising surface the verdict, and `crawl.execute` refuses a run that failed planning. The app shows the sentence in the listing bar, the proof card, the run page and a reachability line on a new website. Separately, the client agreement rule treats zero pointable boxes as `needs-you`.

**Tech Stack:** TypeScript ESM across `@robot/browser`, `@robot/scraper`, `@robot/api`, `@robot/app`; Playwright; Vitest (node env; Chromium tests exist in `@robot/browser` and `@robot/api`); tRPC v11; React 19.

**Spec:** `docs/superpowers/specs/2026-10-09-honest-page-verdicts-design.md` — read it first; the plan argues from it.

## Global Constraints

- All packages are ESM; `@robot/api` and `@robot/scraper` import local files with a `.js` suffix, `@robot/browser` too; `@robot/app` imports without an extension.
- Exact copy from spec §A1's table (host filled in): refused "{host} refused the browser (HTTP {status}{, Vendor}). We can't read this website from here yet."; challenge "{host} asked for a human check (CAPTCHA). Wait a few minutes and try again; pasting product pages won't help, they are behind the same check."; not-found "That page doesn't exist on {host} (404). Check the address."; redirected "That address led to {to}. Paste a page on {host}."; blank "{host} sent an empty page. Try again."; crashed "The browser crashed on this page. It will be retried."; unreachable "{host} could not be reached (no response)."; timeout "{host} did not answer in time."
- Row word (spec §A2): "only in the page data on product n"; proof-row words "screenshot refused on product n" / "human check on product n" where the verdict is known, else today's "screenshot failed on product n".
- Backoff (spec §A3): first challenge/refusal → 2 min, doubling per further one, cap 8 min; cleared by an `ok`; waits, never fails.
- `capture()` resolves for any received document (verdict set); rejects only with `CaptureError` (`crashed | unreachable | timeout`).
- Shared checkout: commit with `git commit -m "…" -- <explicit paths>`; `git add -- <path>` first for new files; never stage `packages/app/src/routeTree.gen.ts`.
- Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Per-package gates: `pnpm --filter <pkg> test -- --run` and `pnpm --filter <pkg> typecheck`; never `pnpm -r test`. Chromium tests need Playwright's chromium (installed).
- Nothing here calls a model; nothing spends.

## Review Focus

1. **A wall served with HTTP 200** (Cloudflare "Just a moment", AWS WAF "Let's confirm you are human") must still be `challenge`, never `ok` — Task 1's classifier tests include 200-status wall bodies.
2. **A healthy product page that mentions "captcha" in its scripts** (Target, Newegg) must stay `ok` — Task 1 keeps the substantial-content gate and tests it.
3. **A listing that redirects within the same host** (`/collections/mens-tees` → `/collections/mens-tshirts`) is `ok`, not `redirected`; only a host change is — Task 1 tests both.
4. **A failed run must not become "Done" on Extract** — Task 6 tests `rollUpStatus` with zero items plus an error and `crawl.execute`'s refusal (unit on the pure guard).
5. **Backoff must not deadlock the finder**: a second capture to a backed-off host waits and then runs — Task 4 tests with a fake clock that the wait resolves and that an `ok` clears the state.

---

### Task 1: Verdict types, classifier and customer sentences (`@robot/browser`)

**Files:**
- Modify: `packages/browser/src/types.ts` (append types)
- Modify: `packages/browser/src/page-health.ts` (new vendor patterns; export a `detectWall` helper)
- Create: `packages/browser/src/verdict.ts`, `packages/browser/src/verdict-copy.ts`
- Test: `packages/browser/src/verdict.test.ts`, `packages/browser/src/verdict-copy.test.ts`
- Modify: `packages/browser/src/index.ts` (exports)

**Interfaces:**
- Produces:
  ```ts
  export type WallVendor = 'cloudflare' | 'akamai' | 'perimeterx' | 'datadome' | 'aws-waf' | 'unknown';
  export type CaptureVerdict =
    | { kind: 'ok'; status: number }
    | { kind: 'refused'; status: number; vendor?: WallVendor }
    | { kind: 'challenge'; status: number; vendor?: WallVendor }
    | { kind: 'not-found'; status: number }
    | { kind: 'redirected'; status: number; to: string }
    | { kind: 'blank'; status: number };
  export type CaptureErrorKind = 'crashed' | 'unreachable' | 'timeout';
  export class CaptureError extends Error { kind: CaptureErrorKind; url: string }
  export function classifyVerdict(input: { requestedUrl: string; finalUrl: string; status: number | null; headers: Record<string, string>; html: string; title: string; boxCount?: number }): CaptureVerdict;
  export function detectWall(html: string, title: string, headers: Record<string, string>): { kind: 'challenge' | 'refused'; vendor: WallVendor } | null;  // in page-health.ts
  export function verdictSentence(v: CaptureVerdict | { kind: CaptureErrorKind }, requestedUrl: string): string;  // verdict-copy.ts
  export function classifyNavigationError(err: unknown): CaptureErrorKind;  // verdict.ts
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/browser/src/verdict.test.ts
import { describe, expect, it } from 'vitest';
import { classifyVerdict, classifyNavigationError } from './verdict.js';

const PRODUCT = `<html><head><title>Widget A</title></head><body><h1>Widget A</h1>${'<p>Real product copy that goes on. </p>'.repeat(60)}<script>var captcha = false;</script></body></html>`;
const CF_CHALLENGE = '<html><head><title>Just a moment...</title></head><body><div>Checking your browser before accessing shop.example. Ray ID: abc</div></body></html>';
const AWS_WAF = '<html><head><title>Human Verification</title></head><body><p>Let\'s confirm you are human. Complete the security check.</p></body></html>';
const AKAMAI = '<html><head><title>Access Denied</title></head><body><h1>Access Denied</h1><p>You don\'t have permission to access this page. Reference #18.5f3</p></body></html>';
const base = { requestedUrl: 'https://shop.example/l', finalUrl: 'https://shop.example/l', headers: {} as Record<string, string> };

describe('classifyVerdict', () => {
  it('a healthy 200 page is ok, even when its scripts mention captcha', () => {
    expect(classifyVerdict({ ...base, status: 200, html: PRODUCT, title: 'Widget A' })).toEqual({ kind: 'ok', status: 200 });
  });
  it('a Cloudflare challenge served with 200 is a challenge, vendor cloudflare', () => {
    expect(classifyVerdict({ ...base, status: 200, html: CF_CHALLENGE, title: 'Just a moment...' })).toEqual({ kind: 'challenge', status: 200, vendor: 'cloudflare' });
  });
  it('a 403 with a Cloudflare body is refused, vendor cloudflare', () => {
    expect(classifyVerdict({ ...base, status: 403, headers: { server: 'cloudflare', 'cf-ray': 'x' }, html: CF_CHALLENGE, title: 'Just a moment...' })).toEqual({ kind: 'refused', status: 403, vendor: 'cloudflare' });
  });
  it('an AWS WAF human check is a challenge, vendor aws-waf', () => {
    expect(classifyVerdict({ ...base, status: 405, headers: { 'x-amzn-waf-action': 'challenge' }, html: AWS_WAF, title: 'Human Verification' })).toEqual({ kind: 'challenge', status: 405, vendor: 'aws-waf' });
  });
  it('an Akamai Access Denied is refused, vendor akamai', () => {
    expect(classifyVerdict({ ...base, status: 403, headers: { server: 'AkamaiGHost' }, html: AKAMAI, title: 'Access Denied' })).toEqual({ kind: 'refused', status: 403, vendor: 'akamai' });
  });
  it('a 429 with no wall body is refused with no vendor', () => {
    expect(classifyVerdict({ ...base, status: 429, html: '<html><body>Too many requests</body></html>', title: '' })).toEqual({ kind: 'refused', status: 429 });
  });
  it('a 404 is not-found; so is a soft 404 by title', () => {
    expect(classifyVerdict({ ...base, status: 404, html: PRODUCT, title: 'Widget A' })).toEqual({ kind: 'not-found', status: 404 });
    expect(classifyVerdict({ ...base, status: 200, html: '<html><body>Try searching or go to the home page.</body></html>', title: 'Page not found' })).toEqual({ kind: 'not-found', status: 200 });
  });
  it('a redirect to another host is redirected; within the host it is ok', () => {
    expect(classifyVerdict({ ...base, finalUrl: 'https://login.other.example/x', status: 200, html: PRODUCT, title: 'Widget A' })).toEqual({ kind: 'redirected', status: 200, to: 'login.other.example' });
    expect(classifyVerdict({ ...base, finalUrl: 'https://shop.example/l2?x=1', status: 200, html: PRODUCT, title: 'Widget A' })).toEqual({ kind: 'ok', status: 200 });
  });
  it('a 200 with almost no visible text and no boxes is blank', () => {
    expect(classifyVerdict({ ...base, status: 200, html: '<html><head><script>app()</script></head><body><div id="app"></div></body></html>', title: '', boxCount: 0 })).toEqual({ kind: 'blank', status: 200 });
  });
  it('no status (a replay) with a healthy page is ok with status 0', () => {
    expect(classifyVerdict({ ...base, status: null, html: PRODUCT, title: 'Widget A' })).toEqual({ kind: 'ok', status: 0 });
  });
});

describe('classifyNavigationError', () => {
  it('names a crash, a dead host and a timeout', () => {
    expect(classifyNavigationError(new Error('page.goto: Target crashed'))).toBe('crashed');
    expect(classifyNavigationError(new Error('Page crashed'))).toBe('crashed');
    expect(classifyNavigationError(new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://x'))).toBe('unreachable');
    expect(classifyNavigationError(new Error('page.goto: net::ERR_CONNECTION_REFUSED'))).toBe('unreachable');
    expect(classifyNavigationError(new Error('page.goto: Timeout 60000ms exceeded.'))).toBe('timeout');
    expect(classifyNavigationError(new Error('something else'))).toBe('unreachable');
  });
});
```

```ts
// packages/browser/src/verdict-copy.test.ts
import { describe, expect, it } from 'vitest';
import { verdictSentence } from './verdict-copy.js';

const U = 'https://www.scan.co.uk/shop/ssd';
describe('verdictSentence', () => {
  it('refused names the host, status and vendor', () => {
    expect(verdictSentence({ kind: 'refused', status: 403, vendor: 'cloudflare' }, U)).toBe("scan.co.uk refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet.");
    expect(verdictSentence({ kind: 'refused', status: 429 }, U)).toBe("scan.co.uk refused the browser (HTTP 429). We can't read this website from here yet.");
  });
  it('the other kinds', () => {
    expect(verdictSentence({ kind: 'challenge', status: 200, vendor: 'aws-waf' }, U)).toBe("scan.co.uk asked for a human check (CAPTCHA). Wait a few minutes and try again; pasting product pages won't help, they are behind the same check.");
    expect(verdictSentence({ kind: 'not-found', status: 404 }, U)).toBe("That page doesn't exist on scan.co.uk (404). Check the address.");
    expect(verdictSentence({ kind: 'redirected', status: 200, to: 'login.other.example' }, U)).toBe('That address led to login.other.example. Paste a page on scan.co.uk.');
    expect(verdictSentence({ kind: 'blank', status: 200 }, U)).toBe('scan.co.uk sent an empty page. Try again.');
    expect(verdictSentence({ kind: 'crashed' }, U)).toBe('The browser crashed on this page. It will be retried.');
    expect(verdictSentence({ kind: 'unreachable' }, U)).toBe('scan.co.uk could not be reached (no response).');
    expect(verdictSentence({ kind: 'timeout' }, U)).toBe('scan.co.uk did not answer in time.');
    expect(verdictSentence({ kind: 'ok', status: 200 }, U)).toBe('Reached scan.co.uk (HTTP 200).');
  });
  it('strips a leading www. from the host', () => {
    expect(verdictSentence({ kind: 'blank', status: 200 }, 'https://www.otto.de/p/1')).toBe('otto.de sent an empty page. Try again.');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @robot/browser exec vitest run src/verdict.test.ts src/verdict-copy.test.ts`
Expected: FAIL — cannot resolve `./verdict.js` / `./verdict-copy.js`.

- [ ] **Step 3: Add the types**

Append to `packages/browser/src/types.ts`:

```ts
/** The anti-bot vendor a wall page or its headers name; `unknown` when a wall is seen without a signature. */
export type WallVendor = 'cloudflare' | 'akamai' | 'perimeterx' | 'datadome' | 'aws-waf' | 'unknown';

/**
 * One honest verdict per capture (spec 2026-10-09 §A1), decided inside
 * `capture()` from the main response, the final url and the page-health
 * classifier. `ok` is the only kind a consumer may treat as the page asked for.
 */
export type CaptureVerdict =
  | { kind: 'ok'; status: number }
  | { kind: 'refused'; status: number; vendor?: WallVendor }
  | { kind: 'challenge'; status: number; vendor?: WallVendor }
  | { kind: 'not-found'; status: number }
  | { kind: 'redirected'; status: number; to: string }
  | { kind: 'blank'; status: number };

/** Why no document arrived at all; the only reason `capture()` rejects. */
export type CaptureErrorKind = 'crashed' | 'unreachable' | 'timeout';

export class CaptureError extends Error {
  constructor(public readonly kind: CaptureErrorKind, public readonly url: string, message: string) {
    super(message);
    this.name = 'CaptureError';
  }
}
```

And add to `PageCapture` (after `annotation?`):

```ts
  /**
   * What the browser got (spec 2026-10-09 §A1). Required on live captures;
   * fixtures and replays built outside the browser carry `{ kind: 'ok', status: 0 }`
   * (see `okVerdict()` in verdict.ts).
   */
  verdict: CaptureVerdict;
```

- [ ] **Step 4: Extend page health with vendor detection**

In `packages/browser/src/page-health.ts`, add after the imports/constants (keep `checkPageHealth` as it is, but add the two patterns inside its `botPatterns` array):

```ts
    { match: 'akamai', includes: ['access denied', 'reference #', 'akamaighost'] },
    { match: 'confirm you are human', reason: 'AWS WAF human verification — site requires human verification' },
    { match: 'human verification', reason: 'Human verification page — site requires human verification' },
```

and add this exported helper at the end of the file:

```ts
/**
 * Which wall, if any, this document is — from headers first (they are
 * authoritative), then the body. Returns `challenge` for an interstitial the
 * visitor could pass (CAPTCHA, "Just a moment", press-and-hold) and `refused`
 * for a flat denial (Access Denied, 403 block page). Null for a normal page.
 */
export function detectWall(html: string, title: string, headers: Record<string, string>): { kind: 'challenge' | 'refused'; vendor: WallVendor } | null {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  const lowerHtml = html.toLowerCase();
  const lowerTitle = title.toLowerCase();
  const text = lowerHtml.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const thin = text.length < SUBSTANTIAL_CONTENT_CHARS;
  const challengeWords = ['just a moment', 'checking your browser', 'verify you are human', 'confirm you are human', "confirm that you're human", 'are you a robot', 'not a robot', 'press & hold', 'press and hold', 'quick verification', 'human verification', 'captcha'];
  const deniedWords = ['access denied', 'you have been blocked', 'your request has been blocked', 'this request was blocked', 'restricted access'];
  const vendor: WallVendor | null =
    h['x-amzn-waf-action'] || lowerHtml.includes('awswaf') ? 'aws-waf'
    : h['cf-ray'] || h['server'] === 'cloudflare' || lowerHtml.includes('cloudflare') || lowerHtml.includes('ray id') ? 'cloudflare'
    : (h['server'] ?? '').includes('akamai') || lowerHtml.includes('akamaighost') || (lowerTitle.includes('access denied') && lowerHtml.includes('reference #')) ? 'akamai'
    : lowerHtml.includes('perimeterx') || lowerHtml.includes('_px') || lowerHtml.includes('px-captcha') ? 'perimeterx'
    : lowerHtml.includes('datadome') ? 'datadome'
    : null;
  const isChallenge = thin && challengeWords.some((w) => lowerTitle.includes(w) || lowerHtml.includes(w));
  const isDenied = thin && deniedWords.some((w) => lowerTitle.includes(w) || lowerHtml.includes(w));
  if (isChallenge) return { kind: 'challenge', vendor: vendor ?? 'unknown' };
  if (isDenied) return { kind: 'refused', vendor: vendor ?? 'unknown' };
  if (vendor && thin) return { kind: 'refused', vendor };
  return null;
}
```

Also `import type { WallVendor } from './types.js';` at the top of `page-health.ts`.

- [ ] **Step 5: Write the classifier and the copy**

```ts
// packages/browser/src/verdict.ts
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
  if (wall?.kind === 'challenge') return { kind: 'challenge', status, vendor: wall.vendor };
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
```

```ts
// packages/browser/src/verdict-copy.ts
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
```

Add to `packages/browser/src/index.ts`:

```ts
export { checkPageHealth, detectWall, type PageHealthResult } from './page-health.js';
export { classifyVerdict, classifyNavigationError, okVerdict } from './verdict.js';
export { verdictSentence } from './verdict-copy.js';
export { CaptureError, type CaptureVerdict, type CaptureErrorKind, type WallVendor } from './types.js';
```

(Replace the existing `checkPageHealth` export line rather than duplicating it.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @robot/browser exec vitest run src/verdict.test.ts src/verdict-copy.test.ts src/page-health.test.ts` (the last exists if there is one; run whatever `ls src/page-health*.test.ts` shows)
Expected: PASS. If an AWS WAF or Akamai assertion fails, adjust `detectWall`'s word lists, not the tests. Then `pnpm --filter @robot/browser typecheck`: the only expected error is `PageCapture.verdict` missing where captures are built — in `playwright-browser.ts` (Task 2) and in test fakes; fix the browser package's own fakes with `verdict: okVerdict()` now so this package typechecks.

- [ ] **Step 7: Commit**

```bash
git add -- packages/browser/src/verdict.ts packages/browser/src/verdict-copy.ts packages/browser/src/verdict.test.ts packages/browser/src/verdict-copy.test.ts
git commit -m "feat(browser): one verdict per capture — types, classifier, vendor detection and the customer sentences

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/browser/src/types.ts packages/browser/src/page-health.ts packages/browser/src/verdict.ts packages/browser/src/verdict-copy.ts packages/browser/src/verdict.test.ts packages/browser/src/verdict-copy.test.ts packages/browser/src/index.ts
```

---

### Task 2: `capture()` decides the verdict and classifies navigation failures

**Files:**
- Modify: `packages/browser/src/playwright-browser.ts` (`navigateWithFallback` 466-492, `capture()` 192-316)
- Test: `packages/browser/src/capture-verdict.test.ts` (Chromium, local `node:http` server — follow `capture-ready.test.ts`'s pattern for launching and serving)

**Interfaces:**
- Consumes: `classifyVerdict`, `classifyNavigationError`, `CaptureError` (Task 1).
- Produces: `PageCapture.verdict` on every live capture; `capture()` rejects with `CaptureError` only when no document arrived.

- [ ] **Step 1: Write the failing test**

```ts
// packages/browser/src/capture-verdict.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PlaywrightBrowser } from './playwright-browser.js';
import { CaptureError } from './types.js';

const PRODUCT = `<html><head><title>Widget</title></head><body><h1>Widget</h1>${'<p>Real product copy that goes on and on. </p>'.repeat(60)}</body></html>`;
let server: Server; let base = ''; let browser: PlaywrightBrowser;

beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname === '/ok') return res.writeHead(200, { 'content-type': 'text/html' }).end(PRODUCT);
    if (u.pathname === '/blocked') return res.writeHead(403, { 'content-type': 'text/html', server: 'cloudflare', 'cf-ray': 'abc' }).end('<html><head><title>Just a moment...</title></head><body>Checking your browser. Ray ID: abc</body></html>');
    if (u.pathname === '/captcha') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html><head><title>Verify you are human</title></head><body><p>Verify you are human to continue.</p></body></html>');
    if (u.pathname === '/gone') return res.writeHead(404, { 'content-type': 'text/html' }).end('<html><body>nope</body></html>');
    if (u.pathname === '/blank') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html><head><script>1</script></head><body><div id="app"></div></body></html>');
    res.writeHead(500).end('boom');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true, stealth: false });
}, 60_000);
afterAll(async () => { await browser.close(); await new Promise<void>((r) => server.close(() => r())); });

describe('capture() verdicts', () => {
  it('a normal page is ok with its status', async () => {
    const c = await browser.capture(`${base}/ok`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1 });
    expect(c.verdict).toEqual({ kind: 'ok', status: 200 });
  }, 30_000);
  it('a 403 Cloudflare page resolves as refused, not a throw', async () => {
    const c = await browser.capture(`${base}/blocked`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1 });
    expect(c.verdict).toEqual({ kind: 'refused', status: 403, vendor: 'cloudflare' });
    expect(c.html).toContain('Just a moment');
  }, 30_000);
  it('a 200 human check is a challenge; a 404 is not-found; an empty app shell is blank', async () => {
    expect((await browser.capture(`${base}/captcha`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1 })).verdict.kind).toBe('challenge');
    expect((await browser.capture(`${base}/gone`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1 })).verdict).toEqual({ kind: 'not-found', status: 404 });
    expect((await browser.capture(`${base}/blank`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1 })).verdict.kind).toBe('blank');
  }, 60_000);
  it('a dead host rejects with a CaptureError of kind unreachable', async () => {
    await expect(browser.capture('http://127.0.0.1:9/x', { waitUntil: 'load', interceptNetworkRequests: false, timeout: 5000 })).rejects.toBeInstanceOf(CaptureError);
    await browser.capture('http://127.0.0.1:9/x', { waitUntil: 'load', interceptNetworkRequests: false, timeout: 5000 }).catch((e: CaptureError) => expect(e.kind).toBe('unreachable'));
  }, 30_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @robot/browser exec vitest run src/capture-verdict.test.ts`
Expected: FAIL — `verdict` is undefined, and the dead host rejects with a plain Error.

- [ ] **Step 3: Record the main response and decide the verdict**

In `playwright-browser.ts`:

1. Change `navigateWithFallback` to return the main response:

```ts
  private async navigateWithFallback(page: Page, url: string, options: CaptureOptions = {}): Promise<Response | null> {
    const timeout = options.timeout ?? 60000;
    const preferred = options.waitUntil ?? 'networkidle';
    try {
      return await page.goto(url, { waitUntil: preferred, timeout });
    } catch (err) {
      if (preferred === 'networkidle') {
        console.warn(`networkidle timed out for ${url}, falling back to domcontentloaded`);
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        await page.waitForTimeout(3000);
        try { await page.waitForLoadState('load', { timeout: 10000 }); } catch { /* load state timeout is fine */ }
        return response;
      }
      throw err;
    }
  }
```

(`import type { Page, Response } from 'playwright';` — add `Response` to the existing type import.)

2. In `capture()`, wrap the navigation call so a thrown navigation becomes a `CaptureError`, and keep the response:

```ts
      let response: Response | null = null;
      try {
        response = await this.navigateWithFallback(page, url, options);
      } catch (err) {
        const kind = classifyNavigationError(err);
        throw new CaptureError(kind, url, `${kind}: ${(err as Error).message}`);
      }
```

(Replace the existing `await this.navigateWithFallback(page, url, options);` line; the `navigateMs` timing stays around it.)

3. At the end, before `return {`, decide the verdict and include it:

```ts
      const headers = response ? response.headers() : {};
      const boxCount = Array.isArray((annotation as { boxes?: unknown[] } | undefined)?.boxes) ? (annotation as { boxes: unknown[] }).boxes.length : undefined;
      const verdict = classifyVerdict({ requestedUrl: url, finalUrl: page.url(), status: response ? response.status() : null, headers, html, title, boxCount });
```

and add `verdict,` to the returned object. Import `classifyVerdict`, `classifyNavigationError` from `./verdict.js` and `CaptureError` from `./types.js`.

Also handle a crash during the tile/annotation phase: wrap the screenshot and `page.evaluate` steps' `catch` paths so an error whose message includes `crashed` rethrows as `new CaptureError('crashed', url, message)` (one `catch (err) { if (/crashed/i.test(String((err as Error).message))) throw new CaptureError('crashed', url, (err as Error).message); throw err; }` around the body after navigation is enough).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @robot/browser exec vitest run src/capture-verdict.test.ts && pnpm --filter @robot/browser test -- --run && pnpm --filter @robot/browser typecheck`
Expected: PASS; the whole browser suite green (fakes that build a `PageCapture` need `verdict: okVerdict()` — fix any the typecheck names).

- [ ] **Step 5: Commit**

```bash
git add -- packages/browser/src/capture-verdict.test.ts
git commit -m "feat(browser): capture() records the main response and decides the verdict; no-document failures are CaptureErrors

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/browser/src/playwright-browser.ts packages/browser/src/capture-verdict.test.ts
```

---

### Task 3: The scraper reads the verdict (one truth) and fakes carry it

**Files:**
- Modify: `packages/scraper/src/verify/capture-check.ts`, `analysis-orchestrator.ts:144-150,249-256,358-364`, `extraction-orchestrator.ts:199-206`, `pipeline.ts:50-57`, `verify/proof-page-capture.ts`
- Modify: every test fake or fixture in `packages/scraper/src` and `packages/api/src` that builds a `PageCapture` literal (grep `screenshotTiles:` and `structuredData:` in `*.test.ts` and `__fixtures__`), adding `verdict: okVerdict()` or `{ kind: 'ok', status: 200 }`.
- Test: `packages/scraper/src/verify/capture-check.test.ts` (extend or create)

**Interfaces:**
- Consumes: `CaptureVerdict`, `verdictSentence`, `okVerdict` from `@robot/browser`.
- Produces: `captureProblem(capture, requestedUrl): { reason: string; verdict?: CaptureVerdict } | null` — **changed return type**; callers that used the string now use `.reason`. `CaptureProblemError extends Error { verdict?: CaptureVerdict }` thrown by `captureProofPage`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/scraper/src/verify/capture-check.test.ts (add)
import { describe, expect, it } from 'vitest';
import { captureProblem, CaptureProblemError } from './capture-check.js';

const cap = (verdict: import('@robot/browser').CaptureVerdict, url = 'https://shop.example/p/1') =>
  ({ url, html: '<html><body>' + 'x '.repeat(1000) + '</body></html>', title: 'P', verdict });

describe('captureProblem reads the verdict', () => {
  it('ok on the same path is no problem', () => {
    expect(captureProblem(cap({ kind: 'ok', status: 200 }), 'https://shop.example/p/1')).toBeNull();
  });
  it('a refused capture is the verdict sentence, with the verdict attached', () => {
    const p = captureProblem(cap({ kind: 'refused', status: 403, vendor: 'cloudflare' }), 'https://shop.example/p/1');
    expect(p?.reason).toBe("shop.example refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet.");
    expect(p?.verdict?.kind).toBe('refused');
  });
  it('a same-host different-path landing is still "redirected to" (proof pages must be the page asked for)', () => {
    const p = captureProblem(cap({ kind: 'ok', status: 200 }, 'https://shop.example/collections/all'), 'https://shop.example/p/1');
    expect(p?.reason).toBe('redirected to https://shop.example/collections/all');
    expect(p?.verdict).toBeUndefined();
  });
  it('CaptureProblemError carries the verdict', () => {
    const e = new CaptureProblemError('x', { kind: 'blank', status: 200 });
    expect(e.verdict?.kind).toBe('blank');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @robot/scraper exec vitest run src/verify/capture-check.test.ts`
Expected: FAIL (return type / missing export).

- [ ] **Step 3: Implement**

```ts
// packages/scraper/src/verify/capture-check.ts
import { verdictSentence, type CaptureVerdict, type PageCapture } from '@robot/browser';

export function samePath(finalUrl: string, requested: string): boolean { /* unchanged */ }

export class CaptureProblemError extends Error {
  constructor(message: string, public readonly verdict?: CaptureVerdict) { super(message); this.name = 'CaptureProblemError'; }
}

/**
 * null when the capture is the requested page and usable; else the reason
 * (the verdict's customer sentence when the browser's verdict says so, or the
 * path-level "redirected to …" that proof pages still need).
 */
export function captureProblem(capture: Pick<PageCapture, 'url' | 'html' | 'title' | 'verdict'>, requestedUrl: string): { reason: string; verdict?: CaptureVerdict } | null {
  if (capture.verdict.kind !== 'ok') return { reason: verdictSentence(capture.verdict, requestedUrl), verdict: capture.verdict };
  if (!samePath(capture.url, requestedUrl)) return { reason: `redirected to ${capture.url}` };
  return null;
}
```

In `verify/proof-page-capture.ts`: `const problem = captureProblem(capture, url); if (problem) throw new CaptureProblemError(problem.reason, problem.verdict);` and export `CaptureProblemError` from the scraper's index if `captureProblem` is exported there (grep `capture-check` in `packages/scraper/src/index.ts`).

In the three orchestrators and the pipeline, replace each `const health = checkPageHealth(...); if (!health.healthy) {…health.reason…}` with the verdict:

```ts
    if (capture.verdict.kind !== 'ok') {
      const reason = verdictSentence(capture.verdict, url);
      // (then the same action the block took before: throw new Error(`Cannot analyze ${url}: ${reason}`) / blockedReason = reason / return {...})
    }
```

Remove the now-unused `checkPageHealth` imports. Fix every `PageCapture` literal in tests/fixtures with `verdict: { kind: 'ok', status: 200 }` (grep in `packages/scraper/src` and `packages/api/src`: `screenshotTiles:`); for fixture loaders that build captures from stored JSON, default `verdict ?? { kind: 'ok', status: 0 }` at the load site.

Grep other users of the old string return: `grep -rn "captureProblem(" packages/scraper/src packages/api/src` — `run-verification.ts` uses it; change `if (problem)` bodies to `problem.reason`.

- [ ] **Step 4: Run the gates**

Run: `pnpm --filter @robot/scraper test -- --run && pnpm --filter @robot/scraper typecheck`
Expected: PASS. (Fixture-replay tests must keep passing: a fixture capture without `verdict` must default to ok at its loader.)

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(scraper): consumers read capture.verdict; captureProblem returns the verdict with its sentence

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/scraper/src
```

(Explicit directory path is acceptable here because every change under it is this task's; confirm with `git status --short packages/scraper` first that nothing unrelated is modified.)

---

### Task 4: Per-host backoff in the domain lock

**Files:**
- Modify: `packages/scraper/src/domain-lock.ts`
- Test: `packages/scraper/src/domain-lock-backoff.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function reportVerdict(domain: string, kind: CaptureVerdict['kind'] | CaptureErrorKind, now?: () => number): void;
  export function backoffRemainingMs(domain: string, now?: () => number): number;   // 0 when none
  export const BACKOFF_FIRST_MS = 120_000, BACKOFF_MAX_MS = 480_000;
  // acquireDomainLock waits backoffRemainingMs before the politeness delay; `_setClockForTests(now, sleep)` lets tests run instantly.
  ```

- [ ] **Step 1: Write the failing test**

```ts
// packages/scraper/src/domain-lock-backoff.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { acquireDomainLock, backoffRemainingMs, reportVerdict, BACKOFF_FIRST_MS, BACKOFF_MAX_MS, _setClockForTests, _resetBackoffForTests } from './domain-lock.js';

let t = 0; const waits: number[] = [];
_setClockForTests(() => t, async (ms) => { waits.push(ms); t += ms; });
afterEach(() => { _resetBackoffForTests(); waits.length = 0; t = 0; });

describe('backoff after a challenge or refusal', () => {
  it('starts at 2 minutes, doubles per further challenge, caps at 8', () => {
    reportVerdict('shop.example', 'challenge');
    expect(backoffRemainingMs('shop.example')).toBe(BACKOFF_FIRST_MS);
    reportVerdict('shop.example', 'refused');
    expect(backoffRemainingMs('shop.example')).toBe(BACKOFF_FIRST_MS * 2);
    reportVerdict('shop.example', 'challenge'); reportVerdict('shop.example', 'challenge');
    expect(backoffRemainingMs('shop.example')).toBe(BACKOFF_MAX_MS);
  });
  it('an ok clears it; other kinds leave it alone', () => {
    reportVerdict('shop.example', 'challenge');
    reportVerdict('shop.example', 'not-found');
    expect(backoffRemainingMs('shop.example')).toBe(BACKOFF_FIRST_MS);
    reportVerdict('shop.example', 'ok');
    expect(backoffRemainingMs('shop.example')).toBe(0);
  });
  it('acquireDomainLock waits out the backoff instead of failing, then runs', async () => {
    reportVerdict('shop.example', 'challenge');
    const release = await acquireDomainLock('shop.example');
    expect(waits).toContain(BACKOFF_FIRST_MS);
    release();
    expect(backoffRemainingMs('shop.example')).toBe(0);
  });
  it('time passing shrinks the remaining wait', () => {
    reportVerdict('shop.example', 'challenge');
    t += 90_000;
    expect(backoffRemainingMs('shop.example')).toBe(BACKOFF_FIRST_MS - 90_000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @robot/scraper exec vitest run src/domain-lock-backoff.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement**

Add to `domain-lock.ts` (keep the existing lock and politeness code; use the injectable clock in both):

```ts
import type { CaptureErrorKind, CaptureVerdict } from '@robot/browser';

export const BACKOFF_FIRST_MS = 120_000;
export const BACKOFF_MAX_MS = 480_000;

/** Per host: when the backoff ends, and how many challenges in a row set it. */
const backoff = new Map<string, { until: number; strikes: number }>();

let now = () => Date.now();
let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Tests only: a fake clock and a fake sleep so backoff tests run instantly. */
export function _setClockForTests(nowFn: () => number, sleepFn: (ms: number) => Promise<void>): void { now = nowFn; sleep = sleepFn; }
export function _resetBackoffForTests(): void { backoff.clear(); lastRequestTime.clear(); }

/**
 * Feed a capture's verdict back to the host's pacing (spec 2026-10-09 §A3).
 * A challenge or refusal starts or doubles the backoff; an ok clears it; the
 * other kinds say nothing about the host's tolerance and change nothing.
 */
export function reportVerdict(domain: string, kind: CaptureVerdict['kind'] | CaptureErrorKind): void {
  if (kind === 'ok') { backoff.delete(domain); return; }
  if (kind !== 'challenge' && kind !== 'refused') return;
  const prev = backoff.get(domain);
  const strikes = (prev?.strikes ?? 0) + 1;
  const ms = Math.min(BACKOFF_FIRST_MS * 2 ** (strikes - 1), BACKOFF_MAX_MS);
  backoff.set(domain, { until: now() + ms, strikes });
  console.log(`[lock] ${domain} ${kind}: backing off ${Math.round(ms / 60000)} min`);
}

export function backoffRemainingMs(domain: string): number {
  const b = backoff.get(domain);
  if (!b) return 0;
  return Math.max(0, b.until - now());
}
```

In `acquireDomainLock`, after the lock is claimed and before the politeness delay:

```ts
  const wait = backoffRemainingMs(domain);
  if (wait > 0) {
    console.log(`[lock] Backoff: waiting ${Math.round(wait / 1000)}s before hitting ${domain}`);
    await sleep(wait);
    // The wait is the penalty; the next verdict decides whether it grows or clears.
    const b = backoff.get(domain); if (b) backoff.set(domain, { ...b, until: now() });
  }
```

Replace the politeness `Date.now()`/`setTimeout` uses with `now()`/`sleep()`. Note the test expects the remaining wait to read 0 right after a waited acquire: set `until: now()` as above.

- [ ] **Step 4: Wire the reporters**

Where captures happen under the lock, report: in `packages/scraper/src/crawl/plan-run.ts` after the listing capture (`page1`'s capture — find where the `PageCapture` is available; on the `catch` for `listing capture failed`, if `err instanceof CaptureError` report `err.kind`), and in `packages/scraper/src/verify/verified-extraction.ts` after `browser.capture` (`reportVerdict(new URL(url).hostname, capture.verdict.kind)`). Also append the verdict sentence to the listing error: `errors.push({ inputIndex, message: err instanceof CaptureProblemError && err.verdict ? err.message : \`listing capture failed: ${(err as Error).message}\` })`.

- [ ] **Step 5: Run the gates**

Run: `pnpm --filter @robot/scraper exec vitest run src/domain-lock-backoff.test.ts src/domain-lock*.test.ts && pnpm --filter @robot/scraper test -- --run && pnpm --filter @robot/scraper typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- packages/scraper/src/domain-lock-backoff.test.ts
git commit -m "feat(scraper): per-host backoff after a challenge or refusal, fed by capture verdicts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/scraper/src/domain-lock.ts packages/scraper/src/domain-lock-backoff.test.ts packages/scraper/src/crawl/plan-run.ts packages/scraper/src/verify/verified-extraction.ts
```

---

### Task 5: The finder, proof pages and reachability surface the verdict (`@robot/api`)

**Files:**
- Modify: `packages/api/src/routers/sources.ts` (`checkListingPage` 652-662; new `reachability` query next to it)
- Modify: `packages/api/src/verify/find-product-pages.ts` (`describeListingPage` return gains `verdict`)
- Modify: `packages/api/src/verify/proof-page-capture.ts` (`ProofPageMeta` failed gains `verdict?`; store it)
- Test: `packages/api/src/verify/find-product-pages.test.ts` (one case), and a unit test for the reachability shaping if a pure helper is extracted (`packages/api/src/verify/reachability.ts` + test)

**Interfaces:**
- Consumes: `CaptureVerdict`, `verdictSentence` from `@robot/browser`; `CaptureProblemError` from `@robot/scraper`; `reportVerdict` from `@robot/scraper`.
- Produces:
  - `checkListingPage` returns `{ verdict: CaptureVerdict; message: string | null; productLinks; pagerSeen; sample; products }` — `message` is the verdict sentence when not ok, else null.
  - `sources.reachability({ url })` (query) → `{ verdict: CaptureVerdict | { kind: CaptureErrorKind }; message: string; finalUrl: string | null; ms: number }`.
  - `ProofPageMeta` failed: `{ …; error: string; verdict?: CaptureVerdict }`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/api/src/verify/reachability.test.ts
import { describe, expect, it } from 'vitest';
import { reachabilityResult } from './reachability.js';

describe('reachabilityResult', () => {
  it('an ok capture reads "Reached host (HTTP 200)."', () => {
    expect(reachabilityResult('https://www.ulta.com/shop/x', { kind: 'ok', status: 200 }, 'https://www.ulta.com/shop/x', 812))
      .toEqual({ verdict: { kind: 'ok', status: 200 }, message: 'Reached ulta.com (HTTP 200).', finalUrl: 'https://www.ulta.com/shop/x', ms: 812 });
  });
  it('a CaptureError kind reads its sentence with no final url', () => {
    expect(reachabilityResult('https://scan.co.uk/x', { kind: 'timeout' }, null, 30_000).message).toBe('scan.co.uk did not answer in time.');
  });
});
```

Add to `find-product-pages.test.ts`:

```ts
  it('describeListingPage carries a non-ok verdict and reports no links', () => {
    const r = describeListingPage([{ href: '/p/1', text: 'A' }], 'https://shop.example/l', '<html></html>', { kind: 'refused', status: 403, vendor: 'cloudflare' });
    expect(r.productLinks).toBe(0);
    expect(r.verdict.kind).toBe('refused');
    expect(r.message).toBe("shop.example refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet.");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @robot/api exec vitest run src/verify/reachability.test.ts src/verify/find-product-pages.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/api/src/verify/reachability.ts
import { verdictSentence, type CaptureErrorKind, type CaptureVerdict } from '@robot/browser';

export type Reachability = { verdict: CaptureVerdict | { kind: CaptureErrorKind }; message: string; finalUrl: string | null; ms: number };

/** The free reachability line Add website shows (spec 2026-10-09 §A2). */
export function reachabilityResult(url: string, verdict: Reachability['verdict'], finalUrl: string | null, ms: number): Reachability {
  return { verdict, message: verdictSentence(verdict, url), finalUrl, ms };
}
```

`describeListingPage(anchors, listingUrl, html, verdict: CaptureVerdict)`:

```ts
  if (verdict.kind !== 'ok') {
    return { verdict, message: verdictSentence(verdict, listingUrl), productLinks: 0, pagerSeen: false, sample: [], products: [] };
  }
  // …existing body…, plus `verdict, message: null` in the returned object
```

`checkListingPage`:

```ts
      const { anchors, html, verdict } = await withBrowserSession(async (browser) => {
        const capture = await browser.capture(input.listingUrl, { waitUntil: 'networkidle', interceptNetworkRequests: false });
        reportVerdict(new URL(input.listingUrl).hostname, capture.verdict.kind);
        if (capture.verdict.kind !== 'ok') return { anchors: [] as ListingAnchor[], html: capture.html, verdict: capture.verdict };
        const anchors = await browser.setContentEvaluate<ListingAnchor[]>(capture.html, LISTING_ANCHORS_SCRIPT);
        return { anchors, html: capture.html, verdict: capture.verdict };
      });
      return describeListingPage(anchors, input.listingUrl, html, verdict);
```

Wrap the capture in `try/catch`: a `CaptureError` becomes `describeListingPage([], url, '', …)`? No — a `CaptureError` has no document; return `{ verdict: { kind: err.kind }, message: verdictSentence({ kind: err.kind }, url), productLinks: 0, pagerSeen: false, sample: [], products: [] }` (widen the return type's `verdict` to `CaptureVerdict | { kind: CaptureErrorKind }`).

`reachability`:

```ts
  reachability: protectedProcedure
    .input(z.object({ url: httpUrl }))
    .query(async ({ input }) => {
      const t0 = Date.now();
      try {
        return await withBrowserSession(async (browser) => {
          const capture = await browser.capture(input.url, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1, timeout: 30_000 });
          reportVerdict(new URL(input.url).hostname, capture.verdict.kind);
          return reachabilityResult(input.url, capture.verdict, capture.url, Date.now() - t0);
        });
      } catch (err) {
        if (err instanceof CaptureError) { reportVerdict(new URL(input.url).hostname, err.kind); return reachabilityResult(input.url, { kind: err.kind }, null, Date.now() - t0); }
        throw err;
      }
    }),
```

Proof pages (`api/verify/proof-page-capture.ts`): in the `catch`, `const verdict = err instanceof CaptureProblemError ? err.verdict : err instanceof CaptureError ? { kind: err.kind } : undefined;` and include `...(verdict ? { verdict } : {})` in the `failed` meta; type: `| { kind: 'proof-page'; status: 'failed'; url: string; startedAt: string; error: string; verdict?: CaptureVerdict | { kind: CaptureErrorKind } }`. Also `reportVerdict` the host with the verdict kind (ok on success).

- [ ] **Step 4: Gates**

Run: `pnpm --filter @robot/api exec vitest run src/verify/reachability.test.ts src/verify/find-product-pages.test.ts && pnpm --filter @robot/api test -- --run && pnpm --filter @robot/api typecheck`
Expected: PASS (Postgres on :5432; browser tests in the api suite may take minutes).

- [ ] **Step 5: Commit**

```bash
git add -- packages/api/src/verify/reachability.ts packages/api/src/verify/reachability.test.ts
git commit -m "feat(api): the finder and proof pages carry the capture verdict; free reachability query for Add website

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/api/src/routers/sources.ts packages/api/src/verify/find-product-pages.ts packages/api/src/verify/find-product-pages.test.ts packages/api/src/verify/proof-page-capture.ts packages/api/src/verify/reachability.ts packages/api/src/verify/reachability.test.ts
```

---

### Task 6: A failed run stays failed (`@robot/api` crawl)

**Files:**
- Modify: `packages/api/src/crawl/plan-source.ts:181-206`, `packages/api/src/crawl/roll-up-run.ts` (`rollUpStatus`, `finaliseRun`), `packages/api/src/routers/crawl.ts` (`execute`, after the `run` lookup)
- Test: `packages/api/src/crawl/roll-up-run.test.ts` (exists? extend; else create), `packages/api/src/crawl/execute-guard.test.ts`

**Interfaces:**
- Produces: `rollUpStatus(counts, cancelled, limitReached, hasError = false)` — `hasError` true with zero items returns `'failed'`; `canExecute(run: { status: string; errorMessage: string | null }, itemCount: number): { ok: true } | { ok: false; message: string }` in `packages/api/src/crawl/execute-guard.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/api/src/crawl/execute-guard.test.ts
import { describe, expect, it } from 'vitest';
import { canExecute } from './execute-guard.js';
import { rollUpStatus } from './roll-up-run.js';

describe('canExecute', () => {
  it('refuses a run that failed planning and has nothing to run, with its reason', () => {
    expect(canExecute({ status: 'failed', errorMessage: "otto.de asked for a human check (CAPTCHA). Wait a few minutes and try again; pasting product pages won't help, they are behind the same check." }, 0))
      .toEqual({ ok: false, message: "This run failed while planning: otto.de asked for a human check (CAPTCHA). Wait a few minutes and try again; pasting product pages won't help, they are behind the same check." });
  });
  it('lets planned, extracting (resume) and partial runs through, and a failed run that still has items (retry)', () => {
    expect(canExecute({ status: 'planned', errorMessage: null }, 10)).toEqual({ ok: true });
    expect(canExecute({ status: 'extracting', errorMessage: null }, 3)).toEqual({ ok: true });
    expect(canExecute({ status: 'partial', errorMessage: null }, 0)).toEqual({ ok: true });
    expect(canExecute({ status: 'failed', errorMessage: 'x' }, 5)).toEqual({ ok: true });
  });
});

describe('rollUpStatus with nothing to roll up', () => {
  it('zero items and an error stays failed; zero items and no error is completed (an empty but honest run)', () => {
    expect(rollUpStatus({ pending: 0, running: 0, done: 0, failed: 0 }, false, false, true)).toBe('failed');
    expect(rollUpStatus({ pending: 0, running: 0, done: 0, failed: 0 }, false, false, false)).toBe('completed');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/execute-guard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/api/src/crawl/execute-guard.ts
/**
 * May `crawl.execute` run this run? A run that failed while planning and has
 * no items is refused with its own reason: `markRunExtracting` would otherwise
 * flip it to extracting and `finaliseRun` roll an empty run up to completed —
 * the green "Done" with 0 rows the 2026-10-08 campaign recorded (spec
 * 2026-10-09 §A2). A failed run that still has items is a retry, allowed.
 */
export function canExecute(run: { status: string; errorMessage: string | null }, itemCount: number): { ok: true } | { ok: false; message: string } {
  if (run.status === 'failed' && itemCount === 0) {
    return { ok: false, message: `This run failed while planning: ${run.errorMessage ?? 'no reason was recorded'}` };
  }
  return { ok: true };
}
```

`rollUpStatus`: add the fourth parameter and, before `if (counts.failed === 0) return 'completed';`, insert `if (hasError && counts.done === 0 && counts.failed === 0) return 'failed';`. In `finaliseRun`, read the run's `errorMessage` (`db.query.runs.findFirst({ where: eq(runs.id, runId), columns: { errorMessage: true } })`) and pass `!!row?.errorMessage` as `hasError`.

`plan-source.ts`: replace the `errorMessage` expression with the first error's message: `errorMessage: allInputsFailed ? (outcome.errors[0]?.message ?? \`planning failed for all ${outcome.inputs.length} input(s)\`) : null` — the count stays in `logs`. (Check `outcome.errors[0]` is the shape `{ inputIndex, message }`; Task 4 made the listing message the verdict sentence when the capture had one.)

`crawl.ts` `execute`: after `if (!run.source) …`, count the run's detail items (`select count(*) from run_items where run_id = … and kind = 'detail'`) and:

```ts
      const guard = canExecute({ status: run.status, errorMessage: run.errorMessage }, itemCount);
      if (!guard.ok) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: guard.message });
```

(`run.errorMessage` and `run.status` must be in the selected columns.)

- [ ] **Step 4: Gates**

Run: `pnpm --filter @robot/api exec vitest run src/crawl/ && pnpm --filter @robot/api typecheck`
Expected: PASS; existing `roll-up-run` tests still pass (the default `hasError = false` keeps old behaviour).

- [ ] **Step 5: Commit**

```bash
git add -- packages/api/src/crawl/execute-guard.ts packages/api/src/crawl/execute-guard.test.ts
git commit -m "fix(api): a run that failed planning stays failed — execute refuses it, finalise never rolls an empty errored run to completed, the reason is the message

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/api/src/crawl/plan-source.ts packages/api/src/crawl/roll-up-run.ts packages/api/src/crawl/execute-guard.ts packages/api/src/crawl/execute-guard.test.ts packages/api/src/routers/crawl.ts
```

---

### Task 7: The app shows the verdict (listing bar, proof card, row words, run page, sample facts, reachability line)

**Files:**
- Modify: `packages/app/src/components/verification/listing-bar.tsx:88-93`, `product-card.tsx:66-76`, `packages/app/src/lib/site/use-proof-captures.ts` (type gains `verdict?`), `packages/app/src/lib/site/verification-model.ts:446-450` (row words), `packages/app/src/lib/site/extract-view.ts:256-266` (`sampleFacts`), `packages/app/src/routes/_app/projects/$project/sites/$site/runs/$run.tsx:263-267`, the site route (reachability line under the listing bar, for a website with no cards and no listing)
- Test: `packages/app/src/lib/site/extract-view.test.ts` (add), `packages/app/src/lib/site/verification-model.test.ts` (row words)

**Interfaces:**
- Consumes: `checkListingPage`'s `{ verdict, message }`; `ProofCapture.verdict?`; `sources.reachability`.
- Produces: `rowStatus(field, board, live, boxesByUrl, failedUrls?, failedKinds?: ReadonlyMap<string, string>)` — the sixth argument maps a product url to its failed capture's verdict kind.

- [ ] **Step 1: Write the failing tests**

```ts
// verification-model.test.ts (add inside describe('rowStatus'))
  it('a refused or challenged screenshot says so on the row', () => {
    const b = board();
    const live = liveFor(b, 'price', [null, sug('219.99', [1], JL), sug('149.00', [1], JL)]);
    const failed = new Set([U[0]!]);
    expect(rowStatus(price, b, live, maps({ [U[0]!]: undefined }), failed, new Map([[U[0]!, 'refused']])).reason).toBe('screenshot refused on product 1');
    expect(rowStatus(price, b, live, maps({ [U[0]!]: undefined }), failed, new Map([[U[0]!, 'challenge']])).reason).toBe('human check on product 1');
    expect(rowStatus(price, b, live, maps({ [U[0]!]: undefined }), failed).reason).toBe('screenshot failed on product 1');
  });
```

(Adapt `maps()` to whatever helper the file uses to build `boxesByUrl`; the point is product 1 has no boxes and is in `failedUrls`.)

```ts
// extract-view.test.ts (add)
import { sampleFacts } from './extract-view';
describe('sampleFacts', () => {
  it('reports extracted rows, and omits pagination when the walk did not look', () => {
    const facts = sampleFacts({ pagesWalked: 1, itemsFound: 30, paginationNote: 'not reported' } as never, { complete: 0, total: 0 }, 3);
    expect(facts.find((f) => f.label === 'Rows extracted')?.value).toBe('3');
    expect(facts.find((f) => f.label === 'Pagination detected')).toBeUndefined();
    expect(facts.find((f) => f.label === 'Sample rows complete')).toBeUndefined();
  });
  it('keeps the complete count when rows have totals', () => {
    const facts = sampleFacts({ pagesWalked: 2, itemsFound: 30, paginationNote: 'next link' } as never, { complete: 2, total: 3 }, 3);
    expect(facts.find((f) => f.label === 'Sample rows complete')?.value).toBe('2 of 3');
    expect(facts.find((f) => f.label === 'Pagination detected')?.value).toBe('next link');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/verification-model.test.ts src/lib/site/extract-view.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`rowStatus`: add `failedKinds?: ReadonlyMap<string, string>` and replace the `why` line:

```ts
        const kind = failedKinds?.get(card.url);
        const why = kind === 'refused' ? 'screenshot refused' : kind === 'challenge' ? 'human check' : failedUrls?.has(card.url) ? 'screenshot failed' : 'screenshot not ready';
```

The route builds `failedKinds` from `captures.byUrl[u].verdict?.kind` (add `verdict?: { kind: string }` to `ProofCapture` in `use-proof-captures.ts`, copied from the meta).

`sampleFacts(evidence, rows, extracted: number)`:

```ts
  const facts: Array<{ label: string; value: string }> = [
    { label: 'Pages walked', value: String(evidence.pagesWalked) },
    { label: 'Product links found', value: String(evidence.itemsFound) },
  ];
  if (evidence.paginationNote && evidence.paginationNote !== 'not reported') facts.push({ label: 'Pagination detected', value: evidence.paginationNote });
  if (rows.total > 0) facts.push({ label: 'Sample rows complete', value: `${rows.complete} of ${rows.total}` });
  else facts.push({ label: 'Rows extracted', value: String(extracted) });
  return facts;
```

Update its caller to pass the extracted row count it already shows in the header.

`listing-bar.tsx`: where `found` renders, first `found.message ? <p role="alert" className="text-sm text-warn">{found.message}</p> :` then the existing two branches.

`product-card.tsx`: keep the footer, but the `title`/text uses `capture?.error` as today (the server now stores the verdict sentence there), so no change beyond nothing; add nothing else. (The `verdict` field is for the row words.)

Run page: render the `errorMessage` banner as today, and additionally when `run.resultCount === 0 && run.status === 'completed' && !run.errorMessage` show a muted line "This run produced no rows." (so a 0-row run is never silent).

Reachability line: in the site route, when `board.cards.length === 0 && !board.listingUrl.trim()`, run `trpc.sources.reachability.useQuery({ url: source.urlTemplate ?? source.url }, { staleTime: Infinity, retry: false })` (use whichever field holds the website's address) and render under the listing bar: `data.verdict.kind === 'ok'` → `<p className="text-sm text-muted-foreground">{data.message}</p>`; else `<p role="alert" className="text-sm text-warn">{data.message}</p>`; while loading, nothing.

- [ ] **Step 4: Gates**

Run: `pnpm --filter @robot/app test -- --run && pnpm --filter @robot/app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(app): the verdict's sentence in the listing bar, the proof rows, the run page; honest sample facts; reachability line on a new website

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/components/verification/listing-bar.tsx packages/app/src/components/verification/product-card.tsx packages/app/src/lib/site/use-proof-captures.ts packages/app/src/lib/site/verification-model.ts packages/app/src/lib/site/verification-model.test.ts packages/app/src/lib/site/extract-view.ts packages/app/src/lib/site/extract-view.test.ts "packages/app/src/routes/_app/projects/\$project/sites/\$site/runs/\$run.tsx" "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx"
```

(Add any other file the sample-facts caller lives in.)

---

### Task 8: "Agreed" means shown on the page (`@robot/app` model + specs)

**Files:**
- Modify: `packages/app/src/lib/site/verification-model.ts:455-459`
- Modify: `packages/app/src/lib/site/verification-model.test.ts:289-293` (+ new cases)
- Modify: `docs/superpowers/specs/2026-09-28-table-first-and-drift-repair-design.md` §A2 line 75; `docs/superpowers/specs/2026-09-29-certification-picks-the-right-path-design.md` §A5

**Interfaces:** `rowStatus` unchanged signature; new `needs-you` reason `only in the page data on product n`.

- [ ] **Step 1: Change the test and add cases**

Replace the `'page data with no element counts as one place'` test with:

```ts
  it('page data no element shows is not agreed: the row asks for a look at that product', () => {
    const b = board();
    const live = liveFor(b, 'price', [sug('129.99', [], JL), sug('219.99', [1], JL), sug('149.00', [], JL)]);
    expect(rowStatus(price, b, live, maps())).toEqual<RowStatus>({ kind: 'needs-you', reason: 'only in the page data on product 1', product: 1 });
  });
  it('a boxless suggestion wins over "comes from different places"', () => {
    const b = board();
    const live = liveFor(b, 'price', [sug('129.99', [1], JL), sug('219.99', [], API), sug('149.00', [1], JL)]);
    expect(rowStatus(price, b, live, maps())).toEqual<RowStatus>({ kind: 'needs-you', reason: 'only in the page data on product 2', product: 2 });
  });
  it('a value carried from another product that this page does not show is the same case', () => {
    const b = board();
    const live = liveFor(b, 'price', [sug('129.99', [1], JL), { ...sug('219.99', [], JL), origin: 'from-product' as const }, sug('149.00', [1], JL)]);
    expect(rowStatus(price, b, live, maps()).reason).toBe('only in the page data on product 2');
  });
```

(`API` is a `Via` with `source: 'api'`; define it beside `JL` if the file has none. The "missing on product n" and "found in n places" cases already in the file must still pass.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @robot/app exec vitest run src/lib/site/verification-model.test.ts`
Expected: the three new/changed cases FAIL (kind is `agreed`).

- [ ] **Step 3: Implement**

In `rowStatus`, after `const places = placesOf(boxes, s, field, card.url);` add:

```ts
    // Spec 2026-10-09 §B1: a value only the page's data carries is never agreed
    // on the row — nothing on this product's page shows it, so a person looks
    // (the expanded row's page-data hint is how they accept it, cell by cell).
    if (places === 0) return { kind: 'needs-you', reason: `only in the page data on product ${n}`, product: n };
```

Update the function's doc comment (the "page data … agrees" sentences) to say the opposite.

- [ ] **Step 4: Amend the two specs**

In `2026-09-28-table-first-and-drift-repair-design.md` §A2, change "(a single box, or page data with no box)" to "(a single box — a value only the page data carries is not agreed; see 2026-10-09 §B)". In `2026-09-29-certification-picks-the-right-path-design.md` §A5, append one sentence: "Zero boxes is not one place: since 2026-10-09 such a suggestion makes the row `needs-you` ('only in the page data on product n')."

- [ ] **Step 5: Gates**

Run: `pnpm --filter @robot/app test -- --run && pnpm --filter @robot/app typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -m "fix(app): a suggestion no element shows is never agreed — the row asks for a look at that product

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/lib/site/verification-model.ts packages/app/src/lib/site/verification-model.test.ts docs/superpowers/specs/2026-09-28-table-first-and-drift-repair-design.md docs/superpowers/specs/2026-09-29-certification-picks-the-right-path-design.md
```

---

### Task 9: Route smoke — the local shop gets walls, and the sentences are asserted

**Files:**
- Modify: `packages/app/src/routes-smoke.test.ts` (`shopPage` ~lines 106-130; the Verification walk; a new short test)

**Interfaces:** consumes the sentences from Task 1 and the surfaces from Task 7.

- [ ] **Step 1: Add the walled routes to the shop**

In `shopPage`, before the `/l` branch:

```ts
  if (pathname === '/blocked') return { type: 'text/html', status: 403, headers: { server: 'cloudflare', 'cf-ray': 'smoke' }, body: '<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing. Ray ID: smoke</body></html>' };
  if (pathname === '/captcha') return { type: 'text/html', body: '<html><head><title>Verify you are human</title></head><body><p>Verify you are human to continue.</p></body></html>' };
```

and let the server honour `status`/`headers` when present (find where `shopPage`'s result is written with `res.writeHead(200, { 'content-type': type })` and use `res.writeHead(page.status ?? 200, { 'content-type': page.type, ...(page.headers ?? {}) })`).

- [ ] **Step 2: Add the assertions**

A new `it` after the Verification walk, using the same `page`, `projectSlug`, `websiteSlug`:

```ts
  it('a wall is reported as a wall, in the same words everywhere', async () => {
    await page.goto(`${APP}/projects/${projectSlug}/sites/${websiteSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'input[aria-label="Listing page"]');
    const host = new URL(SHOP).hostname;
    // Find products on a 403 Cloudflare page.
    await page.getByRole('textbox', { name: 'Listing page' }).fill(`${SHOP}/blocked`);
    await page.getByRole('button', { name: 'Find products' }).click();
    await expect.poll(() => page.locator('main').innerText(), { timeout: 60_000 }).toContain(`${host} refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet.`);
    expect(await page.locator('main').innerText()).not.toContain('No product links found');
    // Find products on a 200 human check.
    await page.getByRole('textbox', { name: 'Listing page' }).fill(`${SHOP}/captcha`);
    await page.getByRole('button', { name: 'Find products' }).click();
    await expect.poll(() => page.locator('main').innerText(), { timeout: 60_000 }).toContain(`${host} asked for a human check (CAPTCHA).`);
    expect(problems, `the Verification tab logged errors:\n  ${problems.join('\n  ')}`).toEqual([]);
  });
```

And in the "Add website" test, after landing on the new website's tab, assert the reachability line: `await expect.poll(() => page.locator('main').innerText(), { timeout: 30_000 }).toContain(\`Reached ${host} (HTTP 200).\`);`.

- [ ] **Step 3: Run the smoke**

With the servers up (`pnpm dev:all` or the isolated pair; restart the api-server first so it runs this branch's code — tell the owner): `pnpm test:ui:app`.
Expected: PASS. Note: the backoff (Task 4) will make the second Find products on the same host wait 2 minutes after the first wall; to keep the smoke under budget, the shop serves `/blocked` and `/captcha` from the same host, so assert the second message with `timeout: 150_000`, or set `BACKOFF_FIRST_MS` via an env override `ROBOT_BACKOFF_FIRST_MS` read in `domain-lock.ts` (add it: `Number(process.env.ROBOT_BACKOFF_FIRST_MS ?? 120_000)`) and start the smoke's api-server with it at `1000`. Document whichever you choose at the top of the test.

- [ ] **Step 4: Commit**

```bash
git commit -m "test(app): the route smoke serves a 403 wall and a human check, and asserts the one sentence each gets

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- packages/app/src/routes-smoke.test.ts packages/scraper/src/domain-lock.ts
```

(Include refreshed `docs/testing/screens/app-*.png` by explicit path if the run changed them.)

---

### Task 10: Live check and handoff

**Files:**
- Create: `docs/testing/results/2026-10-09-honest-verdicts-live-check.md`
- Modify: `docs/handoff.md` (new section + next-work list), `docs/superpowers/specs/2026-10-09-honest-page-verdicts-design.md` (status line)

- [ ] **Step 1: Live check, free, after the api-server runs this branch**

In the campaign org's project ("Credit campaign 2026-10"), on the existing websites: Find products on `scan.co.uk`, `hobbycraft.co.uk` and `otto.de`'s listing → each shows a refused/challenge sentence within 10 s and no count; Allbirds' Verification tab shows Description as "only in the page data on product 2" (not agreed); Article: Sample then Extract either succeeds or ends `failed` with the challenge sentence as the run's message, never "Done" with 0 rows. Record what was seen with screenshots under `docs/testing/results/screens-2026-10-09-verdicts/`.

- [ ] **Step 2: Handoff**

Add a "Honest page verdicts (2026-10-09)" section near the top of `docs/handoff.md`: what changed (one paragraph), the files, how it was proven, and "What NOT to redo": don't add a per-consumer health check again, read `capture.verdict`; don't put "or page data with no box" back into the agreement rule. Update the next-work list: item 1 of the campaign's follow-ups done; proof-page coverage (spec next); correctness on the run page; sitemap discovery.

- [ ] **Step 3: Commit**

```bash
git add -- docs/testing/results/2026-10-09-honest-verdicts-live-check.md docs/testing/results/screens-2026-10-09-verdicts
git commit -m "docs: honest page verdicts — live check and handoff

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -- docs/handoff.md docs/superpowers/specs/2026-10-09-honest-page-verdicts-design.md docs/testing/results/2026-10-09-honest-verdicts-live-check.md docs/testing/results/screens-2026-10-09-verdicts
```

---

## Self-review

**Spec coverage.** §A1 verdict + decided in capture + rejects only on no document + sentences → Tasks 1, 2. Consumers: finder → Task 5 + 7; proof pages → Tasks 3, 5, 7; runs (plan-source, mark-extracting via the execute guard, roll-up, run page, sample facts) → Tasks 6, 7; reachability → Tasks 5, 7. §A3 backoff → Task 4 (waits, 2→8 min, cleared by ok; reporters in the finder, proof capture, planner, verified extraction). §B1 → Task 8 (+ transferred-path case). Specs amended → Task 8. Testing section → Tasks 1, 2, 4, 6, 8 (unit), 9 (smoke), 10 (live). Files list → every file has a task; `analysis-orchestrator`, `extraction-orchestrator`, `pipeline` → Task 3.

**Placeholders.** None; each code step has its code. Task 7's product-card note says "no change beyond nothing" deliberately: the server stores the sentence in `error`.

**Type consistency.** `CaptureVerdict` kinds identical in Tasks 1–7; `verdictSentence(v, requestedUrl)` argument order the same in Tasks 1, 3, 5; `captureProblem` returns `{ reason, verdict? }` in Task 3 and is consumed as such in Task 5; `rollUpStatus`'s 4th parameter `hasError` in Task 6 only; `rowStatus`'s 6th parameter `failedKinds` in Task 7 only; `describeListingPage(anchors, listingUrl, html, verdict)` in Task 5 and its test.

**Review Focus.** 1 → Task 1 (`CF_CHALLENGE` with status 200; `/captcha` in Task 2). 2 → Task 1 (`PRODUCT` with `captcha` in a script). 3 → Task 1 (same-host redirect ok). 4 → Task 6 (`canExecute` + `rollUpStatus` zero items with error). 5 → Task 4 (acquire waits then runs; ok clears).
