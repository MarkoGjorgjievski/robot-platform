# Schema Stepper — Engine (phases 1 and 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything the stepper's screens need from the engine and the API, working end to end through tRPC before any screen exists: a proof-page capture with a box map and its own ready check, marks stored on the binding and used by certification, `suggestMarks` and `transferMarks`, and verification reusing proof-page captures.

**Architecture:** The capture grows one generic hook (`annotate`: a script evaluated once after the expand rounds) and a tile cap; `@robot/scraper`'s verify module gains the box-map script, the proof-page ready check, marks in `VerificationSet`, and two pure functions over stored captures; `@robot/api` stores proof-page captures on the existing `captures` table plus a `.capture.json` file, and exposes four procedures. Certification changes in one place: a page with a mark takes the mark's XPaths instead of the DOM search's hits on that page.

**Tech Stack:** TypeScript ESM, Playwright (real Chromium in tests, no network), Vitest, tRPC v11 + Zod, Drizzle + Postgres (api tests need the dev database up).

**Spec:** `docs/superpowers/specs/2026-09-18-schema-stepper-with-marks-design.md` — §3 (engine), §4 (API), §6 (testing), §7 order of work items 1 and 2. This plan covers those; steps 3 to 6 (screens) are separate plans.

## Global Constraints

- All packages are ESM (`"type": "module"`); imports end in `.js`.
- Run one package's tests at a time: `pnpm --filter <pkg> test -- --maxWorkers=1` (`pnpm -r test` gets killed for memory on this machine). `@robot/api` tests need Postgres (`DATABASE_URL` in `.env`).
- Page-injected scripts are stringified functions: dependency-free, self-contained, and every IIFE starts with `PAGE_SCRIPT_PRELUDE` (`dom-scripts.ts`).
- Nothing here calls a model or the network in tests; browser tests use `setContentEvaluate` (offline by construction) or a local `http.createServer`.
- Commit with explicit paths only: `git add <paths>` then `git commit -m … -- <paths>` (shared checkout rule from the handoff).
- Existing stored certifications must stay current: `fieldHash` and `definitionHash` produce byte-identical input when a set has no marks.
- Spec amendment recorded here (§2.3 of the spec did not say it): the API keeps requiring a location hint (`descriptions[key]`) per field; the stepper's screens send the catalogue entry's description, or the field's name, so `bindingProblems` is untouched by this plan.

---

## File map

| File | Responsibility |
|---|---|
| `packages/browser/src/screenshot-tiles.ts` | `computeTileClips(pageHeight, maxTiles?)` |
| `packages/browser/src/types.ts` | `CaptureOptions.annotate`, `CaptureOptions.maxTiles`, `PageCapture.annotation` |
| `packages/browser/src/playwright-browser.ts` | run `annotate` after the expand rounds, honour `maxTiles` |
| `packages/scraper/src/verify/dom-scripts.ts` | export `browserXPaths` for the box-map script |
| `packages/scraper/src/verify/box-map.ts` (new) | `Box`, `buildBoxMapScript()`, `boxesFromAnnotation()` |
| `packages/scraper/src/verify/proof-page-ready.ts` (new) | `buildProofPageReadyCheck(pageUrl)` |
| `packages/scraper/src/verify/capture-check.ts` (new) | `captureProblem(capture, requestedUrl)` shared by verification and proof-page capture |
| `packages/scraper/src/verify/proof-page-capture.ts` (new) | `captureProofPage(browser, url)` → `{ capture, boxes }` |
| `packages/scraper/src/verify/types.ts` | `Mark`, `VerificationSet.marks` |
| `packages/scraper/src/verify/run-verification.ts` | hashes cover marks; `gatherCandidates` gets the field's marks |
| `packages/scraper/src/verify/certify.ts` | `gatherCandidates` takes `marks`; a marked page skips the DOM search |
| `packages/scraper/src/verify/suggest-marks.ts` (new) | `Suggestion`, `suggestMarks(capture, boxes, fields)` |
| `packages/scraper/src/verify/transfer-marks.ts` (new) | `transferMarks(input, deps)` |
| `packages/scraper/src/verify/index.ts` | exports |
| `packages/api/src/verify/capture-store.ts` (new) | `writeCaptureFile`, `readCaptureFile`, `persistTiles` (moved out of run-source-verification) |
| `packages/api/src/verify/proof-page-capture.ts` (new) | `startProofPageCapture`, `runProofPageCapture`, `loadProofPageCaptures` |
| `packages/api/src/verify/run-source-verification.ts` | reuse proof-page captures |
| `packages/api/src/verify/binding-input.ts` | `marks` in `bindingInput`, `prepareBinding` |
| `packages/api/src/routers/sources.ts` | `captureProofPage`, `proofPageCapture`, `suggestMarks`, `transferMarks` |

---

### Task 1: Tile cap and the `annotate` hook on the capture

**Files:**
- Modify: `packages/browser/src/screenshot-tiles.ts`
- Modify: `packages/browser/src/types.ts:108-114` (`CaptureOptions`), `:40-52` (`PageCapture`)
- Modify: `packages/browser/src/playwright-browser.ts:227-242`
- Test: `packages/browser/src/screenshot-tiles.test.ts`, `packages/browser/src/capture-annotate.test.ts` (new)

**Interfaces:**
- Produces: `computeTileClips(pageHeight: number, maxTiles = MAX_TILES): TileClip[]`; `CaptureOptions.annotate?: string` (a self-invoking expression evaluated once in the live page after the popup and expand rounds, before the screenshot; its value is `PageCapture.annotation`); `CaptureOptions.maxTiles?: number`; `PageCapture.annotation?: unknown`.

- [ ] **Step 1: Failing test for the tile cap**

Append to `packages/browser/src/screenshot-tiles.test.ts`:

```ts
it('takes a caller-chosen tile cap', () => {
  expect(computeTileClips(TILE_HEIGHT * 10, 6)).toHaveLength(6);
  expect(computeTileClips(TILE_HEIGHT * 2, 6)).toHaveLength(2);
  expect(computeTileClips(TILE_HEIGHT * 10)).toHaveLength(MAX_TILES);
});
```

- [ ] **Step 2: Run it, expect failure**

Run: `pnpm --filter @robot/browser test -- --maxWorkers=1 screenshot-tiles`
Expected: FAIL — `computeTileClips` ignores its second argument (10 tiles capped to 3, got 3 not 6).

- [ ] **Step 3: Implement**

In `screenshot-tiles.ts`:

```ts
/** Slice a page of the given pixel height into legible, non-overlapping vertical tiles. `maxTiles` lets a proof-page capture go deeper than the AI-cost cap. */
export function computeTileClips(pageHeight: number, maxTiles: number = MAX_TILES): TileClip[] {
  const h = Math.max(1, Math.floor(pageHeight) || 1);
  const clips: TileClip[] = [];
  for (let i = 0; i < maxTiles; i++) {
```

In `types.ts`, `CaptureOptions`:

```ts
  /**
   * A self-invoking expression evaluated once in the live page after the popup
   * and "show more" rounds, right before the screenshot, so what it sees is
   * what the screenshot shows. Its value is `PageCapture.annotation`. A throw
   * leaves `annotation` undefined; it never fails the capture.
   */
  annotate?: string;
  /** How many screenshot tiles to take (default `MAX_TILES`). */
  maxTiles?: number;
```

In `PageCapture`:

```ts
  /** The `annotate` script's value, when one was given (box map for a proof page). */
  annotation?: unknown;
```

In `playwright-browser.ts`, after the `after-expand` ready block and before `pageHeight`:

```ts
      let annotation: unknown = undefined;
      if (options.annotate) {
        annotation = await page.evaluate(options.annotate).catch((err) => {
          console.warn(`[browser] annotate script failed on ${url}: ${(err as Error).message.split('\n')[0]}`);
          return undefined;
        });
      }

      const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      const clips = computeTileClips(pageHeight, options.maxTiles);
```

and in the returned object: `...(annotation !== undefined ? { annotation } : {}),`.

- [ ] **Step 4: Failing browser test for `annotate`**

Create `packages/browser/src/capture-annotate.test.ts`:

```ts
// `annotate` runs once, after the expand rounds, and its value rides on the capture.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PlaywrightBrowser } from './playwright-browser.js';

let server: http.Server;
let baseUrl: string;
let browser: PlaywrightBrowser;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body><main id="main"><h1>Widget</h1><span id="price">$12.50</span></main></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('PlaywrightBrowser.capture with annotate', () => {
  it('returns the script value as annotation', async () => {
    const c = await browser.capture(`${baseUrl}/p/1`, {
      waitUntil: 'load', interceptNetworkRequests: false,
      annotate: `(() => ({ price: document.getElementById('price').textContent }))()`,
    });
    expect(c.annotation).toEqual({ price: '$12.50' });
  });
  it('a throwing script leaves annotation undefined and the capture intact', async () => {
    const c = await browser.capture(`${baseUrl}/p/1`, { waitUntil: 'load', interceptNetworkRequests: false, annotate: `(() => { throw new Error('boom'); })()` });
    expect(c.annotation).toBeUndefined();
    expect(c.html).toContain('Widget');
  });
  it('without annotate there is no annotation key', async () => {
    const c = await browser.capture(`${baseUrl}/p/1`, { waitUntil: 'load', interceptNetworkRequests: false });
    expect('annotation' in c).toBe(false);
  });
});
```

- [ ] **Step 5: Run both test files, expect pass**

