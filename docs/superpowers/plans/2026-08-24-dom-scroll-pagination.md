# DOM-Scroll Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enumerate a listing that loads by scrolling or by a "load more" button, regardless of how the next batch arrives.

**Architecture:** A new async generator on `IBrowser`, beside `crawl()`, owns the page and yields batches: trigger, wait for the row count to grow, extract only unlabelled rows, stamp them, yield. `planRun` gains a third `walkPages` branch and calls it at the exact line where it currently gives up. Correctness comes from the existing `absorb` dedupe; labelling is only a speed optimisation.

**Tech Stack:** TypeScript (ESM), Playwright, Vitest, Drizzle ORM + PostgreSQL, pnpm workspaces + Turborepo.

**Spec:** [`docs/superpowers/specs/2026-08-24-dom-scroll-pagination-design.md`](../specs/2026-08-24-dom-scroll-pagination-design.md)

## Global Constraints

- All packages are ESM. Every relative import MUST carry a `.js` extension.
- TDD: write the failing test first, run it, watch it fail for the right reason, then implement.
- **Correctness comes from `absorb`'s URL dedupe. Labelling is a speed optimisation and must never be load-bearing** — a virtualized list recycles nodes and takes their labels with it.
- **`max_items` is the only budget consulted. `max_pages` is deliberately ignored.**
- Exact values: `QUIET_ROUNDS = 2`, `GROWTH_TIMEOUT_MS = 3000`, `MAX_SCROLL_ROUNDS = 50`, `SCROLL_PACING_MS = 500`.
- Load-more heuristic text, exact list: `load more`, `show more`, `see more`, `view more`, `more results` (case-insensitive).
- A pagination failure must never lose the work page 1 already planned.
- `pnpm -r test` needs Postgres: `docker start robot-platform-db` first.
- Verify types with `pnpm typecheck --force` — a plain run is FULL TURBO cached and proves nothing. `vitest` does NOT typecheck (esbuild erases types), so a red step that depends on a type error will not show under the test runner; use `tsc` for those.
- Leave no test rows behind: `select count(*) from domain_intelligence where domain in ('example.com','listing.example') or domain like 'test-%'` must be 0 after a full suite run.
- Any scratch or probe file goes in the scratchpad directory, **never in `packages/`**.

## A declared deviation from the spec

Spec §3 says the load-more button is found "heuristic first, AI second", mirroring `detectPaginationFromHtml` → `SchemaAgent.detectPagination`. **This plan implements the heuristic only.**

Why: the AI fallback costs a call per cold domain and produces an answer that this branch's own caching machinery would then freeze — and unlike `api-param`'s paging parameter, a load-more selector has no cheap verification. We cannot probe a button to see whether it was the right one without clicking it, and clicking the wrong one changes the result set. Shipping an unverifiable AI answer into the cache tier is the pattern that cost the previous two cycles most.

The heuristic's misses are also visible rather than silent: no button found means the walk scrolls instead, which is the correct behaviour for most scroll-loading listings anyway. Revisit when a real site is observed where scrolling alone does not advance the listing and the wording heuristic missed its button — that observation is the evidence the fallback should be built from.

## A testing rule this plan inherits, and every task must honour

The `api-param` cycle produced **nine** tests that ran fine and proved nothing. Every one was the same shape: a fixture that satisfied two constraints at once so neither was isolated, or that did not satisfy the constraint the production code actually enforces.

**Adjacent guards get adjacent fixtures — one per guard, each failing only its own.** When a task adds two guards that can both reject the same input, it needs two fixtures, each of which only the guard under test rejects. Every teeth check in this plan names which single test must fail.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/browser/src/types.ts` | **Modify.** `PaginationConfig` gains `dom-scroll` and `loadMoreSelector`; `ScrollOptions` and the `IBrowser.scrollPages` signature. |
| `packages/browser/src/load-more.ts` | **Create.** Pure: find a load-more clickable in HTML. Heuristic only; the AI fallback is wired in Task 5. |
| `packages/browser/src/scroll-pages.ts` | **Create.** The in-page scripts: measure row count, scroll, click, stamp rows. Pure string builders, unit-testable. |
| `packages/browser/src/playwright-browser.ts` | **Modify.** `scrollPages()` — the async generator, mirroring `crawl()`. |
| `packages/scraper/src/__fixtures__/serve.ts` | **Modify.** Serve a page whose inline JS appends cards on scroll, and one with a load-more button. |
| `packages/scraper/src/crawl/scroll-walk-fixture.test.ts` | **Create.** Tier 1 gate: real Chromium against those pages. |
| `packages/scraper/src/crawl/plan-run.ts` | **Modify.** Third `walkPages` branch, and the fallback where it currently gives up. |
| `docs/handoff.md`, `docs/roadmap.md` | **Modify.** Record what the live run demonstrated. |

---

### Task 1: The config member and the fixture pages

**Files:**
- Modify: `packages/browser/src/types.ts`
- Modify: `packages/scraper/src/__fixtures__/serve.ts`
- Test: `packages/scraper/src/__fixtures__/serve-scroll.test.ts`

**Interfaces:**
- Produces: `PaginationConfig.strategy` gains `'dom-scroll'`; `PaginationConfig.loadMoreSelector?: string`. `ServedPage` unchanged — the scroll pages are ordinary HTML with inline JS, so no server change is needed beyond a helper that builds them.

Context: `PaginationConfig` is a flat object with `strategy` plus optional fields, shared by four strategies. Keep that shape — `navigateToPage`'s switch in `playwright-browser.ts` has `default: return false`, so a fifth member breaks neither typecheck nor runtime. **Do not add a `dom-scroll` case to that switch**: this strategy never goes through `crawl()`.

The fixture pages are plain HTML with inline JS and no network calls, so they run in real Chromium offline.

- [ ] **Step 1: Write the failing test**

Create `packages/scraper/src/__fixtures__/serve-scroll.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { scrollFixturePage, loadMoreFixturePage } from './serve.js';

describe('scrollFixturePage', () => {
  it('renders the first batch and nothing else up front', () => {
    const html = scrollFixturePage({ batches: [['/p/100001', '/p/100002'], ['/p/100003']] });
    expect(html).toContain('/p/100001');
    // Later batches must live in the script as data, not in the initial markup —
    // otherwise a crawler that never scrolls would still "find" them and the
    // Tier 1 gate would pass without the scroll loop working at all.
    expect(html.split('<script')[0]).not.toContain('/p/100003');
  });

  it('embeds the remaining batches as data for the scroll handler', () => {
    const html = scrollFixturePage({ batches: [['/p/100001'], ['/p/100003']] });
    expect(html).toContain(JSON.stringify([['/p/100003']]));
  });

  it('can be told to recycle off-screen cards, for the virtualized case', () => {
    expect(scrollFixturePage({ batches: [['/p/100001']], recycle: true })).toContain('RECYCLE');
    expect(scrollFixturePage({ batches: [['/p/100001']] })).not.toContain('RECYCLE');
  });
});

