# The finder reads product links — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Find products", the coverage check and the listing walk's cross-check count products — links on priced product cards, one per product path — never menus, category tiles, policy pages, language links or colour copies, and a page with no product grid says so.

**Architecture:** One pure rule in `@robot/scraper` (`crawl/product-link-group.ts`: `findProductGroup`) decides what a product link is, from per-link features a page script (`LISTING_LINKS_SCRIPT`) reads in the live listing page; `@robot/browser`'s capture gains a bounded "load more" step (`CaptureOptions.loadMore`, at most 3 rounds) that runs before the page is read. `readListingPage` (scraper) is the one way the finder and the coverage check read a listing; the walk reads the same harvest from its own capture's `annotate`. `@robot/api` uses it for `checkListingPage` and the coverage check (sampling by product key, "no products" as an answer, no re-offer for a shape a proof page answered "Not on this product"); `@robot/app` shows the new sentences.

**Tech Stack:** TypeScript ESM; vitest; Playwright (Chromium) for served-page fixtures; Drizzle + Postgres (api tests); tRPC v11; TanStack Start + React 19 (app).

**Spec:** `docs/superpowers/specs/2026-10-20-finder-links-design.md`. Evidence: `docs/testing/results/2026-10-20-finder-links/` (`probe.mts`, `probe2.mts`, `harvests/*.json` — per-link features from 13 live listings, not HTML — and `rule.mjs`, the proposed rule run offline on them).

**Planner's notes:**
- Eight tasks. Task 1 (`@robot/browser`) and Task 2 (`@robot/scraper`, the rule and the walk) touch disjoint files and may run in parallel. Task 3 (scraper, `readListingPage` + Chromium fixtures) needs 1 and 2. Task 4 (api: the finder and the coverage check read through `readListingPage`; the old rule is deleted) needs 3. Task 5 (api: the coverage check's semantics) needs 4. Task 6 (app + route smoke) needs 5. Task 7 (the free live check) needs 3 and must run **before** Task 8 fast-forwards `main` (its "before" column imports the old rule from the main checkout). Task 8 is the merge gate.
- The old rule (`largestProductGroup`, `productPathTemplate`, `LISTING_ANCHORS_SCRIPT`) stays in `product-link-group.ts` from Task 2 until Task 4 moves its last consumer (`@robot/api`) over, so every task ends with every package compiling.
- Line numbers below were read on `feat/finder-links` @ `ea348bf`; find code by the quoted text if they moved.
- The rule's numbers were checked offline on the harvests while planning (a scratch copy of Task 2's module): bombas 27 (3 carded), burrow 25, gymshark 64, ikea 89 (52 carded), ikea blog none, lacoste 13, notonthehighstreet 60, puma 14, ridge none, ruggable 47, skullcandy 41 (39 carded), thomann 51, thomann hub 99. Task 2's test pins exactly these.
- Where this plan reads the spec (say so in review if you disagree):
  1. **§3.3 merge.** The spec's sentence says "when each has at least 3 carded product keys", but its own example (notonthehighstreet 31 → 60) and `rule.mjs` (the measured rule) merge when **at least 3 shapes, each with carded keys**, differ in the same one literal segment. With "each ≥ 3" the example stays at 31 (most sellers list 1–2 products). The plan implements `rule.mjs`'s version (`MERGE_MIN_SHAPES = 3`).
  2. **§3.2 / §3.4 what is offered.** The group is chosen by its carded keys; it offers its carded products first, then the same shape's links that are on no card yet (bombas' lazy cards had no image before scrolling: 3 carded of 27), each in page order. A page's ranking never counts uncarded links.
  3. **§3.4 swatch class.** "An element whose class word contains `swatch`" would swallow a whole product card whose wrapper is `card--has-swatches`. The plan counts a swatch-class ancestor only when its own text shows no price (a swatch list has no price; a card does). Task 3 pins it.
  4. **§3.4 versus spec 2026-10-14 §8.** A key=value fragment (`#sku=c-red`) used to make a second group entry for the same path; now the first address seen (fragment kept) is the product and later variants of the same path fold into it. The walk still keeps every extracted row with its own address (variants are decided up front).
  5. **Where the links are read.** The harvests' features were read in the live page (CSS applied: hidden text not counted). The finder used to read the capture's HTML offline (`setContentEvaluate`, no stylesheets). The plan reads the links in the live page through the capture's `annotate` script, after the bounded loading — what the spec measured.

## Global Constraints