Run: `pnpm --filter @robot/browser test -- --maxWorkers=1 screenshot-tiles capture-annotate`
Expected: PASS (the annotate tests fail before Step 3's playwright change is in; if you wrote Step 4 first, expect `annotation` undefined there).

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @robot/browser typecheck`
```bash
git add packages/browser/src/screenshot-tiles.ts packages/browser/src/screenshot-tiles.test.ts packages/browser/src/types.ts packages/browser/src/playwright-browser.ts packages/browser/src/capture-annotate.test.ts
git commit -m "feat(browser): capture takes an annotate script and a tile cap" -- packages/browser/src/screenshot-tiles.ts packages/browser/src/screenshot-tiles.test.ts packages/browser/src/types.ts packages/browser/src/playwright-browser.ts packages/browser/src/capture-annotate.test.ts
```

---

### Task 2: The box-map script

**Files:**
- Modify: `packages/scraper/src/verify/dom-scripts.ts:122` (export `browserXPaths`)
- Create: `packages/scraper/src/verify/box-map.ts`
- Test: `packages/scraper/src/verify/box-map.test.ts` (real Chromium via `setContentEvaluate`)

**Interfaces:**
- Consumes: `browserXPaths`, `looksVolatile`, `PAGE_SCRIPT_PRELUDE` from `dom-scripts.ts`; `buildXPathProbeScript` for the round trip in the test.
- Produces:
  ```ts
  export type Box = {
    xpaths: string[];            // nearest anchor first, as the DOM search produces them
    text: string;                // the element's OWN text, whitespace-collapsed, ≤ 500 chars; '' for image/link with no text
    rect: { x: number; y: number; w: number; h: number }; // page pixels, absolute
    tag: string;
    kind: 'text' | 'image' | 'link';
    src?: string;                // images: resolved absolute URL
    href?: string;               // links: resolved absolute URL
  };
  export const BOX_MAP_LIMIT = 3000;
  export function buildBoxMapScript(): string;
  /** Narrow a capture's `annotation` to a box map; [] when it is not one. */
  export function boxesFromAnnotation(annotation: unknown): Box[];
  ```

- [ ] **Step 1: Export the XPath generator**

In `dom-scripts.ts` change `function browserXPaths(el: Element): string[]` to `export function browserXPaths(el: Element): string[]`. Its doc comment already says it runs inside the page; add one line: `Exported for box-map.ts, which stringifies it the same way.`

- [ ] **Step 2: Write the failing test**

Create `packages/scraper/src/verify/box-map.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { buildBoxMapScript, boxesFromAnnotation, type Box } from './box-map.js';
import { buildXPathProbeScript, type XPathProbeResult } from './dom-scripts.js';

const HTML = `<html><body>
<div id="main">
  <h1 class="title">Widget A</h1>
  <div class="price-box"><span class="was">$149.00</span><span class="now">$129.99</span></div>
  <p class="stock">In <b>stock</b></p>
  <img class="hero" src="/img/a.jpg" alt="hero">
  <a class="buy" href="/checkout?p=1">Buy</a>
  <span class="hidden" style="display:none">secret</span>
  <script>var x = 'not text';</script>
</div>
</body></html>`;

let browser: PlaywrightBrowser;
beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

async function boxMap(html: string): Promise<Box[]> {
  return boxesFromAnnotation(await browser.setContentEvaluate<unknown>(html, buildBoxMapScript()));
}

describe('buildBoxMapScript', () => {
  it('records every visible element with its own text, plus images and links', async () => {
    const boxes = await boxMap(HTML);
    const byText = Object.fromEntries(boxes.map((b) => [b.text, b]));
    expect(byText['Widget A']).toMatchObject({ tag: 'h1', kind: 'text' });
    expect(byText['Widget A']!.xpaths[0]).toBe('//*[@id="main"]/h1[@class="title"]');            // nearest anchor first
    expect(byText['Widget A']!.xpaths.at(-1)).toMatch(/^\/\/body\//);                             // body-rooted last
    expect(byText['$129.99']!.xpaths[0]).toBe('//*[@id="main"]/div[@class="price-box"]/span[@class="now"]');
    // Own text only: the <p> holds "In", the <b> holds "stock".
    expect(byText['In']).toMatchObject({ tag: 'p' });
    expect(byText['stock']).toMatchObject({ tag: 'b' });
    expect(boxes.find((b) => b.kind === 'image')).toMatchObject({ tag: 'img', src: expect.stringMatching(/\/img\/a\.jpg$/) });
    expect(boxes.find((b) => b.kind === 'link')).toMatchObject({ tag: 'a', text: 'Buy', href: expect.stringMatching(/\/checkout\?p=1$/) });
    expect(boxes.some((b) => b.text === 'secret')).toBe(false);
    expect(boxes.some((b) => b.text.includes('not text'))).toBe(false);
  });

  it('rects are positive page-pixel boxes', async () => {
    const boxes = await boxMap(HTML);
    for (const b of boxes) {
      expect(b.rect.w).toBeGreaterThan(0);
      expect(b.rect.h).toBeGreaterThan(0);
      expect(b.rect.x).toBeGreaterThanOrEqual(0);
      expect(b.rect.y).toBeGreaterThanOrEqual(0);
    }
    const title = boxes.find((b) => b.text === 'Widget A')!;
    const price = boxes.find((b) => b.text === '$129.99')!;
    expect(price.rect.y).toBeGreaterThan(title.rect.y); // document order top to bottom
  });

  it('every xpath resolves back to an element with the same text', async () => {
    const boxes = await boxMap(HTML);
    const textBoxes = boxes.filter((b) => b.kind === 'text');
    const probe = await browser.setContentEvaluate<XPathProbeResult>(HTML, buildXPathProbeScript(textBoxes.flatMap((b) => b.xpaths)));
    for (const b of textBoxes) for (const xp of b.xpaths) expect(probe[xp]).toContain(b.text);
  });

  it('boxesFromAnnotation rejects anything that is not a box map', () => {
    expect(boxesFromAnnotation(undefined)).toEqual([]);
    expect(boxesFromAnnotation({ price: 1 })).toEqual([]);
    expect(boxesFromAnnotation([{ nope: true }])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run, expect failure**

Run: `pnpm --filter @robot/scraper test -- --maxWorkers=1 box-map`
Expected: FAIL — cannot resolve `./box-map.js`.

- [ ] **Step 4: Implement `box-map.ts`**

```ts
// packages/scraper/src/verify/box-map.ts
// The box map: every visible element a customer could click on a proof-page
// screenshot, with the XPaths the DOM search would give it. Built inside the
// page (annotate hook, after the expand rounds, before the screenshot) so the
// rects line up with the tiles.
import { PAGE_SCRIPT_PRELUDE, browserXPaths, looksVolatile } from './dom-scripts.js';

export type Box = {
  xpaths: string[];
  text: string;
  rect: { x: number; y: number; w: number; h: number };
  tag: string;
  kind: 'text' | 'image' | 'link';
  src?: string;
  href?: string;
};

/** Enough for a long product page; past this the map is cut in document order, as the tiles are. */
export const BOX_MAP_LIMIT = 3000;
const TEXT_LIMIT = 500;

/** Runs INSIDE the page. Dependency-free: it is stringified into the script. */
function browserBoxes(xpathsOf: (el: Element) => string[], limit: number, textLimit: number) {
  const out: Array<Record<string, unknown>> = [];
  const sx = window.scrollX, sy = window.scrollY;
  const ownText = (el: Element): string => {
    let t = '';
    for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) t += n.textContent ?? '';
    return t.replace(/\s+/g, ' ').trim().slice(0, textLimit);
  };
  const all = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of Array.from(all)) {
    if (out.length >= limit) break;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') continue;
    const kind = tag === 'img' ? 'image' : tag === 'a' ? 'link' : 'text';
    const text = ownText(el);
    if (kind === 'text' && text === '') continue;
    const cs = window.getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const box: Record<string, unknown> = {
      xpaths: xpathsOf(el), text, tag, kind,
      rect: { x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height) },
    };
    if (kind === 'image') { const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src; if (!src) continue; box.src = src; }
    if (kind === 'link') { const href = (el as HTMLAnchorElement).href; if (href) box.href = href; }
    out.push(box);
  }
  return out;
}

export function buildBoxMapScript(): string {
  return `(() => {
    ${PAGE_SCRIPT_PRELUDE}
    const looksVolatile = ${looksVolatile.toString()};
    const xpathsOf = ${browserXPaths.toString()};
    const boxes = ${browserBoxes.toString()};
    return boxes(xpathsOf, ${BOX_MAP_LIMIT}, ${TEXT_LIMIT});
  })()`;
}

function isBox(v: unknown): v is Box {
  if (!v || typeof v !== 'object') return false;
  const b = v as Partial<Box>;
  return Array.isArray(b.xpaths) && typeof b.text === 'string' && typeof b.tag === 'string'
    && (b.kind === 'text' || b.kind === 'image' || b.kind === 'link')
    && !!b.rect && typeof b.rect.x === 'number' && typeof b.rect.y === 'number' && typeof b.rect.w === 'number' && typeof b.rect.h === 'number';
}

/** Narrow a capture's `annotation` to a box map; [] when it is not one. */
export function boxesFromAnnotation(annotation: unknown): Box[] {
  return Array.isArray(annotation) && annotation.every(isBox) ? annotation : [];
}
```

`browserXPaths` refers to `looksVolatile` by name, which is why the script defines `looksVolatile` before it, exactly as `buildDomSearchScript` does. Images with `display:none` are skipped by the computed-style check; a lazy image with no `src` yet is skipped by the `!src` check.

- [ ] **Step 5: Run, expect pass**

Run: `pnpm --filter @robot/scraper test -- --maxWorkers=1 box-map dom-scripts`
Expected: PASS for both files (dom-scripts still green after the export).

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/src/verify/dom-scripts.ts packages/scraper/src/verify/box-map.ts packages/scraper/src/verify/box-map.test.ts
git commit -m "feat(scraper): box map of a page's clickable elements with their XPaths" -- packages/scraper/src/verify/dom-scripts.ts packages/scraper/src/verify/box-map.ts packages/scraper/src/verify/box-map.test.ts
```

---

### Task 3: Proof-page ready check and `captureProofPage`

**Files:**
- Create: `packages/scraper/src/verify/proof-page-ready.ts`, `packages/scraper/src/verify/capture-check.ts`, `packages/scraper/src/verify/proof-page-capture.ts`
- Modify: `packages/scraper/src/verify/run-verification.ts:94-116` (use `captureProblem`), `packages/scraper/src/verify/constants.ts`, `packages/scraper/src/verify/index.ts`
- Test: `packages/scraper/src/verify/proof-page-ready.test.ts`, `packages/scraper/src/verify/capture-check.test.ts`, `packages/scraper/src/verify/proof-page-capture.test.ts`

**Interfaces:**
- Consumes: `ReadyCheck`, `ReadySnapshot`, `IBrowser`, `PageCapture`, `checkPageHealth` from `@robot/browser`; `buildBoxMapScript`, `boxesFromAnnotation`, `Box`.
- Produces:
  ```ts
  export const PROOF_PAGE_MAX_TILES = 6;                       // constants.ts
  export function buildProofPageReadyCheck(pageUrl: string): ReadyCheck;
  /** null when the capture is the requested page and usable; else the reason (redirect, block page). */
  export function captureProblem(capture: Pick<PageCapture, 'url' | 'html' | 'title'>, requestedUrl: string): string | null;
  export type ProofPageCapture = { capture: PageCapture; boxes: Box[] };
  export async function captureProofPage(browser: IBrowser, url: string): Promise<ProofPageCapture>; // throws Error(captureProblem) on a bad page
  ```

- [ ] **Step 1: Failing test for the ready check (pure)**

Create `packages/scraper/src/verify/proof-page-ready.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ReadySnapshot } from '@robot/browser';
import { buildProofPageReadyCheck } from './proof-page-ready.js';

const empty = { ldJson: [], nextData: null, initialState: null, meta: {} };
const snap = (textLength: number, opts: Partial<ReadySnapshot> = {}): ReadySnapshot => ({
  probe: { textLength }, structuredData: empty, interceptedRequests: [], ...opts,
});
const jsonResponse = { url: 'https://s/api', method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, responseBody: '{}', contentType: 'application/json', bodySize: 2, isJson: true, parsedJson: {}, timestamp: 0 };

describe('buildProofPageReadyCheck', () => {
  it('is not ready on the first poll, nor while the text keeps growing', () => {
    const r = buildProofPageReadyCheck('https://s/p/1');
    expect(r.isReady(snap(100, { structuredData: { ...empty, ldJson: [{ '@type': 'Product' }] } }))).toBe(false);
    expect(r.isReady(snap(200, { structuredData: { ...empty, ldJson: [{ '@type': 'Product' }] } }))).toBe(false);
  });
  it('is ready once the text is unchanged between polls and a structured source has landed', () => {
    const r = buildProofPageReadyCheck('https://s/p/1');
    r.isReady(snap(200));
    expect(r.isReady(snap(200))).toBe(false);                                  // stable text, no structured source yet
    expect(r.isReady(snap(200, { interceptedRequests: [jsonResponse] }))).toBe(true);
  });
  it('a meta description counts as a structured source', () => {
    const r = buildProofPageReadyCheck('https://s/p/1');
    r.isReady(snap(50));
    expect(r.isReady(snap(50, { structuredData: { ...empty, meta: { description: 'x' } } }))).toBe(true);
  });
  it('a structured source seen once stays seen', () => {
    const r = buildProofPageReadyCheck('https://s/p/1');
    r.isReady(snap(50, { interceptedRequests: [jsonResponse] }));
    expect(r.isReady(snap(50))).toBe(true);
  });
  it('polls after the expand rounds and takes the verification grace', () => {
    const r = buildProofPageReadyCheck('https://s/p/1');
    expect(r.when).toBe('after-expand');
    expect(r.graceQuietMs).toBe(750);
    expect(r.script).toContain('innerText');
  });
});
```

- [ ] **Step 2: Run, expect failure** — `pnpm --filter @robot/scraper test -- --maxWorkers=1 proof-page-ready` → cannot resolve module.

- [ ] **Step 3: Implement `proof-page-ready.ts`**

```ts
// packages/scraper/src/verify/proof-page-ready.ts
// A proof page captured for MARKING has no expected values to wait for
// (verification-ready.ts waits for those). What it can wait for: the page's
// text to stop growing between two polls, and one structured source (JSON-LD,
// a meta description, or a JSON response) to have landed, since the
// pre-highlights come from those. Bounded by the capture's own 8 s poll
// deadline and settle wait, like every ready check.
import type { ReadyCheck, ReadySnapshot } from '@robot/browser';
import { PAGE_SCRIPT_PRELUDE } from './dom-scripts.js';
import { VERIFY_GRACE_MAX_MS, VERIFY_GRACE_QUIET_MS } from './verification-ready.js';

const TEXT_LENGTH_PROBE = `(() => { ${PAGE_SCRIPT_PRELUDE} return { textLength: (document.body ? document.body.innerText : '').length }; })()`;

export function buildProofPageReadyCheck(_pageUrl: string): ReadyCheck {
  let lastLength = -1;
  let structuredSeen = false;
  return {
    script: TEXT_LENGTH_PROBE,
    when: 'after-expand',
    graceQuietMs: VERIFY_GRACE_QUIET_MS,
    graceMaxMs: VERIFY_GRACE_MAX_MS,
    isReady: (s: ReadySnapshot) => {
      const len = typeof (s.probe as { textLength?: unknown } | null)?.textLength === 'number' ? (s.probe as { textLength: number }).textLength : -1;
      const stable = len >= 0 && len === lastLength;
      lastLength = len;
      if (!structuredSeen) {
        structuredSeen = s.structuredData.ldJson.length > 0
          || typeof s.structuredData.meta['description'] === 'string'
          || typeof s.structuredData.meta['og:title'] === 'string'
          || s.interceptedRequests.some((r) => r.isJson && r.parsedJson !== null);
      }
      return stable && structuredSeen;
    },
  };
}
```

- [ ] **Step 4: Run, expect pass** — same command.

- [ ] **Step 5: Failing test for `captureProblem`**

Create `packages/scraper/src/verify/capture-check.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { captureProblem } from './capture-check.js';

const ok = { url: 'https://shop.example/p/1?utm=x', html: '<html><body><h1>Widget</h1><p>' + 'a lovely product '.repeat(80) + '</p></body></html>', title: 'Widget' };

describe('captureProblem', () => {
  it('is null for the requested page (query and trailing slash ignored)', () => {
    expect(captureProblem(ok, 'https://shop.example/p/1/')).toBeNull();
  });
  it('names a redirect to another path', () => {
    expect(captureProblem({ ...ok, url: 'https://shop.example/category' }, 'https://shop.example/p/1')).toBe('redirected to https://shop.example/category');
  });
  it('names an unusable page', () => {
    const blocked = { ...ok, html: '<html><body>Access denied</body></html>', title: 'Access Denied' };
    expect(captureProblem(blocked, 'https://shop.example/p/1')).toMatch(/./);
  });
});
```

If `checkPageHealth` does not flag that exact block page, look at `packages/browser/src/page-health.ts` for a phrase it does flag and use it; the assertion is only that a reason string comes back.

- [ ] **Step 6: Implement `capture-check.ts` and use it in `run-verification.ts`**

```ts
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
  // Spec §4.1: a capture that landed on a different path (category page, block page) is not this product page.
  if (!samePath(capture.url, requestedUrl)) return `redirected to ${capture.url}`;
  // A block page, CAPTCHA interstitial or soft 404 served AT the requested path.
  const health = checkPageHealth(capture.html, capture.title, requestedUrl);
  return health.healthy ? null : health.reason ?? 'page is not usable';
}
```

In `run-verification.ts`: delete the local `samePath`, import `captureProblem` from `./capture-check.js`, and replace lines 94–117 with:

```ts
      const problem = captureProblem(c, url);
      if (problem) { captures[url] = null; captureErrors[url] = problem; continue; }
      captures[url] = c;
```

Keep the two explanatory comments (spec §4.1 and I4) by moving them onto `captureProblem`. Drop the now-unused `checkPageHealth` import.

- [ ] **Step 7: Run** — `pnpm --filter @robot/scraper test -- --maxWorkers=1 capture-check run-verification` → PASS.

- [ ] **Step 8: Failing test for `captureProofPage`**

Create `packages/scraper/src/verify/proof-page-capture.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { IBrowser, PageCapture, CaptureOptions } from '@robot/browser';
import { captureProofPage } from './proof-page-capture.js';
import { PROOF_PAGE_MAX_TILES } from './constants.js';
import { loadVerifyFixture } from '../__fixtures__/verify/load.js';

const box = { xpaths: ['//*[@id="main"]/h1'], text: 'Widget A', rect: { x: 0, y: 0, w: 10, h: 10 }, tag: 'h1', kind: 'text' as const };

function fakeBrowser(capture: PageCapture): IBrowser & { options: CaptureOptions[] } {
  const options: CaptureOptions[] = [];
  return {
    options,
    launch: async () => {}, close: async () => {},
    capture: async (_url, o = {}) => { options.push(o); return capture; },
    evaluate: async () => { throw new Error('unused'); },
    setContentEvaluate: async () => { throw new Error('unused'); },
    crawl: async function* () {}, scrollPages: async function* () {},
  } as unknown as IBrowser & { options: CaptureOptions[] };
}

describe('captureProofPage', () => {
  it('captures with load + the proof-page ready check + the box-map annotate + six tiles, and returns the boxes', async () => {
    const c = { ...loadVerifyFixture('shop-example', 'p1'), title: 'Widget A', annotation: [box] };
    const b = fakeBrowser(c);
    const r = await captureProofPage(b, 'https://shop.example/p/1');
    expect(r.boxes).toEqual([box]);
    expect(r.capture).toBe(c);
    const o = b.options[0]!;
    expect(o.waitUntil).toBe('load');
    expect(o.interceptNetworkRequests).toBe(true);
    expect(o.maxTiles).toBe(PROOF_PAGE_MAX_TILES);
    expect(o.ready?.when).toBe('after-expand');
    expect(o.annotate).toContain('getBoundingClientRect');
  });
  it('throws the capture problem for a redirect', async () => {
    const c = { ...loadVerifyFixture('shop-example', 'p1'), url: 'https://shop.example/category', title: 'Cat' };
    await expect(captureProofPage(fakeBrowser(c), 'https://shop.example/p/1')).rejects.toThrow('redirected to https://shop.example/category');
  });
  it('an annotation that is not a box map yields no boxes rather than an error', async () => {
    const c = { ...loadVerifyFixture('shop-example', 'p1'), title: 'Widget A', annotation: { nope: 1 } };
    const r = await captureProofPage(fakeBrowser(c), 'https://shop.example/p/1');
    expect(r.boxes).toEqual([]);
  });
});
```

- [ ] **Step 9: Implement**

`constants.ts`: add `export const PROOF_PAGE_MAX_TILES = 6; // 9,216 px: a product page's specs and reviews usually sit below the AI-cost cap of three`.

```ts
// packages/scraper/src/verify/proof-page-capture.ts
// One proof page, captured for marking: `load` plus the proof-page ready
// check, the box map as the annotate script, six tiles. Refuses a redirect or
// a block page with the same reason verification would give.
import type { IBrowser, PageCapture } from '@robot/browser';
import { PROOF_PAGE_MAX_TILES } from './constants.js';
import { buildBoxMapScript, boxesFromAnnotation, type Box } from './box-map.js';
import { buildProofPageReadyCheck } from './proof-page-ready.js';
import { captureProblem } from './capture-check.js';

export type ProofPageCapture = { capture: PageCapture; boxes: Box[] };

export async function captureProofPage(browser: IBrowser, url: string): Promise<ProofPageCapture> {
  const capture = await browser.capture(url, {
    waitUntil: 'load',
    interceptNetworkRequests: true,
    ready: buildProofPageReadyCheck(url),
    annotate: buildBoxMapScript(),
    maxTiles: PROOF_PAGE_MAX_TILES,
  });
  const problem = captureProblem(capture, url);
  if (problem) throw new Error(problem);
  return { capture, boxes: boxesFromAnnotation(capture.annotation) };
}
```

`index.ts`: add `export * from './box-map.js';`, `export * from './proof-page-ready.js';`, `export * from './capture-check.js';`, `export * from './proof-page-capture.js';`.

- [ ] **Step 10: Run the verify folder, typecheck, commit**

Run: `pnpm --filter @robot/scraper test -- --maxWorkers=1 src/verify` and `pnpm --filter @robot/scraper typecheck`
Expected: PASS.

```bash
git add packages/scraper/src/verify/proof-page-ready.ts packages/scraper/src/verify/proof-page-ready.test.ts packages/scraper/src/verify/capture-check.ts packages/scraper/src/verify/capture-check.test.ts packages/scraper/src/verify/proof-page-capture.ts packages/scraper/src/verify/proof-page-capture.test.ts packages/scraper/src/verify/run-verification.ts packages/scraper/src/verify/constants.ts packages/scraper/src/verify/index.ts
git commit -m "feat(scraper): a proof page captured for marking waits for stable text and one structured source" -- packages/scraper/src/verify/proof-page-ready.ts packages/scraper/src/verify/proof-page-ready.test.ts packages/scraper/src/verify/capture-check.ts packages/scraper/src/verify/capture-check.test.ts packages/scraper/src/verify/proof-page-capture.ts packages/scraper/src/verify/proof-page-capture.test.ts packages/scraper/src/verify/run-verification.ts packages/scraper/src/verify/constants.ts packages/scraper/src/verify/index.ts
```

---

### Task 4: Marks in `VerificationSet`, hashes, and certification

**Files:**
- Modify: `packages/scraper/src/verify/types.ts:12-16`
- Modify: `packages/scraper/src/verify/run-verification.ts:42-69` (hashes), `:148` (`gatherCandidates` call)
- Modify: `packages/scraper/src/verify/certify.ts:34-53` (`gatherCandidates`)
- Test: `packages/scraper/src/verify/marks.test.ts` (new), `packages/scraper/src/verify/certify.test.ts` (one case added)

**Interfaces:**
- Produces:
  ```ts
  export type Mark = { xpaths: string[]; text: string; rect: { x: number; y: number; w: number; h: number } };
  export type VerificationSet = { urls: string[]; expected: Record<string, Record<string, string>>; listing_url?: string;
    /** fieldKey → url → the element the customer clicked (spec 2026-09-18 §3.5). Absent on sets written before marks existed. */
    marks?: Record<string, Record<string, Mark>> };
  gatherCandidates(field, expected, captures, deps: { runDomSearch; marks?: Record<string, Mark> })
  ```

- [ ] **Step 1: Failing tests**

Create `packages/scraper/src/verify/marks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { definitionHash, fieldHash } from './run-verification.js';
import { gatherCandidates } from './certify.js';
import { loadShopExample, SHOP_EXAMPLE_URLS as U } from '../__fixtures__/verify/load.js';
import type { SchemaDefinitionField, VerificationSet, Mark } from './types.js';

const price: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: 'the price', concept: 'price' };
const expected = { [U[0]!]: '129.99', [U[1]!]: '219.99', [U[2]!]: '149.00' };
const base: VerificationSet = { urls: U, expected: { price: expected } };
const mark: Mark = { xpaths: ['//*[@id="main"]/div[@class="price-box"]/span[@class="now"]'], text: '$129.99', rect: { x: 1, y: 2, w: 3, h: 4 } };

describe('hashes with marks', () => {
  it('a set without marks hashes exactly as before marks existed', () => {
    expect(fieldHash(price, base)).toBe(fieldHash(price, { ...base, marks: {} }));
    expect(definitionHash([price], base)).toBe(definitionHash([price], { ...base, marks: {} }));
  });
  it('a mark changes the field hash; moving its rect does not', () => {
    const withMark = { ...base, marks: { price: { [U[0]!]: mark } } };
    expect(fieldHash(price, withMark)).not.toBe(fieldHash(price, base));
    const moved = { ...base, marks: { price: { [U[0]!]: { ...mark, rect: { x: 9, y: 9, w: 9, h: 9 } } } } };
    expect(fieldHash(price, moved)).toBe(fieldHash(price, withMark));
    const otherPath = { ...base, marks: { price: { [U[0]!]: { ...mark, xpaths: ['//body/span'] } } } };
    expect(fieldHash(price, otherPath)).not.toBe(fieldHash(price, withMark));
  });
  it('a mark on another field leaves this field alone', () => {
    const other = { ...base, marks: { title: { [U[0]!]: mark } } };
    expect(fieldHash(price, other)).toBe(fieldHash(price, base));
  });
});

describe('gatherCandidates with marks', () => {
  it('a marked page contributes the mark and skips the DOM search; unmarked pages are searched', async () => {
    const searched: string[] = [];
    const runDomSearch = async (_html: string, _n: unknown, pageUrl: string) => { searched.push(pageUrl); return []; };
    const { candidates } = await gatherCandidates(price, expected, loadShopExample(), { runDomSearch, marks: { [U[0]!]: mark } });
    expect(searched).toEqual([U[1], U[2]]);
    expect(candidates).toContainEqual({ source: 'xpath', path: mark.xpaths[0], transform: 'identity' });
    expect(candidates.some((c) => c.source === 'json-ld' && c.path === 'offers.price')).toBe(true); // structured search still runs on the marked page
  });
});
```

- [ ] **Step 2: Run, expect failure** — `pnpm --filter @robot/scraper test -- --maxWorkers=1 marks` → type errors / `marks` ignored (hash equality where inequality expected).

- [ ] **Step 3: Implement**

`types.ts`:

```ts
export type Mark = { xpaths: string[]; text: string; rect: { x: number; y: number; w: number; h: number } };

export type VerificationSet = {
  urls: string[];                                   // VERIFY_URL_MIN to VERIFY_URL_MAX proof pages
  expected: Record<string, Record<string, string>>; // fieldKey → url → as typed
  listing_url?: string;
  /** fieldKey → url → the element the customer clicked for that cell (spec 2026-09-18 §3.5). Absent on sets written before marks existed. */
  marks?: Record<string, Record<string, Mark>>;
};
```

`run-verification.ts`, a helper above the hashes:

```ts
/** The hash-relevant part of a field's marks on the given pages: paths and text, never the rect (an element that moved but kept its path is the same mark). Undefined when there are none, so a set without marks hashes byte-for-byte as before. */
function markDigest(marks: Record<string, Mark> | undefined, pages: string[]): Record<string, { xpaths: string[]; text: string }> | undefined {
  if (!marks) return undefined;
  const entries = pages.filter((u) => marks[u]).map((u) => [u, { xpaths: marks[u]!.xpaths, text: marks[u]!.text }] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}
```

In `fieldHash`, the object gains `...(markDigest(set.marks?.[field.key], pages) ? { marks: markDigest(set.marks?.[field.key], pages) } : {})`. In `definitionHash`, add `...(set.marks && Object.keys(set.marks).length ? { marks: Object.fromEntries(Object.keys(set.marks).sort().map((k) => [k, markDigest(set.marks![k], set.urls)])) } : {})`. Import `Mark` from `./types.js`. Pass the field's marks at the `gatherCandidates` call: `{ runDomSearch, marks: req.verificationSet.marks?.[field.key] }`.

`certify.ts`, `gatherCandidates`:

```ts
export async function gatherCandidates(
  field: SchemaDefinitionField,
  expected: Record<string, string>,
  captures: Record<string, CaptureLike | null>,
  deps: { runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => Promise<DomHit[]>; marks?: Record<string, Mark> },
): Promise<{ candidates: CandidatePath[]; hitsByUrl: Record<string, number> }> {
  const candidates: CandidatePath[] = [];
  const hitsByUrl: Record<string, number> = {};
  for (const [url, capture] of Object.entries(captures)) {
    if (!capture) continue;
    const exp = expected[url] ?? '';
    if (exp.trim() === '') continue; // not checked here: nothing to search for
    const structured = searchStructured(capture, field.type, exp);
    candidates.push(...structured.map((s) => ({ source: s.source, path: s.path, transform: s.transform })));
    const mark = deps.marks?.[url];
    if (mark) {
      // The customer said which element it is: the mark's XPaths stand in for the DOM search's hits on
      // this page, which is what settles `ambiguous` (spec 2026-09-18 §3.5). The mark still has to be
      // correct or empty on every other checked page, like any candidate.
      hitsByUrl[url] = structured.length + mark.xpaths.length;
      candidates.push(...mark.xpaths.map((xp) => ({ source: 'xpath' as const, path: xp, transform: 'identity' as const })));
      continue;
    }
    const dom = await deps.runDomSearch(capture.html, [{ key: field.key, type: field.type, expected: exp }], capture.url);
    hitsByUrl[url] = structured.length + dom.length;
    candidates.push(...dom.map((h) => ({ source: 'xpath' as const, path: h.xpath, transform: 'identity' as const })));
  }
  return { candidates: dedupe(candidates), hitsByUrl };
}
```

Import `Mark` from `./types.js`.

- [ ] **Step 4: One certify case: a mark settles ambiguity**

Append to `packages/scraper/src/verify/certify.test.ts` (using that file's existing fixtures; adapt names to what is there):

```ts
describe('marks', () => {
  it('a mark whose xpath is correct on every page certifies; its other-page evaluation is the ordinary one', async () => {
    const caps = loadShopExample();
    const field: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: 'd', concept: 'price' };
    const exp = { [U[0]!]: '129.99', [U[1]!]: '219.99', [U[2]!]: '149.00' };
    const xp = '//*[@id="main"]/div[@class="price-box"]/span[@class="now"]';
    const evalXPaths = async (html: string, xps: string[]) => Object.fromEntries(xps.map((x) => [x, x === xp ? (html.match(/class="now">([^<]+)</)?.[1] ?? null) : null]));
    const r = await certify({ field, expected: exp, captures: caps, candidates: [{ source: 'xpath', path: xp, transform: 'identity' }] }, { evalXPaths });
    expect(r.certified).toContainEqual({ source: 'xpath', path: xp, transform: 'identity' });
    expect(Object.values(r.cells).every((c) => c.status === 'pass')).toBe(true);
  });
});
```

(`certify` itself does not change; this pins that a mark's candidate goes through the same door.)

- [ ] **Step 5: Run the verify folder** — `pnpm --filter @robot/scraper test -- --maxWorkers=1 src/verify` → PASS, including every pre-existing hash test.

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/src/verify/types.ts packages/scraper/src/verify/run-verification.ts packages/scraper/src/verify/certify.ts packages/scraper/src/verify/marks.test.ts packages/scraper/src/verify/certify.test.ts
git commit -m "feat(scraper): a mark is the customer's element for a cell; a marked page takes it instead of the DOM search" -- packages/scraper/src/verify/types.ts packages/scraper/src/verify/run-verification.ts packages/scraper/src/verify/certify.ts packages/scraper/src/verify/marks.test.ts packages/scraper/src/verify/certify.test.ts
```

---

### Task 5: `suggestMarks`

**Files:**
- Create: `packages/scraper/src/verify/suggest-marks.ts`
- Modify: `packages/scraper/src/verify/index.ts`
- Test: `packages/scraper/src/verify/suggest-marks.test.ts` (pure), one Chromium case appended to `box-map.test.ts`

**Interfaces:**
- Consumes: `CaptureLike`, `Box`, `normalize`, `valuesEqual`, `SchemaDefinitionField`, `getByDotPath` (via `resolveStructured`).
- Produces:
  ```ts
  export type Suggestion = {
    value: string;                                     // the raw value as found, for the row
    via: { source: 'api' | 'json-ld' | 'meta'; path: string };
    boxes: number[];                                   // indices into the box map that show this value; [] = "page data" only
  };
  export function suggestMarks(capture: CaptureLike, boxes: Box[], fields: SchemaDefinitionField[]): Record<string, Suggestion | null>;
  ```

- [ ] **Step 1: Failing pure test**

Create `packages/scraper/src/verify/suggest-marks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { suggestMarks } from './suggest-marks.js';
import { loadVerifyFixture } from '../__fixtures__/verify/load.js';
import type { Box } from './box-map.js';
import type { SchemaDefinitionField } from './types.js';

const f = (key: string, type: SchemaDefinitionField['type'], concept: string): SchemaDefinitionField => ({ key, name: key, type, description: '', concept });
const box = (text: string, i: number, extra: Partial<Box> = {}): Box => ({ xpaths: [`//b[${i}]`], text, rect: { x: 0, y: i * 10, w: 10, h: 10 }, tag: 'span', kind: 'text', ...extra });
const p1 = loadVerifyFixture('shop-example', 'p1');
const boxes: Box[] = [box('Widget A', 0), box('$129.99', 1), box('$159.99', 2), box('In stock', 3), box('', 4, { kind: 'image', tag: 'img', src: 'https://shop.example/img/a.jpg' }), box('$129.99', 5)];

describe('suggestMarks', () => {
  it('price: JSON-LD offers.price, shown in two places → both boxes', () => {
    const r = suggestMarks(p1, boxes, [f('price', 'money', 'price')]);
    expect(r.price).toEqual({ value: '129.99', via: { source: 'json-ld', path: 'offers.price' }, boxes: [1, 5] });
  });
  it('title: JSON-LD name, one box', () => {
    expect(suggestMarks(p1, boxes, [f('title', 'text', 'product_name')]).title).toEqual({ value: 'Widget A', via: { source: 'json-ld', path: 'name' }, boxes: [0] });
  });
  it('image: matched against src', () => {
    expect(suggestMarks(p1, boxes, [f('image', 'image', 'image_url')]).image).toMatchObject({ value: 'https://shop.example/img/a.jpg', boxes: [4] });
  });
  it('sku: only in the API body → value with no boxes ("page data")', () => {
    expect(suggestMarks(p1, boxes, [f('sku', 'text', 'sku')]).sku).toEqual({ value: 'SKU-A1', via: { source: 'api', path: 'item.code' }, boxes: [] });
  });
  it('a value the field type rejects is skipped; nothing found → null', () => {
    expect(suggestMarks(p1, boxes, [f('weight', 'number', 'weight')]).weight).toBeNull();
  });
  it('an API integer-cents price is not offered as the price when JSON-LD has one', () => {
    expect(suggestMarks(p1, boxes, [f('price', 'money', 'price')]).price!.value).toBe('129.99');
  });
  it('a field with an unknown concept falls back to its key as a path tail', () => {
    expect(suggestMarks(p1, boxes, [f('colors', 'text_list', 'colors')]).colors).toMatchObject({ via: { source: 'api', path: 'item.colors' } });
  });
});
```

- [ ] **Step 2: Run, expect failure** — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/scraper/src/verify/suggest-marks.ts
// Pre-highlights for the mark screen (spec 2026-09-18 §3.3), free and pure:
// the structured data a capture already carries, matched to the elements that
// show it. No model: the customer is one click away on a screen built for it.
import type { CaptureLike } from './certify.js';
import type { Box } from './box-map.js';
import { normalize, valuesEqual } from './normalize.js';
import type { SchemaDefinitionField } from './types.js';

export type Suggestion = {
  value: string;
  via: { source: 'api' | 'json-ld' | 'meta'; path: string };
  boxes: number[];
};

/** Path tails that carry a concept, by concept (deriveConcept's vocabulary). Matched against the end of a dotted path with array indices removed. */
const CONCEPT_PATHS: Record<string, string[]> = {
  product_name: ['name', 'og:title', 'title', 'productName', 'product_name', 'headline'],
  price: ['offers.price', 'price', 'product:price:amount', 'currentPrice', 'current_price', 'salePrice', 'sale_price'],
  description: ['description', 'og:description', 'productDescription', 'product_description'],
  image_url: ['image', 'og:image', 'image.url', 'thumbnailUrl', 'primary_image_url'],
  brand: ['brand.name', 'brand', 'manufacturer', 'brand_name'],
  sku: ['sku', 'productID', 'mpn', 'gtin', 'gtin13', 'code', 'item_id', 'product_id'],
  availability: ['offers.availability', 'availability', 'in_stock', 'is_available'],
  rating: ['aggregateRating.ratingValue', 'ratingValue', 'rating'],
  review_count: ['aggregateRating.reviewCount', 'reviewCount', 'review_count', 'ratingCount'],
  currency: ['offers.priceCurrency', 'priceCurrency', 'product:price:currency'],
};

/** JSON-LD is canonical, meta next, API bodies last: an API body is noisy (`priceCents: 12999` would be offered as the price). */
const SOURCE_ORDER: Array<Suggestion['via']['source']> = ['json-ld', 'meta', 'api'];
const MAX_DEPTH = 12;
const MAX_ARRAY_ITEMS = 25;

type Leaf = { source: Suggestion['via']['source']; path: string; raw: unknown };

function leaves(capture: CaptureLike): Leaf[] {
  const out: Leaf[] = [];
  const walk = (source: Leaf['source'], value: unknown, path: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(value)) { value.slice(0, MAX_ARRAY_ITEMS).forEach((v, i) => walk(source, v, `${path}[${i}]`, depth + 1)); if (path) out.push({ source, path, raw: value }); return; }
    if (value !== null && typeof value === 'object') { for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(source, v, path ? `${path}.${k}` : k, depth + 1); return; }
    if (path) out.push({ source, path, raw: value });
  };
  for (const b of capture.structuredData.ldJson) walk('json-ld', b, '', 0);
  for (const [k, v] of Object.entries(capture.structuredData.meta)) out.push({ source: 'meta', path: k, raw: v });
  for (const r of capture.interceptedRequests) if (r.isJson && r.parsedJson !== null) walk('api', r.parsedJson, '', 0);
  return out;
}

function tailMatches(path: string, tail: string): boolean {
  const p = path.replace(/\[\d+\]/g, '');
  return p === tail || p.endsWith(`.${tail}`);
}

function valueText(raw: unknown): string | null {
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (Array.isArray(raw)) { const parts = raw.map(valueText).filter((s): s is string => s !== null); return parts.length ? parts.join(', ') : null; }
  return null;
}

function boxValue(box: Box): string {
  return box.kind === 'image' ? box.src ?? '' : box.kind === 'link' ? box.href || box.text : box.text;
}

export function suggestMarks(capture: CaptureLike, boxes: Box[], fields: SchemaDefinitionField[]): Record<string, Suggestion | null> {
  const all = leaves(capture);
  const ctx = { pageUrl: capture.url };
  const out: Record<string, Suggestion | null> = {};
  for (const field of fields) {
    const tails = CONCEPT_PATHS[field.concept] ?? [field.key, field.concept];
    let found: Suggestion | null = null;
    for (const source of SOURCE_ORDER) {
      for (const tail of tails) {
        const leaf = all.find((l) => l.source === source && tailMatches(l.path, tail) && normalize(field.type, l.raw, ctx) !== null);
        if (!leaf) continue;
        const value = valueText(leaf.raw)!;
        const matching = boxes.map((b, i) => (valuesEqual(field.type, boxValue(b), value, ctx) ? i : -1)).filter((i) => i >= 0);
        found = { value, via: { source, path: leaf.path }, boxes: matching };
        break;
      }
      if (found) break;
    }
    out[field.key] = found;
  }
  return out;
}
```

`index.ts`: `export * from './suggest-marks.js';`.

- [ ] **Step 4: Run, expect pass**; if the `sku` case picks `item.code` only because `sku`'s tails include `code`, that is intended. If `valuesEqual` for `image` needs the box's `src` resolved against the page URL, it already does (`normalize('image', …, { pageUrl })`).

- [ ] **Step 5: Chromium case over the real box map**

Append to `box-map.test.ts`:

```ts
import { suggestMarks } from './suggest-marks.js';
import { loadVerifyFixture } from '../__fixtures__/verify/load.js';

describe('suggestMarks over a real box map', () => {
  it('finds the shop-example price and title elements on p1', async () => {
    const p1 = loadVerifyFixture('shop-example', 'p1');
    const boxes = await boxMap(p1.html);
    const r = suggestMarks(p1, boxes, [
      { key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' },
      { key: 'title', name: 'Title', type: 'text', description: '', concept: 'product_name' },
    ]);
    expect(r.price!.boxes.map((i) => boxes[i]!.text)).toEqual(['$129.99']);
    expect(r.title!.boxes.map((i) => boxes[i]!.text)).toEqual(['Widget A']);
    expect(boxes[r.price!.boxes[0]!]!.xpaths[0]).toBe('//*[@id="main"]/div[@class="price-box"]/span[@class="now"]');
  });
});
```

Run: `pnpm --filter @robot/scraper test -- --maxWorkers=1 suggest-marks box-map` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/scraper/src/verify/suggest-marks.ts packages/scraper/src/verify/suggest-marks.test.ts packages/scraper/src/verify/box-map.test.ts packages/scraper/src/verify/index.ts
git commit -m "feat(scraper): suggestMarks pre-highlights a field from the page's structured data" -- packages/scraper/src/verify/suggest-marks.ts packages/scraper/src/verify/suggest-marks.test.ts packages/scraper/src/verify/box-map.test.ts packages/scraper/src/verify/index.ts
```

---

### Task 6: `transferMarks`

**Files:**
- Create: `packages/scraper/src/verify/transfer-marks.ts`
- Modify: `packages/scraper/src/verify/index.ts`
- Test: `packages/scraper/src/verify/transfer-marks.test.ts` (real Chromium for the DOM search and XPath probe; no network)

**Interfaces:**
- Consumes: `gatherCandidates`, `rankCertified`, `isVolatilePath`, `resolveStructured`, `applyTransform`, `normalize`, `valuesEqual`, `Box`, `Mark`, `Suggestion`.
- Produces:
  ```ts
  export type TransferInput = {
    field: SchemaDefinitionField;
    from: { url: string; capture: CaptureLike; expected: string; mark?: Mark };
    to: Record<string, { capture: CaptureLike; boxes: Box[] }>;    // url → stored capture and its box map
  };
  export type TransferDeps = {
    evalXPaths: (html: string, xpaths: string[]) => Promise<XPathProbeResult>;
    runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => Promise<DomHit[]>;
  };
  /** url → what page 1's paths read there, or null when nothing resolved. `via.source` is any CertifiedSource here. */
  export type Transferred = { value: string; via: { source: CertifiedSource; path: string }; boxes: number[] };
  export async function transferMarks(input: TransferInput, deps: TransferDeps): Promise<Record<string, Transferred | null>>;
  ```

- [ ] **Step 1: Failing test**

```ts
// packages/scraper/src/verify/transfer-marks.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { transferMarks } from './transfer-marks.js';
import { buildBoxMapScript, boxesFromAnnotation, type Box } from './box-map.js';
import { buildDomSearchScript, buildXPathProbeScript, type DomHit, type DomNeedle, type XPathProbeResult } from './dom-scripts.js';
import { loadShopExample, loadVerifyFixture, SHOP_EXAMPLE_URLS as U, SHOP_EXAMPLE_P4 } from '../__fixtures__/verify/load.js';
import type { SchemaDefinitionField } from './types.js';

let browser: PlaywrightBrowser;
beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

const deps = {
  evalXPaths: (html: string, xps: string[]) => browser.setContentEvaluate<XPathProbeResult>(html, buildXPathProbeScript(xps)),
  runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => browser.setContentEvaluate<DomHit[]>(html, buildDomSearchScript(needles, pageUrl)),
};
const boxesOf = async (html: string): Promise<Box[]> => boxesFromAnnotation(await browser.setContentEvaluate<unknown>(html, buildBoxMapScript()));
const price: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' };
const title: SchemaDefinitionField = { key: 'title', name: 'Title', type: 'text', description: '', concept: 'product_name' };

describe('transferMarks', () => {
  it('carries page 1 price to pages 2 and 3 with the element that shows it', async () => {
    const caps = loadShopExample();
    const to = { [U[1]!]: { capture: caps[U[1]!]!, boxes: await boxesOf(caps[U[1]!]!.html) }, [U[2]!]: { capture: caps[U[2]!]!, boxes: await boxesOf(caps[U[2]!]!.html) } };
    const r = await transferMarks({ field: price, from: { url: U[0]!, capture: caps[U[0]!]!, expected: '129.99' }, to }, deps);
    expect(r[U[1]!]).toMatchObject({ value: expect.stringMatching(/219\.99/), boxes: [expect.any(Number)] });
    expect(to[U[1]!]!.boxes[r[U[1]!]!.boxes[0]!]!.text).toBe('$219.99');
    expect(r[U[2]!]!.value).toMatch(/149(\.00)?/);
  });
  it('prefers the customer\'s mark when page 1 has one', async () => {
    const caps = loadShopExample();
    const mark = { xpaths: ['//*[@id="main"]/div[@class="price-box"]/span[@class="now"]'], text: '$129.99', rect: { x: 0, y: 0, w: 1, h: 1 } };
    const to = { [U[1]!]: { capture: caps[U[1]!]!, boxes: await boxesOf(caps[U[1]!]!.html) } };
    const r = await transferMarks({ field: price, from: { url: U[0]!, capture: caps[U[0]!]!, expected: '129.99', mark }, to }, deps);
    expect(r[U[1]!]!.value).toMatch(/219\.99/);
  });
  it('a page where nothing resolves is null', async () => {
    const caps = loadShopExample();
    const p4 = loadVerifyFixture('shop-example', 'p4');
    const to = { [SHOP_EXAMPLE_P4]: { capture: p4, boxes: await boxesOf(p4.html) } };
    // p4 is the clearance template: the price is not where p1 keeps it, and p4 carries no offers.price (see the fixture).
    const r = await transferMarks({ field: price, from: { url: U[0]!, capture: caps[U[0]!]!, expected: '129.99' }, to }, deps);
    expect(r[SHOP_EXAMPLE_P4] === null || !/129/.test(r[SHOP_EXAMPLE_P4]!.value)).toBe(true);
  });
  it('a structured-only value comes back with no boxes', async () => {
    const caps = loadShopExample();
    const to = { [U[1]!]: { capture: caps[U[1]!]!, boxes: [] as Box[] } };
    const r = await transferMarks({ field: title, from: { url: U[0]!, capture: caps[U[0]!]!, expected: 'Widget A' }, to }, deps);
    expect(r[U[1]!]).toMatchObject({ value: 'Widget B', boxes: [] });
  });
});
```

Open `p4.json` before finalising the third case and assert what that fixture actually holds (its price is elsewhere by design; the assertion above is written to hold either way).

- [ ] **Step 2: Run, expect failure** — module missing.

- [ ] **Step 3: Implement**

```ts
// packages/scraper/src/verify/transfer-marks.ts
// Pages 2 and 3 of the mark screen open with page 1's paths already run on
// them (spec 2026-09-18 §3.4): the same candidates verification would gather
// from page 1, tried on each other page in certification's order, stable paths
// first. Whatever resolves is shown with the element that displays it; the
// customer confirms or corrects. Nothing is certified here.
import type { CaptureLike } from './certify.js';
import { gatherCandidates, isVolatilePath, rankCertified, type CandidatePath } from './certify.js';
import type { Box } from './box-map.js';
import type { DomHit, DomNeedle, XPathProbeResult } from './dom-scripts.js';
import { normalize, valuesEqual } from './normalize.js';
import { resolveStructured } from './search-structured.js';
import { applyTransform } from './transforms.js';
import type { CertifiedSource, Mark, SchemaDefinitionField } from './types.js';

export type TransferInput = {
  field: SchemaDefinitionField;
  from: { url: string; capture: CaptureLike; expected: string; mark?: Mark };
  to: Record<string, { capture: CaptureLike; boxes: Box[] }>;
};
export type TransferDeps = {
  evalXPaths: (html: string, xpaths: string[]) => Promise<XPathProbeResult>;
  runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => Promise<DomHit[]>;
};
export type Transferred = { value: string; via: { source: CertifiedSource; path: string }; boxes: number[] };

function boxValue(box: Box): string {
  return box.kind === 'image' ? box.src ?? '' : box.kind === 'link' ? box.href || box.text : box.text;
}

export async function transferMarks(input: TransferInput, deps: TransferDeps): Promise<Record<string, Transferred | null>> {
  const { field, from } = input;
  const gathered = await gatherCandidates(field, { [from.url]: from.expected }, { [from.url]: from.capture }, {
    runDomSearch: deps.runDomSearch,
    ...(from.mark ? { marks: { [from.url]: from.mark } } : {}),
  });
  // Certification's order, with the deploy-fragile XPaths last (certify.ts's stable-first rule).
  const ranked: CandidatePath[] = [...rankCertified(gathered.candidates.filter((c) => !isVolatilePath(c))), ...rankCertified(gathered.candidates.filter(isVolatilePath))];

  const out: Record<string, Transferred | null> = {};
  for (const [url, target] of Object.entries(input.to)) {
    const ctx = { pageUrl: target.capture.url };
    const xpaths = ranked.filter((c) => c.source === 'xpath').map((c) => c.path);
    const probe = xpaths.length ? await deps.evalXPaths(target.capture.html, xpaths) : {};
    let hit: Transferred | null = null;
    for (const c of ranked) {
      const rawBase = c.source === 'xpath' ? probe[c.path] ?? null : resolveStructured(target.capture, c.source, c.path);
      const raw = applyTransform(rawBase, c.transform);
      if (raw === null || raw === undefined || raw === '') continue;
      if (normalize(field.type, raw, ctx) === null) continue;               // a value the type rejects is not this field
      const value = Array.isArray(raw) ? raw.map(String).join(', ') : String(raw);
      const boxes = target.boxes.map((b, i) => (valuesEqual(field.type, boxValue(b), value, ctx) ? i : -1)).filter((i) => i >= 0);
      hit = { value, via: { source: c.source, path: c.path }, boxes };
      break;
    }
    out[url] = hit;
  }
  return out;
}
```

`index.ts`: `export * from './transfer-marks.js';`. Also export `gatherCandidates`, `isVolatilePath` from `certify.js` in `index.ts` if not already (they are used only internally today; the API does not need them, so leave `index.ts`'s certify line as is unless the typecheck asks).

- [ ] **Step 4: Run, expect pass** — `pnpm --filter @robot/scraper test -- --maxWorkers=1 transfer-marks`.

- [ ] **Step 5: Full scraper gate, typecheck, commit**

Run: `pnpm --filter @robot/scraper test -- --maxWorkers=1` and `pnpm --filter @robot/scraper typecheck`.

```bash
git add packages/scraper/src/verify/transfer-marks.ts packages/scraper/src/verify/transfer-marks.test.ts packages/scraper/src/verify/index.ts
git commit -m "feat(scraper): transferMarks runs page 1's paths on the other proof pages" -- packages/scraper/src/verify/transfer-marks.ts packages/scraper/src/verify/transfer-marks.test.ts packages/scraper/src/verify/index.ts
```

---

### Task 7: Capture store and the proof-page capture job (API)

**Files:**
- Create: `packages/api/src/verify/capture-store.ts`, `packages/api/src/verify/proof-page-capture.ts`
- Modify: `packages/api/src/verify/run-source-verification.ts:38-71` (use `capture-store.ts`)
- Test: `packages/api/src/verify/capture-store.test.ts`, `packages/api/src/verify/proof-page-capture.test.ts`

**Interfaces:**
- Consumes: `captures` table (`@robot/db`), `persistScreenshot`, `getCapturesDir`, `withBrowserSession`, `captureProofPage`, `CAPTURE_REUSE_MAX_AGE_MS`, `Box`.
- Produces:
  ```ts
  // capture-store.ts
  export type StoredCaptureRef = { captureId: string; capturedAt: string; screenshotUrl?: string; blockedReason?: string };
  export async function writeCaptureFile(captureId: string, c: PageCapture): Promise<void>;   // <dir>/<id>.capture.json: url, html, structuredData, JSON interceptedRequests
  export async function readCaptureFile(captureId: string): Promise<PageCapture | null>;      // null on any problem
  export async function loadStoredCapture(ref: StoredCaptureRef): Promise<PageCapture | null>; // null when older than CAPTURE_REUSE_MAX_AGE_MS
  export async function persistTiles(tiles: Buffer[]): Promise<string[]>;                       // /captures/<id>.png per tile, in order
  // proof-page-capture.ts
  export type ProofPageMeta =
    | { kind: 'proof-page'; status: 'capturing'; url: string; startedAt: string }
    | { kind: 'proof-page'; status: 'captured'; url: string; startedAt: string; capturedAt: string; tiles: string[]; boxes: Box[]; pageHeight: number }
    | { kind: 'proof-page'; status: 'failed'; url: string; startedAt: string; error: string };
  export async function startProofPageCapture(sourceId: string, url: string): Promise<{ captureId: string }>; // inserts the row, fires runProofPageCapture un-awaited
  export async function runProofPageCapture(captureId: string, session?: typeof withBrowserSession): Promise<void>; // never rejects; leaves the row terminal
  /** The newest captured proof page per URL for this source, fresh within CAPTURE_REUSE_MAX_AGE_MS. */
  export async function loadProofPageCaptures(sourceId: string, urls: string[]): Promise<Record<string, { ref: StoredCaptureRef; capture: PageCapture; meta: Extract<ProofPageMeta, { status: 'captured' }> }>>;
  ```

- [ ] **Step 1: Move the store out of `run-source-verification.ts` (no behaviour change)**

Create `capture-store.ts` with `StoredCaptureRef`, `writeCaptureFile` (the body of `storeCapture`'s `writeFile` block), `readCaptureFile`, `loadStoredCapture` (age check then `readCaptureFile`), and `persistTiles` (`persistScreenshot` per tile, collecting `url`s). In `run-source-verification.ts`, `storeCapture` becomes:

```ts
async function storeCapture(sourceId: string, url: string, c: PageCapture): Promise<StoredCaptureRef> {
  const shot = c.screenshot.length > 0 ? await persistScreenshot(c.screenshot) : null;
  const [row] = await db.insert(captures).values({ sourceId, url, html: c.html, screenshotPath: shot?.url ?? null, metadata: { kind: 'verification' } }).returning({ id: captures.id });
  await writeCaptureFile(row!.id, c);
  return { captureId: row!.id, capturedAt: new Date().toISOString(), ...(shot ? { screenshotUrl: shot.url } : {}) };
}
```

and imports `loadStoredCapture`, `writeCaptureFile`, `StoredCaptureRef` from `./capture-store.js`, deleting its own copies.

Test `capture-store.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCaptureFile, readCaptureFile, loadStoredCapture, persistTiles } from './capture-store.js';

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'captures-')); process.env.CAPTURES_DIR = dir; });
afterAll(async () => { delete process.env.CAPTURES_DIR; await rm(dir, { recursive: true, force: true }); });

const capture = { url: 'https://s/p/1', html: '<p>x</p>', markdown: '', title: 't', timestamp: 0, screenshot: Buffer.alloc(0), screenshotTiles: [],
  structuredData: { ldJson: [{ a: 1 }], nextData: null, initialState: null, meta: { description: 'd' } },
  interceptedRequests: [
    { url: 'https://s/api', method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, responseBody: '{"k":1}', contentType: 'application/json', bodySize: 7, isJson: true, parsedJson: { k: 1 }, timestamp: 0 },
    { url: 'https://s/x.js', method: 'GET', resourceType: 'script', responseStatus: 200, responseHeaders: {}, responseBody: null, contentType: 'text/javascript', bodySize: 0, isJson: false, parsedJson: null, timestamp: 0 },
  ] };

describe('capture store', () => {
  it('round-trips a capture keeping only the JSON responses', async () => {
    await writeCaptureFile('abc', capture);
    const back = await readCaptureFile('abc');
    expect(back?.html).toBe('<p>x</p>');
    expect(back?.structuredData.ldJson).toEqual([{ a: 1 }]);
    expect(back?.interceptedRequests.map((r) => r.url)).toEqual(['https://s/api']);
  });
  it('readCaptureFile is null for a missing id', async () => { expect(await readCaptureFile('nope')).toBeNull(); });
  it('loadStoredCapture refuses a stale ref', async () => {
    expect(await loadStoredCapture({ captureId: 'abc', capturedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString() })).toBeNull();
    expect(await loadStoredCapture({ captureId: 'abc', capturedAt: new Date().toISOString() })).not.toBeNull();
  });
  it('persistTiles writes one png per tile in order', async () => {
    const urls = await persistTiles([Buffer.from('a'), Buffer.from('b')]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/^\/captures\/.+\.png$/);
  });
});
```

Run: `pnpm --filter @robot/api test -- --maxWorkers=1 capture-store run-source-verification` → PASS.

- [ ] **Step 2: Failing test for the job**

Create `packages/api/src/verify/proof-page-capture.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, captures } from '@robot/db';
import type { IBrowser, PageCapture } from '@robot/browser';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from '../routers/index.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { startProofPageCapture, runProofPageCapture, loadProofPageCaptures, type ProofPageMeta } from './proof-page-capture.js';
import { readCaptureFile } from './capture-store.js';

const caller = createCallerFactory(appRouter)({ db });
let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'captures-')); process.env.CAPTURES_DIR = dir; });
afterAll(async () => { delete process.env.CAPTURES_DIR; await rm(dir, { recursive: true, force: true }); });