describe('loadMoreFixturePage', () => {
  it('renders a button whose text the heuristic will match', () => {
    expect(loadMoreFixturePage({ batches: [['/p/100001'], ['/p/100002']] }))
      .toContain('Load more');
  });

  it('removes the button when the last batch is served', () => {
    // A button that disappears is the clean end signal; the fixture has to
    // actually do it, or the Tier 1 test for that ending proves nothing.
    expect(loadMoreFixturePage({ batches: [['/p/100001']] })).toContain('remove()');
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/__fixtures__/serve-scroll.test.ts`
Expected: FAIL — `scrollFixturePage is not a function`.

- [ ] **Step 3: Implement**

Add to `packages/scraper/src/__fixtures__/serve.ts`:

```typescript
/** One product card. `data-row` is the hook the extraction xpath and the stamp both use. */
const card = (href: string) => `<div data-row class="item"><a href="${href}">x</a></div>`;

/**
 * A listing that appends its next batch when scrolled near the bottom.
 *
 * Batches after the first live in a JS array rather than the markup, deliberately:
 * if they were in the initial HTML, a crawler that never scrolled would still
 * extract them and every Tier 1 assertion here would pass against a broken loop.
 *
 * `recycle` additionally removes cards scrolled past, reproducing a virtualized
 * list — the case where labels vanish with their nodes and the URL dedupe has to
 * carry correctness on its own.
 */
export function scrollFixturePage(
  opts: { batches: string[][]; recycle?: boolean; endless?: boolean },
): string {
  const [first = [], ...rest] = opts.batches;
  return `<!doctype html><html><body>
<div id="results">${first.map(card).join('')}</div>
<div style="height:2000px"></div>
<script>
  const rest = ${JSON.stringify(rest)};
  const recycle = ${opts.recycle ? 'true' : 'false'};
  const endless = ${opts.endless ? 'true' : 'false'};
  const results = document.getElementById('results');
  let served = 0;
  addEventListener('scroll', () => {
    if (window.scrollY + window.innerHeight < document.body.scrollHeight - 50) return;
    // Endless: a fresh card every round, forever. The only thing that can stop
    // a walk here is MAX_SCROLL_ROUNDS.
    if (endless) {
      const d = document.createElement('div');
      d.setAttribute('data-row', '');
      d.innerHTML = '<a href="/p/9' + String(served++).padStart(5, '0') + '">x</a>';
      results.appendChild(d);
      return;
    }
    if (served >= rest.length) return;
    const batch = rest[served++];
    if (recycle) { /* RECYCLE */ results.innerHTML = ''; }
    for (const href of batch) {
      const d = document.createElement('div');
      d.setAttribute('data-row', '');
      d.className = 'item';
      d.innerHTML = '<a href="' + href + '">x</a>';
      results.appendChild(d);
    }
  });
</script></body></html>`;
}

/** The same listing, advanced by a button instead of a scroll. The button removes itself when spent. */
export function loadMoreFixturePage(opts: { batches: string[][] }): string {
  const [first = [], ...rest] = opts.batches;
  return `<!doctype html><html><body>
<div id="results">${first.map(card).join('')}</div>
<button id="more">Load more</button>
<script>
  const rest = ${JSON.stringify(rest)};
  const results = document.getElementById('results');
  const btn = document.getElementById('more');
  let served = 0;
  btn.addEventListener('click', () => {
    const batch = rest[served++] || [];
    for (const href of batch) {
      const d = document.createElement('div');
      d.setAttribute('data-row', '');
      d.className = 'item';
      d.innerHTML = '<a href="' + href + '">x</a>';
      results.appendChild(d);
    }
    if (served >= rest.length) btn.remove();
  });
</script></body></html>`;
}
```

Then extend `PaginationConfig` in `packages/browser/src/types.ts` — add `'dom-scroll'` to the `strategy` union and:

```typescript
  /**
   * For dom-scroll: the clickable that advances the listing, when one was found.
   * Absent means the listing advances by scrolling alone. Stored so a warm run
   * skips the search rather than re-deriving it.
   */
  loadMoreSelector?: string;
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/__fixtures__/serve-scroll.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Teeth check**

Change `scrollFixturePage` to render every batch into the initial markup. Re-run. Expected: "renders the first batch and nothing else up front" FAILS. Restore. Report what you saw.

- [ ] **Step 6: Gates and commit**

```bash
docker start robot-platform-db
pnpm -r test
pnpm typecheck --force
git add packages/browser/src/types.ts packages/scraper/src/__fixtures__/serve.ts packages/scraper/src/__fixtures__/serve-scroll.test.ts
git commit -m "feat(browser): dom-scroll config member, and fixture pages that actually grow"
```

---

### Task 2: Find the load-more button

**Files:**
- Create: `packages/browser/src/load-more.ts`
- Test: `packages/browser/src/load-more.test.ts`

**Interfaces:**
- Produces: `findLoadMore(html: string, afterText?: string): string | null` — a CSS selector for the clickable, or null. `afterText` is a string that must appear BEFORE the button, so the caller can anchor the position rule on a URL page 1 actually produced. `LOAD_MORE_TEXT: readonly string[]`.

Context: this mirrors `detectPaginationFromHtml` — a pure heuristic over HTML, with the AI as a later fallback (wired in Task 5). It must be pure and DOM-free so it unit-tests without a browser; parse with a regex over the raw HTML rather than reaching for a DOM library, as `pagination-detector.ts` already does.

Return a selector, not an element: the caller clicks it in the page.

- [ ] **Step 1: Write the failing test**

Create `packages/browser/src/load-more.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { findLoadMore } from './load-more.js';

describe('findLoadMore', () => {
  it('finds a button by its id', () => {
    expect(findLoadMore('<div id="results"></div><button id="more">Load more</button>'))
      .toBe('#more');
  });

  it('matches every documented wording, case-insensitively', () => {
    for (const text of ['Load More', 'SHOW MORE', 'See more', 'View more', 'More results']) {
      expect(findLoadMore(`<div id="results"></div><button id="b">${text}</button>`)).toBe('#b');
    }
  });

  it('falls back to a class selector when there is no id', () => {
    expect(findLoadMore('<div id="results"></div><button class="btn more-btn">Load more</button>'))
      .toBe('button.more-btn');
  });

  it('ignores a clickable whose text is not a load-more wording', () => {
    // "Subscribe" and "More filters" are the false positives that would click
    // something destructive or useless.
    expect(findLoadMore('<button id="s">Subscribe</button>')).toBeNull();
    expect(findLoadMore('<button id="f">More filters</button>')).toBeNull();
  });

  it('ignores a matching control that sits BEFORE the results', () => {
    // A "show more" in a filter sidebar above the grid is not the pager, and
    // clicking it changes the result set rather than extending it. This is the
    // only test that isolates the position rule — the wording rule accepts this
    // element, so if position stopped being checked nothing else would fail.
    //
    // The anchor is a URL page 1 actually produced. That is evidence the caller
    // already has, unlike a results-container selector, which nothing upstream
    // knows.
    const html = '<button id="filters">Show more</button><div><a href="/p/100001">x</a></div>';
    expect(findLoadMore(html, '/p/100001')).toBeNull();
  });

  it('accepts the same control when it sits AFTER the results', () => {
    // The other half of the position rule: without this, a rule that rejected
    // everything would pass the test above and nothing would catch it.
    const html = '<div><a href="/p/100001">x</a></div><button id="more">Show more</button>';
    expect(findLoadMore(html, '/p/100001')).toBe('#more');
  });

  it('answers null when there is no clickable at all', () => {
    expect(findLoadMore('<div id="results"></div>')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/browser exec vitest run src/load-more.test.ts`
Expected: FAIL — cannot resolve `./load-more.js`.

- [ ] **Step 3: Implement**

Create `packages/browser/src/load-more.ts`:

```typescript
// Which clickable advances this listing?
//
// A pure heuristic over raw HTML, mirroring `detectPaginationFromHtml`: no DOM,
// no browser, so it unit-tests for free. The AI fallback is wired at the call
// site, exactly as it is for HTML pagination detection.
//
// Returning a SELECTOR rather than an element is deliberate — the caller clicks
// it inside the page, and a selector is what survives the process boundary.

/** Wordings that mean "there is more below". Anything else is not a pager. */
export const LOAD_MORE_TEXT: readonly string[] = [
  'load more', 'show more', 'see more', 'view more', 'more results',
];

const CLICKABLE = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const ID_ATTR = /\bid\s*=\s*["']([^"']+)["']/i;
const CLASS_ATTR = /\bclass\s*=\s*["']([^"']+)["']/i;

/** Visible text with tags and entities stripped, collapsed and lowercased. */
function textOf(inner: string): string {
  return inner.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A CSS selector for the clickable that advances the listing, or null.
 *
 * `afterText`, when given, enforces the position rule: a control appearing
 * BEFORE the results is a filter or a sidebar toggle, not a pager. "Show more"
 * in a faceted-search sidebar is the common false positive, and clicking it
 * changes the result set rather than extending it.
 *
 * It is a raw string rather than a container selector on purpose: the caller
 * has page 1's own detail URLs and nothing upstream knows what wraps the grid,
 * so a URL page 1 actually produced is the one anchor available as evidence
 * rather than as a guess. A guard the caller cannot supply an argument for is a
 * guard that never fires.
 */
export function findLoadMore(html: string, afterText?: string): string | null {
  const resultsAt = afterText ? html.indexOf(afterText) : -1;

  for (const match of html.matchAll(CLICKABLE)) {
    const [whole, tag, attrs, inner] = match;
    if (!LOAD_MORE_TEXT.includes(textOf(inner ?? ''))) continue;
    if (resultsAt >= 0 && (match.index ?? 0) < resultsAt) continue;

    const id = ID_ATTR.exec(attrs ?? '')?.[1];
    if (id) return `#${id}`;
    const cls = CLASS_ATTR.exec(attrs ?? '')?.[1]?.split(/\s+/).filter(Boolean);
    // Prefer the most specific-looking class — a bare "btn" matches half the page.
    const best = cls?.slice().sort((a, b) => b.length - a.length)[0];
    if (best) return `${tag}.${best}`;
    void whole;
  }
  return null;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/browser exec vitest run src/load-more.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Teeth check**

Two mutations, report each:
- Delete the `resultsAt` position check. Expected: only "ignores a matching control that sits BEFORE the results container" fails.
- Replace `LOAD_MORE_TEXT.includes(...)` with `textOf(inner).includes('more')`. Expected: only "ignores a clickable whose text is not a load-more wording" fails (it would then accept "More filters").

If either does not fail, stop and report — those are the two guards this module exists for and each needs its own fixture.

- [ ] **Step 6: Gates and commit**

```bash
pnpm -r test
pnpm typecheck --force
git add packages/browser/src/load-more.ts packages/browser/src/load-more.test.ts
git commit -m "feat(browser): find the clickable that advances a listing"
```

---

### Task 3: The in-page scripts

**Files:**
- Create: `packages/browser/src/scroll-pages.ts`
- Test: `packages/browser/src/scroll-pages.test.ts`

**Interfaces:**
- Produces: `SEEN_ATTR = 'data-robot-seen'`; `rowCountScript(rowXpath: string): string`; `stampScript(rowXpath: string): string`; `unseenXpath(rowXpath: string): string`.

Context: **the page does the DOM work; Node decides.** The `api-param` cycle established this split for a good reason — logic inside a stringified script cannot be unit-tested, and it is the decisions that need tests. These three builders are pure string functions; the generator in Task 4 supplies the loop and the judgement.

`unseenXpath` is the whole labelling optimisation: appending a predicate to page 1's own `row_xpath` scopes extraction to unstamped rows without forking `buildExtractionScript`.

- [ ] **Step 1: Write the failing test**

Create `packages/browser/src/scroll-pages.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { unseenXpath, rowCountScript, stampScript, SEEN_ATTR } from './scroll-pages.js';

describe('unseenXpath', () => {
  it('scopes an xpath to rows that have not been stamped', () => {
    expect(unseenXpath('//div[@data-row]')).toBe(`//div[@data-row][not(@${SEEN_ATTR})]`);
  });

  it('leaves the original xpath otherwise untouched', () => {
    // The predicate is appended, never woven in — page 1's plan is the caller's,
    // and rewriting it would break selectors this module does not understand.
    const original = '//div[contains(@class,"item")]/section[1]';
    expect(unseenXpath(original).startsWith(original)).toBe(true);
  });
});