- ESM throughout. Relative imports carry `.js` in `@robot/browser`, `@robot/scraper` and `@robot/api`; none in `@robot/app`.
- `@robot/app` imports nothing from `@robot/scraper` except `@robot/scraper/normalize`, and nothing from `@robot/api` (the existing `import type { AppRouter }` in `lib/trpc.ts` and the route smoke's test-helper imports stay as they are).
- Spec §5.1: **no rule names a site, a domain or a platform.** Test fixtures use made-up shops (`shop.example`, `127.0.0.1`); site names appear only in the harvest table test and the live check.
- Spec §5.3: the loading never runs more than 3 rounds (`LOAD_MORE_MAX_ROUNDS`, clamped whatever a caller asks) and never leaves the page.
- Spec §5.4: nothing changes for an existing website's certified paths or stored proof pages — no migration, no write to `verificationSet`, `captures` or the domain cache.
- Spec §5.5: the coverage check never samples a proof page, under any query (product key, §3.4).
- Customer copy never names internals (no "group", "shape", "carded", "ItemList", "JSON-LD", no model, no money). Exact new sentences:
  - finder, no products: `No products found on this page.` (listing bar: `No products found on this page. Paste product pages below.`)
  - coverage check, no products (planner's copy — the spec says only that it "says so"): `No products found on the listing page, so no more products were checked.`
  - coverage line, shape already answered (planner's copy — the spec says only that it stops offering): `like a proof page marked "Not on this product"`
- Tests per package, one file at a time while working: `cd packages/<pkg> && npx vitest run <file>`; Chromium test files one at a time. Never `pnpm -r test`. The api tests need Postgres running (Docker, `127.0.0.1:5432`); the worktree has its `.env` (gitignored; never stage it).
- Commits by explicit path. Never `git add -A` / `git add .`. Never stage `packages/app/src/routeTree.gen.ts`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work only in `C:\Users\Marko\Documents\projects\robot-platform-finder` on `feat/finder-links`. Never start, stop or restart Marko's dev servers (:3000, :4000). The only servers this plan starts are the isolated pair on :4100/:3100 (Task 8), stopped by port afterwards.
- No paid APIs: nothing here calls a model, Jev or TypeSafe. The live check (Task 7) loads public pages with a local Chromium only.
- Files in this repo are CRLF. Edit with tools that keep line endings; new files may be LF (git normalises).

## Review Focus

1. **A product card whose wrapper class names swatches** (`product-card has-swatches`, common on shop themes) — its main link must still count as the product; only links inside a price-less swatch list are swatches. → Task 3 fixture `/swatches` (every card's wrapper carries `has-swatches`).
2. **A "Load more" that is a real link (`<a href="?page=2">`) or a button that pushes `?page=2` with `history.pushState`** — the first must never be followed (the page would be page 2's), the second must keep what it loaded (same document). → Task 1 tests `/link` and `/push`.
3. **A product whose first-seen listing address carries a query (`?variant=rouge`, `?type=category`) while the proof page is the bare path, or `www.` differs** — the coverage check must never sample it. → Task 5 sampler test "never samples a proof page under any query, fragment or www".
4. **A capture whose link harvest is missing or malformed** (the `annotate` script threw on a strange page, an old fake capture) — reads as "no products": the finder says so, the walk keeps its own rows, nothing throws. → Task 2 tests "asListingLinks reads garbage as no links" and "a capture without a harvest leaves the extraction's rows alone".
5. **A JSON-LD ItemList that names other hosts or relative URLs** (a CDN host, a sister shop) — only same-site items count, relative ones resolve against the listing, and fewer than 3 is no group. → Task 2 test "ItemList: same site only, relative resolved, three or more".

---

### Task 1: The capture can load more of a listing, bounded (`@robot/browser`) — spec §3.7, §5.3

**Files:**
- Modify: `packages/browser/src/load-more.ts` (append constants and scripts)
- Modify: `packages/browser/src/types.ts` (`CaptureOptions`, after `expandTabs` `:~182`)
- Modify: `packages/browser/src/playwright-browser.ts` (imports `:1-16`; `capture()` after the `'after-expand'` ready block `:~207`; new private method after `returnIfNavigatedAway`)
- Modify: `packages/browser/src/index.ts:8`
- Create: `packages/browser/src/capture-load-more.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `CaptureOptions.loadMore?: { rounds: number; enough: number; probe: string; count: (probe: unknown) => number }`; exported from `@robot/browser`: `LOAD_MORE_MAX_ROUNDS = 3`, `LOAD_MORE_QUIET_ROUNDS = 2`.

- [ ] **Step 1: Write the failing test**

Create `packages/browser/src/capture-load-more.test.ts`:

```ts
// Spec 2026-10-20 §3.7, §5.3: a listing reader loads more of the page before it is read, bounded.
// Served pages, real Chromium: a grid that grows when scrolled, a "Load more" button, a "Load more"
// that is a real link (never followed), a button that pushes `?page=2` (same document, kept), a
// page that grows forever (three rounds at most), and a page that never grows (two quiet rounds).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PlaywrightBrowser } from './playwright-browser.js';
import { LOAD_MORE_MAX_ROUNDS, LOAD_MORE_QUIET_ROUNDS } from './load-more.js';

const TEXT = '<p>Every item ships free, returns are easy for thirty days, and our team answers every question within a day of asking.</p>';
const card = (n: number) => `<div class="card" style="height:300px"><a class="p" href="/p/${n}">Item ${n}</a></div>`;
const cards = (from: number, n: number) => Array.from({ length: n }, (_, i) => card(from + i)).join('');
/** A listing page; its script can call `add(n)` to append n more cards. */
const listing = (body: string, js: string) => `<!doctype html><html><head><title>Listing</title></head><body>${body}${TEXT}<script>
  const grid = document.getElementById('grid');
  let next = grid.children.length + 1;
  function add(n) { for (let i = 0; i < n; i++, next++) { const d = document.createElement('div'); d.className = 'card'; d.style.height = '300px'; d.innerHTML = '<a class="p" href="/p/' + next + '">Item ' + next + '</a>'; grid.appendChild(d); } }
  ${js}
</script></body></html>`;
const AT_BOTTOM = 'scrollY + innerHeight >= document.documentElement.scrollHeight - 50';

const PAGES: Record<string, string> = {
  '/grow': listing(`<div id="grid">${cards(1, 6)}</div>`, `let batches = 0; addEventListener('scroll', () => { if (batches < 2 && ${AT_BOTTOM}) { batches++; add(6); } });`),
  '/button': listing(`<div id="grid">${cards(1, 4)}</div><button id="more">Load more</button>`, `let clicks = 0; document.getElementById('more').addEventListener('click', () => { clicks++; add(4); if (clicks >= 3) document.getElementById('more').remove(); });`),
  '/link': listing(`<div id="grid">${cards(1, 4)}</div><a id="more" href="/elsewhere">Load more</a>`, ''),
  '/push': listing(`<div id="grid">${cards(1, 4)}</div><button id="more">Load more</button>`, `document.getElementById('more').addEventListener('click', () => { add(4); history.pushState({}, '', '?page=2'); });`),
  '/endless': listing(`<div id="grid">${cards(1, 6)}</div>`, `addEventListener('scroll', () => { if (${AT_BOTTOM}) add(2); });`),
  '/static': listing(`<div id="grid">${cards(1, 6)}</div>`, ''),
};

/** The probe: how many product links the page holds. `count` turns it into a number. */
const COUNT = `(() => document.querySelectorAll('a.p').length)()`;

let server: http.Server;
let base: string;
let browser: PlaywrightBrowser;
const requests: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url ?? '/');
    const html = PAGES[(req.url ?? '/').split('?')[0]!];
    if (!html) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('no such page'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function read(path: string, loadMore?: { rounds: number; enough: number }) {
  const count = vi.fn((v: unknown) => Number(v));
  const capture = await browser.capture(`${base}${path}`, {
    waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1, annotate: COUNT,
    ...(loadMore ? { loadMore: { ...loadMore, probe: COUNT, count } } : {}),
  });
  return { capture, links: Number(capture.annotation), probes: count.mock.calls.length };
}

describe('capture loadMore (spec 2026-10-20 §3.7)', () => {
  it('without it, a lazy grid is read as it first loaded', async () => {
    expect((await read('/grow')).links).toBe(6);
  }, 60_000);

  it('scrolls a lazy grid until it stops growing, and the page is read after loading', async () => {
    const r = await read('/grow', { rounds: 3, enough: 100 });
    expect(r.links).toBe(18);
    expect(r.capture.html).toContain('href="/p/18"');
  }, 60_000);

  it('clicks a "Load more" button', async () => {
    expect((await read('/button', { rounds: 3, enough: 100 })).links).toBe(16);
  }, 60_000);

  it('never follows a "Load more" that is a real link', async () => {
    requests.length = 0;
    const r = await read('/link', { rounds: 3, enough: 100 });
    expect(requests).not.toContain('/elsewhere');
    expect(new URL(r.capture.url).pathname).toBe('/link');
    expect(r.links).toBe(4);
  }, 60_000);

  it('keeps what a button loaded when it only pushes ?page=2 (same document)', async () => {
    expect((await read('/push', { rounds: 3, enough: 100 })).links).toBeGreaterThanOrEqual(8);
  }, 60_000);

  it('runs at most three rounds, whatever it is asked, on a page that grows forever', async () => {
    const r = await read('/endless', { rounds: 10, enough: 100_000 });
    expect(LOAD_MORE_MAX_ROUNDS).toBe(3);
    expect(r.probes).toBe(1 + LOAD_MORE_MAX_ROUNDS); // once before the first round, once after each
    expect(r.links).toBeGreaterThan(6);
  }, 90_000);

  it('stops after two rounds that add nothing', async () => {
    const r = await read('/static', { rounds: 3, enough: 100 });
    expect(r.probes).toBe(1 + LOAD_MORE_QUIET_ROUNDS);
    expect(r.links).toBe(6);
  }, 60_000);

  it('does not scroll at all when the page already holds enough', async () => {
    const r = await read('/grow', { rounds: 3, enough: 6 });
    expect(r.probes).toBe(1);
    expect(r.links).toBe(6);
  }, 60_000);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/browser && npx vitest run src/capture-load-more.test.ts`
Expected: FAIL — `LOAD_MORE_MAX_ROUNDS` is not exported (import error), or, once it is, the `/grow` loading test reads 6.

- [ ] **Step 3: Add the constants and page scripts to `load-more.ts`**

Append to `packages/browser/src/load-more.ts`:

```ts
// ---- Loading more of a listing before it is read (spec 2026-10-20 §3.7) ----------------------

/** Spec 2026-10-20 §5.3: the loading never runs more rounds than this, whatever a caller asks. */
export const LOAD_MORE_MAX_ROUNDS = 3;
/** Rounds in a row that add nothing before the loading stops. */
export const LOAD_MORE_QUIET_ROUNDS = 2;
/** How long a round waits after its scroll, and after a click, for the page to add what it loads. */
export const LOAD_MORE_SETTLE_MS = 1_000;

/**
 * Up to the top, then down the page in steps of most of a window — a lazy grid loads what
 * enters the viewport, and jumping straight to the bottom skips it (and Chromium's scroll
 * anchoring keeps a bottom-pinned viewport from ever firing another scroll) — then the bottom.
 * At most 30 steps. Resolves when done.
 */
export const STEP_SCROLL_SCRIPT = `(async () => {
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 100));
  const step = Math.max(400, Math.floor(window.innerHeight * 0.9));
  for (let y = step, i = 0; y < document.documentElement.scrollHeight && i < 30; y += step, i++) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  window.scrollTo(0, document.documentElement.scrollHeight);
})()`;

/** Marks the document. A `history.pushState` keeps the mark; a navigation loses it. */
export const MARK_DOCUMENT_SCRIPT = `(() => { window.__robotLoadMore = 1; return true; })()`;
/** Is this still the marked document? */
export const SAME_DOCUMENT_SCRIPT = `(() => window.__robotLoadMore === 1)()`;

/** For a load-more selector: is its first match visible, and the link it sits in (for `hrefNavigates`). Null when nothing matches. */
export function loadMoreTargetScript(selector: string): string {
  return `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const a = el.closest('a');
  return { visible: r.width > 0 && r.height > 0, href: a ? a.getAttribute('href') : null, target: a ? a.getAttribute('target') : null };
})()`;
}
```

- [ ] **Step 4: Declare the option**

In `packages/browser/src/types.ts`, inside `export type CaptureOptions = { … }`, after the `expandTabs?: boolean;` member, add:

```ts
  /**
   * Load more of a listing before it is read (spec 2026-10-20 §3.7): up to `rounds` rounds — never
   * more than `LOAD_MORE_MAX_ROUNDS` — each an up-then-down step scroll and one click on a visible
   * "load more" control (`findLoadMore`) that is not a link to another page. `probe` is a
   * self-invoking expression evaluated in the live page before the first round and after each;
   * `count` turns its value into how many of what the caller wants the page now holds. Stops once
   * `count` reaches `enough`, or after `LOAD_MORE_QUIET_ROUNDS` rounds that added nothing. Never
   * leaves the page: a round that navigated returns to the address and ends the loading. Runs after
   * the popup and "show more" rounds, before the final pass, so the HTML, `annotate` and the
   * screenshot all read the loaded page. Skipped on an error response (status 400 or above).
   */
  loadMore?: { rounds: number; enough: number; probe: string; count: (probe: unknown) => number };
```

- [ ] **Step 5: Implement it in the capture**

In `packages/browser/src/playwright-browser.ts`:

1. Add an import after `import { rowCountScript, stampScript, scopeExtractionScript } from './scroll-pages.js';`:

```ts
import {
  findLoadMore, loadMoreTargetScript, LOAD_MORE_MAX_ROUNDS, LOAD_MORE_QUIET_ROUNDS, LOAD_MORE_SETTLE_MS,
  MARK_DOCUMENT_SCRIPT, SAME_DOCUMENT_SCRIPT, STEP_SCROLL_SCRIPT,
} from './load-more.js';
```

2. In `capture()`, right after the block

```ts
        if (options.ready && readyWhen === 'after-expand') {
          ready = await this.waitUntilReady(page, url, intercepted, options.ready);
          await stage(`ready (after expand): ${ready.state}`);
        }
```

insert:

```ts
        // Spec 2026-10-20 §3.7: a listing reader loads more of the page before it is read. Not on an
        // error response: a wall or a 404 has no grid to grow.
        const documentStatus = ((lastDocument as Response | null) ?? response)?.status() ?? 0;
        if (options.loadMore && documentStatus < 400) {
          await this.loadMoreOfListing(page, url, options);
          await stage('after loadMore');
        }
```

3. Add this private method right after `returnIfNavigatedAway(...)`:

```ts
  /**
   * `CaptureOptions.loadMore` (spec 2026-10-20 §3.7): grow a listing that loads on scroll or on a
   * "load more" click, bounded. A probe or a count that throws reads as 0 (a quiet round); a dead
   * renderer still rethrows. A round that left the document (a load-more that was a link after
   * all, a script redirect) goes back to the address, as `returnIfNavigatedAway` does, and the
   * page is read as it first loaded.
   */
  private async loadMoreOfListing(page: Page, url: string, options: CaptureOptions): Promise<void> {
    const lm = options.loadMore;
    if (!lm) return;
    const rethrowCrash = (err: unknown) => { if (isCrash(err)) throw err; };
    const rounds = Math.max(0, Math.min(Math.floor(lm.rounds), LOAD_MORE_MAX_ROUNDS));
    const measure = async (): Promise<number> => {
      const value = await page.evaluate(lm.probe).catch((err) => { rethrowCrash(err); return null; });
      try {
        const n = lm.count(value);
        return Number.isFinite(n) ? n : 0;
      } catch { return 0; }
    };

    let have = await measure();
    let quiet = 0;
    await page.evaluate(MARK_DOCUMENT_SCRIPT).catch(rethrowCrash);
    for (let round = 0; round < rounds && have < lm.enough && quiet < LOAD_MORE_QUIET_ROUNDS; round++) {
      await page.evaluate(STEP_SCROLL_SCRIPT).catch(rethrowCrash);
      await page.waitForTimeout(LOAD_MORE_SETTLE_MS);
      const html = await page.content().catch((err) => { rethrowCrash(err); return ''; });
      const selector = findLoadMore(html);
      if (selector) {
        const target = (await page.evaluate(loadMoreTargetScript(selector)).catch((err) => { rethrowCrash(err); return null; })) as
          { visible: boolean; href: string | null; target: string | null } | null;
        if (target?.visible && !hrefNavigates(target)) {
          await page.locator(selector).first().click({ timeout: 3_000 }).catch(rethrowCrash);
          await page.waitForTimeout(LOAD_MORE_SETTLE_MS);
        }
      }
      const same = await page.evaluate(SAME_DOCUMENT_SCRIPT).catch((err) => { rethrowCrash(err); return false; });
      if (same !== true) {
        console.warn(`[browser] loading more of ${url} left the page; returning to it and reading it as it first loaded`);
        await this.navigateWithFallback(page, url, options);
        await this.dismissPopups(page);
        return;
      }
      const now = await measure();
      quiet = now > have ? 0 : quiet + 1;
      have = Math.max(have, now);
    }
  }
```

(`hrefNavigates` is already imported from `./overlays.js` at the top of the file.)

4. In `packages/browser/src/index.ts`, replace `export { findLoadMore } from './load-more.js';` with:

```ts
export { findLoadMore, LOAD_MORE_MAX_ROUNDS, LOAD_MORE_QUIET_ROUNDS } from './load-more.js';
```

- [ ] **Step 6: Run the test and the neighbours**

Run, one at a time:
`cd packages/browser && npx vitest run src/capture-load-more.test.ts`
`cd packages/browser && npx vitest run src/load-more.test.ts`
`cd packages/browser && npx vitest run src/capture-ready.test.ts`
`cd packages/browser && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/browser/src/load-more.ts packages/browser/src/types.ts packages/browser/src/playwright-browser.ts packages/browser/src/index.ts packages/browser/src/capture-load-more.test.ts
git commit -m "feat(browser): the capture can load more of a listing, three rounds at most, never leaving the page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The rule, and the walk on it (`@robot/scraper`) — spec §3.1–§3.6, §3.9

**Files:**
- Modify (rewrite): `packages/scraper/src/crawl/product-link-group.ts`
- Modify: `packages/scraper/src/crawl/plan-run.ts` (import `:25`; the listing capture `:~370`; the cross-check `:~516-562`)
- Modify: `packages/scraper/src/index.ts:37`
- Create: `packages/scraper/src/crawl/product-link-rule.test.ts`
- Modify: `packages/scraper/src/crawl/plan-run-product-group.test.ts`
- Modify: `packages/scraper/src/crawl/__fixtures__/README.md`

**Interfaces:**
- Consumes: `isKeyValueFragment` from `@robot/browser` (existing).
- Produces (all exported from `@robot/scraper`):
  - types `CardLevel = { d: number; img: boolean; price: boolean; len: number }`, `ListingAnchor` (adds `swatch?: boolean; levels?: CardLevel[]`), `ListingItem = { url: string; name?: string; image?: string }`, `ListingLinks = { anchors: ListingAnchor[]; itemList: ListingItem[] }`, `ProductGroup = { shape: string | null; urls: string[]; carded: number }`
  - `findProductGroup(links: ListingLinks, listingUrl: string): ProductGroup | null`
  - `asListingLinks(value: unknown): ListingLinks`
  - `productKey(url: string): string | null`, `urlShape(url: string): string | null`, `productPathShape(pathname: string): string`, `fitsShape(shape: string, url: string): boolean`, `onCard(levels?: CardLevel[]): boolean`, `PRICE_PATTERN: RegExp`
  - `LISTING_LINKS_SCRIPT: string` (returns `ListingLinks` from a live page)
  - `reconcileWithProductGroup({ rows, urlField, group: ProductGroup | null, listingUrl, knownDetailUrls?, directListing? }): ReconciledRows | null`
  - kept until Task 4: `largestProductGroup`, `productPathTemplate`, `LISTING_ANCHORS_SCRIPT`

- [ ] **Step 1: Write the failing rule test (values from the harvests)**

Create `packages/scraper/src/crawl/product-link-rule.test.ts`:

```ts
// The finder's rule (spec 2026-10-20 §3), pure. The harvest table is the evidence: per-link
// features read from 13 live listings on 2026-10-20 (docs/testing/results/2026-10-20-finder-links/),
// fed through the rule exactly as the page script would hand them over.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  asListingLinks, CARD_MAX_LEVELS, findProductGroup, fitsShape, onCard, PRICE_PATTERN, productKey, productPathShape, urlShape,
  type CardLevel, type ListingAnchor, type ListingLinks,
} from './product-link-group.js';

const HARVESTS = new URL('../../../../docs/testing/results/2026-10-20-finder-links/harvests/', import.meta.url);
type Harvest = {
  url: string;
  anchors: Array<{ href: string; text: string; chrome: boolean; swatch: boolean; selfPrice: boolean; selfImg: boolean; lv: CardLevel[] }>;
  itemList: Array<string | null>;
};
/** A harvest as `ListingLinks`. Its `lv` starts at the parent; the link itself (its own image and price) is level 0, whose text length was not kept (0). */
function harvest(name: string): { url: string; links: ListingLinks } {
  const h = JSON.parse(readFileSync(new URL(`${name}.json`, HARVESTS), 'utf8')) as Harvest;
  return {
    url: h.url,
    links: {
      anchors: h.anchors.map((a) => ({
        href: a.href, text: a.text, chrome: a.chrome || undefined, swatch: a.swatch || undefined,
        levels: [{ d: 1, img: a.selfImg, price: a.selfPrice, len: 0 }, ...a.lv.slice(0, CARD_MAX_LEVELS - 1)],
      })),
      itemList: h.itemList.filter((u): u is string => typeof u === 'string').map((url) => ({ url })),
    },
  };
}

const CARD: CardLevel[] = [{ d: 1, img: true, price: true, len: 40 }];
const TILE: CardLevel[] = [{ d: 1, img: true, price: false, len: 20 }];
const carded = (href: string, extra: Partial<ListingAnchor> = {}): ListingAnchor => ({ href, text: 'x', levels: CARD, ...extra });
const plain = (href: string, extra: Partial<ListingAnchor> = {}): ListingAnchor => ({ href, text: 'x', ...extra });
const links = (anchors: ListingAnchor[], itemList: ListingLinks['itemList'] = []): ListingLinks => ({ anchors, itemList });
const L = 'https://shop.example/collections/sofas';
const paths = (urls: string[]) => urls.map((u) => { const x = new URL(u); return x.pathname + x.search + x.hash; });

describe('the 13 campaign listings (harvests, 2026-10-20)', () => {
  // [harvest, shape, products offered, of them on cards] — null: no products (§3.6).
  const TABLE: Array<[string, string | null, number, number]> = [
    ['bombas', 'bombas.com/products/*', 27, 3],
    ['burrow', 'burrow.com/products/*', 25, 25],
    ['gymshark', 'gymshark.com/products/*', 64, 64],
    ['ikea', 'ikea.com/my/en/p/*', 89, 52],
    ['ikea-blog', null, 0, 0],
    ['lacoste', 'lacoste.com/gb/lacoste/men/clothing/*/*/*.html', 13, 13],
    ['noths', 'notonthehighstreet.com/*/product/*', 60, 60],
    ['puma', 'us.puma.com/us/en/pd/*/*', 14, 14],
    ['ridge', null, 0, 0],
    ['ruggable', 'ruggable.com/products/*', 47, 47],
    ['skullcandy', 'skullcandy.com/products/*', 41, 39],
    ['thomann', 'thomann.de/de/*.htm', 51, 51],
    ['thomann-cat', 'thomann.de/de/*.htm', 99, 99],
  ];
  for (const [name, shape, n, onCards] of TABLE) {
    it(`${name}: ${shape === null ? 'no products' : `${n} products (${onCards} on cards), ${shape}`}`, () => {
      const { url, links: l } = harvest(name);
      const g = findProductGroup(l, url);
      if (shape === null) { expect(g).toBeNull(); return; }
      expect(g).not.toBeNull();
      expect(g!.shape).toBe(shape);
      expect(g!.urls).toHaveLength(n);
      expect(g!.carded).toBe(onCards);
      expect(new Set(g!.urls.map(productKey)).size).toBe(n); // one address per product
    });
  }

  it('bombas: the products, never the /collections/ menu that won before', () => {
    const { url, links: l } = harvest('bombas');
    const g = findProductGroup(l, url)!;
    expect(g.urls.every((u) => new URL(u).pathname.startsWith('/products/'))).toBe(true);
    // Carded first: the three cards whose image had loaded lead the list.
    expect(paths(g.urls.slice(0, 1))).toEqual(['/products/mens-merino-wool-socks?variant=rouge']);
  });

  it('noths: the seller-segment shapes merge without the ItemList too (§3.3)', () => {
    const { url, links: l } = harvest('noths');
    const g = findProductGroup({ ...l, itemList: [] }, url)!;
    expect(g.shape).toBe('notonthehighstreet.com/*/product/*');
    expect(g.urls).toHaveLength(60);
  });

  it('lacoste: four products in several colours are one address each, the first seen', () => {
    const { url, links: l } = harvest('lacoste');
    const g = findProductGroup(l, url)!;
    expect(paths(g.urls.slice(0, 1))).toEqual(['/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00.html?color=02S']);
  });

  it('puma: the ItemList (24 entries, 14 products) confirms the cards and adds nothing', () => {
    const { url, links: l } = harvest('puma');
    expect(l.itemList).toHaveLength(24);
    const g = findProductGroup(l, url)!;
    expect(g.urls).toHaveLength(14);
    expect(g.shape).toBe('us.puma.com/us/en/pd/*/*');
  });
});

describe('productPathShape (§3.1)', () => {
  it('blanks whole segments with a digit, - or _, or of 12+ characters; keeps words and extensions', () => {
    expect(productPathShape('/products/union-3-seat-sofa')).toBe('/products/*');
    expect(productPathShape('/products/range-plus-armchair')).toBe('/products/*');
    expect(productPathShape('/gb/men/polo-shirts/short-sleeves/L1212-00.html')).toBe('/gb/men/*/*/*.html');
    expect(productPathShape('/gb/men/polo-shirts/long-sleeve/PH2481-00.html')).toBe('/gb/men/*/*/*.html');
    expect(productPathShape('/de/yamaha_c40_konzertgitarre.htm')).toBe('/de/*.htm');
    expect(productPathShape('/de/e-gitarren.html')).toBe('/de/*.html');
    expect(productPathShape('/products/set')).toBe('/products/set');
    expect(productPathShape('/collections/everything')).toBe('/collections/everything');
    expect(productPathShape('/collections/accessoriesall')).toBe('/collections/*');
    expect(productPathShape('/')).toBe('/');
    expect(productPathShape('/p/9/')).toBe('/p/*');
  });
  it('urlShape keeps the host (without www.) and drops the query and fragment', () => {
    expect(urlShape('https://www.shop.example/products/oak-chair?color=red#reviews')).toBe('shop.example/products/*');
    expect(urlShape('mailto:a@b.example')).toBeNull();
    expect(urlShape('not a url')).toBeNull();
  });
  it('fitsShape: `*` takes any one segment, never the host; segment counts must match', () => {
    expect(fitsShape('shop.example/*/product/*', 'https://shop.example/oakhouse/product/oak-chair')).toBe(true);
    expect(fitsShape('shop.example/products/*', 'https://www.shop.example/products/oak-chair')).toBe(true);
    expect(fitsShape('shop.example/products/*', 'https://shop.example/pages/about')).toBe(false);
    expect(fitsShape('shop.example/products/*', 'https://other.example/products/oak-chair')).toBe(false);
    expect(fitsShape('shop.example/products/*', 'https://shop.example/products/a-b/reviews')).toBe(false);
  });
});

describe('PRICE_PATTERN (§3.2)', () => {
  it('reads a number with a currency next to it, in common locale formats', () => {
    for (const s of ['$1,234.50', '1.234,50 €', '1 234,50 €', 'RM810.00', 'MYR 620', '£25', '₹1,299', '¥3,980', '199 kr', '199kr', 'CHF 49.90', '49,90 CHF', 'US$ 20', 'From $99']) {
      expect(PRICE_PATTERN.test(s), s).toBe(true);
    }
  });
  it('is not fooled by ratings, sizes, counts, discounts, years or words that hold a code', () => {
    for (const s of ['4.5 stars', 'Size 10', '2 colours', '-20%', '© 2026', '+2', 'Europe 2026', '12 Kraków', 'Free shipping', 'Rso 5']) {
      expect(PRICE_PATTERN.test(s), s).toBe(false);
    }
  });
});

describe('productKey and onCard', () => {
  it('a product is host + path: query, fragment, trailing slash and www. do not make another', () => {
    expect(productKey('https://www.shop.example/p/oak-chair/?color=red#sku=1')).toBe('shop.example/p/oak-chair');
    expect(productKey('https://shop.example/p/oak-chair')).toBe('shop.example/p/oak-chair');
    expect(productKey('javascript:void(0)')).toBeNull();
  });
  it('a card is a level with at most 3 link paths, under 800 characters, an image and a price — within 7 levels', () => {
    expect(onCard(CARD)).toBe(true);
    expect(onCard(TILE)).toBe(false); // an image alone is not a card (category tiles)
    expect(onCard([{ d: 4, img: true, price: true, len: 40 }])).toBe(false);
    expect(onCard([{ d: 1, img: true, price: true, len: 800 }])).toBe(false);
    expect(onCard([...Array.from({ length: 7 }, () => ({ d: 1, img: false, price: false, len: 0 })), CARD[0]!])).toBe(false);
    expect(onCard(undefined)).toBe(false);
  });
  it('asListingLinks reads garbage as no links', () => {
    expect(asListingLinks(undefined)).toEqual({ anchors: [], itemList: [] });
    expect(asListingLinks([1, 2])).toEqual({ anchors: [], itemList: [] });
    expect(asListingLinks({ anchors: [{ href: '/p/a' }, { nope: 1 }, null], itemList: [{ url: '/p/b' }, 'x'] }))
      .toEqual({ anchors: [{ href: '/p/a', text: '' }], itemList: [{ url: '/p/b' }] });
  });
});

describe('findProductGroup (§3.2–§3.6)', () => {
  it('a menu of 40 links beside a priced grid of 12: the grid', () => {
    const menu = Array.from({ length: 40 }, (_, i) => plain(`/collections/category-${i}`));
    const grid = Array.from({ length: 12 }, (_, i) => carded(`/products/oak-chair-${i}`));
    const g = findProductGroup(links([...menu, ...grid]), L)!;
    expect(g.shape).toBe('shop.example/products/*');
    expect(paths(g.urls)).toEqual(grid.map((a) => a.href));
  });
  it('category tiles with images and no prices: no products', () => {
    expect(findProductGroup(links(Array.from({ length: 8 }, (_, i) => ({ href: `/collections/sofas-${i}`, text: 'x', levels: TILE }))), L)).toBeNull();
  });
  it('policy pages, a language link and a blog post: no products', () => {
    expect(findProductGroup(links([plain('/pages/terms'), plain('/policies/refund-policy'), plain('/en-gb/'), plain('/blogs/news/a-story')]), L)).toBeNull();
  });
  it('one product in four colours is one product; the first address seen is the one offered', () => {
    const g = findProductGroup(links(['red', 'blue', 'green', 'black'].flatMap((c) => [carded(`/p/polo-a?color=${c}`), carded(`/p/polo-b?color=${c}`)])), L)!;
    expect(paths(g.urls)).toEqual(['/p/polo-a?color=red', '/p/polo-b?color=red']);
  });
  it('swatch links and "+2" are not products', () => {
    const g = findProductGroup(links([carded('/products/rug-a'), carded('/products/rug-a-blue', { swatch: true }), carded('/products/rug-b'), carded('/products/rug-c')]), L)!;
    expect(paths(g.urls)).toEqual(['/products/rug-a', '/products/rug-b', '/products/rug-c']);
  });
  it('a key=value fragment stays on the first address; a later variant of the same path folds into it (§3.4 over 2026-10-14 §8)', () => {
    const g = findProductGroup(links([
      carded('https://shop.example/products/alpha-runner-shoe#sku=a-blue'),
      carded('https://shop.example/products/bravo-runner-shoe#reviews'),
      carded('https://shop.example/products/charlie-runner-shoe'),
      carded('https://shop.example/products/charlie-runner-shoe#sku=c-red'),
    ]), L)!;
    expect(g.urls).toEqual([
      'https://shop.example/products/alpha-runner-shoe#sku=a-blue',
      'https://shop.example/products/bravo-runner-shoe',
      'https://shop.example/products/charlie-runner-shoe',
    ]);
  });
  it('the listing itself, the root, other hosts and non-http links are never products', () => {
    const g = findProductGroup(links([carded(L), carded(`${L}?page=2`), carded('/'), carded('https://other.example/products/a-b'), carded('javascript:void(0)'),
      carded('/products/a-1'), carded('/products/b-2'), carded('/products/c-3')]), L)!;
    expect(paths(g.urls)).toEqual(['/products/a-1', '/products/b-2', '/products/c-3']);
  });
  it('three seller shapes with carded products merge; two do not; shapes without cards never do (§3.3)', () => {
    const sellers = (names: string[]) => names.flatMap((s) => [carded(`/${s}/product/oak-chair`), carded(`/${s}/product/pine-stool`)]);
    const three = findProductGroup(links(sellers(['oakhouse', 'fernly', 'marlow'])), L)!;
    expect(three.shape).toBe('shop.example/*/product/*');
    expect(three.urls).toHaveLength(6);
    const two = findProductGroup(links(sellers(['oakhouse', 'fernly'])), L)!;
    expect(two.urls).toHaveLength(2);
    const menu = findProductGroup(links([...['a', 'b', 'c'].map((s) => plain(`/${s}/product/x-1`)), carded('/products/p-1')]), L)!;
    expect(menu.shape).toBe('shop.example/products/*');
  });
  it('ranks by products on cards, not by raw links', () => {
    const many = Array.from({ length: 30 }, (_, i) => plain(`/products/menu-item-${i}`));
    const few = Array.from({ length: 5 }, (_, i) => carded(`/p/real-${i}`));
    expect(findProductGroup(links([...many, ...few]), L)!.shape).toBe('shop.example/p/*');
  });
  it('offers the products on cards first, then the same shape\'s links whose card has not loaded, each in page order', () => {
    const g = findProductGroup(links([plain('/products/lazy-1'), carded('/products/card-1'), plain('/products/lazy-2'), carded('/products/card-2')]), L)!;
    expect(paths(g.urls)).toEqual(['/products/card-1', '/products/card-2', '/products/lazy-1', '/products/lazy-2']);
    expect(g.carded).toBe(2);
  });
  it('a grid wrapped in navigation is still found when nothing outside it is a card', () => {
    const grid = Array.from({ length: 5 }, (_, i) => carded(`/products/shoe-${i}`, { chrome: true }));
    expect(findProductGroup(links([...grid, plain('/pages/about')]), L)!.urls).toHaveLength(5);
  });
  it('ItemList only (products are not links): its items are the group, shape null (§3.5)', () => {
    const g = findProductGroup(links([plain('/pages/terms')], ['/p/a-1', '/p/b-2', '/p/c-3', '/p/a-1'].map((url) => ({ url }))), L)!;
    expect(g).toEqual({ shape: null, urls: ['https://shop.example/p/a-1', 'https://shop.example/p/b-2', 'https://shop.example/p/c-3'], carded: 3 });
  });
  it('ItemList: same site only, relative resolved, three or more', () => {
    expect(findProductGroup(links([], [{ url: 'https://cdn.example/p/a-1' }, { url: 'https://cdn.example/p/b-2' }, { url: '/p/c-3' }, { url: '/p/d-4' }]), L)).toBeNull();
    expect(findProductGroup(links([], [{ url: 'p/a-1' }, { url: 'https://www.shop.example/p/b-2' }, { url: '/p/c-3' }]), L)!.urls)
      .toEqual(['https://shop.example/collections/p/a-1', 'https://www.shop.example/p/b-2', 'https://shop.example/p/c-3']);
  });
  it('an ItemList that overlaps the cards confirms them and adds what they missed; one that does not and is larger wins', () => {
    const cards = [carded('/p/a-1'), carded('/p/b-2')];
    const overlap = findProductGroup(links(cards, ['/p/a-1', '/p/c-3', '/p/d-4'].map((url) => ({ url }))), L)!;
    expect(paths(overlap.urls)).toEqual(['/p/a-1', '/p/b-2', '/p/c-3', '/p/d-4']);
    expect(overlap.shape).toBe('shop.example/p/*');
    const apart = findProductGroup(links(cards, ['/item/x-1', '/item/y-2', '/item/z-3'].map((url) => ({ url }))), L)!;
    expect(apart.shape).toBeNull();
    expect(paths(apart.urls)).toEqual(['/item/x-1', '/item/y-2', '/item/z-3']);
  });
  it('an unparseable listing address is no products, not a throw', () => {
    expect(findProductGroup(links([carded('/p/a-1')]), 'not a url')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/scraper && npx vitest run src/crawl/product-link-rule.test.ts`
Expected: FAIL — `findProductGroup` (and the other new names) are not exported.

- [ ] **Step 3: Rewrite `product-link-group.ts`**

Replace the whole of `packages/scraper/src/crawl/product-link-group.ts` with:

```ts
// The ONE mechanical definition of "the product links on a listing page",
// shared by the Verification tab's "Find products" / listing check
// (`describeListingPage` in @robot/api), the coverage check that samples the
// same group, and the listing walk that Sample and Extract plan with
// (`planRun`, which cross-checks its rows against it). Pure, no AI.
//
// Spec 2026-10-20 (the finder reads product links): a product link is a link
// on a product card, and one product is one path.
// - Shape per path segment (§3.1): a segment with a digit, `-` or `_`, or of
//   12+ characters is `*`; a file extension is kept; the host is kept.
// - On a card (§3.2): an ancestor at most 6 levels up holds at most 3 distinct
//   link paths, under 800 characters of text, an image and a price. A group is
//   ranked by its distinct product keys on cards, never by raw link count, so a
//   menu or a set of category tiles (images, no prices) never wins.
// - One-segment merge (§3.3): at least 3 shapes with carded keys that differ in
//   one literal segment (`/{seller}/product/*`) are one group.
// - One product, one path (§3.4): the key is host + path; the first address
//   seen is the one offered; swatch links and "+2" are not product links.
// - JSON-LD ItemList (§3.5): 3+ same-site items are a group of their own.
// - Zero is an answer (§3.6): no carded group and no ItemList group → null.
// Every threshold came from 13 live listings (docs/testing/results/2026-10-20-finder-links/).
// No rule here names a site, a domain or a platform (spec §5.1).

import { isKeyValueFragment } from '@robot/browser';

/** One ancestor level of a link (index 0 is the link itself): distinct link paths in it, an image, a price, its text length. */
export type CardLevel = { d: number; img: boolean; price: boolean; len: number };

export type ListingAnchor = {
  href: string;
  text: string;
  title?: string;
  image?: string;
  /** In page navigation: nav, aside, a navigation/banner/contentinfo/complementary role, or the page's own header/footer. */
  chrome?: boolean;
  /** A colour/size swatch or a "+2" link (spec §3.4): never a product link. */
  swatch?: boolean;
  /** The link itself, then up to six ancestors (see `LISTING_LINKS_SCRIPT`). Absent: the link is on no card. */
  levels?: CardLevel[];
};

/** One `ItemList` entry from the page's JSON-LD. */
export type ListingItem = { url: string; name?: string; image?: string };

/** What `LISTING_LINKS_SCRIPT` returns from a listing page. */
export type ListingLinks = { anchors: ListingAnchor[]; itemList: ListingItem[] };

export type ProductGroup = {
  /** Host + path shape (`shop.example/products/*`); a merged group has `*` where its shapes differ; null for an ItemList-only group. */
  shape: string | null;
  /** One address per product (the first seen): carded products first, then the shape's other links, each in page order; ItemList items the cards missed last. */
  urls: string[];
  /** What the group was ranked by: its distinct product keys on cards, or the ItemList's distinct items. */
  carded: number;
};

/** Spec §3.2: how far up a card may be, and what it may hold. */
export const CARD_MAX_LEVELS = 7; // the link itself + 6 ancestors
export const CARD_MAX_LINKS = 3;
export const CARD_MAX_TEXT = 800;
/** Spec §3.3, as measured (`rule.mjs`): shapes that differ in one literal segment merge when at least this many carry carded keys. */
export const MERGE_MIN_SHAPES = 3;
/** Spec §3.5: an ItemList is a group from this many distinct same-site items. */
export const ITEM_LIST_MIN = 3;

const CURRENCY = String.raw`(?:[$€£¥₹₩₽₺₪฿₫₱]|(?<![A-Za-z])(?:US\$|AU\$|CA\$|NZ\$|HK\$|S\$|R\$|USD|EUR|GBP|JPY|CNY|INR|AUD|CAD|NZD|CHF|SEK|NOK|DKK|PLN|CZK|HUF|MYR|SGD|HKD|AED|SAR|ZAR|BRL|MXN|TRY|RM|Rs|kr|zł|Kč|Ft|lei)(?![A-Za-z]))`;
const AMOUNT = String.raw`(?:\d{1,3}(?:[.,\s\u00a0\u202f']\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
/**
 * Spec §3.2: a number with a currency symbol or code next to it, either side,
 * in any common locale format (`$1,234.50`, `1.234,50 €`, `RM810.00`, `MYR 620`,
 * `£25`, `₹1,299`, `¥3,980`, `199 kr`, `CHF 49.90`). A code counts only when no
 * letter touches it, so "Europe" or "Kraków" is not a price.
 */
export const PRICE_PATTERN = new RegExp(`${CURRENCY}\\s?${AMOUNT}|${AMOUNT}\\s?${CURRENCY}`, 'i');

const bareHost = (h: string): string => h.toLowerCase().replace(/^www\./, '');
const trimSlash = (p: string): string => p.replace(/\/+$/, '');

/** Spec §3.1, one segment: a digit, `-` or `_`, or 12+ characters → `*`; the extension stays. */
function segmentShape(s: string): string {
  const m = /^(.*?)(\.[a-z]{2,5})$/i.exec(s);
  const [stem, ext] = m ? [m[1]!, m[2]!] : [s, ''];
  return (/[\d_-]/.test(stem) || stem.length >= 12 ? '*' : stem) + ext;
}

/** Spec §3.1: a path's shape, per whole segment (`/products/union-3-seat-sofa` → `/products/*`, `/de/a_b.htm` → `/de/*.htm`). */
export function productPathShape(pathname: string): string {
  return '/' + pathname.split('/').filter(Boolean).map(segmentShape).join('/');
}

/** Host (without `www.`) + path shape; the query and fragment are not part of it. Null for an unparseable or non-http(s) URL. */
export function urlShape(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return bareHost(u.hostname) + productPathShape(u.pathname);
  } catch { return null; }
}

/** Spec §3.4: a product's key — host (without `www.`) + path, trailing slash trimmed, query and fragment dropped. */
export function productKey(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return bareHost(u.hostname) + trimSlash(u.pathname);
  } catch { return null; }
}

/** Does `url` fit `shape` (a group's, which may hold `*` where merged shapes differed)? `*` takes any one segment, never the host. */
export function fitsShape(shape: string, url: string): boolean {
  const own = urlShape(url);
  if (own === null) return false;
  const a = shape.split('/');
  const b = own.split('/');
  return a.length === b.length && a.every((s, i) => s === b[i] || (i > 0 && s === '*'));
}

/** Spec §3.2: one level within reach holds at most 3 link paths, under 800 characters, an image and a price. */
export function onCard(levels: CardLevel[] | undefined): boolean {
  return (levels ?? []).slice(0, CARD_MAX_LEVELS)
    .some((l) => l.d <= CARD_MAX_LINKS && l.len < CARD_MAX_TEXT && l.img && l.price);
}

/** The page script's value, checked: anything malformed reads as a page with no links. */
export function asListingLinks(value: unknown): ListingLinks {
  const v = (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}) as { anchors?: unknown; itemList?: unknown };
  const anchors = Array.isArray(v.anchors)
    ? v.anchors.filter((a): a is ListingAnchor => !!a && typeof a === 'object' && typeof (a as ListingAnchor).href === 'string')
      .map((a) => ({ ...a, text: typeof a.text === 'string' ? a.text : '' }))
    : [];
  const itemList = Array.isArray(v.itemList)
    ? v.itemList.filter((i): i is ListingItem => !!i && typeof i === 'object' && typeof (i as ListingItem).url === 'string')
    : [];
  return { anchors, itemList };
}

/** A same-site link that is not the listing itself or the site's root: its address (variant fragment kept), key and shape. */
type Resolved = { href: string; key: string; shape: string };

function resolver(listingUrl: string): (href: string) => Resolved | null {
  const base = new URL(listingUrl);
  const host = bareHost(base.hostname);
  const self = host + trimSlash(base.pathname);
  return (href) => {
    let u: URL;
    try { u = new URL(href, listingUrl); } catch { return null; }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || bareHost(u.hostname) !== host) return null;
    const path = trimSlash(u.pathname);
    const key = host + path;
    if (path === '' || key === self) return null;
    // Spec 2026-10-14 §8: a fragment whose every part is key=value names a variant and stays on the address.
    if (!isKeyValueFragment(u.hash)) u.hash = '';
    return { href: u.href, key, shape: host + productPathShape(u.pathname) };
  };
}

type ShapeGroup = { shapes: string[]; first: Map<string, { href: string; order: number }>; carded: Set<string> };

function cardGroup(anchors: ListingAnchor[], listingUrl: string): { shape: string; urls: string[]; carded: number } | null {
  const resolve = resolver(listingUrl);
  const byShape = new Map<string, ShapeGroup>();
  anchors.forEach((a, order) => {
    if (a.swatch) return;
    const r = resolve(a.href);
    if (!r) return;
    let g = byShape.get(r.shape);
    if (!g) { g = { shapes: [r.shape], first: new Map(), carded: new Set() }; byShape.set(r.shape, g); }
    if (!g.first.has(r.key)) g.first.set(r.key, { href: r.href, order });
    if (onCard(a.levels)) g.carded.add(r.key);
  });

  // §3.3: shapes with carded keys that differ in one literal segment, three or more of them, are one
  // group (with the shape that already has `*` there, if the page has one).
  const parent = new Map<string, string>();
  const root = (s: string): string => { let x = s; while (parent.get(x) !== x) x = parent.get(x)!; return x; };
  const holes = new Map<string, string[]>();
  for (const [shape, g] of byShape) {
    if (g.carded.size === 0) continue;
    const segs = shape.split('/');
    segs.forEach((seg, i) => {
      if (i === 0 || seg === '' || seg.startsWith('*')) return;
      const hole = segs.map((x, j) => (j === i ? '*' : x)).join('/');
      (holes.get(hole) ?? holes.set(hole, []).get(hole)!).push(shape);
    });
  }
  for (const [hole, members] of holes) {
    if (members.length < MERGE_MIN_SHAPES) continue;
    const all = byShape.has(hole) ? [...members, hole] : members;
    for (const s of all) if (!parent.has(s)) parent.set(s, s);
    for (const s of all.slice(1)) parent.set(root(s), root(all[0]!));
  }
  const groups = new Map<string, ShapeGroup>();
  for (const [shape, g] of byShape) {
    const r = parent.has(shape) ? root(shape) : shape;
    const m = groups.get(r);
    if (!m) { groups.set(r, { shapes: [shape], first: new Map(g.first), carded: new Set(g.carded) }); continue; }
    m.shapes.push(shape);
    for (const [k, v] of g.first) if (!m.first.has(k) || m.first.get(k)!.order > v.order) m.first.set(k, v);
    for (const k of g.carded) m.carded.add(k);
  }

  let best: ShapeGroup | null = null;
  for (const g of groups.values()) {
    if (g.carded.size === 0) continue;
    if (!best || g.carded.size > best.carded.size || (g.carded.size === best.carded.size && g.first.size > best.first.size)) best = g;
  }
  if (!best) return null;
  const winner = best;
  const segs = winner.shapes.map((s) => s.split('/'));
  const shape = segs[0]!.map((x, i) => (segs.every((s) => s[i] === x) ? x : '*')).join('/');
  const urls = [...winner.first.entries()]
    .sort(([ka, a], [kb, b]) => Number(!winner.carded.has(ka)) - Number(!winner.carded.has(kb)) || a.order - b.order)
    .map(([, v]) => v.href);
  return { shape, urls, carded: winner.carded.size };
}

/**
 * The listing's product group (spec 2026-10-20 §3), or null when the page has
 * none — a page of policy links, a blog post, a menu (§3.6). Navigation links
 * (`chrome`) are left out first; when what is left holds no carded group, the
 * whole page is read, so a theme that wraps its grid in `nav` or `aside` is
 * still found (a menu has no prices, so it never qualifies either way).
 */
export function findProductGroup(links: ListingLinks, listingUrl: string): ProductGroup | null {
  try { new URL(listingUrl); } catch { return null; }
  const content = links.anchors.filter((a) => !a.chrome);
  const cards = cardGroup(content, listingUrl)
    ?? (content.length < links.anchors.length ? cardGroup(links.anchors, listingUrl) : null);

  const resolve = resolver(listingUrl);
  const items = new Map<string, string>();
  for (const it of links.itemList) {
    const r = resolve(it.url);
    if (r && !items.has(r.key)) items.set(r.key, r.href);
  }
  const itemGroup = items.size >= ITEM_LIST_MIN;

  if (cards && itemGroup) {
    const cardKeys = new Set(cards.urls.map((u) => productKey(u)));
    // §3.5: an ItemList that overlaps the card group confirms it; what the cards missed is added after them.
    if ([...items.keys()].some((k) => cardKeys.has(k))) {
      const extra = [...items].filter(([k]) => !cardKeys.has(k)).map(([, href]) => href);
      return { shape: cards.shape, urls: [...cards.urls, ...extra], carded: cards.carded };
    }
  }
  if (itemGroup && (!cards || items.size > cards.carded)) return { shape: null, urls: [...items.values()], carded: items.size };
  return cards ? { shape: cards.shape, urls: cards.urls, carded: cards.carded } : null;
}

/**
 * Runs inside the live listing page, as the capture's `annotate` script (after
 * popups, "show more" and the bounded loading — `readListingPage`), so text and
 * prices read as the page shows them. Per link: its href as written, its text,
 * a title, an image (inside the link, else in the nearest ancestor up to three
 * levels that holds no more than three links), `chrome` for page navigation,
 * `swatch` (§3.4: inside a radio, an `aria-checked` or `data-swatch` element, or
 * an element whose class names a swatch and whose own text shows no price — a
 * card's wrapper named `has-swatches` shows its price; or own text "+N"), and
 * `levels`: the link itself, then up to six ancestors, each with its distinct
 * link paths (`d`, counted to 4) and — when `d` ≤ 3 — an image, a price and its
 * text length. And the JSON-LD ItemList items, with their name and image.
 *
 * `String.raw`: the page receives every backslash as written here. The price
 * pattern is `PRICE_PATTERN`, passed through as its source. A relative href in
 * a page with no base URL (a `setContentEvaluate` test) is counted by its path.
 */
export const LISTING_LINKS_SCRIPT = String.raw`(() => {
  const PRICE = new RegExp(${JSON.stringify(PRICE_PATTERN.source)}, ${JSON.stringify(PRICE_PATTERN.flags)});
  const UP = ${CARD_MAX_LEVELS - 1};
  const MAX_LINKS = ${CARD_MAX_LINKS};
  const pathOf = (href) => { try { const u = new URL(href, location.href); return u.host + u.pathname.replace(/\/+$/, ''); } catch (e) { return href.split(/[?#]/)[0] || null; } };
  const memo = new Map();
  const level = (el) => {
    const hit = memo.get(el);
    if (hit) return hit;
    const seen = new Set();
    for (const x of el.querySelectorAll('a[href]')) {
      const p = pathOf(x.getAttribute('href') || '');
      if (p) { seen.add(p); if (seen.size > MAX_LINKS) break; }
    }
    let r;
    if (seen.size > MAX_LINKS) r = { d: seen.size, img: false, price: false, len: 0 };
    else { const t = el.innerText || ''; r = { d: seen.size, img: !!el.querySelector('img, picture'), price: PRICE.test(t), len: t.length }; }
    memo.set(el, r);
    return r;
  };
  const imgUrl = (img) => img ? (img.getAttribute('src') || img.getAttribute('data-src') || (img.getAttribute('srcset') || '').split(/[ ,]/)[0] || '') : '';
  const near = (a) => {
    let el = a.parentElement;
    for (let i = 0; el && i < 3; i++, el = el.parentElement) {
      if (el.querySelectorAll('a[href]').length > 3) break;
      const img = el.querySelector('img');
      if (img) return img;
    }
    return null;
  };
  const chrome = (a) => {
    if (a.closest('nav, aside, [role~=navigation i], [role~=banner i], [role~=contentinfo i], [role~=complementary i]')) return true;
    const hf = a.closest('header, footer');
    return !!hf && !(hf.parentElement && hf.parentElement.closest('article, section, main, aside, nav'));
  };
  const swatch = (a, text) => {
    if (/^\+\s?\d+$/.test(text)) return true;
    if (a.closest('[role=radio], [role=radiogroup], [aria-checked], [data-swatch]')) return true;
    for (let el = a; el && el !== document.body; el = el.parentElement) {
      if (/swatch/i.test(el.getAttribute('class') || '') && !PRICE.test(el.innerText || '')) return true;
    }
    return false;
  };
  const anchors = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
    const inner = a.querySelector('img');
    const own = a.innerText || '';
    const levels = [{ d: 1, img: !!a.querySelector('img, picture'), price: PRICE.test(own), len: own.length }];
    let el = a.parentElement;
    for (let i = 0; el && el !== document.body && i < UP; i++, el = el.parentElement) levels.push(level(el));
    anchors.push({
      href: a.getAttribute('href') || '',
      text: text.slice(0, 200),
      title: a.getAttribute('title') || a.getAttribute('aria-label') || (inner && inner.getAttribute('alt')) || undefined,
      image: imgUrl(inner || near(a)) || undefined,
      chrome: chrome(a) || undefined,
      swatch: swatch(a, text) || undefined,
      levels,
    });
  }
  const itemList = [];
  const urlOf = (x) => typeof x === 'string' ? x : (x && typeof x === 'object' ? (typeof x.url === 'string' ? x.url : (typeof x['@id'] === 'string' ? x['@id'] : null)) : null);
  const imageOf = (x) => typeof x === 'string' ? x : (Array.isArray(x) ? imageOf(x[0]) : (x && typeof x === 'object' && typeof x.url === 'string' ? x.url : undefined));
  const isList = (t) => t === 'ItemList' || (Array.isArray(t) && t.indexOf('ItemList') >= 0);
  const walk = (x, depth) => {
    if (depth > 6 || !x || typeof x !== 'object') return;
    if (Array.isArray(x)) { for (const y of x) walk(y, depth + 1); return; }
    if (isList(x['@type']) && Array.isArray(x.itemListElement)) {
      for (const e of x.itemListElement) {
        if (!e) continue;
        const item = typeof e === 'object' && e.item !== undefined ? e.item : e;
        const url = (typeof e === 'object' && typeof e.url === 'string' ? e.url : null) || urlOf(item);
        if (!url) continue;
        const name = item && typeof item === 'object' && typeof item.name === 'string' ? item.name : (typeof e === 'object' && typeof e.name === 'string' ? e.name : undefined);
        itemList.push({ url, name, image: item && typeof item === 'object' ? imageOf(item.image) : undefined });
      }
    }
    if (x['@graph']) walk(x['@graph'], depth + 1);
    if (x.mainEntity) walk(x.mainEntity, depth + 1);
  };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { walk(JSON.parse(s.textContent || ''), 0); } catch (e) { /* a broken block is skipped */ }
  }
  return { anchors, itemList };
})()`;

export type ReconciledRows = {
  rows: Array<Record<string, unknown>>;
  /** How many of `rows` came from the page's links alone — they carry only the URL field. */
  added: number;
};

/**
 * Should the listing walk plan from the page's product group instead of (only)
 * the rows its extraction produced? Spec 2026-10-20 §3.9: the walk keeps its
 * own row selector; the group is its cross-check and its rescue when it finds
 * zero rows — on the same terms as before.
 *
 * To rescue a row selector that under-matched (Allbirds, 2026-10-08: one row on
 * a 150-product listing). With at least one extracted URL, the group must be
 * CORROBORATED as product links — an extracted URL, or a known product page
 * (the website's verified proof pages), fits the group's shape — and hold
 * products the extraction missed. With zero rows, only a `directListing` input
 * is rescued, and only when a proof page corroborates the group; a search or
 * template input stays "nothing found". Without corroboration the group is
 * left alone: a walk must never queue menu links.
 *
 * Rows and group meet by product key (§3.4): a row at `/p/a?color=red` covers
 * the group's `/p/a`. Every extracted row is kept with its own address —
 * variants are decided up front, never folded here.
 *
 * Returns `null` when the extraction's rows stand as they are; otherwise the
 * rows to plan from, in the group's order — each product's extracted rows in
 * its place, a product the extraction missed as its URL alone — then any
 * extracted row outside the group.
 */
export function reconcileWithProductGroup(args: {
  rows: Array<Record<string, unknown>>;
  urlField: string;
  group: ProductGroup | null;
  listingUrl: string;
  knownDetailUrls?: string[];
  /** The input is a listing URL the customer gave (input strategy `direct`), not a search or template result. */
  directListing?: boolean;
}): ReconciledRows | null {
  const { rows, urlField, group, listingUrl, knownDetailUrls = [], directListing = false } = args;
  if (!group || group.urls.length === 0) return null;

  const resolve = (v: unknown): string | null => {
    if (typeof v !== 'string' || v.trim() === '') return null;
    // The group's own fragment rule, so a row at `/p/a#sku=…` keeps its variant.
    try { const u = new URL(v, listingUrl); if (!isKeyValueFragment(u.hash)) u.hash = ''; return u.href; } catch { return null; }
  };
  const rowsByKey = new Map<string, Array<Record<string, unknown>>>();
  const seenUrls = new Set<string>();
  const extracted: string[] = [];
  for (const row of rows) {
    const url = resolve(row[urlField]);
    if (!url || seenUrls.has(url)) continue;
    const key = productKey(url);
    if (!key) continue;
    seenUrls.add(url);
    extracted.push(url);
    (rowsByKey.get(key) ?? rowsByKey.set(key, []).get(key)!).push({ ...row, [urlField]: url });
  }
  // Zero rows is rescued only on a listing URL the customer gave directly, and only on the proof
  // pages' word: a stale cached selector that matches nothing must not end the walk, while an
  // empty search/template result page must stay empty.
  if (extracted.length === 0 && !directListing) return null;

  const witnesses = [...extracted, ...knownDetailUrls];
  const fits = (u: string): boolean => (group.shape !== null ? fitsShape(group.shape, u) : group.urls.some((g) => urlShape(g) === urlShape(u)));
  if (!witnesses.some(fits)) return null;

  const groupKeys = group.urls.map((u) => productKey(u));
  const missed = groupKeys.filter((k) => k !== null && !rowsByKey.has(k)).length;
  if (missed === 0) return null;

  const merged: Array<Record<string, unknown>> = [];
  const placed = new Set<string>();
  group.urls.forEach((url, i) => {
    const key = groupKeys[i];
    if (!key || placed.has(key)) return;
    placed.add(key);
    merged.push(...(rowsByKey.get(key) ?? [{ [urlField]: url }]));
  });
  for (const [key, keyed] of rowsByKey) if (!placed.has(key)) merged.push(...keyed);
  return { rows: merged, added: missed };
}

// ---- The old rule: @robot/api's finder still reads it until Task 4 of the 2026-10-20 plan moves
// ---- it over. Task 4 deletes everything below this line.

/** A path's "template": digits and 12+-char alnum/hyphen tokens collapsed to `*`. */
export const productPathTemplate = (p: string): string => p.replace(/\d+/g, '*').replace(/[a-z0-9-]{12,}/gi, '*');

const trimTrailingSlash = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p);
const MIN_CONTENT_GROUP = 3;

export function largestProductGroup(
  anchors: Array<{ href: string; text: string; chrome?: boolean }>,
  listingUrl: string,
): string[] {
  const content = anchors.filter((a) => !a.chrome);
  const best = largestGroup(content, listingUrl);
  return best.length >= MIN_CONTENT_GROUP || content.length === anchors.length ? best : largestGroup(anchors, listingUrl);
}

function largestGroup(anchors: Array<{ href: string }>, listingUrl: string): string[] {
  const base = new URL(listingUrl);
  const basePath = trimTrailingSlash(base.pathname);
  const groups = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const a of anchors) {
    let u: URL;
    try { u = new URL(a.href, listingUrl); } catch { continue; }
    if (u.hostname !== base.hostname || (u.protocol !== 'http:' && u.protocol !== 'https:')) continue;
    if (!isKeyValueFragment(u.hash)) u.hash = '';
    if (trimTrailingSlash(u.pathname) === basePath || u.pathname === '/') continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    const key = productPathTemplate(u.pathname);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(u.href);
  }
  let best: string[] = [];
  for (const g of groups.values()) if (g.length > best.length) best = g;
  return best;
}

export const LISTING_ANCHORS_SCRIPT = `(() => {
  const imgUrl = (img) => img ? (img.getAttribute('src') || img.getAttribute('data-src') || (img.getAttribute('srcset') || '').split(/[ ,]/)[0] || '') : '';
  const near = (a) => {
    let el = a.parentElement;
    for (let i = 0; el && i < 3; i++, el = el.parentElement) {
      if (el.querySelectorAll('a[href]').length > 3) break;
      const img = el.querySelector('img');
      if (img) return img;
    }
    return null;
  };
  const chrome = (a) => {
    if (a.closest('nav, aside, [role~=navigation i], [role~=banner i], [role~=contentinfo i], [role~=complementary i]')) return true;
    const hf = a.closest('header, footer');
    return !!hf && !(hf.parentElement && hf.parentElement.closest('article, section, main, aside, nav'));
  };
  return Array.from(document.querySelectorAll('a[href]')).map((a) => {
    const inner = a.querySelector('img');
    return {
      href: a.getAttribute('href') || '',
      text: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
      title: a.getAttribute('title') || a.getAttribute('aria-label') || (inner && inner.getAttribute('alt')) || undefined,
      image: imgUrl(inner || near(a)) || undefined,
      chrome: chrome(a) || undefined,
    };
  });
})()`;
```

(The old section is the current file's `productPathTemplate`, `largestProductGroup`, `largestGroup` and `LISTING_ANCHORS_SCRIPT`, unchanged except `keepVariantFragment(u)` inlined as `if (!isKeyValueFragment(u.hash)) u.hash = '';`. Copy the old `LISTING_ANCHORS_SCRIPT` from the current file rather than retyping it — its `\\s` must stay doubled.)

- [ ] **Step 4: Export the new names**

In `packages/scraper/src/index.ts`, replace

```ts
export { largestProductGroup, productPathTemplate, reconcileWithProductGroup, LISTING_ANCHORS_SCRIPT, type ListingAnchor } from './crawl/product-link-group.js';
```

with

```ts
export {
  findProductGroup, asListingLinks, productKey, productPathShape, urlShape, fitsShape, onCard, reconcileWithProductGroup,
  PRICE_PATTERN, LISTING_LINKS_SCRIPT,
  type CardLevel, type ListingAnchor, type ListingItem, type ListingLinks, type ProductGroup, type ReconciledRows,
  // The old rule, until @robot/api moves over (plan 2026-10-20, Task 4).
  largestProductGroup, productPathTemplate, LISTING_ANCHORS_SCRIPT,
} from './crawl/product-link-group.js';
```

- [ ] **Step 5: Run the rule test**

Run: `cd packages/scraper && npx vitest run src/crawl/product-link-rule.test.ts`
Expected: PASS (every row of the harvest table, every rule case).

- [ ] **Step 6: Write the failing walk tests**

In `packages/scraper/src/crawl/plan-run-product-group.test.ts`:

1. Replace the import line `import { largestProductGroup, LISTING_ANCHORS_SCRIPT, reconcileWithProductGroup } from './product-link-group.js';` with:

```ts
import { findProductGroup, reconcileWithProductGroup, type ListingLinks, type ProductGroup } from './product-link-group.js';
```

2. Replace `const GROUP = largestProductGroup(FIXTURE.anchors, LISTING);` with:

```ts
/**
 * The fixture predates the card features (2026-10-08: href and text only). This file is about the
 * walk's cross-check, not about telling a card from a menu — `product-link-rule.test.ts` does that
 * on 13 live harvests — so every `/products/` link is given one card level (an image and a price)
 * and every other link none.
 */
const FIXTURE_LINKS: ListingLinks = {
  anchors: FIXTURE.anchors.map((a) => ({
    ...a,
    levels: [/\/products\//.test(a.href) ? { d: 1, img: true, price: true, len: 40 } : { d: 1, img: false, price: false, len: a.text.length }],
  })),
  itemList: [],
};
const PRODUCT_GROUP = findProductGroup(FIXTURE_LINKS, LISTING)!;
const GROUP = PRODUCT_GROUP.urls;
```

3. Replace the `CAPTURE` constant and the `FakeBrowser` class with:

```ts
const capture = (annotation: unknown) => ({
  url: LISTING, html: '<html><body>allbirds listing</body></html>', markdown: '', screenshot: Buffer.alloc(0),
  screenshotTiles: [], verdict: { kind: 'ok', status: 200 }, title: 'Mens', timestamp: 0,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} }, interceptedRequests: [],
  ...(annotation === undefined ? {} : { annotation }),
} as unknown as PageCapture);