const box = { xpaths: ['//*[@id="main"]/h1'], text: 'Widget', rect: { x: 0, y: 0, w: 10, h: 10 }, tag: 'h1', kind: 'text' as const };
const fakeCapture = (url: string): PageCapture => ({
  url, html: '<html><body><div id="main"><h1>Widget</h1>' + 'text '.repeat(200) + '</div></body></html>', markdown: '', title: 'Widget', timestamp: 0,
  screenshot: Buffer.from('png1'), screenshotTiles: [Buffer.from('png1'), Buffer.from('png2')],
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} }, interceptedRequests: [], annotation: [box],
});
const sessionWith = (capture: (url: string) => Promise<PageCapture>) => async <T>(fn: (b: IBrowser) => Promise<T>) =>
  fn({ launch: async () => {}, close: async () => {}, capture: (u: string) => capture(u) } as unknown as IBrowser);

describe('proof-page capture job', () => {
  it('records a captured page: tiles, boxes, capture file', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-ok', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { fire: false });
      const row0 = await db.query.captures.findFirst({ where: eq(captures.id, captureId) });
      expect((row0!.metadata as ProofPageMeta).status).toBe('capturing');
      await runProofPageCapture(captureId, sessionWith(async (u) => fakeCapture(u)));
      const row = await db.query.captures.findFirst({ where: eq(captures.id, captureId) });
      const meta = row!.metadata as ProofPageMeta;
      expect(meta.status).toBe('captured');
      if (meta.status !== 'captured') return;
      expect(meta.tiles).toHaveLength(2);
      expect(meta.boxes).toEqual([box]);
      expect(row!.screenshotPath).toBe(meta.tiles[0]);
      expect((await readCaptureFile(captureId))?.html).toContain('Widget');
      const loaded = await loadProofPageCaptures(f.sourceId, f.urls);
      expect(Object.keys(loaded)).toEqual([f.urls[0]]);
      expect(loaded[f.urls[0]!]!.ref.captureId).toBe(captureId);
    } finally { await f.cleanup(); }
  });
  it('records a failure with its reason and never throws', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-fail', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { fire: false });
      await runProofPageCapture(captureId, sessionWith(async () => { throw new Error('net::ERR_FAILED'); }));
      const meta = (await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata as ProofPageMeta;
      expect(meta).toMatchObject({ status: 'failed', error: 'net::ERR_FAILED' });
      expect(await loadProofPageCaptures(f.sourceId, f.urls)).toEqual({});
    } finally { await f.cleanup(); }
  });
  it('a redirect is a failure with the capture problem as its reason', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-redir', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { fire: false });
      await runProofPageCapture(captureId, sessionWith(async () => fakeCapture('https://elsewhere.example/cat')));
      const meta = (await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata as ProofPageMeta;
      expect(meta).toMatchObject({ status: 'failed', error: 'redirected to https://elsewhere.example/cat' });
    } finally { await f.cleanup(); }
  });
});
```

`startProofPageCapture(sourceId, url, opts)` takes `{ session?: typeof withBrowserSession; fire?: boolean }`: the router calls it with no opts (real session, fired un-awaited); the tests pass `{ fire: false }` so nothing runs in the background, then call `runProofPageCapture(captureId, session)` themselves with a fake session. `runProofPageCapture`'s second argument is that injectable session, defaulting to `withBrowserSession`.

- [ ] **Step 3: Implement `proof-page-capture.ts`**

```ts
// packages/api/src/verify/proof-page-capture.ts
// The background body behind `sources.captureProofPage`: one captures row per
// request, its metadata the state machine the stepper polls. Follows
// run-source-verification.ts's rule: the caller never awaits the run, so it
// never rejects and always leaves the row terminal.
import { and, eq, inArray, desc } from 'drizzle-orm';
import { db, captures } from '@robot/db';
import type { PageCapture } from '@robot/browser';
import { captureProofPage, CAPTURE_REUSE_MAX_AGE_MS, type Box } from '@robot/scraper';
import { withBrowserSession } from '../browser-session.js';
import { safeErrorMessage } from '../crawl/plan-source.js';
import { writeCaptureFile, readCaptureFile, persistTiles, type StoredCaptureRef } from './capture-store.js';