describe('rowCountScript', () => {
  it('counts ALL rows, stamped or not', () => {
    // Growth is measured against the whole list, not the unstamped remainder:
    // after a round stamps everything, the unstamped count is 0 and would look
    // like the list had shrunk.
    const script = rowCountScript('//div[@data-row]');
    expect(script).toContain('//div[@data-row]');
    expect(script).not.toContain(SEEN_ATTR);
  });
});

describe('stampScript', () => {
  it('stamps every row matching the caller\'s xpath', () => {
    expect(stampScript('//div[@data-row]')).toContain(SEEN_ATTR);
    expect(stampScript('//div[@data-row]')).toContain('//div[@data-row]');
  });

  it('embeds the xpath as data, not as code', () => {
    // A selector carrying a quote must not be able to close the string and run.
    const nasty = `//div[@class="a'b"]`;
    expect(stampScript(nasty)).toContain(JSON.stringify(nasty));
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/browser exec vitest run src/scroll-pages.test.ts`
Expected: FAIL — cannot resolve `./scroll-pages.js`.

- [ ] **Step 3: Implement**

Create `packages/browser/src/scroll-pages.ts`:

```typescript
// The in-page half of the scroll walk: measure, stamp, and scope.
//
// Every judgement — has it grown, is it quiet, are we done — lives in the
// generator in Node. These are pure string builders so they can be tested
// without a browser, and so the loop's decisions can be tested without a page.

/** The attribute marking a row this walk has already extracted. */
export const SEEN_ATTR = 'data-robot-seen';

/**
 * Page 1's own row xpath, scoped to rows not yet stamped.
 *
 * Appended as a predicate rather than woven into the expression: the xpath comes
 * from the extraction plan and may use axes or functions this module knows
 * nothing about, so the only safe edit is one that composes.
 */
export function unseenXpath(rowXpath: string): string {
  return `${rowXpath}[not(@${SEEN_ATTR})]`;
}

/**
 * How many rows are on the page in total.
 *
 * Deliberately counts stamped rows too. Growth is a property of the whole list;
 * measuring only unstamped rows would read "0" after every successful round and
 * make a growing list look finished.
 */
export function rowCountScript(rowXpath: string): string {
  return `(() => {
  const xp = ${JSON.stringify(rowXpath)};
  const r = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  return r.snapshotLength;
})()`;
}

/** Stamp every matching row, so the next round's extraction skips it. */
export function stampScript(rowXpath: string): string {
  return `(() => {
  const xp = ${JSON.stringify(rowXpath)};
  const r = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  let n = 0;
  for (let i = 0; i < r.snapshotLength; i++) {
    const el = r.snapshotItem(i);
    if (el && el.setAttribute) { el.setAttribute(${JSON.stringify(SEEN_ATTR)}, '1'); n++; }
  }
  return n;
})()`;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/browser exec vitest run src/scroll-pages.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Teeth check**

Change `rowCountScript` to use `unseenXpath(rowXpath)`. Re-run. Expected: only "counts ALL rows, stamped or not" fails. Restore.

That mutation is the single most dangerous one in this module — it would make every round after the first read a count of zero, which the generator would interpret as a finished list. Confirm it fails.

- [ ] **Step 6: Gates and commit**

```bash
pnpm -r test
pnpm typecheck --force
git add packages/browser/src/scroll-pages.ts packages/browser/src/scroll-pages.test.ts
git commit -m "feat(browser): in-page measure, stamp and scope for the scroll walk"
```

---

### Task 4: The generator

**Files:**
- Modify: `packages/browser/src/types.ts` (add `ScrollOptions`, extend `IBrowser`)
- Modify: `packages/browser/src/playwright-browser.ts` (add `scrollPages`)
- Test: `packages/scraper/src/crawl/scroll-walk-fixture.test.ts`

**Interfaces:**
- Consumes: `unseenXpath`, `rowCountScript`, `stampScript` (Task 3); `findLoadMore` (Task 2); `scrollFixturePage`, `loadMoreFixturePage`, `serveFixturePages` (Task 1).
- Produces: `IBrowser.scrollPages(startUrl: string, options: ScrollOptions): AsyncGenerator<CrawlPage>` where `ScrollOptions = { extractionScript: string; rowXpath: string; maxItems?: number; loadMoreSelector?: string }`. Yields the same `CrawlPage` shape `crawl()` does — `{ url, pageNumber, data, totalRows }` — with `pageNumber` counting rounds from 2.

Context: it must live on `IBrowser` beside `crawl()` because `evaluate(url, script)` **navigates** — a Node-driven loop would reload the page every round and destroy everything already loaded. Mirror `crawl()`'s structure: `this.context.newPage()`, `navigateWithFallback`, `dismissPopups`, and a `finally { await page.close(); }`.

**`FixtureBrowser` in `packages/scraper/src/__fixtures__/replay.ts` implements `IBrowser`** and will need the new method — a throwing stub is fine and correct there, since fixture replay never scrolls. Check for other implementers before assuming that is the only one.

This is the task where a Tier 1 test is worth more than any unit test, because the thing being tested is whether a real browser actually grows a real page.

- [ ] **Step 1: Write the failing test**

Create `packages/scraper/src/crawl/scroll-walk-fixture.test.ts`:

```typescript
// Tier 1: does the scroll walk actually grow a real page in a real browser?
//
// Every other test in this cycle fakes the page. This one serves a listing whose
// JS appends cards on scroll and drives real Chromium against it, so the growth
// wait, the quiet-round rule and the stamping are the real ones.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser, type CrawlPage } from '@robot/browser';
import { serveFixturePages, scrollFixturePage, loadMoreFixturePage, type ServedSite } from '../__fixtures__/serve.js';
import { buildExtractionScript } from '../executor.js';
import { DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

const ROW_XPATH = '//div[@data-row]';
const script = () => buildExtractionScript(
  { row_xpath: ROW_XPATH, fields: [{ name: DETAIL_URL_FIELD, xpath: './/a/@href', attribute: 'href', transform: 'absolute_url' }] },
  { [DETAIL_URL_FIELD]: 'url' },
);

let browser: PlaywrightBrowser;
let site: ServedSite;

beforeAll(async () => {
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
  site = await serveFixturePages([
    { path: '/scroll', html: scrollFixturePage({ batches: [['/p/100001', '/p/100002'], ['/p/200001'], ['/p/300001']] }) },
    { path: '/virtual', html: scrollFixturePage({ batches: [['/p/100001'], ['/p/200001']], recycle: true }) },
    { path: '/button', html: loadMoreFixturePage({ batches: [['/p/100001'], ['/p/200001']] }) },
    { path: '/done', html: scrollFixturePage({ batches: [['/p/100001', '/p/100002']] }) },
    // An empty batch is a round that yields nothing — the stall the quiet-round
    // rule exists to survive.
    { path: '/stall', html: scrollFixturePage({ batches: [['/p/100001'], [], ['/p/400001']] }) },
    { path: '/endless', html: scrollFixturePage({ batches: [['/p/100001']], endless: true }) },
  ]);
}, 60_000);

afterAll(async () => {
  try { await browser?.close(); } finally { await site?.close(); }
});

async function walk(path: string, opts: { maxItems?: number; loadMoreSelector?: string } = {}): Promise<CrawlPage[]> {
  const out: CrawlPage[] = [];
  for await (const p of browser.scrollPages(`${site.baseUrl}${path}`, {
    extractionScript: script(), rowXpath: ROW_XPATH, ...opts,
  })) out.push(p);
  return out;
}

const urls = (pages: CrawlPage[]) => pages.flatMap((p) => p.data.map((r) => String(r[DETAIL_URL_FIELD])));

describe('the scroll walk against a real page', () => {
  it('enumerates batches that only exist after scrolling', async () => {
    const found = urls(await walk('/scroll'));
    expect(found.some((u) => u.endsWith('/p/200001'))).toBe(true);
    expect(found.some((u) => u.endsWith('/p/300001'))).toBe(true);
  }, 60_000);

  it('yields each round only the rows that are new', async () => {
    // The labelling optimisation, observed from outside: page 1's two cards must
    // not reappear in round 2's batch.
    const pages = await walk('/scroll');
    const second = pages.find((p) => p.pageNumber === 2);
    expect(second?.data.map((r) => String(r[DETAIL_URL_FIELD]))).toEqual([`${site.baseUrl}/p/200001`]);
  }, 60_000);

  it('loses nothing when the page recycles cards out of the DOM', async () => {
    // Virtualized: the fixture clears the container each round, so the labels go
    // with it. Correctness has to come from the caller's dedupe, and the walk
    // still has to SEE every item at least once.
    const found = urls(await walk('/virtual'));
    expect(found.some((u) => u.endsWith('/p/100001'))).toBe(true);
    expect(found.some((u) => u.endsWith('/p/200001'))).toBe(true);
  }, 60_000);

  it('stops on a page that has nothing more, without hanging', async () => {
    const pages = await walk('/done');
    expect(urls(pages)).toEqual([]);
  }, 60_000);

  it('advances by clicking when a load-more selector is given', async () => {
    const found = urls(await walk('/button', { loadMoreSelector: '#more' }));
    expect(found.some((u) => u.endsWith('/p/200001'))).toBe(true);
  }, 60_000);

  it('stops when maxItems is reached', async () => {
    const found = urls(await walk('/scroll', { maxItems: 1 }));
    expect(found.length).toBeLessThanOrEqual(1);
  }, 60_000);

  it('survives a round that yields nothing and keeps going', async () => {
    // THE quiet-round rule, and the reason it is 2 rather than 1. `/stall`
    // serves nothing on its first scroll and a real batch on its second. A
    // crawler that stopped at the first quiet round would silently truncate
    // this listing and look like it had finished.
    const found = urls(await walk('/stall'));
    expect(found.some((u) => u.endsWith('/p/400001'))).toBe(true);
  }, 60_000);

  it('bounds a listing that never goes quiet', async () => {
    // `/endless` appends a new card on every scroll, forever. Without
    // MAX_SCROLL_ROUNDS this test does not fail — it hangs, which is worse.
    const pages = await walk('/endless');
    expect(pages.length).toBeLessThanOrEqual(50);
  }, 120_000);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/scroll-walk-fixture.test.ts`
Expected: FAIL — `browser.scrollPages is not a function`.

- [ ] **Step 3: Implement**

Add to `packages/browser/src/types.ts`:

```typescript
export type ScrollOptions = {
  /** The extraction script from buildExtractionScript, scoped by the walk to unstamped rows. */
  extractionScript: string;
  /** Page 1's own row xpath — used to count rows, stamp them, and scope extraction. */
  rowXpath: string;
  /** Stop once this many items have been yielded across all rounds. */
  maxItems?: number;
  /** When present, advance by clicking this instead of scrolling. */
  loadMoreSelector?: string;
};
```

and to `IBrowser`:

```typescript
  scrollPages(startUrl: string, options: ScrollOptions): AsyncGenerator<CrawlPage>;
```

Add to `packages/browser/src/playwright-browser.ts`, beside `crawl()`:

```typescript
  /** Consecutive rounds yielding nothing new before the listing is called finished. */
  private static readonly QUIET_ROUNDS = 2;
  /** How long to wait for the row count to grow before treating a round as quiet. */
  private static readonly GROWTH_TIMEOUT_MS = 3000;
  /** Hard bound so a page that grows forever cannot loop forever. Not a budget knob. */
  private static readonly MAX_SCROLL_ROUNDS = 50;
  /** Pacing between rounds. Scrolling in a tight loop is a louder bot signal than fetching. */
  private static readonly SCROLL_PACING_MS = 500;

  async *scrollPages(startUrl: string, options: ScrollOptions): AsyncGenerator<CrawlPage> {
    if (!this.context) throw new Error('Browser not launched. Call launch() first.');
    const maxItems = options.maxItems ?? Number.MAX_SAFE_INTEGER;
    const page = await this.context.newPage();
    let yielded = 0;

    try {
      await this.navigateWithFallback(page, startUrl);
      await this.dismissPopups(page);

      let quiet = 0;
      for (let round = 2; round <= PlaywrightBrowser.MAX_SCROLL_ROUNDS; round++) {
        if (yielded >= maxItems) break;

        const before = await page.evaluate(rowCountScript(options.rowXpath)) as number;

        // Stamp BEFORE advancing: everything currently on the page has either been
        // extracted by a previous round or belongs to page 1, which the caller
        // already has. Anything appearing after this point is what we want.
        await page.evaluate(stampScript(options.rowXpath));

        if (options.loadMoreSelector) {
          const btn = page.locator(options.loadMoreSelector).first();
          if (!await btn.isVisible({ timeout: 1000 }).catch(() => false)) break;
          await btn.click({ timeout: 5000 }).catch(() => {});
        } else {
          await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        }

        // Wait for growth rather than a fixed delay: a fast site proceeds at once,
        // a slow one still gets its chance, and the timeout only binds when
        // nothing is coming.
        const grew = await page.waitForFunction(
          `(${rowCountScript(options.rowXpath)}) > ${before}`,
          undefined,
          { timeout: PlaywrightBrowser.GROWTH_TIMEOUT_MS },
        ).then(() => true).catch(() => false);

        const extracted = await page.evaluate(
          options.extractionScript.replace(options.rowXpath, unseenXpath(options.rowXpath)),
        ) as { data: Record<string, unknown>[]; totalRows: number };

        if (!grew && extracted.data.length === 0) {
          if (++quiet >= PlaywrightBrowser.QUIET_ROUNDS) break;
          continue;
        }
        quiet = 0;

        if (extracted.data.length > 0) {
          yield { url: page.url(), pageNumber: round, data: extracted.data, totalRows: extracted.totalRows };
          yielded += extracted.data.length;
        }
        await page.waitForTimeout(PlaywrightBrowser.SCROLL_PACING_MS);
      }
    } finally {
      await page.close();
    }
  }
```

Import `rowCountScript`, `stampScript` and `unseenXpath` from `./scroll-pages.js` at the top of the file, and `ScrollOptions` from `./types.js`.

Then add a stub to every other `IBrowser` implementer. In `packages/scraper/src/__fixtures__/replay.ts`'s `FixtureBrowser`:

```typescript
  // eslint-disable-next-line require-yield
  async *scrollPages(): AsyncGenerator<CrawlPage> {
    throw new Error('FixtureBrowser cannot scroll — fixture replay is a frozen snapshot');
  }
```

Search for other implementers before assuming that is the only one, and report what you found.

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/scroll-walk-fixture.test.ts`
Expected: PASS, 6 tests.

If a round yields nothing on the `/scroll` fixture, set `HEADFUL=1` and watch. **Debug it — do not weaken the assertions.** If the scroll event never fires because the page is too short, that is a fixture bug; if `waitForFunction` never resolves, that is a real finding about the growth wait.

- [ ] **Step 5: Teeth check**

Three mutations, report each:
- `QUIET_ROUNDS` to 1. Expected: "loses nothing when the page recycles cards" may still pass; report exactly which tests fail, if any. This one is genuinely uncertain — say what you observe rather than what you expect.
- Remove the `stampScript` call. Expected: only "yields each round only the rows that are new" fails.
- Replace `unseenXpath(...)` with the raw `rowXpath` in the extraction. Expected: same test fails.

- [ ] **Step 6: Gates and commit**

```bash
pnpm -r test
pnpm typecheck --force
pnpm --filter @robot/dashboard exec tsc --noEmit
git add packages/browser/src/types.ts packages/browser/src/playwright-browser.ts packages/scraper/src/__fixtures__/replay.ts packages/scraper/src/crawl/scroll-walk-fixture.test.ts
git commit -m "feat(browser): scrollPages — grow a listing and yield what appeared"
```

---

### Task 5: Wire it into planRun

**Files:**
- Modify: `packages/scraper/src/crawl/plan-run.ts`
- Test: `packages/scraper/src/crawl/plan-run-scroll.test.ts`
- Test: `packages/scraper/src/crawl/plan-run-scroll.fixtures.ts`

**Interfaces:**
- Consumes: `IBrowser.scrollPages` (Task 4); `findLoadMore` (Task 2); the existing `walkPages` dispatcher, `absorb`, and the `{ gained, budgetStopped, refused }` `WalkResult` shape.
- Produces: nothing new.

Context — **two edits, and the surrounding block is not to be restructured.**

1. `walkPages` gains a third branch: `config.strategy === 'dom-scroll'` routes to a new `walkScrollPages`, which returns the same `WalkResult`.
2. At `plan-run.ts:482`, where `if (!pagination.config)` currently pushes `no pagination detected …` and `continue`s, attempt a scroll walk first. If it gains items, write a `dom-scroll` config through the existing `savePagination`; if not, fall through to the warning exactly as today.

The second edit is the whole feature. Everything else — verification, the bounded stale retry, the cache write, the thin-walk warning, per-input error isolation — already keys off `walkPages`, so it works untouched.

`findLoadMore` is called with the capture's HTML. When it returns a selector, pass it in `ScrollOptions` and store it on the config.

- [ ] **Step 1: Write the failing test**

Create `packages/scraper/src/crawl/plan-run-scroll.fixtures.ts`:

```typescript
import type { PaginationConfig, PageCapture, CrawlPage, ScrollOptions } from '@robot/browser';
import type { PlanRunDeps, PlanRunRequest } from './plan-run.js';
import { DETAIL_URL_FIELD } from './enumerate-detail-urls.js';

/** Detail URLs page 1's own extraction yields. */
export const PAGE1 = ['https://listing.example/p/100001', 'https://listing.example/p/100002'];

export const SCROLL_CONFIG: PaginationConfig = { strategy: 'dom-scroll' };

export type SavedConfig = { domain: string; config: PaginationConfig };

export type ScrollDeps = PlanRunDeps & {
  scrollCalls: ScrollOptions[];
  crawlCalls: unknown[];
  saved: SavedConfig[];
};

/**
 * `html` carries no pagination markup at all, so every other rung of the ladder
 * comes back empty and the scroll fallback is the only thing that can fire.
 */
export const plainHtml = '<html><body><div data-row><a href="/p/100001">x</a></div></body></html>';

export function scrollDeps(over: {
  cachedConfig?: PaginationConfig | null;
  /** Detail URLs each scroll round yields, in order. */
  rounds?: string[][];
  html?: string;
}): ScrollDeps {
  const scrollCalls: ScrollOptions[] = [];
  const crawlCalls: unknown[] = [];
  const saved: SavedConfig[] = [];
  const rounds = over.rounds ?? [['https://listing.example/p/200001']];

  const capture = {
    url: 'https://listing.example/list',
    html: over.html ?? plainHtml,
    screenshot: '',
    screenshotTiles: [],
    interceptedRequests: [],
  } as unknown as PageCapture;

  return {
    browser: {
      capture: async () => capture,
      async *crawl(_url: string, options: unknown) { crawlCalls.push(options); },
      async *scrollPages(_url: string, options: ScrollOptions): AsyncGenerator<CrawlPage> {
        scrollCalls.push(options);
        for (let i = 0; i < rounds.length; i++) {
          const batch = rounds[i]!;
          if (batch.length === 0) continue;
          yield {
            url: 'https://listing.example/list',
            pageNumber: i + 2,
            data: batch.map((u) => ({ [DETAIL_URL_FIELD]: u })),
            totalRows: batch.length,
          };
        }
      },
    } as unknown as PlanRunDeps['browser'],
    agent: null,
    extract: (async () => ({
      data: [{ [DETAIL_URL_FIELD]: PAGE1[0] }],
      rows: PAGE1.map((u) => ({ [DETAIL_URL_FIELD]: u })),
      plan: { row_xpath: '//div[@data-row]', fields: [{ name: DETAIL_URL_FIELD, xpath: './/a/@href' }] },
      confidence: 1,
      sources: {},
      fieldCount: { found: 1, total: 1 },
      fieldsByTier: { requested: [], discovered: [] },
      cacheHit: false,
    })) as unknown as PlanRunDeps['extract'],
    acquireLock: async () => () => {},
    lookupCache: (async () => (
      over.cachedConfig ? { paginationConfig: over.cachedConfig } : null
    )) as unknown as PlanRunDeps['lookupCache'],
    savePagination: (async (domain: string, config: PaginationConfig) => { saved.push({ domain, config }); }) as PlanRunDeps['savePagination'],
    scrollCalls,
    crawlCalls,
    saved,
  };
}

export function scrollRequest(budget: { maxPages: number; maxItems: number }): PlanRunRequest {
  return {
    source: {
      listingMode: 'listing_to_detail',
      inputStrategy: 'direct',
      urlTemplate: 'https://listing.example/list',
      budget: { max_pages: budget.maxPages, max_items: budget.maxItems, mode: 'first_n' },
    },
    schema: [{ name: DETAIL_URL_FIELD, type: 'url', origin: 'listing' }],
    inputSet: { columns: [{ name: 'url', primary: true }], rows: [{ url: 'https://listing.example/list' }] },
  } as unknown as PlanRunRequest;
}
```

Create `packages/scraper/src/crawl/plan-run-scroll.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { planRun } from './plan-run.js';
import { DETAIL_URL_FIELD } from './enumerate-detail-urls.js';
import { scrollDeps, scrollRequest, SCROLL_CONFIG, PAGE1 } from './plan-run-scroll.fixtures.js';

const detailUrls = (o: Awaited<ReturnType<typeof planRun>>) =>
  o.items.filter((i) => i.kind === 'detail').map((i) => i.url);

describe('planRun — the scroll fallback', () => {
  it('scrolls where it would otherwise have given up', async () => {
    const deps = scrollDeps({ rounds: [['https://listing.example/p/200001']] });

    const outcome = await planRun(scrollRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.scrollCalls).toHaveLength(1);
    expect(detailUrls(outcome)).toContain('https://listing.example/p/200001');
    // The give-up warning must NOT be pushed when the scroll worked.
    expect(outcome.warnings.some((w) => w.includes('no pagination detected'))).toBe(false);
  });

  it('caches a dom-scroll config once the walk gained', async () => {
    const deps = scrollDeps({ rounds: [['https://listing.example/p/200001']] });

    await planRun(scrollRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.saved).toHaveLength(1);
    expect(deps.saved[0]?.config.strategy).toBe('dom-scroll');
  });

  it('caches NOTHING and still warns when the scroll gained nothing', async () => {
    // A listing that genuinely has one screen. This is the common case, and it
    // must end exactly as it did before this feature existed.
    const deps = scrollDeps({ rounds: [[]] });

    const outcome = await planRun(scrollRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.saved).toEqual([]);
    expect(outcome.warnings.some((w) => w.includes('no pagination detected'))).toBe(true);
    expect(detailUrls(outcome)).toEqual(PAGE1);
  });

  it('never routes a dom-scroll config through browser.crawl', async () => {
    // crawl()'s navigateToPage has `default: return false`, so a misrouted
    // dom-scroll config would silently walk zero pages rather than erroring.
    const deps = scrollDeps({ cachedConfig: SCROLL_CONFIG, rounds: [['https://listing.example/p/200001']] });

    await planRun(scrollRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.crawlCalls).toHaveLength(0);
    expect(deps.scrollCalls).toHaveLength(1);
  });

  it('passes the load-more selector when the page has one', async () => {
    const deps = scrollDeps({
      html: '<html><body><div id="results"><div data-row><a href="/p/100001">x</a></div></div><button id="more">Load more</button></body></html>',
      rounds: [['https://listing.example/p/200001']],
    });

    await planRun(scrollRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(deps.scrollCalls[0]?.loadMoreSelector).toBe('#more');
    expect(deps.saved[0]?.config.loadMoreSelector).toBe('#more');
  });

  it('feeds scroll rows through the same dedupe as every other walk', async () => {
    // Round 2 re-serves one of page 1's URLs — the virtualized case, where a
    // recycled card is extracted twice. It must be planned once.
    const deps = scrollDeps({ rounds: [[PAGE1[0]!, 'https://listing.example/p/200001']] });

    const outcome = await planRun(scrollRequest({ maxPages: 3, maxItems: 50 }), deps);

    expect(detailUrls(outcome).filter((u) => u === PAGE1[0])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/plan-run-scroll.test.ts`
Expected: FAIL — `scrollCalls` is empty and the give-up warning is present, because nothing calls `scrollPages` yet.

- [ ] **Step 3: Implement**

In `plan-run.ts`, add the imports:

```typescript
import { findLoadMore } from '@robot/browser';
```

(export `findLoadMore` from `packages/browser/src/index.ts` if it is not already.)

Add the walker beside `walkApiPages`:

```typescript
      /**
       * Walk a scroll-loading listing: grow the page, absorb what appeared.
       *
       * Feeds the SAME `absorb` the other two walkers use, so dedupe, the item
       * cap and the stop reasons behave identically — which is what lets a
       * virtualized listing re-serve a recycled card without planning it twice.
       */
      const walkScrollPages = async (config: PaginationConfig): Promise<WalkResult> => {
        const before = detailCount();
        let budgetStopped = false;
        for await (const round of deps.browser.scrollPages(start.url, {
          extractionScript: script,
          rowXpath: page1.plan!.row_xpath,
          maxItems: cap - detailCount(),
          ...(config.loadMoreSelector ? { loadMoreSelector: config.loadMoreSelector } : {}),
        })) {
          items.push({
            kind: 'listing', url: round.url, inputIndex: start.inputIndex,
            inputValues: start.inputValues, listingValues: {}, pageNumber: round.pageNumber,
          });
          const stop = absorb(round.data, start.url, round.pageNumber);
          if (stop !== null) {
            budgetStopped = stop === 'budget';
            break;
          }
        }
        return { gained: detailCount() - before, budgetStopped, refused: false };
      };
```

Extend the dispatcher:

```typescript
      const walkPages = (config: PaginationConfig): Promise<WalkResult> => {
        if (config.strategy === 'api-param') return walkApiPages(config);
        if (config.strategy === 'dom-scroll') return walkScrollPages(config);
        return walkHtmlPages(config);
      };
```

Replace the give-up block at `plan-run.ts:482`:

```typescript
      if (!pagination.config) {
        // Nothing in the markup says how this listing advances — but a page that
        // scroll-loads never would. This is the last rung, and the only way to
        // know is to try: a listing that is genuinely finished costs two quiet
        // rounds and stops.
        // Anchor the position rule on a URL page 1 actually produced, so a
        // "Show more" in a filter sidebar above the grid is not mistaken for
        // the pager. Passing nothing here would leave that guard inert.
        const firstDetailUrl = listingRows
          .map((row) => row[DETAIL_URL_FIELD])
          .find((u): u is string => typeof u === 'string' && u.length > 0);
        // The PATH, not the absolute URL. Extraction resolves hrefs against the
        // page, so `detail_url` is absolute while the markup almost always
        // carries `/p/100001` — anchoring on the absolute form would never match
        // and the position rule would sit inert, which is the failure this
        // argument exists to prevent.
        const anchorPath = firstDetailUrl
          ? (() => { try { return new URL(firstDetailUrl).pathname; } catch { return firstDetailUrl; } })()
          : undefined;
        const loadMoreSelector = findLoadMore(capture?.html ?? '', anchorPath) ?? undefined;
        const scrollConfig: PaginationConfig = {
          strategy: 'dom-scroll',
          ...(loadMoreSelector ? { loadMoreSelector } : {}),
        };
        const scrolled = await walkScrollPages(scrollConfig);
        if (scrolled.gained > 0) {
          try {
            await savePagination(paginationDomain, scrollConfig);
          } catch (err) {
            warnings.push(
              `pagination cache save failed on ${start.url}: ${(err as Error).message} `
              + `— the walk's items are planned; the config was not stored`,
            );
          }
          report(start.inputIndex, 'planned', detailCount() - detailsBefore);
          continue;
        }
        warnings.push(`no pagination detected on ${start.url} — planned page 1 only`);
        report(start.inputIndex, 'planned', detailCount() - detailsBefore);
        continue;
      }
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @robot/scraper exec vitest run src/crawl/plan-run-scroll.test.ts src/crawl/plan-run-pagination.test.ts src/crawl/plan-run-api-param.test.ts`
Expected: PASS — the new file, and every existing pagination test still green.

- [ ] **Step 5: Teeth check**

Four mutations, report which single test each fails:
- Make the dispatcher route `dom-scroll` to `walkHtmlPages`. Expected: "never routes a dom-scroll config through browser.crawl" fails.
- Save the config unconditionally (drop `scrolled.gained > 0`). Expected: "caches NOTHING and still warns" fails.
- Pass the raw `rowXpath` without the load-more selector. Expected: "passes the load-more selector" fails.
- Absorb with `round.url` as the base instead of `start.url`. Expected: report what fails — if nothing does, say so, because that is the same base-URL defect the `api-param` walk shipped.

- [ ] **Step 6: Gates and commit**

```bash
pnpm -r test
pnpm typecheck --force
pnpm --filter @robot/dashboard exec tsc --noEmit
git add packages/scraper/src/crawl/plan-run.ts packages/scraper/src/crawl/plan-run-scroll.test.ts packages/scraper/src/crawl/plan-run-scroll.fixtures.ts packages/browser/src/index.ts
git commit -m "feat(crawl): scroll where planRun used to give up"
```

---

### Task 6: Live proof and docs

**Files:**
- Modify: `docs/handoff.md`, `docs/roadmap.md`

**Interfaces:**
- Consumes: everything above.

This task makes real requests to a live site. **Plan only — it fetches listing pages, no detail pages.** Do not raise a budget beyond what step 1 sets, and do not re-run a step for a better-looking result.

**Do not start this task without the controller's explicit go-ahead** — it spends money and the target choice matters.

- [ ] **Step 1: Pick a target and confirm it with the controller**

`api-param`'s live proof failed because the target was chosen on a roadmap note rather than on evidence: Newegg's category page renders server-side. **Do not repeat that.** Before spending anything, capture a candidate listing and check whether scrolling actually grows it:

```bash
HEADFUL=1 pnpm --filter @robot/scraper exec tsx src/test-run.ts "<candidate listing url>"
```

Watch the page. If scrolling does not add products, it is not a target. Report the candidate and what you observed, and wait for confirmation before step 2.

- [ ] **Step 2: Set a budget where items bind**

`max_pages` is not consulted by this strategy, so only `max_items` matters. Record the previous value so it can be restored:

```bash
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform \
  -c "update sources set budget = '{\"mode\":\"first_n\",\"max_items\":40,\"max_pages\":1}'::jsonb where slug='<slug>' returning slug, budget;"
```

- [ ] **Step 3: Plan, and record what happened**

```bash
pnpm --filter @robot/api exec tsx src/crawl-plan.ts <slug>
```

Record the run id, how many rounds it took, and how many detail items landed. Then verify:

```bash
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform \
  -c "select kind, page_number, count(*) from run_items where run_id='<run-id>' group by 1,2 order by 1,2;"
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform \
  -c "select pagination_config from domain_intelligence where domain like '%<domain>%' and page_type='listing';"
```

Expected: detail items spread across several `page_number`s, and a `{"strategy":"dom-scroll"}` config.

- [ ] **Step 4: Plan again and confirm the domain is warm**

```bash
pnpm --filter @robot/api exec tsx src/crawl-plan.ts <slug>
```

Expected: the same fan-out, reached via the cached config rather than the fallback.

- [ ] **Step 5: Restore the budget**

```bash
docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform \
  -c "update sources set budget = '<the value recorded in step 2>'::jsonb where slug='<slug>';"
```

- [ ] **Step 6: Record what is true**

Update `docs/handoff.md` and `docs/roadmap.md` with the real numbers. Do not claim anything the run did not demonstrate. Specifically:

- If the walk was cut short by `max_items` rather than by the list ending, say so — the quiet-round rule was then never exercised live.
- **Cursor APIs and POST/GraphQL remain unsupported by `api-param`**, and this strategy covers them only incidentally — it does not care how the batch arrives, so it works, but nothing about those transports was tested.
- If anti-bot interfered at any point, record it as a corpus fact.

- [ ] **Step 7: Commit**

```bash
git add docs/handoff.md docs/roadmap.md
git commit -m "docs: dom-scroll pagination, and what the live run showed"
```

---

## Done when

- `pnpm -r test`, `pnpm typecheck --force` and `pnpm --filter @robot/dashboard exec tsc --noEmit` are clean, and the leaked-row query returns 0.
- A listing that only reveals products on scroll is enumerated past its first screen, proven in Tier 1 against real Chromium.
- A listing that recycles cards out of the DOM loses no items.
- A load-more button is found, clicked, and its disappearance ends the walk.
- A finished listing stops after the quiet rounds and caches nothing.
- A `dom-scroll` config never reaches `browser.crawl()`.
- The docs say exactly what the live run demonstrated.

## Not in this plan

Horizontal carousels and "quick view" overlays; clicking through consent interstitials (popup dismissal already runs at capture); replacing `api-param` where a JSON endpoint exists; fixing `deriveTemplate`'s parameter choice on the HTML path; the `findListingApi` miss-case cost recorded as a follow-up on the previous branch.