/** Serves the listing's capture with its link harvest as the `annotate` value (spec 2026-10-20: read in the live page). */
class FakeBrowser implements IBrowser {
  /** `undefined`: a capture with no harvest at all (no default here — `new FakeBrowser(undefined)` must mean that). */
  constructor(private readonly annotation: unknown) {}
  async launch(): Promise<void> {}
  async capture(): Promise<PageCapture> { return capture(this.annotation); }
  async evaluate<T>(): Promise<T> { throw new Error('not used'); }
  async setContentEvaluate<T>(): Promise<T> { throw new Error('the walk reads the capture\'s own harvest, never the HTML offline'); }
  async close(): Promise<void> {}
  async *crawl(_url: string, _options: CrawlOptions): AsyncGenerator<CrawlPage> {}
  async *scrollPages(_startUrl: string, _options: ScrollOptions): AsyncGenerator<CrawlPage> {}
}
```

4. In the file's header comment (third line), change the name `largestProductGroup` to `findProductGroup` (so Task 4's grep for the old names finds nothing). In `type PlanOpts`, add `annotation?: unknown;`, and in `plan(...)` replace `browser: new FakeBrowser(), agent: null,` with `browser: new FakeBrowser('annotation' in opts ? opts.annotation : FIXTURE_LINKS), agent: null,`.

5. Inside `describe('planRun: the listing walk agrees with the finder …')`, add after the last `it(…)`:

```ts
  it('a capture without a harvest leaves the extraction\'s rows alone (no products, no warning)', async () => {
    for (const annotation of [undefined, null, 'garbage', { anchors: 'x' }]) {
      const outcome = await plan([{ detail_url: FIRST }], { annotation });
      expect(details(outcome)).toEqual([FIRST]);
      expect(outcome.warnings.some((w) => w.includes('planned from the page'))).toBe(false);
    }
  });