export type ProofPageMeta =
  | { kind: 'proof-page'; status: 'capturing'; url: string; startedAt: string }
  | { kind: 'proof-page'; status: 'captured'; url: string; startedAt: string; capturedAt: string; tiles: string[]; boxes: Box[]; pageHeight: number }
  | { kind: 'proof-page'; status: 'failed'; url: string; startedAt: string; error: string };

type Session = typeof withBrowserSession;

export async function startProofPageCapture(sourceId: string, url: string, opts: { session?: Session; fire?: boolean } = {}): Promise<{ captureId: string }> {
  const meta: ProofPageMeta = { kind: 'proof-page', status: 'capturing', url, startedAt: new Date().toISOString() };
  const [row] = await db.insert(captures).values({ sourceId, url, metadata: meta }).returning({ id: captures.id });
  if (opts.fire ?? true) void runProofPageCapture(row!.id, opts.session);
  return { captureId: row!.id };
}

export async function runProofPageCapture(captureId: string, session: Session = withBrowserSession): Promise<void> {
  const row = await db.query.captures.findFirst({ where: eq(captures.id, captureId), columns: { id: true, url: true, metadata: true } }).catch(() => null);
  if (!row) return;
  const meta = row.metadata as ProofPageMeta;
  try {
    const { capture, boxes } = await session((browser) => captureProofPage(browser, row.url));
    const tiles = await persistTiles(capture.screenshotTiles);
    await writeCaptureFile(captureId, capture);
    const pageHeight = boxes.reduce((h, b) => Math.max(h, b.rect.y + b.rect.h), 0);
    const done: ProofPageMeta = { kind: 'proof-page', status: 'captured', url: row.url, startedAt: meta.startedAt, capturedAt: new Date().toISOString(), tiles, boxes, pageHeight };
    await db.update(captures).set({ html: capture.html, screenshotPath: tiles[0] ?? null, metadata: done }).where(eq(captures.id, captureId));
  } catch (err) {
    console.error(`[proof-page] capture ${captureId} failed:`, err);
    const failed: ProofPageMeta = { kind: 'proof-page', status: 'failed', url: row.url, startedAt: meta.startedAt, error: safeErrorMessage(err).slice(0, 1000) };
    await db.update(captures).set({ metadata: failed }).where(eq(captures.id, captureId)).catch((e) => console.error(`[proof-page] failed to record failure for ${captureId}:`, e));
  }
}