```

6. Replace the whole `describe('largestProductGroup — fragments (spec 2026-10-14 §8)', …)` block with:

```ts
describe('the walk and one product per path (spec 2026-10-20 §3.4)', () => {
  const L = 'https://s.example/collections/all';
  const G: ProductGroup = {
    shape: 's.example/products/*',
    urls: ['https://s.example/products/alpha-runner-shoe#sku=a-blue', 'https://s.example/products/bravo-runner-shoe', 'https://s.example/products/charlie-runner-shoe'],
    carded: 3,
  };
  it('a key=value fragment stays on the row url, a plain one is stripped, and the row is not counted missed', () => {
    const rows = [{ url: '/products/alpha-runner-shoe#sku=a-blue', title: 'A' }, { url: '/products/bravo-runner-shoe#reviews', title: 'B' }];
    expect(reconcileWithProductGroup({ rows, urlField: 'url', group: G, listingUrl: L })).toEqual({
      rows: [{ url: 'https://s.example/products/alpha-runner-shoe#sku=a-blue', title: 'A' }, { url: 'https://s.example/products/bravo-runner-shoe', title: 'B' }, { url: 'https://s.example/products/charlie-runner-shoe' }],
      added: 1,
    });
  });
  it('rows for two variants of one product both stay, in the product\'s place; the product is not added again', () => {
    const rows = [{ url: '/products/alpha-runner-shoe', title: 'A' }, { url: '/products/bravo-runner-shoe?color=red', title: 'B red' }, { url: '/products/bravo-runner-shoe?color=blue', title: 'B blue' }];
    expect(reconcileWithProductGroup({ rows, urlField: 'url', group: G, listingUrl: L })).toEqual({
      rows: [
        { url: 'https://s.example/products/alpha-runner-shoe', title: 'A' },
        { url: 'https://s.example/products/bravo-runner-shoe?color=red', title: 'B red' },
        { url: 'https://s.example/products/bravo-runner-shoe?color=blue', title: 'B blue' },
        { url: 'https://s.example/products/charlie-runner-shoe' },
      ],
      added: 1,
    });
  });
  it('a merged group (`*/product/*`) is corroborated by a proof page of any seller; an ItemList group by a url of a member\'s shape', () => {
    const merged: ProductGroup = { shape: 's.example/*/product/*', urls: ['https://s.example/oakhouse/product/oak-chair', 'https://s.example/fernly/product/pine-stool'], carded: 2 };
    expect(reconcileWithProductGroup({ rows: [], urlField: 'url', group: merged, listingUrl: L, directListing: true, knownDetailUrls: ['https://s.example/marlow/product/ash-table'] })?.added).toBe(2);
    const listOnly: ProductGroup = { shape: null, urls: ['https://s.example/item/x-1', 'https://s.example/item/y-2', 'https://s.example/item/z-3'], carded: 3 };
    expect(reconcileWithProductGroup({ rows: [{ url: '/item/x-1' }], urlField: 'url', group: listOnly, listingUrl: L })?.added).toBe(2);
    expect(reconcileWithProductGroup({ rows: [{ url: '/pages/about' }], urlField: 'url', group: listOnly, listingUrl: L })).toBeNull();
  });
  it('no group is no change', () => {
    expect(reconcileWithProductGroup({ rows: [{ url: '/p/a' }], urlField: 'url', group: null, listingUrl: L })).toBeNull();
  });
});
```

- [ ] **Step 7: Run them to see them fail**

Run: `cd packages/scraper && npx vitest run src/crawl/plan-run-product-group.test.ts`
Expected: FAIL — `planRun` still harvests with `setContentEvaluate` (the fake now throws), so "a row selector that matched one product still plans the budget…" finds no group.

- [ ] **Step 8: Switch the walk to the new rule**

In `packages/scraper/src/crawl/plan-run.ts`:

1. Replace `import { largestProductGroup, reconcileWithProductGroup, LISTING_ANCHORS_SCRIPT, type ListingAnchor } from './product-link-group.js';` with:

```ts
import { asListingLinks, findProductGroup, reconcileWithProductGroup, LISTING_LINKS_SCRIPT } from './product-link-group.js';
```

2. In the listing capture, replace

```ts
        capture = await deps.browser.capture(start.url, {
          waitUntil: 'networkidle',
          interceptNetworkRequests: true,
        });
```

with

```ts
        capture = await deps.browser.capture(start.url, {
          waitUntil: 'networkidle',
          interceptNetworkRequests: true,
          // The page's product links, read in the live page (spec 2026-10-20): the cross-check
          // below groups them with the finder's own rule.
          annotate: LISTING_LINKS_SCRIPT,
        });
```

3. Replace the cross-check block — from `      const directListing = source.inputStrategy === 'direct';` through the closing `}` of its `if (…) { try { … } catch (err) { … } }` (the block that today calls `setContentEvaluate<ListingAnchor[]>(capture.html, LISTING_ANCHORS_SCRIPT)`) — with:

```ts
      const directListing = source.inputStrategy === 'direct';
      if (
        capture
        && (extractedUrls.size > 0 || (directListing && (request.knownDetailUrls?.length ?? 0) > 0))
        && extractedUrls.size < cap - (detailCount() - detailsBefore)
      ) {
        try {
          // A missing or malformed harvest reads as no products: the extraction's rows stand.
          const group = findProductGroup(asListingLinks(capture.annotation), start.url);
          const reconciled = reconcileWithProductGroup({
            rows: listingRows, urlField: DETAIL_URL_FIELD, group, listingUrl: start.url, directListing,
            ...(request.knownDetailUrls ? { knownDetailUrls: request.knownDetailUrls } : {}),
          });
          if (reconciled && group) {
            // A row added from the page's links carries only its URL: any
            // listing-origin field (a price read off the card) stays empty
            // for it, and the log says so.
            const listingGap = partitions.listing.length > 0
              ? `; listing fields not available for ${reconciled.added} links added from the page`
              : '';
            warnings.push(
              `${start.url}: the listing extraction found ${extractedUrls.size} product link(s) but the page has `
              + `${group.urls.length} product link(s) of the same kind — planned from the page's product links${listingGap}`,
            );
            listingRows = reconciled.rows;
          }
        } catch (err) {
          // Advisory: the extraction's own rows still stand.
          console.error('[plan] product-link cross-check failed (non-fatal):', err);
        }
      }
```

Keep the comment block above it ("Cross-check page 1's rows against the page's own product links …") and add one sentence at its end: `The links are read in the live page by the capture's \`annotate\` script (spec 2026-10-20).`

4. In `packages/scraper/src/crawl/__fixtures__/README.md`, append to the `allbirds-mens-listing-anchors.json` entry: ` Since 2026-10-20 (the finder reads product links) the walk test gives every \`/products/\` anchor one card level (image + price) before grouping — the fixture has no card features; the card rule itself is tested on the 2026-10-20 harvests.`

- [ ] **Step 9: Run the walk tests, the rule test and the other walk files**