/** The newest captured proof page per URL for this source, fresh within CAPTURE_REUSE_MAX_AGE_MS, with its capture file loaded. */
export async function loadProofPageCaptures(sourceId: string, urls: string[]): Promise<Record<string, { ref: StoredCaptureRef; capture: PageCapture; meta: Extract<ProofPageMeta, { status: 'captured' }> }>> {
  if (urls.length === 0) return {};
  const rows = await db.query.captures.findMany({
    where: and(eq(captures.sourceId, sourceId), inArray(captures.url, urls)),
    orderBy: [desc(captures.createdAt)],
    columns: { id: true, url: true, metadata: true },
  });
  const out: Record<string, { ref: StoredCaptureRef; capture: PageCapture; meta: Extract<ProofPageMeta, { status: 'captured' }> }> = {};
  for (const r of rows) {
    const m = r.metadata as Partial<ProofPageMeta> | null;
    if (!m || m.kind !== 'proof-page' || m.status !== 'captured' || out[r.url]) continue;
    if (Date.now() - Date.parse(m.capturedAt) > CAPTURE_REUSE_MAX_AGE_MS) continue;
    const capture = await readCaptureFile(r.id);
    if (!capture) continue;
    out[r.url] = { ref: { captureId: r.id, capturedAt: m.capturedAt, ...(m.tiles[0] ? { screenshotUrl: m.tiles[0] } : {}) }, capture, meta: m };
  }
  return out;
}
```

`safeErrorMessage` lives in `../crawl/plan-source.js` (already imported by run-source-verification.ts). If `captureProofPage` is not yet exported from `@robot/scraper`'s package index, add it to `packages/scraper/src/index.ts` where the verify module is re-exported (check `grep -n "verify" packages/scraper/src/index.ts`).

- [ ] **Step 4: Run, expect pass** — `pnpm --filter @robot/api test -- --maxWorkers=1 proof-page-capture capture-store`.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/verify/capture-store.ts packages/api/src/verify/capture-store.test.ts packages/api/src/verify/proof-page-capture.ts packages/api/src/verify/proof-page-capture.test.ts packages/api/src/verify/run-source-verification.ts
git commit -m "feat(api): proof-page capture job stores tiles, box map and capture file on a captures row" -- packages/api/src/verify/capture-store.ts packages/api/src/verify/capture-store.test.ts packages/api/src/verify/proof-page-capture.ts packages/api/src/verify/proof-page-capture.test.ts packages/api/src/verify/run-source-verification.ts
```

---

### Task 8: Verification reuses proof-page captures

**Files:**
- Modify: `packages/api/src/verify/run-source-verification.ts:105-129, 146-153`
- Test: `packages/api/src/verify/run-source-verification.test.ts` (one case added; read its existing fakes first and follow them)

**Interfaces:**
- Consumes: `loadProofPageCaptures`.
- Behaviour: for every proof-page URL with a fresh captured proof page, `reuse[url]` is that capture and `captureRefs[url]` is its ref (no new `captures` row); this applies to a first Verify too, not only `onlyKeys` re-verifies. A previous verification's captures still win for `onlyKeys` runs when present (they are what the stored result was proven on).

- [ ] **Step 1: Failing test**

`run-source-verification.test.ts` mocks `@robot/scraper`'s `runVerification` (`runVerificationMock`) and `withBrowserSession`, so the assertion is on what `runVerification` is handed and on the refs written back. Add inside its `describe('runSourceVerification')`, using the file's `makeSchemaSource`, `startVerificationRow`, `fakeCapture` helpers, plus `import { writeCaptureFile } from './capture-store.js';` at the top:

```ts
  it('hands runVerification a fresh proof-page capture as a reused capture and writes its ref, creating no new captures row', async () => {
    const { sourceId, urls, cleanup } = await makeSchemaSource('proofpage');
    try {
      // A proof page captured for marking, as proof-page-capture.ts stores it: a captures row with
      // the state in metadata, and the capture file beside the screenshots.
      const now = new Date().toISOString();
      const [seeded] = await db.insert(captures).values({
        sourceId, url: urls[0]!, html: '<html>seeded</html>',
        metadata: { kind: 'proof-page', status: 'captured', url: urls[0], startedAt: now, capturedAt: now, tiles: ['/captures/seeded.png'], boxes: [], pageHeight: 0 },
      }).returning({ id: captures.id });
      await writeCaptureFile(seeded!.id, fakeCapture(urls[0]!, '<html>seeded</html>'));

      const verificationId = await startVerificationRow(sourceId);
      runVerificationMock.mockImplementation(async (_req: unknown, deps: { captures?: Record<string, PageCapture> }) => ({
        outcome: { fields: {}, allPassed: false, aiCalls: 0 },
        captures: { [urls[0]!]: deps.captures![urls[0]!]!, [urls[1]!]: fakeCapture(urls[1]!, '<html>2</html>'), [urls[2]!]: fakeCapture(urls[2]!, '<html>3</html>') },
        captureErrors: {},
      }));

      await runSourceVerification(sourceId, verificationId);

      const deps = runVerificationMock.mock.calls[0]![1] as { captures?: Record<string, PageCapture> };
      expect(deps.captures?.[urls[0]!]?.html).toBe('<html>seeded</html>');
      expect(deps.captures?.[urls[1]!]).toBeUndefined();

      const row = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, verificationId) });
      const refs = row!.captures as Record<string, { captureId: string; screenshotUrl?: string }>;
      expect(refs[urls[0]!]).toMatchObject({ captureId: seeded!.id, screenshotUrl: '/captures/seeded.png' });
      expect(refs[urls[1]!]!.captureId).not.toBe(seeded!.id);
      const rowsForUrl0 = await db.query.captures.findMany({ where: eq(captures.url, urls[0]!) });
      expect(rowsForUrl0).toHaveLength(1); // reused, not stored again
    } finally {
      await cleanup();
    }
  });
```