Run, one at a time:
`cd packages/scraper && npx vitest run src/crawl/plan-run-product-group.test.ts`
`cd packages/scraper && npx vitest run src/crawl/product-link-rule.test.ts`
`cd packages/scraper && npx vitest run src/crawl/plan-run.test.ts`
`cd packages/scraper && npx vitest run src/crawl/plan-run-guardrails.test.ts`
`cd packages/scraper && npx vitest run src/crawl/plan-run-page-level.test.ts`
`cd packages/scraper && npx vitest run src/crawl/plan-run-zero-item-warning.test.ts`
`cd packages/scraper && npx vitest run src/crawl/plan-run-scroll.test.ts`
`cd packages/scraper && npx vitest run src/crawl/plan-run-pagination.test.ts`
`cd packages/scraper && npx vitest run src/crawl/plan-run-api-param.test.ts`
`cd packages/scraper && npx vitest run src/crawl/link-discovery-tiers.test.ts`
`cd packages/scraper && npx vitest run src/crawl/product-link-group.test.ts` (the old script's Chromium test, unchanged until Task 4)
`cd packages/scraper && npx tsc --noEmit`
`cd packages/api && npx tsc --noEmit` (the api still compiles against the kept old rule)
Expected: all PASS, no type errors. The Allbirds walk tests keep their numbers (150 links, the first 40 planned, "149 links added").

- [ ] **Step 10: Commit**

```bash
git add packages/scraper/src/crawl/product-link-group.ts packages/scraper/src/crawl/plan-run.ts packages/scraper/src/index.ts packages/scraper/src/crawl/product-link-rule.test.ts packages/scraper/src/crawl/plan-run-product-group.test.ts packages/scraper/src/crawl/__fixtures__/README.md
git commit -m "feat(scraper): a product link is a link on a product card, one product per path; the walk cross-checks with it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One way to read a listing, proven on served pages (`@robot/scraper`) — spec §3.7, §6

**Files:**
- Create: `packages/scraper/src/crawl/read-listing.ts`
- Create: `packages/scraper/src/crawl/__fixtures__/listing-pages.ts`
- Create: `packages/scraper/src/crawl/read-listing.test.ts`
- Modify: `packages/scraper/src/index.ts`

**Interfaces:**
- Consumes: Task 1's `CaptureOptions.loadMore`; Task 2's `LISTING_LINKS_SCRIPT`, `asListingLinks`, `findProductGroup`, `ListingLinks`.
- Produces: `readListingPage(browser: IBrowser, url: string, opts?: { load?: boolean; timeout?: number }): Promise<{ capture: PageCapture; links: ListingLinks }>` (throws `CaptureError` like `capture`; `links` is empty unless the verdict is ok); `LISTING_LOAD_ROUNDS = 3`, `LISTING_LOAD_ENOUGH = 60` — all exported from `@robot/scraper`.

- [ ] **Step 1: Write the served fixtures**

Create `packages/scraper/src/crawl/__fixtures__/listing-pages.ts`:

```ts
// Served listing pages for the finder's rule (spec 2026-10-20 §6), one per mechanism. Made-up
// shops only (spec §5.1). Served by `serveFixturePages` (../../__fixtures__/serve.ts); images 404,
// which leaves an <img> element on the page — all the card rule asks for.
import type { ServedPage } from '../../__fixtures__/serve.js';

/** Long enough that no page reads as "an empty page" (verdict rule: under 100 characters of text). */
const FILLER = '<p>Free delivery on every order over a modest amount, easy returns within thirty days, and a friendly team who answers every question within a day.</p>';
const page = (body: string, head = '') => `<!doctype html><html><head><title>Listing</title>${head}</head><body>${body}${FILLER}</body></html>`;
const img = (name: string) => `<img src="/img/${encodeURIComponent(name)}.png" alt="">`;
/** A product card: the photo and name in one link, the price beside it. */
export const productCard = (href: string, title: string, price: string, extra = '', cls = 'product-card') =>
  `<li class="${cls}"><a href="${href}">${img(title)}<span>${title}</span></a><span class="price">${price}</span>${extra}</li>`;
const grid = (cards: string[]) => `<ul class="grid">${cards.join('')}</ul>`;
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

/** Appends priced cards: on scroll near the bottom (`lazy`), or on a "Load more" click (`button`). */
function growingPage(mode: 'lazy' | 'button', first: number, batches: number, perBatch: number): string {
  const cards = range(first).map((i) => productCard(`/products/oak-chair-${i}`, `Oak chair ${i}`, `$${100 + i}.00`)).join('');
  const trigger = mode === 'lazy'
    ? `addEventListener('scroll', () => { if (scrollY + innerHeight >= document.documentElement.scrollHeight - 50) addBatch(); });`
    : `document.getElementById('more').addEventListener('click', addBatch);`;
  return page(`<ul class="grid" id="grid">${cards}</ul>${mode === 'button' ? '<button id="more">Load more</button>' : ''}<script>
  let next = ${first + 1}, served = 0, last = 0;
  function addBatch() {
    if (served >= ${batches} || Date.now() - last < 300) return;
    served++; last = Date.now();
    const grid = document.getElementById('grid');
    for (let i = 0; i < ${perBatch}; i++, next++) {
      const li = document.createElement('li');
      li.className = 'product-card';
      li.style.height = '200px';
      li.innerHTML = '<a href="/products/oak-chair-' + next + '"><img src="/img/c' + next + '.png" alt=""><span>Oak chair ' + next + '</span></a><span class="price">$' + (100 + next) + '.00</span>';
      grid.appendChild(li);
    }
    if (served >= ${batches} && document.getElementById('more')) document.getElementById('more').remove();
  }
  ${trigger}
</script><style>.product-card { height: 200px; }</style>`);
}

export const LISTING_FIXTURES: ServedPage[] = [
  // A menu of plain-div links (no nav/aside: the old navigation filter let it through) beside a priced grid.
  { path: '/menu', html: page(`<div class="mega-menu">${range(40).map((i) => `<div class="menu-item"><a href="/collections/category-${i}">Category ${i}</a></div>`).join('')}</div>${grid(range(12).map((i) => productCard(`/products/oak-chair-${i}`, `Oak chair ${i}`, `$${100 + i}.00`)))}`) },
  // Category tiles: an image and a name, no price.
  { path: '/tiles', html: page(`<div class="tiles">${range(8).map((i) => `<div class="tile"><a href="/collections/sofas-${i}">${img(`Sofas ${i}`)}<span>Sofas ${i}</span></a></div>`).join('')}</div>`) },
  // One shop's product slugs, every kind: the old template split these into five groups.
  { path: '/slugs', html: page(grid(['range-plus-armchair', 'union-3-seat-sofa', 'field-3-piece-sofa', 'shift-sleeper-sofa', 'span-sleeper-sofa', 'arch-nesting-tables']
    .map((s, i) => productCard(`/products/${s}`, s, `£${200 + i}`)))) },
  // Four polos, each card linking its colours by query.
  { path: '/colours', html: page(grid(['a', 'b', 'c', 'd'].map((p) => productCard(`/polo-shirts/polo-${p}?color=red`, `Polo ${p}`, '49,90 €',
    ['blue', 'green'].map((c) => `<a href="/polo-shirts/polo-${p}?color=${c}">${c}</a>`).join(''))))) },
  // Swatch lists (other colour pages) and "+2" links; every card's wrapper names swatches (Review Focus 1).
  { path: '/swatches', html: page(grid(['sierra', 'sundara', 'cyrus', 'impasto', 'kamran'].map((r) => productCard(`/products/${r}-rug`, `${r} rug`, 'RM810.00',
    `<ul class="swatch-list"><li><a href="/products/${r}-rug-blue">blue</a></li><li><a href="/products/${r}-rug-green">green</a></li></ul><a href="/products/${r}-rug">+2</a>`,
    'product-card has-swatches')))) },
  // Four sellers, three products each: /{seller}/product/{slug}.
  { path: '/sellers', html: page(grid(['oakhouse', 'fernly', 'marlow', 'tindle'].flatMap((s) => ['silver-ring', 'gold-hoop', 'pearl-drop']
    .map((p) => productCard(`/${s}/product/${p}`, `${s} ${p}`, '£25'))))) },
  // Products that are not links (clicked by script); the page data lists them.
  { path: '/itemlist', html: page(`<div class="grid">${range(5).map((i) => `<div class="card" onclick="location.href='/p/widget-${i}'">${img(`w${i}`)}<span>Widget ${i}</span><span>$${i}9.00</span></div>`).join('')}</div><a href="/pages/terms">Terms</a>`,
    ld({ '@context': 'https://schema.org', '@type': 'CollectionPage', mainEntity: { '@type': 'ItemList', itemListElement: range(5).map((i) => ({ '@type': 'ListItem', position: i, url: `/p/widget-${i}`, name: `Widget ${i}` })) } })) },
  // No grid: policy pages, a language link, a blog post.
  { path: '/policies', html: page(`<div class="links"><a href="/pages/terms">Terms</a><a href="/policies/refund-policy">Refunds</a><a href="/en-gb/">English (UK)</a><a href="/blogs/news/our-story">Our story</a></div>`) },
  // A grid that grows when scrolled: 6 cards, then 3 batches of 6.
  { path: '/lazy', html: growingPage('lazy', 6, 3, 6) },
  // A grid that grows on "Load more": 6 cards, then 2 batches of 6.
  { path: '/more', html: growingPage('button', 6, 2, 6) },
  // Link text is collapsed whitespace and keeps every letter (`/\s+/`, not `/s+/`).
  { path: '/text', html: page(grid([productCard('/products/tree-runner-1', "Men's   Tree\n Runner Shoes", '$98')])) },
];
```

- [ ] **Step 2: Write the failing test**

Create `packages/scraper/src/crawl/read-listing.test.ts`:

```ts
// Spec 2026-10-20 §6: one served page per mechanism, read the way the finder and the coverage
// check read a listing (`readListingPage`: the live page, the bounded loading, the link harvest),
// then grouped by the one rule. Real Chromium, no network beyond 127.0.0.1.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { serveFixturePages, type ServedSite } from '../__fixtures__/serve.js';
import { LISTING_FIXTURES } from './__fixtures__/listing-pages.js';
import { readListingPage } from './read-listing.js';
import { findProductGroup } from './product-link-group.js';

let browser: PlaywrightBrowser;
let site: ServedSite;

beforeAll(async () => {
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
  site = await serveFixturePages(LISTING_FIXTURES);
}, 60_000);

afterAll(async () => {
  try { await browser?.close(); } finally { await site?.close(); }
});

async function find(path: string, load = false) {
  const url = `${site.baseUrl}${path}`;
  const { capture, links } = await readListingPage(browser, url, { load });
  return { capture, links, group: findProductGroup(links, url) };
}
const paths = (urls: string[]) => urls.map((u) => { const x = new URL(u); return x.pathname + x.search; });

describe('the finder on served listings (spec 2026-10-20 §6)', () => {
  it('a menu of div links beside a priced grid: the twelve products, no category', async () => {
    const { group } = await find('/menu');
    expect(group?.shape).toBe('127.0.0.1/products/*');
    expect(paths(group!.urls)).toEqual(Array.from({ length: 12 }, (_, i) => `/products/oak-chair-${i + 1}`));
  }, 60_000);

  it('category tiles with images and no prices: no products', async () => {
    const { group, links } = await find('/tiles');
    expect(links.anchors.length).toBe(8);
    expect(group).toBeNull();
  }, 60_000);

  it('slug-fragmented products are one group', async () => {
    const { group } = await find('/slugs');
    expect(group!.urls).toHaveLength(6);
  }, 60_000);

  it('colour copies by query are one product each, the first address kept', async () => {
    const { group } = await find('/colours');
    expect(paths(group!.urls)).toEqual(['a', 'b', 'c', 'd'].map((p) => `/polo-shirts/polo-${p}?color=red`));
  }, 60_000);

  it('swatch links and "+2" are not products; a card whose wrapper names swatches still is', async () => {
    const { group, links } = await find('/swatches');
    expect(paths(group!.urls)).toEqual(['sierra', 'sundara', 'cyrus', 'impasto', 'kamran'].map((r) => `/products/${r}-rug`));
    const main = links.anchors.find((a) => a.href === '/products/sierra-rug' && a.text.includes('rug'))!;
    expect(main.swatch).toBeUndefined();
    expect(links.anchors.filter((a) => a.swatch).length).toBe(15); // 2 colours + "+2", five cards
  }, 60_000);

  it('seller-segment shapes are one group', async () => {
    const { group } = await find('/sellers');
    expect(group?.shape).toBe('127.0.0.1/*/product/*');
    expect(group!.urls).toHaveLength(12);
  }, 60_000);

  it('products that are not links: the page data\'s ItemList is the group, with names', async () => {
    const { group, links } = await find('/itemlist');
    expect(group?.shape).toBeNull();
    expect(paths(group!.urls)).toEqual([1, 2, 3, 4, 5].map((i) => `/p/widget-${i}`));
    expect(links.itemList[0]).toMatchObject({ url: '/p/widget-1', name: 'Widget 1' });
  }, 60_000);

  it('a page with no grid has no products — no policy page, language link or blog post', async () => {
    expect((await find('/policies')).group).toBeNull();
  }, 60_000);

  it('a lazy grid: 6 without loading, all 24 with it', async () => {
    expect((await find('/lazy')).group!.urls).toHaveLength(6);
    const loaded = await find('/lazy', true);
    expect(loaded.group!.urls).toHaveLength(24);
    expect(loaded.capture.html).toContain('/products/oak-chair-24');
  }, 90_000);

  it('a "Load more" button: all 18 with loading', async () => {
    expect((await find('/more', true)).group!.urls).toHaveLength(18);
  }, 90_000);

  it('link text collapses whitespace and keeps every letter', async () => {
    const { links } = await find('/text');
    expect(links.anchors.find((a) => a.href === '/products/tree-runner-1')?.text).toBe("Men's Tree Runner Shoes");
  }, 60_000);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd packages/scraper && npx vitest run src/crawl/read-listing.test.ts`
Expected: FAIL — `./read-listing.js` does not exist.

- [ ] **Step 4: Implement `readListingPage`**

Create `packages/scraper/src/crawl/read-listing.ts`:

```ts
// How the finder ("Find products", `sources.checkListingPage`) and the coverage check read a
// listing page (spec 2026-10-20): one capture, no network interception, one screenshot tile; with
// `load`, the capture first loads more of the page (§3.7: at most 3 rounds, stopping at 60
// products or 2 rounds that added none); then the page's links are read in the live page
// (`LISTING_LINKS_SCRIPT`, as the capture's `annotate`). The walk reads the same harvest from its
// own capture. No AI, nothing saved.
import type { IBrowser, PageCapture } from '@robot/browser';
import { asListingLinks, findProductGroup, LISTING_LINKS_SCRIPT, type ListingLinks } from './product-link-group.js';

/** Spec §3.7: rounds of loading the finder asks for (the browser never runs more than 3). */
export const LISTING_LOAD_ROUNDS = 3;
/** Spec §3.7: stop loading once the page holds this many products. */
export const LISTING_LOAD_ENOUGH = 60;

/**
 * Throws what `capture` throws (a `CaptureError` when no document arrived). `links` is empty
 * unless the verdict is ok: a wall's links are not the shop's.
 */
export async function readListingPage(
  browser: IBrowser,
  url: string,
  opts: { load?: boolean; timeout?: number } = {},
): Promise<{ capture: PageCapture; links: ListingLinks }> {
  const capture = await browser.capture(url, {
    waitUntil: 'networkidle',
    interceptNetworkRequests: false,
    maxTiles: 1,
    annotate: LISTING_LINKS_SCRIPT,
    ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
    ...(opts.load
      ? {
        loadMore: {
          rounds: LISTING_LOAD_ROUNDS,
          enough: LISTING_LOAD_ENOUGH,
          probe: LISTING_LINKS_SCRIPT,
          count: (value: unknown) => findProductGroup(asListingLinks(value), url)?.urls.length ?? 0,
        },
      }
      : {}),
  });
  return { capture, links: capture.verdict.kind === 'ok' ? asListingLinks(capture.annotation) : { anchors: [], itemList: [] } };
}
```

In `packages/scraper/src/index.ts`, after the `product-link-group.js` export block, add:

```ts
export { readListingPage, LISTING_LOAD_ROUNDS, LISTING_LOAD_ENOUGH } from './crawl/read-listing.js';
```

- [ ] **Step 5: Run it**

Run: `cd packages/scraper && npx vitest run src/crawl/read-listing.test.ts` then `cd packages/scraper && npx tsc --noEmit`
Expected: PASS, no type errors. If a fixture's verdict is not `ok` (links come back empty), print `capture.verdict` and lengthen `FILLER` rather than weakening the test.

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/src/crawl/read-listing.ts packages/scraper/src/crawl/__fixtures__/listing-pages.ts packages/scraper/src/crawl/read-listing.test.ts packages/scraper/src/index.ts
git commit -m "feat(scraper): readListingPage — the live page, loaded more (bounded), its links; served fixtures per mechanism

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The finder and the coverage check read products (`@robot/api`); the old rule goes — spec §3.6, §3.7, §4

**Files:**
- Modify (rewrite): `packages/api/src/verify/find-product-pages.ts`
- Modify: `packages/api/src/routers/sources.ts` (import `:26`; `checkListingPage` `:~696-729`)
- Modify: `packages/api/src/verify/run-coverage-check.ts` (imports `:11-15`; `defaultListing` `:38-62`)
- Modify: `packages/api/src/verify/find-product-pages.test.ts`
- Modify: `packages/api/src/routers/sources-extract.test.ts` (`describe('sources.checkListingPage')` `:36-138`)
- Delete: `packages/api/src/__fixtures__/listing-anchors/everlane-mens-tshirts.json`, `packages/api/src/__fixtures__/listing-anchors/README.md`
- Modify: `packages/scraper/src/crawl/product-link-group.ts` (delete the old-rule section), `packages/scraper/src/index.ts`
- Delete: `packages/scraper/src/crawl/product-link-group.test.ts` (its one case moved to Task 3's `/text`)

**Interfaces:**
- Consumes: Task 3's `readListingPage`; Task 2's `findProductGroup`, `productKey`, `ListingLinks`, `ListingAnchor`, `ListingItem`, `LISTING_LINKS_SCRIPT`.
- Produces: `describeListingPage(links: ListingLinks, listingUrl: string, html: string, verdict: CaptureVerdict): ListingPageCheck` (shape of `ListingPageCheck` unchanged); `listingProducts(links: ListingLinks, listingUrl: string, urls: string[])`. `largestProductGroup`, `productPathTemplate`, `LISTING_ANCHORS_SCRIPT` no longer exist.

- [ ] **Step 1: Write the failing tests**

In `packages/api/src/verify/find-product-pages.test.ts`, replace the whole file with:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser, okVerdict } from '@robot/browser';
import { LISTING_LINKS_SCRIPT, type CardLevel, type ListingAnchor, type ListingLinks } from '@robot/scraper';
import { describeListingPage, listingProducts } from './find-product-pages.js';

const CARD: CardLevel[] = [{ d: 1, img: true, price: true, len: 40 }];
const carded = (href: string, text: string, extra: Partial<ListingAnchor> = {}): ListingAnchor => ({ href, text, levels: CARD, ...extra });
const links = (anchors: ListingAnchor[], itemList: ListingLinks['itemList'] = []): ListingLinks => ({ anchors, itemList });

describe('describeListingPage', () => {
  const listingUrl = 'https://shop.example/c/shoes';
  // 12 product cards plus 2 category links (no card): the count is the products only.
  const bigGroup = Array.from({ length: 12 }, (_, i) => carded(`/p/air-${i}-123456789012`, `Air ${i}`));
  const smallGroup = [{ href: '/c/running-123456789012', text: 'Running' }, { href: '/c/casual-123456789012', text: 'Casual' }];
  const all = links([...bigGroup, ...smallGroup]);

  it('reports the full group size, a 10-item sample, and pagerSeen true when a pager is present', () => {
    const html = '<html><head><link rel="next" href="?page=2"></head><body></body></html>';
    const result = describeListingPage(all, listingUrl, html, okVerdict(200));
    expect(result.productLinks).toBe(12);
    expect(result.pagerSeen).toBe(true);
    expect(result.sample).toEqual(bigGroup.slice(0, 10).map((a) => new URL(a.href, listingUrl).href));
  });

  it('reports pagerSeen false when the html has no pagination markup', () => {
    const result = describeListingPage(all, listingUrl, '<html><body><p>no pager here</p></body></html>', okVerdict(200));
    expect(result.productLinks).toBe(12);
    expect(result.pagerSeen).toBe(false);
  });

  it('a page with no products is zero, with no sentence of its own (the app says "No products found on this page.")', () => {
    const r = describeListingPage(links([{ href: '/pages/terms', text: 'Terms' }, { href: '/en-gb/', text: 'English' }]), listingUrl, '<html></html>', okVerdict(200));
    expect(r).toMatchObject({ productLinks: 0, sample: [], products: [], message: null });
  });

  it('describeListingPage carries a non-ok verdict and reports no links', () => {
    const r = describeListingPage(links([carded('/p/1', 'A')]), 'https://shop.example/l', '<html></html>', { kind: 'refused', status: 403, vendor: 'cloudflare' });
    expect(r.productLinks).toBe(0);
    expect(r.verdict.kind).toBe('refused');
    expect(r.message).toBe("shop.example refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet.");
  });
});

const L = 'https://shop.example/c/chairs';

describe('listingProducts', () => {
  it('merges the several links to one product, by product: the longest text wins, the first image wins', () => {
    const anchors: ListingAnchor[] = [
      { href: '/p/1?color=red', text: '', image: '/img/1.jpg' },
      { href: '/p/1', text: 'Chair' },
      { href: 'https://shop.example/p/1', text: 'Oak chair, natural' },
      { href: '/p/1?color=blue', text: 'blue — a much longer swatch label', swatch: true },
    ];
    expect(listingProducts(links(anchors), L, ['https://shop.example/p/1?color=red'])).toEqual([{ url: 'https://shop.example/p/1?color=red', title: 'Oak chair, natural', image: 'https://shop.example/img/1.jpg' }]);
  });
  it('falls back to the title attribute, then the ItemList name and image, then the path', () => {
    expect(listingProducts(links([{ href: '/p/2', text: '', title: 'Pine stool' }]), L, ['https://shop.example/p/2'])).toEqual([{ url: 'https://shop.example/p/2', title: 'Pine stool' }]);
    expect(listingProducts(links([], [{ url: '/p/4', name: 'Ash table', image: '/img/4.jpg' }]), L, ['https://shop.example/p/4'])).toEqual([{ url: 'https://shop.example/p/4', title: 'Ash table', image: 'https://shop.example/img/4.jpg' }]);
    expect(listingProducts(links([{ href: '/p/3', text: '  ' }]), L, ['https://shop.example/p/3'])).toEqual([{ url: 'https://shop.example/p/3', title: '/p/3' }]);
  });
  it('drops an image that is not http(s) and keeps the order of the urls asked for', () => {
    const anchors: ListingAnchor[] = [{ href: '/p/b', text: 'B', image: 'data:image/png;base64,xx' }, { href: '/p/a', text: 'A' }];
    expect(listingProducts(links(anchors), L, ['https://shop.example/p/a', 'https://shop.example/p/b']).map((p) => [p.title, p.image])).toEqual([['A', undefined], ['B', undefined]]);
  });
});

describe('LISTING_LINKS_SCRIPT in Chromium (offline page)', () => {
  let browser: PlaywrightBrowser;
  beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it('reads an image inside the link, a lazy one, and one beside the link in the same card', async () => {
    const html = `<html><body>
      <a href="/p/1"><img src="/i/1.jpg"><span>Oak chair</span></a>
      <a href="/p/2" aria-label="Pine stool"><img data-src="/i/2.jpg"></a>
      <div class="card"><img src="/i/3.jpg"><a href="/p/3">Birch table</a></div>
    </body></html>`;
    const { anchors } = await browser.setContentEvaluate<ListingLinks>(html, LISTING_LINKS_SCRIPT);
    const byHref = Object.fromEntries(anchors.map((a) => [a.href, a]));
    expect(byHref['/p/1']).toMatchObject({ text: 'Oak chair', image: '/i/1.jpg' });
    expect(byHref['/p/2']).toMatchObject({ title: 'Pine stool', image: '/i/2.jpg' });
    expect(byHref['/p/3']).toMatchObject({ text: 'Birch table', image: '/i/3.jpg' });
  });

  it('flags nav, role=navigation, aside and page-level header/footer links, but not a header inside a product card', async () => {
    const html = `<html><body>
      <header><a href="/c/top">Top</a></header>
      <nav><a href="/c/nav">Nav</a></nav>
      <div role="navigation"><a href="/c/role">Role</a></div>
      <ul role="Navigation menubar"><li><a href="/c/menubar">Menubar</a></li></ul>
      <aside><a href="/c/side">Side</a></aside>
      <main><article><header><a href="/p/card">Card</a></header></article><a href="/p/grid">Grid</a></main>
      <footer><a href="/c/foot">Foot</a></footer>
    </body></html>`;
    const { anchors } = await browser.setContentEvaluate<ListingLinks>(html, LISTING_LINKS_SCRIPT);
    const chrome = Object.fromEntries(anchors.map((a) => [a.href, a.chrome === true]));
    expect(chrome).toEqual({ '/c/top': true, '/c/nav': true, '/c/role': true, '/c/menubar': true, '/c/side': true, '/p/card': false, '/p/grid': false, '/c/foot': true });
  });

  it('a priced card with an image is a card level; a tile without a price is not', async () => {
    const html = `<html><body><ul>
      <li><a href="/p/1"><img src="/i/1.jpg"><span>Oak chair</span></a><span>$129.99</span></li>
      <li><a href="/c/sofas"><img src="/i/2.jpg"><span>Sofas</span></a></li>
    </ul></body></html>`;
    const { anchors } = await browser.setContentEvaluate<ListingLinks>(html, LISTING_LINKS_SCRIPT);
    const level1 = (href: string) => anchors.find((a) => a.href === href)!.levels![1];
    expect(level1('/p/1')).toMatchObject({ d: 1, img: true, price: true });
    expect(level1('/c/sofas')).toMatchObject({ d: 1, img: true, price: false });
  });
});
```

In `packages/api/src/routers/sources-extract.test.ts`, inside `describe('sources.checkListingPage', …)`:

1. Replace the first test (`'captures the listing page (no AI) and reports product link count, sample, and pagerSeen'`) with:

```ts
  it('captures the listing page (no AI, loading more, the links read in the page) and reports product count, sample, and pagerSeen', async () => {
    const html = '<html><head><link rel="next" href="?page=2"></head><body></body></html>';
    const anchors = Array.from({ length: 12 }, (_, i) => ({ href: `/p/air-${i}-123456789012`, text: `Air ${i}`, levels: [{ d: 1, img: true, price: true, len: 30 }] }));
    const captureMock = vi.fn().mockResolvedValue({ html, verdict: { kind: 'ok', status: 200 }, annotation: { anchors, itemList: [] } });
    withBrowserSessionMock.mockImplementation(async (fn: (browser: unknown) => Promise<unknown>) => fn({ capture: captureMock }));

    const result = await caller.sources.checkListingPage({ listingUrl: 'https://test-check-listing.example.com/c/shoes' });

    expect(result.productLinks).toBe(12);
    expect(result.pagerSeen).toBe(true);
    expect(result.sample).toHaveLength(10);
    expect(result.verdict).toEqual({ kind: 'ok', status: 200 });
    expect(result.message).toBeNull();
    expect(withBrowserSessionMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith('https://test-check-listing.example.com/c/shoes', expect.objectContaining({
      interceptNetworkRequests: false, timeout: 20_000, annotate: expect.any(String),
      loadMore: expect.objectContaining({ rounds: 3, enough: 60 }),
    }));
  });

  it('a page with no product cards counts no products', async () => {
    const anchors = [{ href: '/pages/terms', text: 'Terms' }, { href: '/collections/sofas', text: 'Sofas', levels: [{ d: 1, img: true, price: false, len: 5 }] }];
    withBrowserSessionMock.mockImplementation(async (fn: (browser: unknown) => Promise<unknown>) =>
      fn({ capture: vi.fn().mockResolvedValue({ html: '<html></html>', verdict: { kind: 'ok', status: 200 }, annotation: { anchors, itemList: [] } }) }),
    );
    const result = await caller.sources.checkListingPage({ listingUrl: 'https://test-check-listing-none.example.com/c/x' });
    expect(result).toMatchObject({ productLinks: 0, sample: [], products: [], message: null });
  });
```

2. In `'reports pagerSeen false when the captured page has no pagination markup'`, give both anchors `levels: [{ d: 1, img: true, price: true, len: 30 }]` and replace the mock with `fn({ capture: vi.fn().mockResolvedValue({ html, verdict: { kind: 'ok', status: 200 }, annotation: { anchors, itemList: [] } }) })`.

3. In `'a challenge page counts no links, skips the anchor harvest, and says why'`, rename it `'a challenge page counts no links and says why'`, delete `const setContentEvaluateMock = vi.fn();` and `expect(setContentEvaluateMock).not.toHaveBeenCalled();`, and make the mock `fn({ capture: vi.fn().mockResolvedValue({ html: '<html>captcha</html>', verdict: { kind: 'challenge', status: 403, vendor: 'datadome' }, annotation: { anchors: [{ href: '/p/1-2', text: 'x', levels: [{ d: 1, img: true, price: true, len: 3 }] }], itemList: [] } }) })` (a wall's links never count).

4. In `'no document at all (a CaptureError) …'`, drop `, setContentEvaluate: vi.fn()` from the mock.

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/api && npx vitest run src/verify/find-product-pages.test.ts` and `cd packages/api && npx vitest run src/routers/sources-extract.test.ts`
Expected: FAIL — `describeListingPage` still takes anchors; `checkListingPage` still calls `setContentEvaluate` (not a function on the mock).

- [ ] **Step 3: Rewrite `find-product-pages.ts`**

Replace the whole of `packages/api/src/verify/find-product-pages.ts` with:

```ts
// What "Find products" (`sources.checkListingPage`) reports about a listing page. The page is read
// by `readListingPage` (@robot/scraper: the live page, loaded more, its links) and grouped by the
// one rule the coverage check and the listing walk use too (`findProductGroup`, spec 2026-10-20):
// a product link is a link on a product card, one product per path, and a page with none has no
// products. No AI involved.

import { detectPaginationFromHtml, verdictSentence, type CaptureErrorKind, type CaptureVerdict } from '@robot/browser';
import { findProductGroup, productKey, type ListingLinks } from '@robot/scraper';

const absolute = (u: string, base: string): string | undefined => {
  try { const x = new URL(u, base); return /^https?:$/.test(x.protocol) ? x.href : undefined; } catch { return undefined; }
};

/**
 * Names each product of `describeListingPage`'s sample from the listing alone: every link to the
 * same product (spec §3.4: by product key, so `?color=` copies count) that is not a swatch, and
 * the page data's ItemList entry. Title: the longest link text, else a link's `title`, else the
 * ItemList name, else the path. Image: the first link's resolved http(s) image, else the ItemList's.
 */
export function listingProducts(links: ListingLinks, listingUrl: string, urls: string[]) {
  return urls.map((url) => {
    const key = productKey(url);
    const same = (href: string) => key !== null && productKey(absolute(href, listingUrl) ?? '') === key;
    const mine = links.anchors.filter((a) => !a.swatch && same(a.href));
    const item = links.itemList.find((i) => same(i.url));
    const text = mine.map((a) => a.text.trim()).sort((x, y) => y.length - x.length)[0]
      || mine.find((a) => a.title?.trim())?.title?.trim()
      || item?.name?.trim()
      || '';
    const image = [...mine.map((a) => (a.image ? absolute(a.image, listingUrl) : undefined)), item?.image ? absolute(item.image, listingUrl) : undefined].find(Boolean);
    return { url, title: (text || new URL(url).pathname).slice(0, 120), ...(image ? { image } : {}) };
  });
}

/**
 * The listing check: how many products the page's product group has (before any `limit` cut), a
 * 10-item sample, whether a pager was seen (`detectPaginationFromHtml`, no AI), and the sample's
 * products (title + image), so the Verification tab's product cards fill without visiting any
 * product. A page with no products reports zero (the app says "No products found on this page.").
 *
 * `verdict` is the browser's word on the listing page itself (spec 2026-10-09 §A1): anything but
 * ok means the links are not the shop's (a block page, a CAPTCHA, a 404), so nothing is counted
 * and `message` carries the verdict's customer sentence instead. `message` is null when ok.
 */
export type ListingPageCheck = {
  verdict: CaptureVerdict | { kind: CaptureErrorKind };
  message: string | null;
  productLinks: number;
  pagerSeen: boolean;
  sample: string[];
  products: ReturnType<typeof listingProducts>;
};

/** The check for a listing page the browser never got a document for (a `CaptureError`), or one whose verdict is not ok. */
export function unreadListingPage(verdict: CaptureVerdict | { kind: CaptureErrorKind }, listingUrl: string): ListingPageCheck {
  return { verdict, message: verdictSentence(verdict, listingUrl), productLinks: 0, pagerSeen: false, sample: [], products: [] };
}

export function describeListingPage(links: ListingLinks, listingUrl: string, html: string, verdict: CaptureVerdict): ListingPageCheck {
  if (verdict.kind !== 'ok') return unreadListingPage(verdict, listingUrl);
  const urls = findProductGroup(links, listingUrl)?.urls ?? [];
  const sample = urls.slice(0, 10);
  return {
    verdict,
    message: null,
    productLinks: urls.length,
    pagerSeen: detectPaginationFromHtml(html, listingUrl) !== null,
    sample,
    products: listingProducts(links, listingUrl, sample),
  };
}
```

- [ ] **Step 4: `checkListingPage` reads through `readListingPage`**

In `packages/api/src/routers/sources.ts`:

1. Replace `import { describeListingPage, unreadListingPage, LISTING_ANCHORS_SCRIPT, type ListingAnchor, type ListingPageCheck } from '../verify/find-product-pages.js';` with `import { describeListingPage, unreadListingPage, type ListingPageCheck } from '../verify/find-product-pages.js';`
2. Add `readListingPage,` to the `@robot/scraper` import list (the one that ends with `reportVerdict, backoffAnswer, CaptureProblemError,`).
3. In `checkListingPage`, replace

```ts
        const { anchors, html, verdict } = await withBrowserSession(async (browser) => {
          // 20 s, not the browser's default 60 s: Brooklinen never goes idle
          // and the finder sat at a blank "Find products" for 90 s waiting
          // out two 60 s networkidle timeouts (campaign 2, 2026-10-11). The
          // `load` fallback inside navigateWithFallback still applies.
          const capture = await browser.capture(input.listingUrl, { waitUntil: 'networkidle', interceptNetworkRequests: false, timeout: 20_000 });
          reportVerdict(hostname, capture.verdict);
          if (capture.verdict.kind !== 'ok') return { anchors: [] as ListingAnchor[], html: capture.html, verdict: capture.verdict };
          const anchors = await browser.setContentEvaluate<ListingAnchor[]>(capture.html, LISTING_ANCHORS_SCRIPT);
          return { anchors, html: capture.html, verdict: capture.verdict };
        });
        return describeListingPage(anchors, input.listingUrl, html, verdict);
```

with

```ts
        const { links, html, verdict } = await withBrowserSession(async (browser) => {
          // 20 s, not the browser's default 60 s: Brooklinen never goes idle
          // and the finder sat at a blank "Find products" for 90 s waiting
          // out two 60 s networkidle timeouts (campaign 2, 2026-10-11). The
          // `load` fallback inside navigateWithFallback still applies. Then at
          // most three rounds of loading more (spec 2026-10-20 §3.7).
          const { capture, links } = await readListingPage(browser, input.listingUrl, { load: true, timeout: 20_000 });
          reportVerdict(hostname, capture.verdict);
          return { links, html: capture.html, verdict: capture.verdict };
        });
        return describeListingPage(links, input.listingUrl, html, verdict);
```

4. In the doc comment above `checkListingPage`, replace "Captures the page with `withBrowserSession` exactly as `findProductPages` does, but also keeps the html around to feed `describeListingPage` (find-product-pages.ts): the largest same-path-template group's full size (not just the capped ranking), a sample of it, and whether a pager was detected on the page." with "Reads the page with `readListingPage` (@robot/scraper: loaded more, at most three rounds; its links read in the live page) and hands them to `describeListingPage` (find-product-pages.ts): the product group's full size, a sample of it, and whether a pager was detected on the page."

- [ ] **Step 5: The coverage check reads the listing the same way**

In `packages/api/src/verify/run-coverage-check.ts`:

1. In the `@robot/scraper` import, replace `largestProductGroup, LISTING_ANCHORS_SCRIPT,` with `findProductGroup, readListingPage,`, and remove `type ListingAnchor,`.
2. Replace the body of `defaultListing`'s `captureSlots(() => withBrowserSession(async (browser) => { … }))` callback with:

```ts
      const { capture, links } = await readListingPage(browser, url, { load: true });
      reportVerdict(hostname, capture.verdict);
      if (capture.verdict.kind !== 'ok') return { productUrls: [], verdictMessage: verdictSentence(capture.verdict, url) };
      return { productUrls: findProductGroup(links, url)?.urls ?? [], verdictMessage: null };
```

and its doc comment's first sentence with: "The listing's products, read the way "Find products" reads them (`readListingPage` + `findProductGroup`, spec 2026-10-20); a non-ok verdict, or no document at all, is the sentence instead."

- [ ] **Step 6: Delete the old rule**

1. In `packages/scraper/src/crawl/product-link-group.ts`, delete everything from the line `// ---- The old rule: @robot/api's finder still reads it until Task 4 of the 2026-10-20 plan moves` to the end of the file.
2. In `packages/scraper/src/index.ts`, delete the two lines `// The old rule, until @robot/api moves over (plan 2026-10-20, Task 4).` and `largestProductGroup, productPathTemplate, LISTING_ANCHORS_SCRIPT,`.
3. Delete `packages/scraper/src/crawl/product-link-group.test.ts` (Task 3's `/text` fixture carries its one case), and the Everlane fixture: `packages/api/src/__fixtures__/listing-anchors/everlane-mens-tshirts.json` and its `README.md` (anchors without card features; the 2026-10-20 harvests replace them).

```bash
git rm packages/scraper/src/crawl/product-link-group.test.ts packages/api/src/__fixtures__/listing-anchors/everlane-mens-tshirts.json packages/api/src/__fixtures__/listing-anchors/README.md
```

4. Confirm nothing else reads the old names:

Run: `cd /c/Users/Marko/Documents/projects/robot-platform-finder && git grep -n "largestProductGroup\|productPathTemplate\|LISTING_ANCHORS_SCRIPT\|listing-anchors" -- packages`
Expected: no output (a comment naming them is fixed to name `findProductGroup` / `LISTING_LINKS_SCRIPT`; `packages/api/src/crawl/plan-source.ts:~143` names `reconcileWithProductGroup`, which stays).

- [ ] **Step 7: Run the tests and type-check**

Run, one at a time:
`cd packages/api && npx vitest run src/verify/find-product-pages.test.ts`
`cd packages/api && npx vitest run src/routers/sources-extract.test.ts`
`cd packages/api && npx vitest run src/verify/run-coverage-check.test.ts`
`cd packages/api && npx vitest run src/routers/sources-schema.test.ts`
`cd packages/api && npx tsc --noEmit`
`cd packages/scraper && npx tsc --noEmit`
`cd packages/scraper && npx vitest run src/crawl/plan-run-product-group.test.ts`
Expected: all PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/verify/find-product-pages.ts packages/api/src/verify/find-product-pages.test.ts packages/api/src/routers/sources.ts packages/api/src/routers/sources-extract.test.ts packages/api/src/verify/run-coverage-check.ts packages/scraper/src/crawl/product-link-group.ts packages/scraper/src/index.ts
git commit -m "feat(api): Find products and the coverage check read products — loaded more, by the one rule; the old rule goes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(The `git rm` in Step 6 already staged the three deletions; they go into this commit.)

---

### Task 5: The coverage check samples products only, says when there are none, and stops re-offering an answered shape (`@robot/api`) — spec §3.6, §3.8, §5.5

**Files:**
- Modify: `packages/api/src/verify/coverage-sampler.ts`
- Modify: `packages/api/src/verify/coverage-summary.ts`
- Modify: `packages/api/src/verify/run-coverage-check.ts` (`runCoverageCheck` after `const { productUrls, verdictMessage } = await listing(listingUrl);`; `latestCoverageCheck`)
- Modify: `packages/api/src/verify/coverage-sampler.test.ts`, `packages/api/src/verify/coverage-summary.test.ts`, `packages/api/src/verify/run-coverage-check.test.ts`

**Interfaces:**
- Consumes: Task 2's `productKey`, `urlShape`.
- Produces: `CoverageResults.noProducts?: true`; `FieldCoverage.answered?: true` (present only when every empty sampled page's shape has a proof page marked "Not on this product" for that field; `representative` is then null); `summariseCoverage(results, fieldKeys, absentShapes?: Record<string, string[]>)`; `NO_PRODUCTS_ON_LISTING` (exported from `coverage-summary.ts`). `latestCoverageCheck` passes the absent shapes in; the tRPC answer gains `fields[].answered`.

- [ ] **Step 1: Write the failing tests**

In `packages/api/src/verify/coverage-sampler.test.ts`, add inside the `describe`:

```ts
  it('never samples a proof page under any query, fragment or www (spec 2026-10-20 §5.5)', () => {
    const listed = ['https://www.s.example/p/1?variant=rouge', 'https://s.example/p/2?type=category#reviews', 'https://s.example/p/3'];
    expect(sampleListing(listed, ['https://s.example/p/1', 'https://www.s.example/p/2/'])).toEqual(['https://s.example/p/3']);
  });
  it('two addresses of one product are one sample, the first kept', () => {
    expect(sampleListing(['https://s.example/p/1?color=red', 'https://s.example/p/1?color=blue', 'https://s.example/p/2'], [])).toEqual(['https://s.example/p/1?color=red', 'https://s.example/p/2']);
  });
```

In `packages/api/src/verify/coverage-summary.test.ts`:

1. Change the import to `import { summariseCoverage, stageLine, COVERAGE_STALLED, NO_PRODUCTS_ON_LISTING, type CoverageResults } from './coverage-summary.js';`
2. Add inside `describe('summariseCoverage (spec 2026-10-10 §A5)', …)`:

```ts
  it('a shape a proof page answered "Not on this product" is not offered again (spec 2026-10-20 §3.8)', () => {
    const r = summariseCoverage(results([page(10, ['price'], multi), page(11, ['price'], multi)]), ['price'], { price: ['s.example/p/*'] });
    expect(r[0]).toMatchObject({ key: 'price', empty: ['https://s.example/p/10', 'https://s.example/p/11'], representative: null, answered: true });
  });
  it('an empty page of another shape is still offered; an answer on another field changes nothing', () => {
    const sampled = [page(10, ['price'], multi), { url: 'https://s.example/item/x-1', empty: ['price'], shape: multi }];
    const r = summariseCoverage(results(sampled), ['price'], { price: ['s.example/p/*'], rating: ['s.example/item/*'] });
    expect(r[0]!.representative).toBe('https://s.example/item/x-1');
    expect(r[0]!.answered).toBeUndefined();
    expect(summariseCoverage(results([page(10, ['price'])]), ['price'], { rating: ['s.example/p/*'] })[0]).not.toHaveProperty('answered');
  });
```

3. Add inside `describe('stageLine (spec §5)', …)`:

```ts
  it('a listing with no products says so (spec 2026-10-20 §3.6)', () => {
    expect(NO_PRODUCTS_ON_LISTING).toBe('No products found on the listing page, so no more products were checked.');
    expect(stageLine('done', { listingUrl: 'x', sampled: [], proofShapes: {}, planned: 0, noProducts: true }, 0, null)).toBe(NO_PRODUCTS_ON_LISTING);
  });
```

In `packages/api/src/verify/run-coverage-check.test.ts`:

1. Add `NO_PRODUCTS_ON_LISTING` to the `./coverage-summary.js` import.
2. Add, inside the main `describe` after `'a website with no listing url ends done with nothing sampled, without loading anything'`:

```ts
  it('a listing with no products ends done, samples nothing and says so (spec 2026-10-20 §3.6)', async () => {
    const f = await certifiedWebsite('cov-noproducts');
    try {
      const extract = vi.fn();
      const { checkId } = await startCoverageCheck(f.sourceId, null, { fire: false });
      await runCoverageCheck(checkId, { listing: vi.fn(async () => ({ productUrls: [], verdictMessage: null })), extract, proofShapes });
      const row = await checkRow(checkId);
      expect(row.status).toBe('done');
      expect(row.results).toEqual({ listingUrl: f.listingUrl, sampled: [], proofShapes: {}, planned: 0, noProducts: true });
      expect(extract).not.toHaveBeenCalled();
      expect((await latestCoverageCheck(f.sourceId))!).toMatchObject({ status: 'done', fields: [], stage: NO_PRODUCTS_ON_LISTING });
    } finally { await f.cleanup(); }
  });

  it('a proof page marked "Not on this product" for Price stops the offer for that shape (spec 2026-10-20 §3.8)', async () => {
    const f = await certifiedWebsite('cov-answered');
    try {
      const host = new URL(f.proofUrls[0]!).host;
      const listed = Array.from({ length: 4 }, (_, i) => `https://${host}/p/${10 + i}`);
      const { checkId } = await startCoverageCheck(f.sourceId, null, { fire: false });
      await runCoverageCheck(checkId, { listing: vi.fn(async () => ({ productUrls: listed, verdictMessage: null })), extract: extractWith(f.keyOf, () => true), proofShapes });
      const before = (await latestCoverageCheck(f.sourceId))!.fields.find((x) => x.key === f.keyOf.price)!;
      expect(before.representative).toBe(listed[0]);
      expect(before.answered).toBeUndefined();

      const src = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId), columns: { verificationSet: true } }))!;
      const set = src.verificationSet as VerificationSet;
      await db.update(sources).set({ verificationSet: { ...set, absent: { [f.keyOf.price]: { [f.proofUrls[0]!]: true } } } }).where(eq(sources.id, f.sourceId));

      const after = (await latestCoverageCheck(f.sourceId))!.fields.find((x) => x.key === f.keyOf.price)!;
      expect(after).toMatchObject({ representative: null, answered: true, empty: listed });
      const title = (await latestCoverageCheck(f.sourceId))!.fields.find((x) => x.key === f.keyOf.title);
      expect(title).toBeUndefined(); // Title was never empty
    } finally { await f.cleanup(); }
  });