- [ ] **Step 2: Run, expect failure** — the fake's `capture` throws, cells read `not_captured`.

- [ ] **Step 3: Implement**

In `runSourceVerification`, after the `onlyKeys` reuse block:

```ts
    // Proof pages captured for marking (spec 2026-09-18 §3.5) are the same
    // captures verification would take; use them while fresh. A previous
    // verification's own captures, when reused above, stay in charge: the
    // stored result was proven on those.
    const proofPages = await loadProofPageCaptures(sourceId, set.urls.filter((u) => !reuse[u]));
    for (const [url, p] of Object.entries(proofPages)) { reuse[url] = p.capture; reusedRefs.set(url, p.ref); }
```

Import `loadProofPageCaptures` from `./proof-page-capture.js`. The `captureRefs` loop already writes `reused` for a URL in `reusedRefs`, so nothing else changes.

- [ ] **Step 4: Run** — `pnpm --filter @robot/api test -- --maxWorkers=1 run-source-verification` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/verify/run-source-verification.ts packages/api/src/verify/run-source-verification.test.ts
git commit -m "feat(api): verification reuses a fresh proof-page capture instead of capturing again" -- packages/api/src/verify/run-source-verification.ts packages/api/src/verify/run-source-verification.test.ts
```

---

### Task 9: Marks in `updateBinding`

**Files:**
- Modify: `packages/api/src/verify/binding-input.ts`
- Modify: `packages/api/src/test-helpers/customer-source.ts:25-31` (accept `marks` in the `Caller` type and pass through)
- Test: `packages/api/src/verify/binding-input.test.ts` (cases added), `packages/api/src/routers/sources-binding.test.ts` (one case added)

**Interfaces:**
- Produces: `bindingInput.marks?: Record<fieldKey, Record<url, Mark>>` (zod: `xpaths` 1–3 strings each ≤ 2000 chars, `text` ≤ 2000, `rect` four non-negative numbers); `prepareBinding` writes `verificationSet.marks` only for known field keys and listed URLs, and omits the key entirely when nothing remains.
- Rule added to `bindingProblems`: a mark on a cell whose expected value is blank → `"<field> @ <url>: a marked element needs its value"`.

- [ ] **Step 1: Failing tests**

Append to `binding-input.test.ts` (follow the file's existing `contract`/`input` fixtures):

```ts
describe('marks', () => {
  const mark = { xpaths: ['//*[@id="p"]'], text: '$1', rect: { x: 0, y: 0, w: 1, h: 1 } };
  it('are carried into the verification set for known fields and listed pages only', () => {
    const { verificationSet } = prepareBinding({ ...validInput, marks: { price: { [U[0]!]: mark, 'https://other.example/': mark }, ghost: { [U[0]!]: mark } } }, contract);
    expect(verificationSet.marks).toEqual({ price: { [U[0]!]: mark } });
  });
  it('are omitted entirely when none apply', () => {
    expect('marks' in prepareBinding({ ...validInput, marks: { ghost: { [U[0]!]: mark } } }, contract).verificationSet).toBe(false);
    expect('marks' in prepareBinding(validInput, contract).verificationSet).toBe(false);
  });
  it('a mark on a blank cell is a problem', () => {
    const blank = { ...validInput, urls: [...U, 'https://test.example.com/p/4'], marks: { price: { 'https://test.example.com/p/4': mark } } };
    expect(bindingProblems(blank, contract)).toContain(`Price @ https://test.example.com/p/4: a marked element needs its value`);
  });
});
```

Adapt `validInput`, `U` and `contract` to the names that file already defines (read it first).

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

`binding-input.ts`:

```ts
const rect = z.object({ x: z.number().min(0), y: z.number().min(0), w: z.number().min(0), h: z.number().min(0) });
export const markInput = z.object({ xpaths: z.array(z.string().max(2000)).min(1).max(3), text: z.string().max(2000), rect });

export const bindingInput = z.object({
  sourceId: z.string().uuid(),
  urls: z.array(httpUrl).min(VERIFY_URL_MIN).max(VERIFY_URL_MAX),
  listingUrl: httpUrl.optional(),
  descriptions: z.record(z.string(), z.string().trim().max(1000)),
  expected: z.record(z.string(), z.record(z.string(), z.string())),
  /** fieldKey → url → the element the customer clicked (spec 2026-09-18 §3.5). */
  marks: z.record(z.string(), z.record(z.string(), markInput)).optional(),
});
```

In `bindingProblems`, inside the per-field loop after the expected-value checks:

```ts
    for (const url of input.urls) {
      if (input.marks?.[f.key]?.[url] && (cells[url] ?? '').trim() === '') problems.push(`${f.name} @ ${url}: a marked element needs its value`);
    }
```

In `prepareBinding`, before the return:

```ts
  const marks: NonNullable<VerificationSet['marks']> = {};
  for (const f of contract) {
    const perUrl = Object.fromEntries(input.urls.filter((u) => input.marks?.[f.key]?.[u]).map((u) => [u, input.marks![f.key]![u]!]));
    if (Object.keys(perUrl).length) marks[f.key] = perUrl;
  }
  return { fields, verificationSet: { urls: input.urls, expected, ...(input.listingUrl ? { listing_url: input.listingUrl } : {}), ...(Object.keys(marks).length ? { marks } : {}) } };
```

`customer-source.ts`: add `marks?: Record<string, Record<string, { xpaths: string[]; text: string; rect: { x: number; y: number; w: number; h: number } }>>` to the `updateBinding` input type and to `createProjectWithSource`'s `opts`, passed through when given.

- [ ] **Step 4: One router case** in `sources-binding.test.ts`: save a binding with a mark, read the source back, assert `verificationSet.marks` holds it; save again without `marks`, assert it is gone (a save is the whole binding, as today).

- [ ] **Step 5: Run** — `pnpm --filter @robot/api test -- --maxWorkers=1 binding-input sources-binding` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/verify/binding-input.ts packages/api/src/verify/binding-input.test.ts packages/api/src/routers/sources-binding.test.ts packages/api/src/test-helpers/customer-source.ts
git commit -m "feat(api): a binding carries the marked element per cell" -- packages/api/src/verify/binding-input.ts packages/api/src/verify/binding-input.test.ts packages/api/src/routers/sources-binding.test.ts packages/api/src/test-helpers/customer-source.ts
```

---

### Task 10: The four procedures

**Files:**
- Modify: `packages/api/src/routers/sources.ts` (after `checkListingPage`, ~line 742)
- Test: `packages/api/src/routers/sources-marks.test.ts` (new)

**Interfaces:**
- Consumes: `startProofPageCapture`, `loadProofPageCaptures`, `ProofPageMeta`, `readCaptureFile`, `suggestMarks`, `transferMarks`, `bindingFor`, `contractFields`, `withBrowserSession`, `buildDomSearchScript`, `buildXPathProbeScript`.
- Produces:
  ```ts
  sources.captureProofPage({ sourceId: uuid, url: httpUrl }) → { captureId: string }                 // mutation
  sources.proofPageCapture({ captureId: uuid }) → { url: string; status: 'capturing' | 'captured' | 'failed'; tiles: string[]; boxes: Box[]; pageHeight: number; error?: string; capturedAt?: string }  // query
  sources.suggestMarks({ captureId: uuid, fieldKeys?: string[] }) → Record<fieldKey, Suggestion | null>   // query
  sources.transferMarks({ sourceId: uuid, fromUrl: httpUrl, toUrls: httpUrl[] }) → Record<url, Record<fieldKey, Transferred | null>>  // mutation (opens a browser for setContentEvaluate)
  ```
- Errors: `NOT_FOUND` for an unknown source or capture; `PRECONDITION_FAILED` from `transferMarks` when `fromUrl` has no fresh proof-page capture or no expected values on the binding (`"Mark page 1 first"`), and a `toUrl` without a capture comes back as `null` for every field rather than an error.

- [ ] **Step 1: Failing tests**

```ts
// packages/api/src/routers/sources-marks.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, captures } from '@robot/db';
import { PlaywrightBrowser } from '@robot/browser';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { buildBoxMapScript, boxesFromAnnotation } from '@robot/scraper';
import { writeCaptureFile } from '../verify/capture-store.js';
import { SHOP_EXAMPLE } from '../test-helpers/shop-example.js';

// `startProofPageCapture` fires a real browser un-awaited; stub the job so this file never launches one for the mutation.
const { runMock } = vi.hoisted(() => ({ runMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../verify/proof-page-capture.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../verify/proof-page-capture.js')>();
  return { ...real, runProofPageCapture: runMock, startProofPageCapture: (s: string, u: string) => real.startProofPageCapture(s, u, { fire: false }) };
});

const caller = createCallerFactory(appRouter)({ db });
let dir: string;
let browser: PlaywrightBrowser;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'captures-')); process.env.CAPTURES_DIR = dir;
  browser = new PlaywrightBrowser(); await browser.launch({ headless: true });
});
afterAll(async () => { await browser.close(); delete process.env.CAPTURES_DIR; await rm(dir, { recursive: true, force: true }); });

/** A captured proof page for `url`: fixture html + structured data, box map built by real Chromium. */
async function seedProofPage(sourceId: string, url: string, page: 'p1' | 'p2' | 'p3') {
  const fixture = { ...SHOP_EXAMPLE[page], url };
  const boxes = boxesFromAnnotation(await browser.setContentEvaluate<unknown>(fixture.html, buildBoxMapScript()));
  const now = new Date().toISOString();
  const [row] = await db.insert(captures).values({ sourceId, url, html: fixture.html, metadata: { kind: 'proof-page', status: 'captured', url, startedAt: now, capturedAt: now, tiles: ['/captures/x.png'], boxes, pageHeight: 900 } }).returning({ id: captures.id });
  await writeCaptureFile(row!.id, fixture);
  return row!.id;
}

describe('sources.captureProofPage / proofPageCapture', () => {
  it('creates a capturing row and reports it', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-cap', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const { captureId } = await caller.sources.captureProofPage({ sourceId: f.sourceId, url: f.urls[0]! });
      const s = await caller.sources.proofPageCapture({ captureId });
      expect(s).toMatchObject({ status: 'capturing', url: f.urls[0], tiles: [], boxes: [] });
    } finally { await f.cleanup(); }
  });
  it('NOT_FOUND for an unknown capture', async () => {
    await expect(caller.sources.proofPageCapture({ captureId: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('sources.suggestMarks', () => {
  it('suggests price and title from the page data with their boxes', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-sug', fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }] });
    try {
      const id = await seedProofPage(f.sourceId, f.urls[0]!, 'p1');
      const r = await caller.sources.suggestMarks({ captureId: id });
      expect(r[f.keys.Price!]).toMatchObject({ value: '129.99', via: { source: 'json-ld', path: 'offers.price' } });
      expect(r[f.keys.Price!]!.boxes).toHaveLength(1);
      expect(r[f.keys.Title!]).toMatchObject({ value: 'Widget A' });
    } finally { await f.cleanup(); }
  });
});

describe('sources.transferMarks', () => {
  it('carries page 1 to pages 2 and 3', async () => {
    // `bindingProblems` needs a value on each of pages 1 to 3, so the binding is saved as it will be
    // once the stepper has confirmed every page; transferMarks only reads page 1's value.
    const f = await createProjectWithSource(caller, { tag: 'marks-tr', fields: [{ name: 'Price', type: 'money' }],
      expected: { Price: { 'https://test-marks-tr.example.com/p/1': '129.99', 'https://test-marks-tr.example.com/p/2': '219.99', 'https://test-marks-tr.example.com/p/3': '149.00' } } });
    try {
      await seedProofPage(f.sourceId, f.urls[0]!, 'p1'); await seedProofPage(f.sourceId, f.urls[1]!, 'p2'); await seedProofPage(f.sourceId, f.urls[2]!, 'p3');
      const r = await caller.sources.transferMarks({ sourceId: f.sourceId, fromUrl: f.urls[0]!, toUrls: [f.urls[1]!, f.urls[2]!] });
      expect(r[f.urls[1]!]![f.keys.Price!]!.value).toMatch(/219\.99/);
      expect(r[f.urls[1]!]![f.keys.Price!]!.boxes).toHaveLength(1);
      expect(r[f.urls[2]!]![f.keys.Price!]!.value).toMatch(/149/);
    } finally { await f.cleanup(); }
  });
  it('PRECONDITION_FAILED when page 1 has no capture', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-tr0', fields: [{ name: 'Price', type: 'money' }] });
    try {
      await expect(caller.sources.transferMarks({ sourceId: f.sourceId, fromUrl: f.urls[0]!, toUrls: [f.urls[1]!] })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    } finally { await f.cleanup(); }
  });
});
```

`createProjectWithSource` derives its URLs from the tag (`https://test-<tag>.example.com/p/<n>`), which is why the `expected` keys above spell them out. `@robot/scraper`'s fixture loader (`src/__fixtures__/verify/load.ts`) is not exported from the package, so create `packages/api/src/test-helpers/shop-example.ts` holding the content of `p1.json`, `p2.json` and `p3.json` as `export const SHOP_EXAMPLE: Record<'p1' | 'p2' | 'p3', PageCapture>` (each with `markdown: ''`, `title: ''`, `timestamp: 0`, `screenshot: Buffer.alloc(0)`, `screenshotTiles: []` filled in), rather than reaching into another package's test files.

- [ ] **Step 2: Run, expect failure** — procedures do not exist.

- [ ] **Step 3: Implement, in `sources.ts` after `checkListingPage`**

```ts
  /** Start capturing one proof page for marking (spec 2026-09-18 §3.1). Poll `proofPageCapture`. */
  captureProofPage: publicProcedure
    .input(z.object({ sourceId: z.string().uuid(), url: httpUrl }))
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db.query.sources.findFirst({ where: eq(sources.id, input.sourceId), columns: { id: true } });
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      return startProofPageCapture(input.sourceId, input.url);
    }),

  proofPageCapture: publicProcedure
    .input(z.object({ captureId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.captures.findFirst({ where: eq(captures.id, input.captureId), columns: { id: true, url: true, metadata: true } });
      const meta = row?.metadata as ProofPageMeta | undefined;
      if (!row || !meta || meta.kind !== 'proof-page') throw new TRPCError({ code: 'NOT_FOUND', message: `Proof-page capture ${input.captureId} not found` });
      return {
        url: meta.url, status: meta.status,
        tiles: meta.status === 'captured' ? meta.tiles : [],
        boxes: meta.status === 'captured' ? meta.boxes : [],
        pageHeight: meta.status === 'captured' ? meta.pageHeight : 0,
        ...(meta.status === 'failed' ? { error: meta.error } : {}),
        ...(meta.status === 'captured' ? { capturedAt: meta.capturedAt } : {}),
      };
    }),

  /** Pre-highlights for the mark screen (spec 2026-09-18 §3.3): pure over the stored capture, no browser, no model. */
  suggestMarks: publicProcedure
    .input(z.object({ captureId: z.string().uuid(), fieldKeys: z.array(z.string()).optional() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.captures.findFirst({ where: eq(captures.id, input.captureId), columns: { id: true, sourceId: true, metadata: true } });
      const meta = row?.metadata as ProofPageMeta | undefined;
      if (!row || !meta || meta.kind !== 'proof-page') throw new TRPCError({ code: 'NOT_FOUND', message: `Proof-page capture ${input.captureId} not found` });
      if (meta.status !== 'captured') throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This page is not captured yet' });
      const capture = await readCaptureFile(row.id);
      if (!capture) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This capture is no longer on disk; capture the page again' });
      const source = await ctx.db.query.sources.findFirst({ where: eq(sources.id, row.sourceId), columns: { id: true }, with: { dataset: { columns: { schema: true } } } });
      const fields = bindingFor(contractFields(source?.dataset?.schema)).filter((f) => !input.fieldKeys || input.fieldKeys.includes(f.key));
      return suggestMarks(capture, meta.boxes, fields);
    }),

  /** Page 1's paths run on the other proof pages (spec 2026-09-18 §3.4). Opens a browser for the offline DOM search and XPath probe only. */
  transferMarks: publicProcedure
    .input(z.object({ sourceId: z.string().uuid(), fromUrl: httpUrl, toUrls: z.array(httpUrl).min(1).max(VERIFY_URL_MAX) }))
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db.query.sources.findFirst({ where: eq(sources.id, input.sourceId), columns: { id: true, schemaDefinition: true, verificationSet: true } });
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: `Source ${input.sourceId} not found` });
      const fields = (source.schemaDefinition ?? []) as SchemaDefinitionField[];
      const set = (source.verificationSet ?? { urls: [], expected: {} }) as VerificationSet;
      const pages = await loadProofPageCaptures(input.sourceId, [input.fromUrl, ...input.toUrls]);
      const from = pages[input.fromUrl];
      if (!from) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Mark page 1 first: it has no fresh capture' });
      const to = Object.fromEntries(input.toUrls.filter((u) => pages[u]).map((u) => [u, { capture: pages[u]!.capture, boxes: pages[u]!.meta.boxes }]));
      const out: Record<string, Record<string, Transferred | null>> = Object.fromEntries(input.toUrls.map((u) => [u, {}]));
      if (fields.length === 0) return out;
      await withBrowserSession(async (browser) => {
        const deps = {
          evalXPaths: (html: string, xps: string[]) => browser.setContentEvaluate<XPathProbeResult>(html, buildXPathProbeScript(xps)),
          runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => browser.setContentEvaluate<DomHit[]>(html, buildDomSearchScript(needles, pageUrl)),
        };
        for (const field of fields) {
          const expected = set.expected[field.key]?.[input.fromUrl] ?? '';
          if (expected.trim() === '') { for (const u of input.toUrls) out[u]![field.key] = null; continue; }
          const r = await transferMarks({ field, from: { url: input.fromUrl, capture: from.capture, expected, mark: set.marks?.[field.key]?.[input.fromUrl] }, to }, deps);
          for (const u of input.toUrls) out[u]![field.key] = r[u] ?? null;
        }
      });
      return out;
    }),
```

Imports to add at the top of `sources.ts`: `captures` from `@robot/db`; `startProofPageCapture`, `loadProofPageCaptures`, `type ProofPageMeta` from `../verify/proof-page-capture.js`; `readCaptureFile` from `../verify/capture-store.js`; `suggestMarks`, `transferMarks`, `buildDomSearchScript`, `buildXPathProbeScript`, `type Transferred`, `type DomHit`, `type DomNeedle`, `type XPathProbeResult`, `type SchemaDefinitionField`, `type VerificationSet`, `VERIFY_URL_MAX` from `@robot/scraper` (some are already imported; `buildDomSearchScript` must be added to `verify/index.ts`'s dom-scripts export line if it is not there — it is not today: add it). `bindingFor`, `contractFields` from `../contract.js`.

- [ ] **Step 4: Run** — `pnpm --filter @robot/api test -- --maxWorkers=1 sources-marks` → PASS.

- [ ] **Step 5: Full api gate, typecheck across packages**

Run: `pnpm --filter @robot/api test -- --maxWorkers=1`, then `pnpm typecheck`.
Expected: green. If the dashboard's typecheck complains about `sources.updateBinding`'s input type (it should not: `marks` is optional), fix the dashboard call site rather than the schema.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routers/sources.ts packages/api/src/routers/sources-marks.test.ts packages/api/src/test-helpers/shop-example.ts packages/scraper/src/verify/index.ts
git commit -m "feat(api): captureProofPage, proofPageCapture, suggestMarks and transferMarks" -- packages/api/src/routers/sources.ts packages/api/src/routers/sources-marks.test.ts packages/api/src/test-helpers/shop-example.ts packages/scraper/src/verify/index.ts
```

---

### Task 11: Live check and handoff

**Files:**
- Create: `docs/testing/2026-09-18-proof-page-capture-live.md`
- Modify: `docs/handoff.md` (new section at the top, after "Read this first")

- [ ] **Step 1: Free live check against Ikea, without touching Marko's dev servers**

Start a second api-server on :4100 with no key (see memory note "Free live checks without touching dev servers": `ANTHROPIC_API_KEY= PORT=4100 pnpm --filter @robot/api-server dev`, or however that note says). Drive it over tRPC-HTTP with a small `tsx` script in the scratchpad:

1. `sources.captureProofPage` for the three Ikea proof URLs on the existing Acne/Ikea website (`sources.listByProject` to find the sourceId); poll `proofPageCapture` every 2 s until all three are `captured`; record time per page, tile count, box count, `pageHeight`.
2. `sources.suggestMarks` on page 1: record which of the eight fields got a suggestion, its source, and how many boxes; open the first tile PNG and confirm by eye that the suggested `price` box's rect sits on the price.
3. `sources.transferMarks` from page 1 to pages 2 and 3: record per field whether a value came back and whether it has a box.
4. **Do not** call `updateBinding` or `verify` on the customer's website; nothing is written to the binding in this check.

Write the numbers into `docs/testing/2026-09-18-proof-page-capture-live.md` (what was run, the four numbers per page, per-field table for steps 2 and 3, anything that looked wrong).

- [ ] **Step 2: Handoff**

Add a section "Schema stepper, engine (2026-09-18)" to `docs/handoff.md` under "Read this first": spec and plan paths, what landed (one line per task), the live numbers, the spec amendment about descriptions, and the next plan (catalogue and step 1).

- [ ] **Step 3: Commit**

```bash
git add docs/testing/2026-09-18-proof-page-capture-live.md docs/handoff.md
git commit -m "docs: proof-page capture live check and handoff for the stepper engine" -- docs/testing/2026-09-18-proof-page-capture-live.md docs/handoff.md
```