```

- [ ] **Step 2: Run them to see them fail**

Run, one at a time:
`cd packages/api && npx vitest run src/verify/coverage-sampler.test.ts`
`cd packages/api && npx vitest run src/verify/coverage-summary.test.ts`
`cd packages/api && npx vitest run src/verify/run-coverage-check.test.ts`
Expected: FAIL — the sampler keys by address minus `#…` (the `?variant=` page is sampled); `NO_PRODUCTS_ON_LISTING` and the third argument of `summariseCoverage` do not exist; an empty listing is not `noProducts`.

- [ ] **Step 3: Sample by product key**

In `packages/api/src/verify/coverage-sampler.ts`:

1. Add at the top, after the comment block: `import { productKey } from '@robot/scraper';`
2. Replace `const key = (u: string) => u.replace(/#.*$/, '').replace(/\/+$/, '');` with:

```ts
/** Spec 2026-10-20 §3.4, §5.5: one product is one path — a query, a fragment, `www.` or a trailing slash never makes another, so a proof page is never sampled under any of them. */
const key = (u: string) => productKey(u) ?? u.replace(/#.*$/, '').replace(/\/+$/, '');
```

- [ ] **Step 4: Answered shapes and the no-products line**

In `packages/api/src/verify/coverage-summary.ts`:

1. Change `import type { Shape } from '@robot/scraper';` to `import { urlShape, type Shape } from '@robot/scraper';`
2. Replace the `CoverageResults` and `FieldCoverage` types with:

```ts
/** `noProducts`: the listing had no products at all (spec 2026-10-20 §3.6), so nothing was sampled. */
export type CoverageResults = { listingUrl: string; sampled: SampledPage[]; proofShapes: Record<string, Shape>; planned?: number; noProducts?: true };
/** `answered`: every empty page's address shape has a proof page marked "Not on this product" for this field (spec 2026-10-20 §3.8) — nothing to offer, `representative` is null. */
export type FieldCoverage = { key: string; empty: string[]; sampled: number; unread: number; explanation: string | null; representative: string | null; answered?: true };
```

3. Replace `summariseCoverage` with:

```ts
/**
 * Per field, the sampled pages it was empty on. `absentShapes`: field key → the address shapes
 * (`urlShape`) of the proof pages marked "Not on this product" for it. An empty page of such a
 * shape is already answered (spec 2026-10-20 §3.8): it is never the page offered as the next
 * proof page; when every empty page is, the field is `answered` and nothing is offered.
 */
export function summariseCoverage(results: CoverageResults, fieldKeys: string[], absentShapes: Record<string, string[]> = {}): FieldCoverage[] {
  const read = results.sampled.filter(isRead);
  const unread = results.sampled.length - read.length;
  const proof = Object.values(results.proofShapes);
  const out: FieldCoverage[] = [];
  for (const key of fieldKeys) {
    const empties = read.filter((p) => p.empty.includes(key));
    if (empties.length === 0) continue;
    const answered = new Set(absentShapes[key] ?? []);
    const open = empties.filter((p) => { const s = urlShape(p.url); return s === null || !answered.has(s); });
    out.push({
      key, empty: empties.map((p) => p.url), sampled: read.length, unread, explanation: explain(empties, proof), representative: representative(open),
      ...(open.length === 0 ? { answered: true as const } : {}),
    });
  }
  return out;
}
```

4. After `COVERAGE_STALLED`, add:

```ts
/** A listing with no products (spec 2026-10-20 §3.6): the check samples nothing and says so. */
export const NO_PRODUCTS_ON_LISTING = 'No products found on the listing page, so no more products were checked.';
```

5. In `stageLine`, right after `const n = results?.sampled.length ?? 0;` in the done branch (before `if (n === 0) return null;`), add:

```ts
  if (results?.noProducts) return NO_PRODUCTS_ON_LISTING;
```

- [ ] **Step 5: The job and the query**

In `packages/api/src/verify/run-coverage-check.ts`:

1. Add `urlShape,` to the `@robot/scraper` import.
2. Right after `if (verdictMessage) throw new Error(verdictMessage);` in `runCoverageCheck`, add:

```ts
    // Spec 2026-10-20 §3.6: a listing with no products is an answer — nothing is sampled, and the tab says so.
    if (productUrls.length === 0) { await done({ listingUrl, sampled: [], proofShapes: {}, planned: 0, noProducts: true }); return; }
```

3. In `latestCoverageCheck`, replace

```ts
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true } });
  const keys = ((Array.isArray(source?.schemaDefinition) ? source!.schemaDefinition : []) as SchemaDefinitionField[]).map((f) => f.key);
```

with

```ts
  const source = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  const keys = ((Array.isArray(source?.schemaDefinition) ? source!.schemaDefinition : []) as SchemaDefinitionField[]).map((f) => f.key);
  // Spec 2026-10-20 §3.8: per field, the address shapes of the proof pages answered "Not on this product" — read now, so an answer given after the check counts.
  const absent = ((source?.verificationSet ?? null) as VerificationSet | null)?.absent ?? {};
  const absentShapes = Object.fromEntries(Object.entries(absent).map(([key, cells]) => [key, Object.keys(cells).map(urlShape).filter((s): s is string => s !== null)]));
```

and `summariseCoverage(results, keys)` with `summariseCoverage(results, keys, absentShapes)`.

- [ ] **Step 6: Run the tests**

Run, one at a time:
`cd packages/api && npx vitest run src/verify/coverage-sampler.test.ts`
`cd packages/api && npx vitest run src/verify/coverage-summary.test.ts`
`cd packages/api && npx vitest run src/verify/run-coverage-check.test.ts`
`cd packages/api && npx tsc --noEmit`
Expected: all PASS (the existing `toEqual` on `fields[0]` still holds: `answered` is absent unless true), no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/verify/coverage-sampler.ts packages/api/src/verify/coverage-summary.ts packages/api/src/verify/run-coverage-check.ts packages/api/src/verify/coverage-sampler.test.ts packages/api/src/verify/coverage-summary.test.ts packages/api/src/verify/run-coverage-check.test.ts
git commit -m "feat(api): the coverage check samples products by key, says when a listing has none, and stops re-offering an answered shape

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: What a customer sees, and the route smoke (`@robot/app`) — spec §3.6, §3.8, §4

**Files:**
- Modify: `packages/app/src/lib/site/extract-view.ts` (`listingCheckLabel` `:~53-64`)
- Modify: `packages/app/src/components/verification/listing-bar.tsx` (imports; `:~108-110`)
- Modify: `packages/app/src/lib/site/proof-coverage-view.ts`
- Modify: `packages/app/src/lib/site/extract-view.test.ts`, `packages/app/src/lib/site/proof-coverage-view.test.ts`
- Modify: `packages/app/src/routes-smoke.test.ts` (the `/l` listing `:~180-218`; the coverage test after the `'app-site-verification-coverage-absent'` screenshot `:~1727`; the wall test `:~2076`, `:~2087`)

**Interfaces:**
- Consumes: Task 5's `fields[].answered` on `sources.coverage` (the query `latestCoverageCheck` answers; the site route's `coverageQuery` feeds `ProofCoverageView`, whose shape the app re-declares).
- Produces: `NO_PRODUCTS_FOUND = 'No products found on this page.'` (extract-view.ts); `ANSWERED = 'like a proof page marked "Not on this product"'` (proof-coverage-view.ts); `ProofCoverageView['fields'][number].answered?: boolean`.

- [ ] **Step 1: Write the failing unit tests**

In `packages/app/src/lib/site/extract-view.test.ts`, inside `describe('listingCheckLabel', …)` (the block holding `'reports product links and pager, singular and plural'`), add:

```ts
  it('a page with no products says so (spec 2026-10-20 §3.6)', () => {
    expect(NO_PRODUCTS_FOUND).toBe('No products found on this page.');
    expect(listingCheckLabel({ productLinks: 0, pagerSeen: true })).toEqual({ tone: 'warn', text: NO_PRODUCTS_FOUND });
    expect(listingCheckLabel({ productLinks: 0, pagerSeen: false })).toEqual({ tone: 'warn', text: NO_PRODUCTS_FOUND });
  });
```

and add `NO_PRODUCTS_FOUND` to that file's import from `./extract-view`.

In `packages/app/src/lib/site/proof-coverage-view.test.ts`, change the import to `import { ANSWERED, coverageLine, coverageStage, EVERY_PRODUCT_DEFAULT } from './proof-coverage-view';` and add inside `describe('coverageLine (spec 2026-10-10 §5)', …)`:

```ts
  it('a shape a proof page answered "Not on this product" offers nothing and says why (spec 2026-10-20 §3.8)', () => {
    expect(ANSWERED).toBe('like a proof page marked "Not on this product"');
    expect(coverageLine({ ...f, representative: null, answered: true }, false)).toEqual({
      text: 'Empty on 2 of 20 sampled products · all 2 list their sizes as variants in the page data · like a proof page marked "Not on this product"',
      useAsProofPage: null,
    });
    // It wins over "already a proof page" and the six-page limit: it is the reason nothing is offered.
    expect(coverageLine({ ...f, explanation: null, representative: null, answered: true }, true, true).text).toBe('Empty on 2 of 20 sampled products · like a proof page marked "Not on this product"');
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/app && npx vitest run src/lib/site/extract-view.test.ts` and `cd packages/app && npx vitest run src/lib/site/proof-coverage-view.test.ts`
Expected: FAIL — `NO_PRODUCTS_FOUND` / `ANSWERED` are not exported; zero reads "0 product links · …".

- [ ] **Step 3: The copy**

In `packages/app/src/lib/site/extract-view.ts`, above `listingCheckLabel`'s doc comment add:

```ts
/** Spec 2026-10-20 §3.6: what the finder says about a page with no products. */
export const NO_PRODUCTS_FOUND = 'No products found on this page.';
```

and in `listingCheckLabel`, right after `if ('error' in check) return { tone: 'error', text: check.error };`, add:

```ts
  if (check.productLinks === 0) return { tone: 'warn', text: NO_PRODUCTS_FOUND };
```

In `packages/app/src/components/verification/listing-bar.tsx`, add `import { NO_PRODUCTS_FOUND } from '../../lib/site/extract-view';` after the `verification-model` import, and replace

```tsx
          <p className="text-sm text-muted-foreground">No product links found on this page. Paste product pages below.</p>
```

with

```tsx
          <p className="text-sm text-muted-foreground">{NO_PRODUCTS_FOUND} Paste product pages below.</p>
```

In `packages/app/src/lib/site/proof-coverage-view.ts`:

1. In `ProofCoverageView`, change the `fields` element type to `{ key: string; empty: string[]; sampled: number; explanation: string | null; representative: string | null; answered?: boolean }`.
2. After `export const ON_BOARD = 'already a proof page';` add:

```ts
/** Spec 2026-10-20 §3.8: the empty products look like a proof page already answered "Not on this product" for this field — nothing to add. */
export const ANSWERED = 'like a proof page marked "Not on this product"';
```

3. In `coverageLine`, replace

```ts
  if (onBoard) parts.push(ON_BOARD);
  else if (atLimit) parts.push(AT_LIMIT);
  return { text: parts.join(' · '), useAsProofPage: atLimit || onBoard ? null : f.representative };
```

with

```ts
  if (f.answered) parts.push(ANSWERED);
  else if (onBoard) parts.push(ON_BOARD);
  else if (atLimit) parts.push(AT_LIMIT);
  return { text: parts.join(' · '), useAsProofPage: f.answered || atLimit || onBoard ? null : f.representative };
```

and add to its doc comment: "`f.answered` (spec 2026-10-20 §3.8): every empty product has the address shape of a proof page answered "Not on this product" for this field; the line says so and offers nothing."

- [ ] **Step 4: Run the unit tests and type-check**

Run: `cd packages/app && npx vitest run src/lib/site/extract-view.test.ts`, `cd packages/app && npx vitest run src/lib/site/proof-coverage-view.test.ts`, `cd packages/app && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: The route smoke's shop has priced cards, and it reads the answered line**

In `packages/app/src/routes-smoke.test.ts`:

1. The listing doc comment above `SHOP_FOOTER` / `shopPage`: replace "The listing: three product cards (a photo and the product's name in a link) and one link that is not a product, which the listing heuristic must leave out." with "The listing: three product cards (a photo and the product's name in a link, the price beside it — spec 2026-10-20: a product link is a link on a priced card) and one link that is not a product, which the finder must leave out."

2. In `shopPage`, the `/l` branch, replace

```ts
    const cards =
      PRODUCTS.map((p, i) => `<li><a href="${p.path}"><img src="/i/${i + 1}.png" alt=""><span>${p.title}</span></a></li>`).join('') +
      `<li><a href="${SECOND_SHAPE.path}"><img src="/i/9.png" alt=""><span>${SECOND_SHAPE.title}</span></a></li>`;
```

with

```ts
    const cards =
      PRODUCTS.map((p, i) => `<li><a href="${p.path}"><img src="/i/${i + 1}.png" alt=""><span>${p.title}</span></a><span class="price">${p.price}</span></li>`).join('') +
      `<li><a href="${SECOND_SHAPE.path}"><img src="/i/9.png" alt=""><span>${SECOND_SHAPE.title}</span></a><span class="price">${SECOND_SHAPE.price}</span></li>`;
```

3. In the coverage test, right after `await shootViewportBothThemes(page, 'app-site-verification-coverage-absent');`, insert:

```ts
    // Spec 2026-10-20 §3.8: Price is now answered "Not on this product" on a proof page whose
    // address has the sampled product's shape (/p/9 is that proof page), so the line stops
    // offering it and says why.
    await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'input[aria-label="Listing page"]');
    await expect
      .poll(async () => ((await priceLine.count()) ? await priceLine.locator('span').first().innerText() : ''), { timeout: 20_000 })
      .toBe('Empty on 1 of 1 sampled product · it lists its sizes as variants in the page data · like a proof page marked "Not on this product"');
    expect(await page.getByRole('button', { name: 'Use a sampled product as proof page for Price', exact: true }).count(), 'an answered shape is offered again').toBe(0);
```

4. In the wall test, replace both `.not.toContain('No product links found')` with `.not.toContain('No products found')`.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/lib/site/extract-view.ts packages/app/src/lib/site/extract-view.test.ts packages/app/src/components/verification/listing-bar.tsx packages/app/src/lib/site/proof-coverage-view.ts packages/app/src/lib/site/proof-coverage-view.test.ts packages/app/src/routes-smoke.test.ts
git commit -m "feat(app): \"No products found on this page.\"; an answered shape is not offered again; the smoke's shop has priced cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The route smoke itself runs in Task 8 (it needs the isolated pair and every task in).

---

### Task 7: The free live check, before and after (spec §6, CLAUDE.md gate 5)

**Files:**
- Create: `docs/testing/results/2026-10-20-finder-links/live-check.mts`
- Create (by running it): `docs/testing/results/2026-10-20-finder-links/live-check.md`, `docs/testing/results/2026-10-20-finder-links/live/<site>.png` (only the zero cases are committed)

**Interfaces:**
- Consumes: Task 3's `readListingPage`; Task 2's `findProductGroup`; the main checkout's old rule (`largestProductGroup`, `LISTING_ANCHORS_SCRIPT` in `C:/Users/Marko/Documents/projects/robot-platform/packages/scraper/src/crawl/product-link-group.ts` — `main` is still at the pre-branch commit; run this task before Task 8 fast-forwards it).
- Produces: the results file Task 8's docs cite.

- [ ] **Step 1: Write the script**

Create `docs/testing/results/2026-10-20-finder-links/live-check.mts`:

```ts
// The free live check for spec 2026-10-20 §6: the finder's real code over the 13 listing pages of
// the harvests, before (the rule on `main` before this branch: one capture, the HTML read offline,
// `largestProductGroup`) and after (this branch: `readListingPage` with the bounded loading, then
// `findProductGroup`). One Chromium, one page at a time. No model, no database, no server.
// Writes live-check.md and the after capture's first screenshot tile per site (live/<site>.png).
//
// Run from packages/scraper, so `@robot/*` resolve:
//   npx tsx ../../docs/testing/results/2026-10-20-finder-links/live-check.mts [site …]
// BEFORE_ROOT: a checkout whose packages/scraper still has the old rule (default: the main checkout).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PlaywrightBrowser } from '../../../../packages/browser/src/index.ts';
import { readListingPage } from '../../../../packages/scraper/src/crawl/read-listing.ts';
import { findProductGroup } from '../../../../packages/scraper/src/crawl/product-link-group.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'live');
const BEFORE_ROOT = process.env.BEFORE_ROOT ?? 'C:/Users/Marko/Documents/projects/robot-platform';

/** The 13 harvest URLs (probe2.mts) and what the spec's §2 table counted on each page. */
const SITES: Array<{ site: string; url: string; onPage: string }> = [
  { site: 'bombas', url: 'https://bombas.com/collections/mens-socks', onPage: '27 /products/*' },
  { site: 'burrow', url: 'https://burrow.com/collections/sofas', onPage: '25' },
  { site: 'thomann-cat', url: 'https://www.thomann.de/de/gitarren_baesse.html', onPage: 'a category hub (99 acceptable, §7)' },
  { site: 'thomann', url: 'https://www.thomann.de/de/4-4_konzertgitarren.html', onPage: '51 (/de/*.htm)' },
  { site: 'lacoste', url: 'https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/', onPage: '13' },
  { site: 'ikea', url: 'https://www.ikea.com/my/en/cat/sofas-fu003/', onPage: '52 priced cards' },
  { site: 'ikea-blog', url: 'https://www.ikea.com/global/en/stories/ideas-inspiration/style-report-modern-nordic-warmth-260617/', onPage: '0' },
  { site: 'noths', url: 'https://www.notonthehighstreet.com/sale/jewellery-sale', onPage: '60 /{seller}/product/*' },
  { site: 'ruggable', url: 'https://ruggable.com/collections/shop-all', onPage: '47' },
  { site: 'skullcandy', url: 'https://www.skullcandy.com/collections/shop-all', onPage: '41' },
  { site: 'puma', url: 'https://us.puma.com/us/en/men/shoes', onPage: '14' },
  { site: 'gymshark', url: 'https://www.gymshark.com/collections/all-products/womens', onPage: 'colours are separate pages (§7)' },
  { site: 'ridge', url: 'https://ridge.com/collections/wallets', onPage: '0' },
];

type Before = { n: number; paths: number; examples: string[] } | { verdict: string } | { error: string } | { skipped: string };
type After = { n: number; carded: number; shape: string | null; examples: string[]; verdict: string; finalUrl: string; anchors: number; itemList: number; ms: number } | { error: string };
const msg = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0]!.slice(0, 200);
const pathOf = (u: string) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };

const pick = process.argv.slice(2);
const sites = SITES.filter((s) => pick.length === 0 || pick.includes(s.site));
mkdirSync(OUT, { recursive: true });

let old: { largestProductGroup: (a: unknown[], u: string) => string[]; LISTING_ANCHORS_SCRIPT: string } | null = null;
try {
  const mod = await import(pathToFileURL(join(BEFORE_ROOT, 'packages/scraper/src/crawl/product-link-group.ts')).href);
  if (typeof mod.largestProductGroup === 'function' && typeof mod.LISTING_ANCHORS_SCRIPT === 'string') old = mod;
} catch (e) { console.warn(`[live-check] no old rule at ${BEFORE_ROOT}: ${msg(e)}`); }

const browser = new PlaywrightBrowser();
await browser.launch({ headless: true });
const rows: Array<{ site: string; url: string; onPage: string; before: Before; after: After }> = [];
try {
  for (const { site, url, onPage } of sites) {
    let before: Before = { skipped: 'old rule not found' };
    if (old) {
      try {
        const cap = await browser.capture(url, { waitUntil: 'networkidle', interceptNetworkRequests: false, timeout: 20_000, maxTiles: 1 });
        if (cap.verdict.kind === 'ok') {
          const anchors = await browser.setContentEvaluate<unknown[]>(cap.html, old.LISTING_ANCHORS_SCRIPT);
          const group = old.largestProductGroup(anchors, url);
          before = { n: group.length, paths: new Set(group.map((u) => new URL(u).pathname)).size, examples: group.slice(0, 3).map(pathOf) };
        } else before = { verdict: cap.verdict.kind };
      } catch (e) { before = { error: msg(e) }; }
    }
    let after: After;
    try {
      const t0 = Date.now();
      const { capture, links } = await readListingPage(browser, url, { load: true, timeout: 20_000 });
      const group = findProductGroup(links, url);
      writeFileSync(join(OUT, `${site}.png`), capture.screenshot);
      after = {
        n: group?.urls.length ?? 0, carded: group?.carded ?? 0, shape: group?.shape ?? null, examples: (group?.urls ?? []).slice(0, 3).map(pathOf),
        verdict: capture.verdict.kind, finalUrl: capture.url, anchors: links.anchors.length, itemList: links.itemList.length, ms: Date.now() - t0,
      };
    } catch (e) { after = { error: msg(e) }; }
    rows.push({ site, url, onPage, before, after });
    console.log(JSON.stringify({ site, before, after }));
  }
} finally {
  await browser.close();
}

const cell = (b: Before) => ('n' in b ? `${b.n} links / ${b.paths} paths` : 'verdict' in b ? `verdict ${b.verdict}` : 'error' in b ? `error: ${b.error}` : b.skipped);
const cellAfter = (a: After) => ('error' in a ? `error: ${a.error}` : a.verdict !== 'ok' ? `verdict ${a.verdict}` : a.n === 0 ? '**no products**' : `${a.n} (${a.carded} on cards)`);
const lines = [
  '# The finder reads product links — free live check',
  '',
  `Run ${new Date().toISOString()} by \`live-check.mts\` (this folder): one Chromium, one page at a time, no model. Before: the rule on \`main\` before this branch (${old ? BEFORE_ROOT : 'not found'}). After: \`readListingPage\` (bounded loading) + \`findProductGroup\`. Screenshots: \`live/<site>.png\` (the zero cases are committed).`,
  '',
  '| Site | Products on the page (spec §2) | Finder before | Finder after | Shape after | First products after | ms |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.site} | ${r.onPage} | ${cell(r.before)} | ${cellAfter(r.after)} | ${'shape' in r.after ? `\`${r.after.shape ?? 'ItemList'}\`` : ''} | ${'examples' in r.after ? r.after.examples.map((e) => `\`${e}\``).join('<br>') : ''} | ${'ms' in r.after ? r.after.ms : ''} |`),
  '',
  '## Before, first links',
  '',
  ...rows.map((r) => `- ${r.site}: ${'examples' in r.before ? r.before.examples.map((e) => `\`${e}\``).join(', ') : cell(r.before)}`),
  '',
  '## Zero cases (screenshots looked at)',
  '',
  ...rows.filter((r) => !('error' in r.after) && r.after.n === 0).map((r) => `- ${r.site} — \`live/${r.site}.png\`; final URL ${'finalUrl' in r.after ? r.after.finalUrl : ''}; ${'anchors' in r.after ? `${r.after.anchors} links, ${r.after.itemList} ItemList items` : ''}. LOOKED: (fill in what the screenshot shows)`),
  '',
  '## Raw',
  '',
  '```json',
  JSON.stringify(rows, null, 2),
  '```',
  '',
];
writeFileSync(join(HERE, 'live-check.md'), lines.join('\n'));
console.log(`wrote ${join(HERE, 'live-check.md')}`);
```

- [ ] **Step 2: Run it**

The main checkout must still be at the pre-branch `main` (it is, until Task 8): `git -C /c/Users/Marko/Documents/projects/robot-platform log -1 --oneline` shows `f78d817` or another commit without `findProductGroup`.

Run: `cd packages/scraper && npx tsx ../../docs/testing/results/2026-10-20-finder-links/live-check.mts`
Expected: 13 JSON lines, then `wrote …/live-check.md`. About 13 × (≤20 s + ≤25 s) — under 10 minutes; use a 600 000 ms timeout or run it in the background and wait for it.

- [ ] **Step 3: Read the result against the spec, and look at the zero cases**

Open `live-check.md`. Expected (spec §1, §4, queue "Done when"): every "after" with products shows product paths only — no `/collections/`, `/cat/`, `/pages/`, `/policies/`, language or blog links, no colour copies (`?color=` twice for one path); ridge and the ikea blog post read **no products**; bombas, burrow, thomann, lacoste, ikea, noths, ruggable, skullcandy and puma are close to the spec's "products on the page" (live pages change; a count within a few of the spec's, or higher after loading, is fine). Geo (MYR prices, a lacoste/puma country redirect) is out of scope (§7): if a page redirects to another country's site and reads zero, say so in the file, it is not a failure of this rule.

For every zero case, Read `docs/testing/results/2026-10-20-finder-links/live/<site>.png` and replace that line's `LOOKED: (fill in …)` with one sentence of what the page shows (e.g. "a wallet collection whose cards are buttons, no product links; the page data has no ItemList" or "an article with two product mentions, no grid"). If a page that has a visible product grid reads zero, or an after list holds a non-product link, stop: that is a real failure — go back to the owning task (the rule: Task 2; the loading: Task 1; the harvest script: Task 2's `LISTING_LINKS_SCRIPT`), fix it with a test that pins it, and re-run this task.

- [ ] **Step 4: Commit**

```bash
git add docs/testing/results/2026-10-20-finder-links/live-check.mts docs/testing/results/2026-10-20-finder-links/live-check.md
git add docs/testing/results/2026-10-20-finder-links/live/ridge.png docs/testing/results/2026-10-20-finder-links/live/ikea-blog.png
git commit -m "test(finder): free live check over the 13 campaign listings, before and after — counts, examples, the zero cases looked at

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add one `live/<site>.png` per zero case the run actually had, by name; never `git add` the whole `live/` folder.)

---

### Task 8: The merge gate, docs, the merge and the queue (`CLAUDE.md` "Autonomous runs")

**Files:**
- Modify: `docs/superpowers/specs/2026-10-20-finder-links-design.md` (Status), `docs/handoff.md` (new section before `## Verify never fails silently (2026-10-20)`), `CLAUDE.md` (Key Technical Decisions), `docs/testing/2026-10-11-campaign-2.md` (group 4 `:~203`, suggested order item 5 `:~267`), `docs/queue.md` (after the merge)
- Add: the smoke's changed screenshots only if a new one was written (none are new in this plan; `git checkout -- docs/testing/screens` after the smoke)

**Interfaces:**
- Consumes: every earlier task.
- Produces: a branch that passes the gate, docs that say what shipped, `main` fast-forwarded and pushed, the queue item in **Done**.

- [ ] **Step 1: Every task's tests and reviews are clean; trailers are right**

Confirm each task's review (and fix rounds) ended clean. Then:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-finder && git log main..HEAD --format=%B | grep Co-Authored-By | sort | uniq -c
```

Expected: only `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Rewrite strays with `git rebase main --exec "bash <script>"` where the script amends only commits whose trailer names another model (memory `subagent-commit-trailers`).

- [ ] **Step 2: Full test run and type-check of every touched package**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-finder/packages/browser && npx vitest run && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-finder/packages/scraper && npx vitest run && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-finder/packages/api && npx vitest run && npx tsc --noEmit
cd /c/Users/Marko/Documents/projects/robot-platform-finder/packages/app && npx vitest run && npx tsc --noEmit
```

Expected: all PASS, no type errors (Postgres up, `.env` present). A Chromium file that times out only in the full run: re-run that file alone; `transfer-marks.test.ts`'s JSON-LD image-array case is a known flake. A real failure blocks the merge: fix it on the branch with a test.

- [ ] **Step 3: Whole-branch review**

The controller dispatches one reviewer on the most capable model over `git diff main...HEAD`, with the spec and this plan (the "Where this plan reads the spec" notes included). No open Critical or Important finding may remain; fix on the branch and re-run Step 2 for the touched packages.

- [ ] **Step 4: The route smoke, from the branch, on an isolated pair**

`@robot/app` and `@robot/api` changed, so (CLAUDE.md gate 4):

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-finder/packages/api-server && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= PORT=4100 APP_ORIGINS=http://localhost:3100 npx tsx src/index.ts
```

(in the background), and

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-finder/packages/app && VITE_API_URL=http://localhost:4100 npx vite dev --port 3100
```

(in the background). Wait until `curl -s http://localhost:4100/healthz` answers `{"status":"ok"}` and `curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/login` answers 200. Then:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-finder/packages/app && RUN_UI_SMOKE=1 APP_URL=http://localhost:3100 API_URL=http://localhost:4100 npx vitest run src/routes-smoke.test.ts
```

Expected: PASS, including "4 products found", the coverage test's new answered line, and the wall test. Look at `docs/testing/screens/app-site-verification-coverage-*.png`. Stop both servers by port, never :3000/:4000:

```powershell
Get-NetTCPConnection -LocalPort 4100,3100 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false }
```

Then restore what the run wrote: `git checkout -- docs/testing/screens packages/app/src/routeTree.gen.ts` (no screenshot is new in this plan). A second smoke run against the same api-server must start at least two minutes after the first ended (the wall step's backoff).

- [ ] **Step 5: The free live check (gate 5)**

Capture changed, so gate 5 applies: Task 7's `live-check.md` is the check, and its zero cases were looked at. If any code changed after Task 7 (review fixes in Tasks 1–3), re-run Task 7 Steps 2–3 and commit the new results before going on.

- [ ] **Step 6: Docs**

Note the last code commit: `git log -1 --format=%h -- packages` → `<sha>`.

1. Spec — replace the Status paragraph's first sentence with: ``**Status:** implemented on `feat/finder-links` and merged to `main` on 2026-10-20 (`<sha>`); written under the standing approval (`CLAUDE.md`, "Autonomous runs"; queue item "The product finder and the coverage check read the right links"), with its plan (`docs/superpowers/plans/2026-10-20-finder-links.md`).`` Keep the rest of the paragraph.

2. `docs/handoff.md` — insert before `## Verify never fails silently (2026-10-20)`:

```markdown
## The finder reads product links (2026-10-20)

Spec `docs/superpowers/specs/2026-10-20-finder-links-design.md`, plan
`docs/superpowers/plans/2026-10-20-finder-links.md`. Branch `feat/finder-links`. Campaign 2, group 4.

**What a customer gets.** "Find products" offers products — no menus, category tiles, policy pages,
language links or colour copies — after scrolling the listing and clicking "Load more" for at most
three rounds. A page with no product grid says "No products found on this page." The coverage check
samples products only (never a proof page, under any query), says "No products found on the listing
page, so no more products were checked." when there are none, and stops offering "Use as proof page"
for a field whose empty products look like a proof page already answered "Not on this product".

**What changed.**
1. One rule, `findProductGroup` (`packages/scraper/src/crawl/product-link-group.ts`), for the finder,
   the coverage check and the walk's cross-check: a product link is a link on a card (within 6
   ancestors: ≤ 3 link paths, < 800 characters, an image and a price — `PRICE_PATTERN`); shapes per
   path segment; one product per path (`productKey`), swatches and "+2" left out; 3+ seller-style
   shapes merge; a JSON-LD ItemList (3+ same-site items) is a group too; no group is no products.
2. The links are read in the live page by `LISTING_LINKS_SCRIPT` as the capture's `annotate`;
   `readListingPage` (scraper) is how the finder and the coverage check read a listing.
3. `CaptureOptions.loadMore` (`@robot/browser`): up-then-down step scroll + one non-navigating
   "load more" click per round, at most `LOAD_MORE_MAX_ROUNDS` = 3, stopping at 60 products or 2
   quiet rounds; a round that left the document goes back.
4. The walk keeps its row selector; it reads the same harvest from its capture and reconciles by
   product key (extracted variant rows stay as they are).
5. Coverage: `sampleListing` keys by product; `noProducts` on the check's results; `answered` on a
   field when every empty page's address shape has a proof page marked absent for it.

**Proof.** Unit tests on the 13 live harvests (`product-link-rule.test.ts`), served Chromium pages per
mechanism (`read-listing.test.ts`, `capture-load-more.test.ts`), the route smoke on an isolated pair,
and the free live check before/after (`docs/testing/results/2026-10-20-finder-links/live-check.md`).

**Read the spec this way (planner's choices).** The §3.3 merge is `rule.mjs`'s (3+ shapes each with
carded products), not "each with 3"; the group offers carded products first, then the same shape's
links whose card had not loaded; a swatch-class element counts only when it shows no price; a later
variant of a path folds into its first address (2026-10-14 §8 had kept both).

**Open.**
- A listing that shows no prices (price on request, members-only, B2B) now finds no products.
- Geo (MYR prices, country redirects), colours as separate product pages, sitemap-first discovery,
  products that are not links without an ItemList (spec §7).
- `findLoadMore` knows English wordings only ("Mehr anzeigen" is not clicked).
- §3.8 is coarse: on most shops every product shares one shape, so one "Not on this product" for a
  field stops the offer for that field altogether.
```

3. `CLAUDE.md` — after the "Verify never fails silently (2026-10-20)" bullet in Key Technical Decisions:

```markdown
- The finder reads product links (2026-10-20): one rule (`findProductGroup`, scraper `crawl/product-link-group.ts`) for "Find products", the coverage check and the walk's cross-check — a product link is a link on a priced, imaged card (within 6 ancestors, ≤ 3 link paths, < 800 characters), shapes per path segment, one product per path (swatches, "+2" and `?color=` copies fold), seller-style shapes merge, a JSON-LD ItemList counts, and a page with none has no products; the links are read in the live page after at most 3 rounds of loading more (`CaptureOptions.loadMore`); the coverage check samples by product key and stops offering a shape a proof page answered "Not on this product".
```

4. `docs/testing/2026-10-11-campaign-2.md`:
   - group 4's heading line `4. **The finder and the coverage check read the wrong links; the walk usually reads the right ones.**` → append ` Fixed 2026-10-20 (\`<sha>\`, spec 2026-10-20-finder-links), except geo and colours as separate pages (its §7).`
   - suggested order item `5. **Finder and coverage** (group 4):` → `5. **Finder and coverage** (group 4) — done 2026-10-20, spec 2026-10-20-finder-links:`

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-finder
git add docs/superpowers/specs/2026-10-20-finder-links-design.md docs/handoff.md CLAUDE.md docs/testing/2026-10-11-campaign-2.md
git commit -m "docs: the finder reads product links — shipped; handoff, decisions, campaign 2 group 4

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Rebase on `main`, fast-forward `main`, push**

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-finder
git checkout -- packages/app/src/routeTree.gen.ts
git status --short
git fetch origin
git rebase main
```

If `main` moved, re-run Step 2 for the touched packages (and Step 4 if an app/api file on `main` changed). The main checkout must be clean and on `main`:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform status --short
git -C /c/Users/Marko/Documents/projects/robot-platform rev-parse --abbrev-ref HEAD
```

If it is not clean, or not on `main`, stop: write the item under **Needs Marko** in `docs/queue.md` ("branch ready, main checkout not clean") and do not merge. Otherwise:

```bash
git -C /c/Users/Marko/Documents/projects/robot-platform merge --ff-only feat/finder-links
git -C /c/Users/Marko/Documents/projects/robot-platform push origin main
```

Expected: a fast-forward and a push. A refused fast-forward (main moved again) means: rebase again, re-run Steps 2 and 4, try again.

- [ ] **Step 8: The queue item to Done, on `main`**

In the worktree (its branch is now `main`'s head), edit `docs/queue.md`: delete item 1 ("The product finder and the coverage check read the right links …") from **Next** and renumber the rest; add at the top of **Done**: ``- 2026-10-20 — The finder and the coverage check read the right links (`<sha>`).`` (the last code commit from Step 6). Then:

```bash
cd /c/Users/Marko/Documents/projects/robot-platform-finder
git add docs/queue.md
git commit -m "docs(queue): the finder and the coverage check read the right links — done

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -C /c/Users/Marko/Documents/projects/robot-platform merge --ff-only feat/finder-links
git -C /c/Users/Marko/Documents/projects/robot-platform push origin main
```

Expected: `main` at the queue commit, pushed. The next queue item starts from there.
