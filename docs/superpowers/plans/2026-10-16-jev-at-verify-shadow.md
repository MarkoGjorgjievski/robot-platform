# Jev at Verify, in shadow — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each proof-page capture, a background Jev reading (one TypeSafe call, the screenshot once in state) answers which candidate is each ambiguous field's value and which variant the page shows; the Verification tab shows where Jev differs, the detail bar shows Jev's pick, Verify records agreement, ops shows it — nothing Jev says is ever applied.

**Architecture:** `@robot/scraper` owns the pure candidate and variant-option builders (moved from the experiment CLI). `@robot/db` gains `jev_readings` and `source_verifications.verify_agreement`. `@robot/api` owns the reading job (`verify/jev-reading.ts`: switch, daily budget, request building, an injected client, timeout and one retry, storage), its trigger from the proof-page capture, a polled `sources.jevReadings` query, agreement recording after a Verify, a CLI report, and the ops line. `@robot/app` mirrors the reading shape and renders the row note and the detail-bar text, read-only.

**Tech Stack:** TypeScript ESM; vitest; Drizzle + Postgres (drizzle-kit migrations); tRPC v11; `@typesafe-ai/sdk` (already a dev dependency of `@robot/api`, moved to `dependencies` in Task 3); TanStack Start + React 19.

**Spec:** `docs/superpowers/specs/2026-10-16-jev-at-verify-shadow-design.md`

**Planner's notes (deviations from the spec's letter, each within its intent):**
- **Screenshot:** the spec says a 1440 × 1000 viewport tile. Proof-page captures are taken at a 1280-wide viewport and stored as tiles of 1280 × 1536 (`TILE_WIDTH`/`TILE_HEIGHT`), which is inside TypeSafe's limits (each side 256–1568 px, ≤ 2,458,624 px). The reading sends one stored tile as is — the tile holding the topmost candidate's box, else tile 1 — so no image processing is added. A tile shorter than 400 px (the last one) is never chosen (the experiment saw "400 Invalid image dimensions" on short crops). ≈ 5,100 tokens ≈ $0.0002 a reading.
- **Where the app reads it:** the spec says `sources.suggestMarks` returns `jev`. `suggestMarks` is fetched once per capture with `staleTime: Infinity` and merged once (a × must not be undone by a refetch), while a reading lands seconds later. So the readings come from a new query, `sources.jevReadings({ sourceId, captureIds })`, polled every 3 s while any is `running`. Same data, same display.
- **Trigger on a contract change:** the spec also re-reads when a field is added. Left out: a new field reaches a proof page through its next capture, which a re-Verify or "Try again" takes anyway; noted in the handoff.
- **Variant note placement:** the spec puts it on the Variants row, or under fields reading a variant list. This plan shows it under each field whose proving or suggested path reads a variant list (`[page]` or a fixed index on `offers|hasVariant|variants|…`), one note per row, the field note first; the Variants row is not touched.

## Global Constraints

- Copy, exact (spec §8): row note field `Jev reads 374.25 as the Price on product 1`; row note variant `Jev reads the selected variant as 6'x9' on product 1`; detail bar `Jev: 374.25 (0.98)` · `Jev: none of these (0.71)` · `Jev: not read`; ops `Jev agreed on 5 of 6 proof pages`. Probabilities print with two decimals.
- Shadow only (spec §10.2): a reading never changes an answer, a suggestion, a certification, `fieldHash`, a run row, a verification's `cost_usd` or a gate; Verify never waits for it.
- The switch (spec §3, §10.1): no reading, no request, nothing rendered unless `process.env.JEV_SHADOW === '1'` and `TYPESAFE_API_KEY` is set. The budget: `JEV_DAILY_READINGS` (default 2000) readings per UTC day across the api-server, checked before a request is sent.
- Sent (spec §10.3, §10.4): only the screenshot, the page `<title>` and verbatim candidate values / variant labels; never page text. The screenshot appears once, in `state`; no question repeats its reference.
- Asked (spec §10.6): only fields of type `text`, `money`, `number` with ≥ 2 distinct candidates after normalising; the variant question only when the page data has a variant list. Field options ≤ 30, variant options ≤ 40 (keeping the `[page]` match).
- Shown (spec §10.7): a row note only at p ≥ 0.6 and only when Jev differs from the suggestion or the answer; at most one per row; every note starts with "Jev reads".
- A failed or timed-out reading stores `status: 'failed'` and renders nothing; 10 s timeout, one retry.
- Tests never send a real TypeSafe request: the client is injected everywhere; the only live call is the spec §11 live step, run by the controller after the merge.
- Tests per package only: `pnpm --filter @robot/<pkg> exec vitest run <file>`; never `pnpm -r test`; the route smoke runs on `main` after the merge against `pnpm dev:all`.
- Commits by explicit path; never `git add -A`/`.`; never stage `packages/app/src/routeTree.gen.ts`; every message ends `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `.js` suffix on relative imports in scraper/api/db; none in app; `@robot/app` never imports `@robot/scraper` except `@robot/scraper/normalize`, never `@robot/api`.

## Review Focus

1. A page whose candidates are all the same value spelt differently (`"$22.00"`, `"22"`, `"22.00 USD"`) must not ask a question, and must not show a note. → Task 1 test "money candidates that normalise to one value are not ambiguous".
2. A reading still running when the customer clicks Verify must not delay or change the Verify, and its late result must still show. → Task 3 test "runJevReading writes only its own row"; Task 5 test "a running reading renders nothing, a done one renders".
3. The daily budget reached mid-day must stop new requests, not fail captures. → Task 3 test "at the budget, startJevReading inserts nothing and sends nothing".
4. A capture whose last tile is a 200-px sliver and whose candidate sits there must send a full tile, not the sliver. → Task 3 test "tileFor never picks a tile shorter than 400 px".
5. Jev answering a candidate id the request did not offer, or an answer key it was not asked, must be ignored, not stored as a pick. → Task 3 test "answers outside the asked ids are dropped".

---

### Task 1: Candidates and variant options (`@robot/scraper`)

**Files:**
- Create: `packages/scraper/src/verify/jev-candidates.ts`, `packages/scraper/src/verify/jev-candidates.test.ts`
- Modify: `packages/scraper/src/verify/index.ts` (export)
- Modify: `packages/api/src/jev-images-run.ts` (import `jevFieldCandidates` instead of its local `candidatesFor`; delete the local copy, `leaves`, `Leaf`)

**Interfaces:**
- Consumes: `pathFitsConcept` (`field-fit.ts`), `normalize` (`normalize.ts`), `detectVariantLists`, `isVariantEntry`, `entryAxisValue` (`variant-detect.ts`), `pickPageEntry` (`page-variant-match.ts`), `Box` (`box-map.ts`), `PageCapture` from `@robot/browser` (type only).
- Produces:
  ```ts
  export type JevField = { key: string; name: string; type: CustomerFieldType; concept: string; description?: string };
  export type JevCandidate = { id: string; value: string; source: string };
  export type JevVariantOption = { id: string; label: string; entryIndex: number };
  export const JEV_FIELD_TYPES: readonly CustomerFieldType[]; // ['text', 'money', 'number']
  export const JEV_MAX_FIELD_OPTIONS = 30;
  export const JEV_MAX_VARIANT_OPTIONS = 40;
  export function jevFieldCandidates(field: JevField, structured: { ldJson: unknown[]; meta: Record<string, string> }, boxes: Box[]): JevCandidate[];
  export function isAmbiguous(field: JevField, candidates: JevCandidate[]): boolean; // ≥ 2 and asked type
  export function jevVariantOptions(capture: Pick<PageCapture, 'structuredData' | 'interceptedRequests' | 'pageVariant'>): { options: JevVariantOption[]; pageMatch: string | null } | null;
  ```

- [ ] **Step 1: Failing tests.** `packages/scraper/src/verify/jev-candidates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isAmbiguous, jevFieldCandidates, jevVariantOptions, JEV_MAX_VARIANT_OPTIONS, type JevField } from './jev-candidates.js';
import type { Box } from './box-map.js';

const box = (text: string, tag = 'span', y = 100): Box => ({ xpaths: [`//${tag}`], text, rect: { x: 100, y, w: 200, h: 20 }, tag, kind: 'text' });
const price: JevField = { key: 'price', name: 'Price', type: 'money', concept: 'price', description: 'the price a buyer pays' };
const brand: JevField = { key: 'brand', name: 'Brand', type: 'text', concept: 'brand' };
const title: JevField = { key: 'title', name: 'Title', type: 'text', concept: 'product_name' };

describe('jevFieldCandidates', () => {
  it('offers a sale price and a crossed-out list price as two candidates (Ruggable)', () => {
    const c = jevFieldCandidates(price, { ldJson: [{ '@type': 'Product', offers: { price: '374.25' } }], meta: {} }, [box('Sierra Rug', 'h1', 80), box('$374.25', 'span', 200), box('$499.00', 's', 200)]);
    expect(c.map((x) => x.value)).toEqual(['374.25', '$499.00']);
    expect(isAmbiguous(price, c)).toBe(true);
  });
  it('offers the brand and the site tagline (Gymshark)', () => {
    const c = jevFieldCandidates(brand, { ldJson: [{ '@type': 'Product', brand: { name: 'Gymshark' } }], meta: { 'og:site_name': 'Gymshark | We Do Gym' } }, []);
    expect(c.map((x) => x.value)).toEqual(['Gymshark', 'Gymshark | We Do Gym']);
  });
  it('offers the JSON-LD name and the heading (Colourpop)', () => {
    const c = jevFieldCandidates(title, { ldJson: [{ '@type': 'Product', name: 'Drift' }], meta: {} }, [box('Super Shock Shadow', 'h1', 80)]);
    expect(c.map((x) => x.value).sort()).toEqual(['Drift', 'Super Shock Shadow']);
  });
  it('money candidates that normalise to one value are not ambiguous', () => {
    const c = jevFieldCandidates(price, { ldJson: [{ offers: { price: '22' } }], meta: { 'product:price:amount': '22.00' } }, [box('Widget', 'h1', 80), box('$22.00', 'span', 200)]);
    expect(c).toHaveLength(1);
    expect(isAmbiguous(price, c)).toBe(false);
  });
  it('never asks a boolean, image or url field', () => {
    const stock: JevField = { key: 'stock', name: 'In stock', type: 'boolean', concept: 'availability' };
    expect(isAmbiguous(stock, [{ id: 'c1', value: 'yes', source: 'x' }, { id: 'c2', value: 'no', source: 'y' }])).toBe(false);
  });
  it('caps at 30 candidates with stable ids c1…', () => {
    const ld = { offers: Array.from({ length: 40 }, (_, i) => ({ price: String(100 + i) })) };
    const c = jevFieldCandidates(price, { ldJson: [ld], meta: {} }, []);
    expect(c).toHaveLength(30);
    expect(c[0]!.id).toBe('c1');
  });
});

describe('jevVariantOptions', () => {
  const hasVariant = (n: number) => Array.from({ length: n }, (_, i) => ({ '@type': 'Product', sku: `R-${i}`, size: `${i + 2}'x${i + 3}'`, offers: { price: String(100 + i), url: `/p?variant=${1000 + i}` } }));
  const cap = (pv?: unknown, n = 4) => ({
    structuredData: { ldJson: [{ '@type': 'ProductGroup', variesBy: ['https://schema.org/size'], hasVariant: hasVariant(n) }], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [],
    ...(pv ? { pageVariant: pv as never } : {}),
  });
  it('labels entries by option values and name, never price, and finds the [page] match', () => {
    const r = jevVariantOptions(cap({ ids: [], pairs: [{ name: 'size', value: "4'x5'" }], labels: ["4'x5'"], named: true, selected: false }))!;
    expect(r.options.map((o) => o.label)).toEqual(["2'x3'", "3'x4'", "4'x5'", "5'x6'"]);
    expect(r.options.every((o) => !/\d+\.\d\d|100|101/.test(o.label))).toBe(true);
    expect(r.pageMatch).toBe('e3');
  });
  it('no variant list → null', () => {
    expect(jevVariantOptions({ structuredData: { ldJson: [{ '@type': 'Product', name: 'x' }], nextData: null, initialState: null, meta: {} }, interceptedRequests: [] })).toBeNull();
  });
  it('caps at 40 options and keeps the [page] match', () => {
    const r = jevVariantOptions(cap({ ids: [], pairs: [{ name: 'size', value: "57'x58'" }], labels: ["57'x58'"], named: true, selected: false }, 60))!;
    expect(r.options.length).toBeLessThanOrEqual(JEV_MAX_VARIANT_OPTIONS);
    expect(r.pageMatch).not.toBeNull();
    expect(r.options.some((o) => o.id === r.pageMatch)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect fail** (`Cannot find module './jev-candidates.js'`):

`pnpm --filter @robot/scraper exec vitest run src/verify/jev-candidates.test.ts`

- [ ] **Step 3: Implement** `packages/scraper/src/verify/jev-candidates.ts`:

```ts
// packages/scraper/src/verify/jev-candidates.ts
// What a Jev reading may choose among (spec 2026-10-16 §4): verbatim values our
// code finds, never free page text. Moved from the experiment CLI
// (packages/api/src/jev-images-run.ts, `candidatesFor`), plus the variant
// options experiment 2 asked about.
import type { PageCapture } from '@robot/browser';
import type { Box } from './box-map.js';
import { pathFitsConcept } from './field-fit.js';
import { normalize } from './normalize.js';
import { detectVariantLists, entryAxisValue, isVariantEntry } from './variant-detect.js';
import { pickPageEntry } from './page-variant-match.js';
import type { CustomerFieldType } from './types.js';

export type JevField = { key: string; name: string; type: CustomerFieldType; concept: string; description?: string };
export type JevCandidate = { id: string; value: string; source: string };
export type JevVariantOption = { id: string; label: string; entryIndex: number };
export const JEV_FIELD_TYPES: readonly CustomerFieldType[] = ['text', 'money', 'number'];
export const JEV_MAX_FIELD_OPTIONS = 30;
export const JEV_MAX_VARIANT_OPTIONS = 40;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const normText = (s: string) => s.normalize('NFKC').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

type Leaf = { source: string; path: string; raw: unknown };
function leaves(value: unknown, path: string, depth: number, out: Leaf[], source: string): void {
  if (depth > 12 || out.length > 5000) return;
  if (Array.isArray(value)) { value.slice(0, 30).forEach((v, i) => leaves(v, `${path}[${i}]`, depth + 1, out, source)); return; }
  if (isObj(value)) { for (const [k, v] of Object.entries(value)) leaves(v, path === '' ? k : `${path}.${k}`, depth + 1, out, source); return; }
  if (path !== '' && value !== null && value !== undefined && value !== '') out.push({ source, path, raw: value });
}

/** The key a value is told apart by: money and numbers by amount, text by normalised text. */
function keyOf(type: CustomerFieldType, v: string): string | null {
  if (type === 'money' || type === 'number') { const n = normalize(type, v); return n === null ? null : String(n); }
  const t = normText(v);
  return t === '' ? null : t;
}

/**
 * Choice candidates for a field: distinct values of the page's structured leaves whose path fits the
 * field (JSON-LD and meta), plus the visible strings for it — money strings near the heading for a
 * price, the h1 and og:title for a name, og:site_name/product:brand for a brand. Verbatim; ≤ 30.
 */
export function jevFieldCandidates(field: JevField, structured: { ldJson: unknown[]; meta: Record<string, string> }, boxes: Box[]): JevCandidate[] {
  const out: Array<Omit<JevCandidate, 'id'>> = [];
  const seen = new Set<string>();
  const add = (value: string, source: string) => {
    const v = value.replace(/\s+/g, ' ').trim();
    if (v === '' || v.length > 200) return;
    const k = keyOf(field.type, v);
    if (k === null || seen.has(k)) return;
    seen.add(k);
    out.push({ value: v, source });
  };
  const ls: Leaf[] = [];
  structured.ldJson.forEach((b) => leaves(b, '', 0, ls, 'json-ld'));
  for (const [k, v] of Object.entries(structured.meta)) ls.push({ source: 'meta', path: k, raw: v });
  for (const l of ls) {
    if (!pathFitsConcept(field.concept, l.path)) continue;
    if ((field.type === 'money' || field.type === 'number') && normalize(field.type, l.raw) === null) continue;
    add(String(l.raw), `${l.source} ${l.path}`);
  }
  const h1s = boxes.filter((b) => b.tag.toLowerCase() === 'h1' && b.text.trim() !== '');
  if (field.concept === 'brand') for (const k of ['og:site_name', 'application-name', 'product:brand']) if (structured.meta[k]) add(structured.meta[k]!, `meta ${k}`);
  if (field.concept === 'product_name') {
    for (const h of h1s.slice(0, 2)) add(h.text, 'visible h1');
    if (structured.meta['og:title']) add(structured.meta['og:title'], 'meta og:title');
  }
  if (field.concept === 'price') {
    const h1 = h1s[0]?.rect;
    const moneyText = /^[^\d]{0,8}[$£€]\s?\d[\d,]*(\.\d{1,2})?\s*$|^\s*\d[\d,]*(\.\d{1,2})?\s?(€|£)\s*$/;
    for (const b of [...boxes].sort((a, c) => a.rect.y - c.rect.y || a.rect.x - c.rect.x)) {
      if (!moneyText.test(b.text)) continue;
      if (h1 ? Math.abs(b.rect.y - h1.y) > 700 || Math.abs(b.rect.x - h1.x) > 900 : b.rect.y > 1200) continue;
      add(b.text, 'visible');
    }
  }
  return out.slice(0, JEV_MAX_FIELD_OPTIONS).map((c, i) => ({ id: `c${i + 1}`, ...c }));
}

export function isAmbiguous(field: JevField, candidates: JevCandidate[]): boolean {
  return JEV_FIELD_TYPES.includes(field.type) && candidates.length >= 2;
}

const variesByOf = (container: unknown): string[] => {
  const v = isObj(container) ? container.variesBy : undefined;
  return (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter((x): x is string => typeof x === 'string')
    .map((t) => t.replace(/^https?:\/\/schema\.org\//i, '').trim()).filter(Boolean);
};
function getAt(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const part of path.split(/\.|\[(\d+)\]/).filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = Array.isArray(cur) ? cur[Number(part)] : (cur as Obj)[part];
  }
  return cur;
}

/** An entry's verbatim name, title and option values (never a price, a stock level, an id or an address). */
function entryLabel(e: Obj, axes: string[]): string {
  const parts: string[] = [];
  const add = (v: unknown) => {
    if (typeof v !== 'string' && typeof v !== 'number') return;
    const t = String(v).replace(/\s+/g, ' ').trim();
    if (!t || t.length > 140 || /^https?:/.test(t)) return;
    if (parts.some((p) => p.toLowerCase().includes(t.toLowerCase()))) return;
    parts.push(t);
  };
  add(e.name); add(e.title); add(e.public_title);
  for (const a of axes) add(entryAxisValue(e, a));
  for (const k of ['size', 'color', 'colour', 'option1', 'option2', 'option3']) add(e[k]);
  for (const k of ['selectedOptions', 'options', 'additionalProperty']) {
    const v = e[k];
    for (const o of Array.isArray(v) ? v : isObj(v) ? [v] : []) if (isObj(o) && typeof o.name === 'string' && (typeof o.value === 'string' || typeof o.value === 'number')) add(`${o.name}: ${o.value}`);
  }
  return parts.join(' · ');
}

/**
 * The variant question's options (spec 2026-10-16 §4): the first variant list the page data carries,
 * each entry labelled by its option values and name, ≤ 40 keeping the `[page]` match; `pageMatch` is
 * the option `pickPageEntry` reads with the capture's page variant, or null. Null without a list.
 */
export function jevVariantOptions(capture: Pick<PageCapture, 'structuredData' | 'interceptedRequests' | 'pageVariant'>): { options: JevVariantOption[]; pageMatch: string | null } | null {
  const list = detectVariantLists(capture as never)[0];
  if (!list) return null;
  const roots: unknown[] = [];
  if (list.source === 'json-ld') {
    for (const b of capture.structuredData.ldJson) { if (!isObj(b)) continue; roots.push(b); if (Array.isArray(b['@graph'])) roots.push(...b['@graph']); }
  } else {
    for (const r of capture.interceptedRequests) if (r.isJson && r.parsedJson != null) roots.push(r.parsedJson);
  }
  for (const root of roots) {
    const arr = getAt(root, list.path);
    if (!Array.isArray(arr)) continue;
    const dot = list.path.lastIndexOf('.');
    const container = dot < 0 ? root : getAt(root, list.path.slice(0, dot));
    const axes = variesByOf(container);
    const entries = arr.map((e, idx) => ({ e, idx })).filter((x) => isObj(x.e) && isVariantEntry(x.e as Obj));
    if (entries.length === 0) continue;
    let options = entries.map((x, k) => ({ id: `e${k + 1}`, label: entryLabel(x.e as Obj, list.axes) || `entry ${x.idx + 1}`, entryIndex: x.idx }));
    const hit = capture.pageVariant ? pickPageEntry(arr, capture.pageVariant, axes) : undefined;
    const matchIdx = hit === undefined ? null : arr.indexOf(hit);
    if (options.length > JEV_MAX_VARIANT_OPTIONS) {
      const keep = new Set<number>([options[0]!.entryIndex, ...(matchIdx !== null ? [matchIdx] : [])]);
      const step = options.length / (JEV_MAX_VARIANT_OPTIONS - keep.size);
      for (let k = 0; keep.size < JEV_MAX_VARIANT_OPTIONS && k < options.length; k = Math.max(k + 1, Math.floor(k + step))) keep.add(options[k]!.entryIndex);
      options = options.filter((o) => keep.has(o.entryIndex));
    }
    const pageMatch = matchIdx === null ? null : options.find((o) => o.entryIndex === matchIdx)?.id ?? null;
    return { options, pageMatch };
  }
  return null;
}
```

Add to `packages/scraper/src/verify/index.ts`: `export * from './jev-candidates.js';`

In `packages/api/src/jev-images-run.ts`: delete `type Leaf`, `leaves`, `candidatesFor` (lines ~204–264); add `jevFieldCandidates` to the `@robot/scraper` import; replace every `candidatesFor(field, structured, boxes, h1s)` call with `jevFieldCandidates(field, structured, boxes)` (the h1s are now read from `boxes`; where the CLI builds `h1s` from a separate annotate result, keep passing its boxes — the h1 boxes carry `tag: 'h1'`). Run `pnpm --filter @robot/api exec tsc --noEmit` to confirm.

- [ ] **Step 4: Run, expect pass:** `pnpm --filter @robot/scraper exec vitest run src/verify/jev-candidates.test.ts` (9 passed); `pnpm --filter @robot/scraper exec tsc --noEmit`; `pnpm --filter @robot/api exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add packages/scraper/src/verify/jev-candidates.ts packages/scraper/src/verify/jev-candidates.test.ts packages/scraper/src/verify/index.ts packages/api/src/jev-images-run.ts
git commit -m "feat(scraper): Jev candidates and variant options — verbatim values, ambiguity, caps, the [page] match kept

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Storage (`@robot/db`)

**Files:**
- Modify: `packages/db/src/schema.ts` (table `jevReadings` + relations; `sourceVerifications.verifyAgreement`)
- Create: `packages/db/drizzle/0018_jev_readings.sql`, `packages/db/drizzle/meta/0018_snapshot.json`, journal entry (generated)
- Test: `packages/db/src/schema.test.ts`

**Interfaces:**
- Produces: `jevReadings` (`id`, `sourceId`, `captureId` unique, `url`, `status`, `model`, `answers jsonb`, `inputTokens int`, `costUsd numeric(10,6)`, `error`, `createdAt`, `completedAt`); `sourceVerifications.verifyAgreement jsonb`.

- [ ] **Step 1: Failing test** — append to `packages/db/src/schema.test.ts` (follow the file's existing pattern of inserting a source first; reuse its helper that creates a source, named in the file's earlier tests):

```ts
it('stores a Jev reading per capture, unique on the capture', async () => {
  const sourceId = await makeSource(); // the helper the file's earlier tests use to insert a source
  const [cap] = await db.insert(captures).values({ sourceId, url: 'https://s.example/p/1' }).returning({ id: captures.id });
  const [r] = await db.insert(jevReadings).values({ sourceId, captureId: cap!.id, url: 'https://s.example/p/1', status: 'running' }).returning();
  expect(r!.status).toBe('running');
  await expect(db.insert(jevReadings).values({ sourceId, captureId: cap!.id, url: 'https://s.example/p/1', status: 'running' })).rejects.toThrow();
  const [v] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'x', verifyAgreement: { asked: 1, agreed: 1, pages: {} } }).returning();
  expect(v!.verifyAgreement).toEqual({ asked: 1, agreed: 1, pages: {} });
});
```

(If the file has no `makeSource` helper, insert a source the way its first test does and name that block's helper `makeSource` inside this test.)

- [ ] **Step 2: Run, expect fail:** `pnpm --filter @robot/db exec vitest run src/schema.test.ts` (`jevReadings` is not exported).

- [ ] **Step 3: Implement.** In `packages/db/src/schema.ts`, after `coverageChecksRelations`:

```ts
// ─── Jev readings (2026-10-16) ──────────────────────────────────────────────
// Jev at Verify, in shadow (spec 2026-10-16): one reading per proof-page
// capture — which candidate each ambiguous field is, which variant the page
// shows. Shown and measured, never applied.

export const jevReadings = pgTable('jev_readings', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  captureId: uuid('capture_id').notNull().references(() => captures.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  // 'running' | 'done' | 'failed'
  status: varchar('status', { length: 12 }).notNull().default('running'),
  model: varchar('model', { length: 40 }),
  // JevAnswers (@robot/api verify/jev-reading.ts)
  answers: jsonb('answers'),
  inputTokens: integer('input_tokens'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('jev_readings_capture_id_idx').on(table.captureId),
  index('jev_readings_source_id_idx').on(table.sourceId),
  index('jev_readings_created_at_idx').on(table.createdAt),
]);

export const jevReadingsRelations = relations(jevReadings, ({ one }) => ({
  source: one(sources, { fields: [jevReadings.sourceId], references: [sources.id] }),
  capture: one(captures, { fields: [jevReadings.captureId], references: [captures.id] }),
}));
```

In `sourceVerifications`, after `variantResults`:

```ts
  // JevAgreement (@robot/api verify/jev-reading.ts): per proof page, Jev's picks against what the
  // customer verified (spec 2026-10-16 §7). Null when no reading was done for its pages.
  verifyAgreement: jsonb('verify_agreement'),
```

Generate and apply: `pnpm --filter @robot/db exec drizzle-kit generate --name jev_readings` (writes `0018_jev_readings.sql`, the snapshot and the journal entry; check the SQL creates the table, its two foreign keys with `ON DELETE cascade`, the three indexes and `ALTER TABLE "source_verifications" ADD COLUMN "verify_agreement" jsonb`), then `pnpm db:migrate`. The migration is additive; `main`'s running servers ignore the new table.

- [ ] **Step 4: Run, expect pass:** `pnpm --filter @robot/db exec vitest run src/schema.test.ts`; `pnpm --filter @robot/db exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/schema.test.ts packages/db/drizzle/0018_jev_readings.sql packages/db/drizzle/meta/0018_snapshot.json packages/db/drizzle/meta/_journal.json
git commit -m "feat(db): jev_readings (one per proof-page capture) and source_verifications.verify_agreement

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The reading job and its trigger (`@robot/api`)

**Files:**
- Create: `packages/api/src/verify/jev-reading.ts`, `packages/api/src/verify/jev-reading.test.ts`, `packages/api/src/verify/jev-client.ts`
- Modify: `packages/api/src/verify/proof-page-capture.ts` (trigger after the success write), `packages/api/package.json` (move `@typesafe-ai/sdk` from `devDependencies` to `dependencies`), `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Task 1's `jevFieldCandidates`, `isAmbiguous`, `jevVariantOptions`, `JevField`, `JevCandidate`, `JevVariantOption`; Task 2's `jevReadings`; `contractFields` (`../contract.js`); `TILE_HEIGHT` (`@robot/browser`).
- Produces:
  ```ts
  export type JevQuestion = { key: string; kind: 'field' | 'variant'; instructions: string; options: Array<{ id: string; label: string }> };
  export type JevRequest = { tileIndex: number; state: { page_title: string; candidates: Record<string, Array<{ id: string; value: string }>> }; questions: JevQuestion[] };
  export type JevAnswer = { pick: string; p: number };
  export type JevAnswers = {
    fields: Record<string, { candidates: JevCandidate[]; pick: string; p: number }>;
    variant?: { entries: JevVariantOption[]; pick: string; p: number; pageMatch: string | null };
  };
  export interface JevClient { ask(req: { image: Buffer; state: JevRequest['state']; questions: JevQuestion[] }): Promise<{ model: string; inputTokens: number; answers: Record<string, { choice: string; probabilities: Record<string, number> }> }> }
  export function jevEnabled(env?: NodeJS.ProcessEnv): boolean;
  export function jevDailyBudget(env?: NodeJS.ProcessEnv): number;
  export function tileFor(tiles: Buffer[], tileHeights: number[], ys: number[]): number;
  export function buildJevRequest(input: { title: string; fields: JevField[]; capture: Pick<PageCapture, 'structuredData' | 'interceptedRequests' | 'pageVariant'>; boxes: Box[]; tileHeights: number[] }): { request: JevRequest; fieldCandidates: Record<string, JevCandidate[]>; variant: { options: JevVariantOption[]; pageMatch: string | null } | null } | null;
  export function answersFrom(built: NonNullable<ReturnType<typeof buildJevRequest>>, raw: Awaited<ReturnType<JevClient['ask']>>['answers']): JevAnswers;
  export async function startJevReading(input: { sourceId: string; captureId: string; url: string; title: string; capture: PageCapture; boxes: Box[] }, deps?: { client?: JevClient; env?: NodeJS.ProcessEnv; fire?: boolean; now?: Date }): Promise<{ readingId: string | null; reason?: 'off' | 'budget' | 'exists' | 'nothing-to-ask' }>;
  export async function runJevReading(readingId: string, built: NonNullable<ReturnType<typeof buildJevRequest>>, image: Buffer, client: JevClient, opts?: { timeoutMs?: number }): Promise<void>;
  // jev-client.ts
  export function typesafeJevClient(): JevClient; // dynamic import of @typesafe-ai/sdk, model jev-1.14.0, danger-zone header
  ```

- [ ] **Step 1: Failing tests.** `packages/api/src/verify/jev-reading.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, captures, jevReadings, sources, sourceVerifications } from '@robot/db';
import type { Box } from '@robot/scraper';
import { answersFrom, buildJevRequest, jevDailyBudget, jevEnabled, runJevReading, startJevReading, tileFor, type JevClient } from './jev-reading.js';
import { createTestSource, deleteTestSource } from '../test-helpers/source.js';

const ON = { JEV_SHADOW: '1', TYPESAFE_API_KEY: 'k' } as NodeJS.ProcessEnv;
const box = (text: string, tag = 'span', y = 100): Box => ({ xpaths: [`//${tag}`], text, rect: { x: 100, y, w: 200, h: 20 }, tag, kind: 'text' });
const fields = [
  { key: 'price', name: 'Price', type: 'money' as const, concept: 'price', description: 'the price a buyer pays' },
  { key: 'stock', name: 'In stock', type: 'boolean' as const, concept: 'availability' },
];
const capture = {
  url: 'https://s.example/p/1', structuredData: { ldJson: [{ '@type': 'Product', offers: { price: '374.25' } }], nextData: null, initialState: null, meta: {} },
  interceptedRequests: [], screenshotTiles: [Buffer.from('tile1'), Buffer.from('tile2')], pageHeight: 3000, verdict: { kind: 'ok', status: 200 },
} as never;
const boxes = [box('Sierra Rug', 'h1', 80), box('$374.25', 'span', 200), box('$499.00', 's', 200)];

function fakeClient(answer?: (q: string[]) => Record<string, { choice: string; probabilities: Record<string, number> }>, fail = 0): JevClient & { calls: Array<{ image: Buffer; state: unknown; questions: unknown[] }> } {
  const calls: Array<{ image: Buffer; state: unknown; questions: unknown[] }> = [];
  let failures = fail;
  return {
    calls,
    async ask(req) {
      calls.push(req as never);
      if (failures-- > 0) throw new Error('boom');
      const keys = req.questions.map((q) => q.key);
      return { model: 'jev-1.14.0', inputTokens: 5000, answers: answer ? answer(keys) : Object.fromEntries(keys.map((k) => [k, { choice: 'c1', probabilities: { c1: 0.98, c2: 0.02 } }])) };
    },
  };
}

describe('the switch and the budget', () => {
  it('is off without JEV_SHADOW or without a key', () => {
    expect(jevEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(jevEnabled({ JEV_SHADOW: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(jevEnabled(ON)).toBe(true);
  });
  it('reads JEV_DAILY_READINGS, default 2000', () => {
    expect(jevDailyBudget({} as NodeJS.ProcessEnv)).toBe(2000);
    expect(jevDailyBudget({ JEV_DAILY_READINGS: '50' } as NodeJS.ProcessEnv)).toBe(50);
    expect(jevDailyBudget({ JEV_DAILY_READINGS: 'x' } as NodeJS.ProcessEnv)).toBe(2000);
  });
});

describe('buildJevRequest', () => {
  it('asks the ambiguous price, never the boolean; state holds only the title and verbatim candidates', () => {
    const b = buildJevRequest({ title: 'Sierra Rug', fields, capture, boxes, tileHeights: [1536, 1464] })!;
    expect(b.request.questions.map((q) => q.key)).toEqual(['price']);
    expect(Object.keys(b.request.state).sort()).toEqual(['candidates', 'page_title']);
    expect(b.request.state.candidates.price!.map((c) => c.value)).toEqual(['374.25', '$499.00']);
    expect(b.request.questions[0]!.instructions).toContain('the price a buyer pays now for the selected variant');
    expect(JSON.stringify(b.request)).not.toContain('Sierra Rug</');
  });
  it('nothing ambiguous and no variant list → null', () => {
    expect(buildJevRequest({ title: 't', fields: [fields[1]!], capture, boxes, tileHeights: [1536] })).toBeNull();
  });
});

describe('tileFor', () => {
  it('picks the tile holding the topmost candidate', () => {
    expect(tileFor([Buffer.from('a'), Buffer.from('b')], [1536, 1536], [1700, 2000])).toBe(1);
  });
  it('never picks a tile shorter than 400 px', () => {
    expect(tileFor([Buffer.from('a'), Buffer.from('b')], [1536, 200], [1600])).toBe(0);
  });
  it('no candidate box → tile 0', () => {
    expect(tileFor([Buffer.from('a')], [1536], [])).toBe(0);
  });
});

describe('answersFrom', () => {
  it('answers outside the asked ids are dropped', () => {
    const b = buildJevRequest({ title: 'x', fields, capture, boxes, tileHeights: [1536] })!;
    const a = answersFrom(b, { price: { choice: 'c9', probabilities: { c9: 1 } }, bogus: { choice: 'c1', probabilities: { c1: 1 } } });
    expect(a.fields).toEqual({});
  });
  it('keeps a pick and its probability, none included', () => {
    const b = buildJevRequest({ title: 'x', fields, capture, boxes, tileHeights: [1536] })!;
    expect(answersFrom(b, { price: { choice: 'c1', probabilities: { c1: 0.98, c2: 0.02 } } }).fields.price).toMatchObject({ pick: 'c1', p: 0.98 });
    expect(answersFrom(b, { price: { choice: 'none', probabilities: { none: 0.71 } } }).fields.price).toMatchObject({ pick: 'none', p: 0.71 });
  });
});

describe('startJevReading / runJevReading', () => {
  let sourceId: string;
  let captureId: string;
  beforeEach(async () => {
    sourceId = await createTestSource({ schema: [{ key: 'price', name: 'Price', type: 'money', concept: 'price', description: 'the price a buyer pays' }] });
    const [c] = await db.insert(captures).values({ sourceId, url: 'https://s.example/p/1' }).returning({ id: captures.id });
    captureId = c!.id;
  });
  afterEach(async () => { await deleteTestSource(sourceId); });

  it('off → no row, no request', async () => {
    const client = fakeClient();
    const r = await startJevReading({ sourceId, captureId, url: 'https://s.example/p/1', title: 'x', capture, boxes }, { client, env: {} as NodeJS.ProcessEnv });
    expect(r).toEqual({ readingId: null, reason: 'off' });
    expect(client.calls).toHaveLength(0);
    expect(await db.query.jevReadings.findFirst({ where: eq(jevReadings.captureId, captureId) })).toBeUndefined();
  });

  it('at the budget, startJevReading inserts nothing and sends nothing', async () => {
    const client = fakeClient();
    const r = await startJevReading({ sourceId, captureId, url: 'https://s.example/p/1', title: 'x', capture, boxes }, { client, env: { ...ON, JEV_DAILY_READINGS: '0' } });
    expect(r.reason).toBe('budget');
    expect(client.calls).toHaveLength(0);
  });

  it('a done reading stores its answers, tokens and cost; the image is sent once, the questions never name it', async () => {
    const client = fakeClient();
    const r = await startJevReading({ sourceId, captureId, url: 'https://s.example/p/1', title: 'x', capture, boxes }, { client, env: ON, fire: false });
    expect(r.readingId).not.toBeNull();
    const built = buildJevRequest({ title: 'x', fields: [{ key: 'price', name: 'Price', type: 'money', concept: 'price', description: 'the price a buyer pays' }], capture, boxes, tileHeights: [1536, 1464] })!;
    await runJevReading(r.readingId!, built, Buffer.from('tile1'), client);
    const row = await db.query.jevReadings.findFirst({ where: eq(jevReadings.id, r.readingId!) });
    expect(row).toMatchObject({ status: 'done', inputTokens: 5000, model: 'jev-1.14.0' });
    expect(Number(row!.costUsd)).toBeCloseTo(0.00021, 5);
    expect((row!.answers as { fields: Record<string, { pick: string }> }).fields.price!.pick).toBe('c1');
    expect(client.calls).toHaveLength(1);
    expect(JSON.stringify(client.calls[0]!.questions)).not.toMatch(/screenshot-ref|<screenshot>/);
  });

  it('a second start for the same capture is "exists"', async () => {
    const client = fakeClient();
    await startJevReading({ sourceId, captureId, url: 'u', title: 'x', capture, boxes }, { client, env: ON, fire: false });
    expect((await startJevReading({ sourceId, captureId, url: 'u', title: 'x', capture, boxes }, { client, env: ON, fire: false })).reason).toBe('exists');
  });

  it('one retry, then failed with the error; nothing else written', async () => {
    const client = fakeClient(undefined, 2);
    const r = await startJevReading({ sourceId, captureId, url: 'u', title: 'x', capture, boxes }, { client, env: ON, fire: false });
    const built = buildJevRequest({ title: 'x', fields: [{ key: 'price', name: 'Price', type: 'money', concept: 'price' }], capture, boxes, tileHeights: [1536] })!;
    await runJevReading(r.readingId!, built, Buffer.from('t'), client);
    expect(client.calls).toHaveLength(2);
    const row = await db.query.jevReadings.findFirst({ where: eq(jevReadings.id, r.readingId!) });
    expect(row).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('a timeout is a failure', async () => {
    const slow: JevClient = { ask: () => new Promise(() => {}) };
    const r = await startJevReading({ sourceId, captureId, url: 'u', title: 'x', capture, boxes }, { client: slow, env: ON, fire: false });
    const built = buildJevRequest({ title: 'x', fields: [{ key: 'price', name: 'Price', type: 'money', concept: 'price' }], capture, boxes, tileHeights: [1536] })!;
    await runJevReading(r.readingId!, built, Buffer.from('t'), slow, { timeoutMs: 20 });
    expect((await db.query.jevReadings.findFirst({ where: eq(jevReadings.id, r.readingId!) }))!.status).toBe('failed');
  });

  it('runJevReading writes only its own row', async () => {
    const before = await db.query.sourceVerifications.findMany({ where: eq(sourceVerifications.sourceId, sourceId) });
    const src = await db.query.sources.findFirst({ where: eq(sources.id, sourceId) });
    const r = await startJevReading({ sourceId, captureId, url: 'u', title: 'x', capture, boxes }, { client: fakeClient(), env: ON, fire: false });
    const built = buildJevRequest({ title: 'x', fields: [{ key: 'price', name: 'Price', type: 'money', concept: 'price' }], capture, boxes, tileHeights: [1536] })!;
    await runJevReading(r.readingId!, built, Buffer.from('t'), fakeClient());
    expect(await db.query.sourceVerifications.findMany({ where: eq(sourceVerifications.sourceId, sourceId) })).toEqual(before);
    expect(await db.query.sources.findFirst({ where: eq(sources.id, sourceId) })).toEqual(src);
  });
});
```

`createTestSource` / `deleteTestSource`: if `packages/api/src/test-helpers/` already has a helper that creates an org, project, dataset with a given schema and a source (look at `seed-coverage-check.ts`'s callers and the router tests' `beforeEach`), import it and adapt the two calls; otherwise add `packages/api/src/test-helpers/source.ts` exporting those two functions, built the way `routers/sources-verify.test.ts` builds its source (org → project → dataset with `schema` → source), and delete by the org id (everything cascades).

- [ ] **Step 2: Run, expect fail:** `pnpm --filter @robot/api exec vitest run src/verify/jev-reading.test.ts`.

- [ ] **Step 3: Implement** `packages/api/src/verify/jev-reading.ts`:

```ts
// packages/api/src/verify/jev-reading.ts
// Jev at Verify, in shadow (spec 2026-10-16): after a proof page is captured,
// one TypeSafe call — the screenshot once in state — says which candidate each
// ambiguous field is and which variant the page shows. Stored in jev_readings,
// shown and measured, NEVER applied: this module writes only its own row.
import { and, count, eq, gte } from 'drizzle-orm';
import { db, jevReadings, sources } from '@robot/db';
import type { PageCapture } from '@robot/browser';
import { isAmbiguous, jevFieldCandidates, jevVariantOptions, type Box, type JevCandidate, type JevField, type JevVariantOption } from '@robot/scraper';
import { contractFields } from '../contract.js';
import { typesafeJevClient } from './jev-client.js';

export const JEV_MODEL = 'jev-1.14.0';
const USD_PER_TOKEN = 0.042 / 1e6;
const DEFAULT_DAILY = 2000;
const MIN_TILE_HEIGHT = 400;
const TIMEOUT_MS = 10_000;

export type JevQuestion = { key: string; kind: 'field' | 'variant'; instructions: string; options: Array<{ id: string; label: string }> };
export type JevRequest = { tileIndex: number; state: { page_title: string; candidates: Record<string, Array<{ id: string; value: string }>> }; questions: JevQuestion[] };
export type JevAnswer = { pick: string; p: number };
export type JevAnswers = {
  fields: Record<string, { candidates: JevCandidate[]; pick: string; p: number }>;
  variant?: { entries: JevVariantOption[]; pick: string; p: number; pageMatch: string | null };
};
export interface JevClient {
  ask(req: { image: Buffer; state: JevRequest['state']; questions: JevQuestion[] }): Promise<{ model: string; inputTokens: number; answers: Record<string, { choice: string; probabilities: Record<string, number> }> }>;
}
export const VARIANT_KEY = '_variant';

export function jevEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.JEV_SHADOW === '1' && !!env.TYPESAFE_API_KEY;
}
export function jevDailyBudget(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.JEV_DAILY_READINGS);
  return Number.isFinite(n) && n >= 0 && env.JEV_DAILY_READINGS?.trim() ? Math.floor(n) : DEFAULT_DAILY;
}

/** The stored tile holding the topmost candidate's box; never one shorter than 400 px (TypeSafe rejects slivers); else tile 0. */
export function tileFor(tiles: Buffer[], tileHeights: number[], ys: number[]): number {
  if (tiles.length === 0) return 0;
  const top = ys.length ? Math.min(...ys) : 0;
  let y0 = 0;
  for (let i = 0; i < tiles.length; i++) {
    const h = tileHeights[i] ?? 0;
    if (top >= y0 && top < y0 + h) return h >= MIN_TILE_HEIGHT ? i : Math.max(0, i - 1);
    y0 += h;
  }
  return 0;
}

const PRICE_EXTRA = 'the price a buyer pays now for the selected variant';

export function buildJevRequest(input: { title: string; fields: JevField[]; capture: Pick<PageCapture, 'structuredData' | 'interceptedRequests' | 'pageVariant'>; boxes: Box[]; tileHeights: number[] }) {
  const questions: JevQuestion[] = [];
  const fieldCandidates: Record<string, JevCandidate[]> = {};
  const candidatesState: JevRequest['state']['candidates'] = {};
  const ys: number[] = [];
  for (const f of input.fields) {
    const cands = jevFieldCandidates(f, { ldJson: input.capture.structuredData.ldJson, meta: input.capture.structuredData.meta }, input.boxes);
    if (!isAmbiguous(f, cands)) continue;
    fieldCandidates[f.key] = cands;
    candidatesState[f.key] = cands.map((c) => ({ id: c.id, value: c.value }));
    const desc = f.concept === 'price' ? PRICE_EXTRA : (f.description ?? '').trim();
    questions.push({ key: f.key, kind: 'field', instructions: `Which of these is the ${f.name} of the product shown${desc ? ` — ${desc}` : ''}? Look at the screenshot.`, options: cands.map((c) => ({ id: c.id, label: c.value })) });
    for (const c of cands) { const b = input.boxes.find((x) => x.text.replace(/\s+/g, ' ').trim() === c.value); if (b) ys.push(b.rect.y); }
  }
  const variant = jevVariantOptions(input.capture);
  if (variant) {
    questions.push({ key: VARIANT_KEY, kind: 'variant', instructions: 'Which variant is selected on the screenshot?', options: variant.options.map((o) => ({ id: o.id, label: o.label })) });
  }
  if (questions.length === 0) return null;
  const request: JevRequest = { tileIndex: 0, state: { page_title: input.title, candidates: candidatesState }, questions };
  return { request, fieldCandidates, variant, ys };
}

export function answersFrom(built: NonNullable<ReturnType<typeof buildJevRequest>>, raw: Record<string, { choice: string; probabilities: Record<string, number> }>): JevAnswers {
  const out: JevAnswers = { fields: {} };
  for (const q of built.request.questions) {
    const a = raw[q.key];
    if (!a) continue;
    const allowed = new Set([...q.options.map((o) => o.id), 'none']);
    if (!allowed.has(a.choice)) continue;
    const p = Math.round((a.probabilities[a.choice] ?? 0) * 100) / 100;
    if (q.kind === 'field') out.fields[q.key] = { candidates: built.fieldCandidates[q.key]!, pick: a.choice, p };
    else if (built.variant) out.variant = { entries: built.variant.options, pick: a.choice, p, pageMatch: built.variant.pageMatch };
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Never rejects; writes only its own row. One retry. */
export async function runJevReading(readingId: string, built: NonNullable<ReturnType<typeof buildJevRequest>>, image: Buffer, client: JevClient, opts: { timeoutMs?: number } = {}): Promise<void> {
  const ms = opts.timeoutMs ?? TIMEOUT_MS;
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await withTimeout(client.ask({ image, state: built.request.state, questions: built.request.questions }), ms);
      await db.update(jevReadings).set({
        status: 'done', model: res.model, answers: answersFrom(built, res.answers), inputTokens: res.inputTokens,
        costUsd: (res.inputTokens * USD_PER_TOKEN).toFixed(6), completedAt: new Date(),
      }).where(eq(jevReadings.id, readingId));
      return;
    } catch (err) { last = err; }
  }
  const error = (last instanceof Error ? last.message : String(last)).slice(0, 500);
  await db.update(jevReadings).set({ status: 'failed', error, completedAt: new Date() }).where(eq(jevReadings.id, readingId))
    .catch((e) => console.error(`[jev] failed to record failure for ${readingId}:`, e));
}

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function startJevReading(
  input: { sourceId: string; captureId: string; url: string; title: string; capture: PageCapture; boxes: Box[] },
  deps: { client?: JevClient; env?: NodeJS.ProcessEnv; fire?: boolean; now?: Date } = {},
): Promise<{ readingId: string | null; reason?: 'off' | 'budget' | 'exists' | 'nothing-to-ask' }> {
  const env = deps.env ?? process.env;
  if (!jevEnabled(env)) return { readingId: null, reason: 'off' };
  const exists = await db.query.jevReadings.findFirst({ where: eq(jevReadings.captureId, input.captureId), columns: { id: true } });
  if (exists) return { readingId: null, reason: 'exists' };
  const [{ n }] = await db.select({ n: count() }).from(jevReadings).where(gte(jevReadings.createdAt, startOfUtcDay(deps.now ?? new Date())));
  if (n >= jevDailyBudget(env)) return { readingId: null, reason: 'budget' };
  const source = await db.query.sources.findFirst({ where: eq(sources.id, input.sourceId), columns: { id: true }, with: { dataset: { columns: { schema: true } } } });
  const fields: JevField[] = contractFields(source?.dataset?.schema).map((f) => ({ key: f.key, name: f.name, type: f.type, concept: f.concept, description: typeof f.description === 'string' ? f.description : '' }));
  const tiles = input.capture.screenshotTiles ?? [];
  const pageH = input.capture.pageHeight ?? tiles.length * 1536;
  const tileHeights = tiles.map((_, i) => Math.max(0, Math.min(1536, pageH - i * 1536)));
  const built = buildJevRequest({ title: input.title, fields, capture: input.capture, boxes: input.boxes, tileHeights });
  if (!built) return { readingId: null, reason: 'nothing-to-ask' };
  const tileIndex = tileFor(tiles, tileHeights, built.ys);
  built.request.tileIndex = tileIndex;
  const image = tiles[tileIndex];
  if (!image) return { readingId: null, reason: 'nothing-to-ask' };
  const [row] = await db.insert(jevReadings).values({ sourceId: input.sourceId, captureId: input.captureId, url: input.url, status: 'running' })
    .onConflictDoNothing().returning({ id: jevReadings.id });
  if (!row) return { readingId: null, reason: 'exists' };
  if (deps.fire ?? true) void runJevReading(row.id, built, image, deps.client ?? typesafeJevClient());
  return { readingId: row.id };
}
```

(`count`, `gte` and `and` come from `drizzle-orm`; drop `and` if unused. Use `TILE_HEIGHT` from `@robot/browser` instead of the literal 1536 in `startJevReading`.)

`packages/api/src/verify/jev-client.ts`:

```ts
// The real TypeSafe client (never used in tests: the client is injected).
import type { JevClient } from './jev-reading.js';
import { JEV_MODEL } from './jev-reading.js';

export function typesafeJevClient(): JevClient {
  let made: Promise<{ sdk: typeof import('@typesafe-ai/sdk'); client: InstanceType<(typeof import('@typesafe-ai/sdk'))['TypeSafeClient']> }> | null = null;
  const get = () => (made ??= import('@typesafe-ai/sdk').then((sdk) => ({
    sdk,
    client: new sdk.TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' }, retry: { maxRetries: 0 }, timeout: 15_000, logLevel: 'error' }),
  })));
  return {
    async ask(req) {
      const { sdk, client } = await get();
      // The screenshot once, in state; the questions say "the screenshot" in words and never name it.
      const state = { screenshot: sdk.image(req.image) as never, ...req.state };
      const questions = Object.fromEntries(req.questions.map((q) => [q.key, sdk.choice(q.instructions, {
        ...Object.fromEntries(q.options.map((o) => [o.id, o.label])),
        none: q.kind === 'variant' ? 'No variant is shown as selected' : 'None of these is the value the screenshot shows',
      })]));
      const res = await client.systemOne({ model: JEV_MODEL, state: state as never, questions: questions as never });
      const answers = Object.fromEntries(Object.entries(res.answers as Record<string, { choice?: string; probabilities?: Record<string, number> }>)
        .filter(([, a]) => typeof a.choice === 'string').map(([k, a]) => [k, { choice: a.choice!, probabilities: a.probabilities ?? {} }]));
      return { model: res.model, inputTokens: res.usage.input_tokens, answers };
    },
  };
}
```

(Check the SDK's types in `node_modules/@typesafe-ai/sdk` for the answer key format: the experiment CLI keyed questions `q_<id>` and stripped the prefix (`key.replace(/^q_/, '')`); if keys must be identifiers, key questions `q_${q.key}` here and strip the prefix when building `answers`.)

`packages/api/package.json`: move `"@typesafe-ai/sdk": "^0.7.0"` from `devDependencies` to `dependencies`; run `pnpm install` in the worktree (the lockfile changes; commit it).

Trigger — `packages/api/src/verify/proof-page-capture.ts`, in `runProofPageCapture` right after the `await db.update(captures).set({ html: capture.html, … metadata: done })` line:

```ts
    // Jev at Verify, in shadow (spec 2026-10-16 §3): never awaited, never fails the capture.
    void startJevReading({ sourceId: row.sourceId, captureId, url: row.url, title: done.title ?? '', capture, boxes: visible })
      .catch((e) => console.error(`[jev] could not start for ${captureId}:`, e));
```

(add `sourceId: true` to the row's `columns`, and `import { startJevReading } from './jev-reading.js';`.) Add one test to the existing proof-page capture test file (find it with `grep -l runProofPageCapture packages/api/src/**/*.test.ts`): with `JEV_SHADOW` unset, a successful capture leaves no `jev_readings` row — pinning that the trigger respects the switch.

- [ ] **Step 4: Run, expect pass:** `pnpm --filter @robot/api exec vitest run src/verify/jev-reading.test.ts` and the proof-page capture test file; `pnpm --filter @robot/api exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/verify/jev-reading.ts packages/api/src/verify/jev-reading.test.ts packages/api/src/verify/jev-client.ts packages/api/src/verify/proof-page-capture.ts packages/api/package.json pnpm-lock.yaml
# plus the proof-page capture test file and test-helpers/source.ts if created
git commit -m "feat(api): a Jev reading after each proof-page capture — switch, daily budget, one call with the screenshot once, timeout and one retry, its own row only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The readings query, agreement, the CLI and ops (`@robot/api`)

**Files:**
- Modify: `packages/api/src/routers/sources.ts` (`jevReadings` query), `packages/api/src/verify/run-source-verification.ts` (agreement after the results write), `packages/api/src/routers/ops.ts` (field `jevAgreement`)
- Create: `packages/api/src/verify/jev-agreement.ts` (pure `agreementOf` + `recordJevAgreement`), `packages/api/src/verify/jev-agreement.test.ts`, `packages/api/src/jev-agreement.ts` (CLI)
- Test: `packages/api/src/routers/ops.test.ts`

**Interfaces:**
- Consumes: Task 2's tables; Task 3's `JevAnswers`, `VARIANT_KEY`.
- Produces:
  ```ts
  export type JevAgreement = { asked: number; agreed: number; pages: Record<string, { readingId: string; fields: Record<string, { pick: string; value: string | null; p: number; expected: string; agree: boolean }>; variant?: { pick: string; pageMatch: string | null; agree: boolean } }> };
  export function agreementOf(fields: Array<{ key: string; type: CustomerFieldType }>, set: VerificationSet, readings: Array<{ id: string; url: string; answers: JevAnswers }>): JevAgreement | null;
  export async function recordJevAgreement(verificationId: string, sourceId: string, fields: SchemaDefinitionField[], set: VerificationSet): Promise<void>; // never throws
  // sources router
  jevReadings: protectedProcedure.input(z.object({ sourceId: z.string().uuid(), captureIds: z.array(z.string().uuid()).max(VERIFY_URL_MAX) })).query(...) → Record<captureId, { status: 'running' | 'done' | 'failed'; answers: JevAnswers | null }>
  // ops website field
  jevAgreement?: { agreed: number; asked: number };
  ```

- [ ] **Step 1: Failing tests.** `packages/api/src/verify/jev-agreement.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { agreementOf } from './jev-agreement.js';

const set = { urls: ['u1', 'u2'], expected: { price: { u1: '374.25', u2: '449.25' } } } as never;
const reading = (url: string, pick: string, cands: Array<[string, string]>, variant?: { pick: string; pageMatch: string | null }) => ({
  id: `r-${url}`, url,
  answers: { fields: { price: { candidates: cands.map(([id, value]) => ({ id, value, source: 's' })), pick, p: 0.97 } }, ...(variant ? { variant: { entries: [], p: 0.9, ...variant } } : {}) },
});

describe('agreementOf', () => {
  it('compares Jev\'s pick with the verified value by amount', () => {
    const a = agreementOf([{ key: 'price', type: 'money' }], set, [reading('u1', 'c1', [['c1', '$374.25'], ['c2', '$499.00']]), reading('u2', 'c2', [['c1', '449.25'], ['c2', '599.00']])])!;
    expect(a.asked).toBe(2);
    expect(a.agreed).toBe(1);
    expect(a.pages.u1!.fields.price).toMatchObject({ pick: 'c1', value: '$374.25', expected: '374.25', agree: true });
    expect(a.pages.u2!.fields.price!.agree).toBe(false);
  });
  it('a none pick never agrees with a value', () => {
    expect(agreementOf([{ key: 'price', type: 'money' }], set, [reading('u1', 'none', [['c1', '374.25'], ['c2', '499']])])!.pages.u1!.fields.price!.agree).toBe(false);
  });
  it('records the variant pick against the [page] match', () => {
    const a = agreementOf([{ key: 'price', type: 'money' }], set, [reading('u1', 'c1', [['c1', '374.25'], ['c2', '499']], { pick: 'e3', pageMatch: 'e3' })])!;
    expect(a.pages.u1!.variant).toEqual({ pick: 'e3', pageMatch: 'e3', agree: true });
  });
  it('no readings → null', () => {
    expect(agreementOf([{ key: 'price', type: 'money' }], set, [])).toBeNull();
  });
});
```

In `packages/api/src/routers/ops.test.ts`, add (following its existing website-page test's setup): with a verification row whose `verifyAgreement` is `{ asked: 6, agreed: 5, pages: { u1: { readingId: 'r', fields: { <priceKey>: { … agree: true } } }, … } }`, the website's Price field carries `jevAgreement: { agreed: 5, asked: 6 }`; a field never asked carries none. Build the `pages` so that Price is asked on 6 pages and agrees on 5.

For `sources.jevReadings`, add to the sources router tests (the file that tests `suggestMarks`): a `done` reading and a `running` one come back keyed by capture id; a capture of another org is `NOT_FOUND` (use the router's existing `captureInOrg`/`sourceInOrg` guard).

- [ ] **Step 2: Run, expect fail:** `pnpm --filter @robot/api exec vitest run src/verify/jev-agreement.test.ts src/routers/ops.test.ts` (and the sources test file).

- [ ] **Step 3: Implement.** `packages/api/src/verify/jev-agreement.ts`:

```ts
// Spec 2026-10-16 §7: when a Verify completes, Jev's picks against what the customer verified.
import { desc, eq, inArray } from 'drizzle-orm';
import { db, jevReadings, sourceVerifications } from '@robot/db';
import { normalize, type CustomerFieldType, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import type { JevAnswers } from './jev-reading.js';

export type JevAgreement = {
  asked: number; agreed: number;
  pages: Record<string, { readingId: string; fields: Record<string, { pick: string; value: string | null; p: number; expected: string; agree: boolean }>; variant?: { pick: string; pageMatch: string | null; agree: boolean } }>;
};

const same = (type: CustomerFieldType, a: string, b: string) => {
  if (type === 'money' || type === 'number') { const x = normalize(type, a); return x !== null && x === normalize(type, b); }
  return a.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase() === b.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
};

export function agreementOf(fields: Array<{ key: string; type: CustomerFieldType }>, set: VerificationSet, readings: Array<{ id: string; url: string; answers: JevAnswers }>): JevAgreement | null {
  if (readings.length === 0) return null;
  const out: JevAgreement = { asked: 0, agreed: 0, pages: {} };
  for (const r of readings) {
    const page: JevAgreement['pages'][string] = { readingId: r.id, fields: {} };
    for (const f of fields) {
      const a = r.answers.fields[f.key];
      const expected = (set.expected[f.key]?.[r.url] ?? '').trim();
      if (!a || expected === '') continue;
      const value = a.pick === 'none' ? null : a.candidates.find((c) => c.id === a.pick)?.value ?? null;
      const agree = value !== null && same(f.type, value, expected);
      page.fields[f.key] = { pick: a.pick, value, p: a.p, expected, agree };
      out.asked++;
      if (agree) out.agreed++;
    }
    if (r.answers.variant) page.variant = { pick: r.answers.variant.pick, pageMatch: r.answers.variant.pageMatch, agree: r.answers.variant.pick === r.answers.variant.pageMatch };
    out.pages[r.url] = page;
  }
  return out;
}

/** Never throws: agreement is measurement, not Verify. */
export async function recordJevAgreement(verificationId: string, sourceId: string, fields: SchemaDefinitionField[], set: VerificationSet): Promise<void> {
  try {
    const rows = await db.query.jevReadings.findMany({
      where: inArray(jevReadings.url, set.urls), orderBy: [desc(jevReadings.createdAt)],
      columns: { id: true, url: true, sourceId: true, status: true, answers: true },
    });
    const latest = new Map<string, { id: string; url: string; answers: JevAnswers }>();
    for (const r of rows) if (r.sourceId === sourceId && r.status === 'done' && r.answers && !latest.has(r.url)) latest.set(r.url, { id: r.id, url: r.url, answers: r.answers as JevAnswers });
    const agreement = agreementOf(fields, set, [...latest.values()]);
    if (agreement) await db.update(sourceVerifications).set({ verifyAgreement: agreement }).where(eq(sourceVerifications.id, verificationId));
  } catch (err) {
    console.error(`[jev] agreement for ${verificationId} failed:`, err);
  }
}
```

In `run-source-verification.ts`, right after the `await db.update(sourceVerifications).set({ results: …, completedAt: new Date() })` call: `await recordJevAgreement(verificationId, sourceId, fields, set);` (it never throws; import from `./jev-agreement.js`).

In `routers/sources.ts`, beside `suggestMarks`:

```ts
  /** Jev at Verify, in shadow (spec 2026-10-16 §6): each capture's reading, polled by the tab while one runs. */
  jevReadings: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid(), captureIds: z.array(z.string().uuid()).max(VERIFY_URL_MAX) }))
    .query(async ({ ctx, input }) => {
      await sourceInOrg(ctx, input.sourceId);
      if (input.captureIds.length === 0) return {} as Record<string, { status: 'running' | 'done' | 'failed'; answers: JevAnswers | null }>;
      const rows = await ctx.db.query.jevReadings.findMany({
        where: and(eq(jevReadings.sourceId, input.sourceId), inArray(jevReadings.captureId, input.captureIds)),
        columns: { captureId: true, status: true, answers: true },
      });
      return Object.fromEntries(rows.map((r) => [r.captureId, { status: r.status as 'running' | 'done' | 'failed', answers: r.status === 'done' ? (r.answers as JevAnswers) : null }]));
    }),
```

(imports: `jevReadings` from `@robot/db`, `inArray` and `and` from `drizzle-orm` if not already, `type JevAnswers` from `../verify/jev-reading.js`.)

In `routers/ops.ts`, after computing `results`: read the verification row's agreement — `const agreementRow = fieldCurrency.latest ? await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, fieldCurrency.latest.id), columns: { verifyAgreement: true } }) : null; const agreement = (agreementRow?.verifyAgreement ?? null) as JevAgreement | null;` — and in each field object add:

```ts
          ...(() => {
            if (!agreement) return {};
            const cells = Object.values(agreement.pages).map((p) => p.fields[f.key]).filter((c): c is NonNullable<typeof c> => !!c);
            return cells.length ? { jevAgreement: { agreed: cells.filter((c) => c.agree).length, asked: cells.length } } : {};
          })(),
```

CLI `packages/api/src/jev-agreement.ts`:

```ts
// CLI: Jev at Verify, in shadow — how often Jev agreed with what customers verified (spec 2026-10-16 §7).
//   pnpm --filter @robot/api exec tsx src/jev-agreement.ts [--since 2026-10-16]
import { gte, isNotNull, and } from 'drizzle-orm';
import { db, sourceVerifications } from '@robot/db';
import type { JevAgreement } from './verify/jev-agreement.js';

const sinceArg = process.argv.indexOf('--since');
const since = sinceArg > 0 ? new Date(process.argv[sinceArg + 1]!) : new Date(0);
const rows = await db.query.sourceVerifications.findMany({
  where: and(isNotNull(sourceVerifications.verifyAgreement), gte(sourceVerifications.startedAt, since)),
  columns: { id: true, sourceId: true, verifyAgreement: true },
});
const buckets = new Map<string, { asked: number; agreed: number }>();
const byField = new Map<string, { asked: number; agreed: number }>();
const disagreements: string[] = [];
for (const r of rows) {
  const a = r.verifyAgreement as JevAgreement;
  for (const [url, page] of Object.entries(a.pages)) {
    for (const [key, c] of Object.entries(page.fields)) {
      const b = c.p >= 0.9 ? '≥ 0.9' : c.p >= 0.8 ? '0.8–0.9' : c.p >= 0.6 ? '0.6–0.8' : '< 0.6';
      for (const [map, k] of [[buckets, b], [byField, key]] as const) { const x = map.get(k) ?? { asked: 0, agreed: 0 }; x.asked++; if (c.agree) x.agreed++; map.set(k, x); }
      if (!c.agree) disagreements.push(`${r.sourceId} ${key} ${url}: Jev ${c.value ?? 'none'} (${c.p.toFixed(2)}) · verified ${c.expected}`);
    }
  }
}
const line = (k: string, x: { asked: number; agreed: number }) => `  ${k}: ${x.agreed} of ${x.asked} (${x.asked ? Math.round((100 * x.agreed) / x.asked) : 0}%)`;
console.log(`${rows.length} verifications with readings since ${since.toISOString().slice(0, 10)}`);
console.log('By probability:'); for (const [k, x] of buckets) console.log(line(k, x));
console.log('By field:'); for (const [k, x] of byField) console.log(line(k, x));
console.log(`Disagreements (${disagreements.length}):`); for (const d of disagreements.slice(0, 50)) console.log(`  ${d}`);
process.exit(0);
```

- [ ] **Step 4: Run, expect pass:** `pnpm --filter @robot/api exec vitest run src/verify/jev-agreement.test.ts src/routers/ops.test.ts` and the sources router test file; `pnpm --filter @robot/api exec tsc --noEmit`; then the api suite once: `pnpm --filter @robot/api exec vitest run`.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/verify/jev-agreement.ts packages/api/src/verify/jev-agreement.test.ts packages/api/src/jev-agreement.ts packages/api/src/verify/run-source-verification.ts packages/api/src/routers/sources.ts packages/api/src/routers/ops.ts packages/api/src/routers/ops.test.ts
# plus the sources router test file touched
git commit -m "feat(api): Jev readings query, agreement recorded after a Verify, the agreement CLI, and the ops field line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The Verification tab and ops page (`@robot/app`)

**Files:**
- Create: `packages/app/src/lib/site/jev-view.ts`, `packages/app/src/lib/site/jev-view.test.ts`
- Modify: `packages/app/src/components/verification/verification-table.tsx` (`TableRow.jevNote`, rendered in `StatusCell`), `packages/app/src/components/verification/cell-detail-bar.tsx` (`DetailBarSelection.jevText`), the site route `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx` (the polled query and wiring), `packages/app/src/lib/ops-view.ts` (`OpsField.jevAgreement`, `jevAgreementLine`), `packages/app/src/routes/_app/ops/websites/$sourceId.tsx`
- Test: `packages/app/src/lib/ops-view.test.ts`

**Interfaces:**
- Consumes: the wire shapes from Task 4 (mirrored, never imported); `Board`, `Suggestions`, `Field`, `Card`, `sameValue`, `displayValue` from `verification-model.ts`; `FieldVerification`-like results (the route's `results`).
- Produces:
  ```ts
  export type JevAnswersLike = { fields: Record<string, { candidates: Array<{ id: string; value: string }>; pick: string; p: number }>; variant?: { entries: Array<{ id: string; label: string }>; pick: string; p: number; pageMatch: string | null } };
  export type JevReadingLike = { status: 'running' | 'done' | 'failed'; answers: JevAnswersLike | null };
  export const JEV_NOTE_P = 0.6;
  export const JEV_FIELD_NOTE = (value: string, field: string, n: number) => string;   // "Jev reads 374.25 as the Price on product 1"
  export const JEV_VARIANT_NOTE = (label: string, n: number) => string;              // "Jev reads the selected variant as 6'x9' on product 1"
  export function jevNote(field: Field, board: Board, live: Suggestions, readings: Record<string, JevReadingLike | undefined>, readsVariantList: boolean): string | null;
  export function jevDetailText(reading: JevReadingLike | undefined, fieldKey: string): string; // "Jev: 374.25 (0.98)" | "Jev: none of these (0.71)" | "Jev: not read"
  export function readsVariantList(path: string | undefined): boolean;
  // ops-view.ts
  export function jevAgreementLine(field: { jevAgreement?: { agreed: number; asked: number } }): string | null; // "Jev agreed on 5 of 6 proof pages"
  ```

- [ ] **Step 1: Failing tests.** `packages/app/src/lib/site/jev-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { jevDetailText, jevNote, readsVariantList, type JevReadingLike } from './jev-view';
import { emptyBoard, type Board, type Field, type Suggestions } from './verification-model';

const price: Field = { key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' };
const cards = [{ url: 'u1', title: '' }, { url: 'u2', title: '' }, { url: 'u3', title: '' }];
const board = (answers: Board['answers'] = {}): Board => ({ ...emptyBoard(), cards, answers });
const live = (v: string): Suggestions => ({ price: { u1: { captureId: 'k', value: v, boxes: [], origin: 'page-data' } } });
const done = (pick: string, p: number, extra: Partial<NonNullable<JevReadingLike['answers']>> = {}): JevReadingLike => ({
  status: 'done', answers: { fields: { price: { candidates: [{ id: 'c1', value: '374.25' }, { id: 'c2', value: '$499.00' }], pick, p } }, ...extra },
});

describe('jevNote', () => {
  it('says what Jev reads when it differs from the suggestion', () => {
    expect(jevNote(price, board(), live('499.00'), { u1: done('c1', 0.98) }, false)).toBe('Jev reads 374.25 as the Price on product 1');
  });
  it('silent when Jev agrees with the suggestion (by amount)', () => {
    expect(jevNote(price, board(), live('$374.25'), { u1: done('c1', 0.98) }, false)).toBeNull();
  });
  it('compares with the customer\'s answer when there is one', () => {
    expect(jevNote(price, board({ price: { u1: { value: '499.00', mark: null } } }), {}, { u1: done('c1', 0.9) }, false)).toBe('Jev reads 374.25 as the Price on product 1');
  });
  it('silent below p 0.6, on a none pick, and for a running or failed reading', () => {
    expect(jevNote(price, board(), live('499.00'), { u1: done('c1', 0.59) }, false)).toBeNull();
    expect(jevNote(price, board(), live('499.00'), { u1: done('none', 0.9) }, false)).toBeNull();
    expect(jevNote(price, board(), live('499.00'), { u1: { status: 'running', answers: null } }, false)).toBeNull();
    expect(jevNote(price, board(), live('499.00'), { u1: { status: 'failed', answers: null } }, false)).toBeNull();
  });
  it('a running reading renders nothing, a done one renders', () => {
    expect(jevNote(price, board(), live('499.00'), {}, false)).toBeNull();
    expect(jevNote(price, board(), live('499.00'), { u1: done('c1', 0.98) }, false)).not.toBeNull();
  });
  it('the variant note when the field reads a variant list and Jev differs from the [page] match', () => {
    const r = done('c1', 0.98, { variant: { entries: [{ id: 'e1', label: "2'x3'" }, { id: 'e2', label: "6'x9'" }], pick: 'e2', p: 0.95, pageMatch: 'e1' } });
    expect(jevNote(price, board(), live('$374.25'), { u1: r }, true)).toBe("Jev reads the selected variant as 6'x9' on product 1");
    expect(jevNote(price, board(), live('$374.25'), { u1: r }, false)).toBeNull();
  });
  it('one note per row: the lowest product that differs, the field note first', () => {
    const r = done('c1', 0.98, { variant: { entries: [{ id: 'e1', label: 'a' }, { id: 'e2', label: 'b' }], pick: 'e2', p: 0.95, pageMatch: 'e1' } });
    const l: Suggestions = { price: { u1: { captureId: 'k', value: '374.25', boxes: [], origin: 'page-data' }, u2: { captureId: 'k', value: '499.00', boxes: [], origin: 'page-data' } } };
    expect(jevNote(price, board(), l, { u1: r, u2: done('c1', 0.98) }, true)).toBe('Jev reads 374.25 as the Price on product 2');
  });
});

describe('jevDetailText', () => {
  it('the pick and its probability, none, or not read', () => {
    expect(jevDetailText(done('c1', 0.98), 'price')).toBe('Jev: 374.25 (0.98)');
    expect(jevDetailText(done('none', 0.71), 'price')).toBe('Jev: none of these (0.71)');
    expect(jevDetailText(undefined, 'price')).toBe('Jev: not read');
    expect(jevDetailText(done('c1', 0.98), 'title')).toBe('Jev: not read');
  });
});

describe('readsVariantList', () => {
  it('[page] or a fixed index on a variant list', () => {
    expect(readsVariantList('hasVariant[page].offers.price')).toBe(true);
    expect(readsVariantList('offers[0].price')).toBe(true);
    expect(readsVariantList('@graph[1].name')).toBe(false);
    expect(readsVariantList(undefined)).toBe(false);
  });
});
```

In `packages/app/src/lib/ops-view.test.ts`: `jevAgreementLine({ jevAgreement: { agreed: 5, asked: 6 } })` → `'Jev agreed on 5 of 6 proof pages'`; `{ agreed: 1, asked: 1 }` → `'Jev agreed on 1 of 1 proof page'`; no `jevAgreement` → `null`.

- [ ] **Step 2: Run, expect fail:** `pnpm --filter @robot/app exec vitest run src/lib/site/jev-view.test.ts src/lib/ops-view.test.ts`.

- [ ] **Step 3: Implement** `packages/app/src/lib/site/jev-view.ts`:

```ts
// Jev at Verify, in shadow (spec 2026-10-16 §6): what the Verification tab says
// about a reading. Pure; mirrors @robot/api's JevAnswers (never imported).
// Read-only: nothing here touches the board.
import { normalize } from '@robot/scraper/normalize';
import type { Board, Field, Suggestions } from './verification-model';

export type JevAnswersLike = {
  fields: Record<string, { candidates: Array<{ id: string; value: string }>; pick: string; p: number }>;
  variant?: { entries: Array<{ id: string; label: string }>; pick: string; p: number; pageMatch: string | null };
};
export type JevReadingLike = { status: 'running' | 'done' | 'failed'; answers: JevAnswersLike | null };
export const JEV_NOTE_P = 0.6;
export const JEV_FIELD_NOTE = (value: string, field: string, n: number) => `Jev reads ${value} as the ${field} on product ${n}`;
export const JEV_VARIANT_NOTE = (label: string, n: number) => `Jev reads the selected variant as ${label} on product ${n}`;

const VARIANT_LIST_STEP = /(^|[.\]])(offers|hasVariant|variants|variant|skus|items|products|options)\[(\d+|page)\]/i;
export function readsVariantList(path: string | undefined): boolean {
  return !!path && VARIANT_LIST_STEP.test(path);
}

function same(field: Field, a: string, b: string): boolean {
  if (field.type === 'money' || field.type === 'number') { const x = normalize(field.type, a); return x !== null && x === normalize(field.type, b); }
  return a.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase() === b.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function jevNote(field: Field, board: Board, live: Suggestions, readings: Record<string, JevReadingLike | undefined>, readsVariant: boolean): string | null {
  let variantNote: string | null = null;
  for (const [i, card] of board.cards.entries()) {
    const r = readings[card.url];
    if (!r || r.status !== 'done' || !r.answers) continue;
    const a = r.answers.fields[field.key];
    if (a && a.pick !== 'none' && a.p >= JEV_NOTE_P) {
      const jev = a.candidates.find((c) => c.id === a.pick)?.value;
      const theirs = board.answers[field.key]?.[card.url]?.value ?? live[field.key]?.[card.url]?.value;
      if (jev && theirs && !same(field, jev, theirs)) return JEV_FIELD_NOTE(jev, field.name, i + 1);
    }
    const v = r.answers.variant;
    if (readsVariant && !variantNote && v && v.pick !== 'none' && v.p >= JEV_NOTE_P && v.pick !== v.pageMatch) {
      const label = v.entries.find((e) => e.id === v.pick)?.label;
      if (label) variantNote = JEV_VARIANT_NOTE(label, i + 1);
    }
  }
  return variantNote;
}

export function jevDetailText(reading: JevReadingLike | undefined, fieldKey: string): string {
  const a = reading?.status === 'done' ? reading.answers?.fields[fieldKey] : undefined;
  if (!a) return 'Jev: not read';
  if (a.pick === 'none') return `Jev: none of these (${a.p.toFixed(2)})`;
  const v = a.candidates.find((c) => c.id === a.pick)?.value;
  return v ? `Jev: ${v} (${a.p.toFixed(2)})` : 'Jev: not read';
}
```

`ops-view.ts`: add `jevAgreement?: { agreed: number; asked: number };` to `OpsField` and

```ts
/** Spec 2026-10-16 §8: how often Jev agreed with the verified value on this field's proof pages; null when never asked. */
export function jevAgreementLine(field: Pick<OpsField, 'jevAgreement'>): string | null {
  const a = field.jevAgreement;
  if (!a || a.asked === 0) return null;
  return `Jev agreed on ${a.agreed} of ${a.asked} proof ${a.asked === 1 ? 'page' : 'pages'}`;
}
```

and in `routes/_app/ops/websites/$sourceId.tsx`, beside the `defaultLine(field)` paragraph: `{jevAgreementLine(field) ? <p className="mb-2 text-sm text-muted-foreground">{jevAgreementLine(field)}</p> : null}`.

`verification-table.tsx`: add `jevNote: string | null;` to `TableRow`; add `jevNote: string | null` to `StatusCellProps` and pass `jevNote={row.jevNote}` where `StatusCell` is rendered; in `StatusCell`, render it after the address warning, muted, whatever the status kind (it never changes the status):

```tsx
function StatusCell({ addressWarning, jevNote, ...props }: StatusCellProps) {
  const shows = !!addressWarning && (props.status.kind === 'accepted' || props.status.kind === 'agreed' || props.badge?.kind === 'verified');
  if (!shows && !jevNote) return <StatusBody {...props} />;
  return (
    <div className="flex flex-col gap-1">
      <StatusBody {...props} />
      {shows ? <span className="text-sm text-warn">{addressWarning}</span> : null}
      {jevNote ? <span className="text-sm text-muted-foreground" data-testid="jev-note">{jevNote}</span> : null}
    </div>
  );
}
```

`cell-detail-bar.tsx`: add `jevText?: string;` to `DetailBarSelection`; render under the value block, only when set: `{s.jevText ? <p className="text-sm text-muted-foreground" data-testid="jev-text">{s.jevText}</p> : null}`.

Site route — after the `suggestQueries` block:

```tsx
  // Jev at Verify, in shadow (spec 2026-10-16 §6): each captured product's reading, polled while one runs.
  const captureIdList = capturedUrls.map((u) => captures.byUrl[u]!.captureId);
  const jevQuery = trpc.sources.jevReadings.useQuery(
    { sourceId: site.id, captureIds: captureIdList },
    { enabled: captureIdList.length > 0, refetchInterval: (q) => (Object.values(q.state.data ?? {}).some((r) => r.status === 'running') ? 3000 : false) },
  );
  const jevByUrl: Record<string, JevReadingLike | undefined> = Object.fromEntries(capturedUrls.map((u) => [u, jevQuery.data?.[captures.byUrl[u]!.captureId]]));
```

(use the route's existing name for the website's id where it reads `site.id`; check how `proofPageCaptures` is called in the route and pass the same id.) In the `rows` mapping add:

```tsx
      jevNote: jevNote(f, board, live, jevByUrl, board.cards.some((c) => {
        const cell = results?.[f.key]?.cells[c.url];
        return readsVariantList(cell && cell.status === 'pass' ? cell.path?.path : undefined) || readsVariantList(live[f.key]?.[c.url]?.via?.path);
      })),
```

and in `detailBar`: `jevText: url ? jevDetailText(jevByUrl[url], detailField.key) : undefined,` — shown only when the switch produced a reading: when `jevQuery.data` has no entry for that capture, pass `undefined` instead (so a tab with Jev off shows nothing): `jevText: url && jevByUrl[url] ? jevDetailText(jevByUrl[url], detailField.key) : undefined`.

Imports in the route: `import { jevDetailText, jevNote, readsVariantList, type JevReadingLike } from '../../../../../../lib/site/jev-view';`. (If the `results` cell type lacks `path`, use the same access `addressWarning` uses.)

- [ ] **Step 4: Run, expect pass:** `pnpm --filter @robot/app exec vitest run src/lib/site/jev-view.test.ts src/lib/ops-view.test.ts`; `pnpm --filter @robot/app exec tsc --noEmit`; the app unit suite once: `pnpm --filter @robot/app exec vitest run`.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/lib/site/jev-view.ts packages/app/src/lib/site/jev-view.test.ts packages/app/src/components/verification/verification-table.tsx packages/app/src/components/verification/cell-detail-bar.tsx "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx" packages/app/src/lib/ops-view.ts packages/app/src/lib/ops-view.test.ts "packages/app/src/routes/_app/ops/websites/\$sourceId.tsx"
git commit -m "feat(app): Jev in shadow on the Verification tab — the row note where Jev differs, Jev's pick in the detail bar, the ops agreement line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The route smoke and the docs

**Files:**
- Create: `packages/api/src/test-helpers/seed-jev-reading.ts`
- Modify: `packages/app/src/routes-smoke.test.ts` (one new test), `docs/handoff.md`, `CLAUDE.md`, `.env.example`, `docs/superpowers/specs/2026-10-16-jev-at-verify-shadow-design.md` (status line)

**Interfaces:**
- Consumes: Task 2's table; Task 4's `jevReadings` query; Task 5's `data-testid="jev-note"` and `"jev-text"`.
- Produces: `seedJevReading(input: { sourceId: string; captureId: string; url: string; answers: unknown }): Promise<{ readingId: string }>`.

- [ ] **Step 1: The seed helper** `packages/api/src/test-helpers/seed-jev-reading.ts`:

```ts
// A done Jev reading inserted directly, so the route smoke can read the shadow note
// without a TypeSafe request (spec 2026-10-16 §11). Cascades with the source.
import { db, jevReadings } from '@robot/db';

export async function seedJevReading(input: { sourceId: string; captureId: string; url: string; answers: unknown }): Promise<{ readingId: string }> {
  const [row] = await db.insert(jevReadings).values({ ...input, status: 'done', model: 'jev-1.14.0', inputTokens: 0, costUsd: '0', completedAt: new Date() })
    .onConflictDoUpdate({ target: jevReadings.captureId, set: { answers: input.answers, status: 'done' } })
    .returning({ id: jevReadings.id });
  return { readingId: row!.id };
}
```

- [ ] **Step 2: The smoke test** in `packages/app/src/routes-smoke.test.ts`, after "a proof page whose address names a variant that the certified path ignores reads the row warning" (it leaves the website with three proof pages and product 1 = `/p/11?variant=f2`; reuse its style):

```ts
  // Jev at Verify, in shadow (spec 2026-10-16 §6): a seeded reading on product 1 reads Price
  // differently from the row's value → the row note and the detail bar's text. No request is sent.
  it('a Jev reading that differs from the row shows its note and its pick', async () => {
    expect(projectSlug, 'there is no project').not.toBeNull();
    expect(websiteSlug, 'there is no website').not.toBeNull();
    problems.length = 0;
    await page.goto(`${APP}/projects`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(1500);
    const api = apiAs(await sessionCookie(context));
    const site = await api.sources.get.query({ projectSlug: projectSlug!, sourceSlug: websiteSlug! });
    const priceKey = site.fields.find((f) => f.name === 'Price')?.key;
    expect(priceKey, 'no key for Price').toBeTruthy();
    const urls = (site.verificationSet as { urls: string[] }).urls;
    const caps = await api.sources.proofPageCaptures.query({ sourceId: site.id, urls });
    const first = caps[urls[0]!];
    expect(first?.captureId, 'product 1 has no capture to seed a reading on').toBeTruthy();
    await seedJevReading({
      sourceId: site.id, captureId: first!.captureId, url: urls[0]!,
      answers: { fields: { [priceKey!]: { candidates: [{ id: 'c1', value: '59.00', source: 'seed' }, { id: 'c2', value: '79.00', source: 'seed' }], pick: 'c1', p: 0.93 } } },
    });
    await page.goto(`${APP}/projects/${projectSlug}/sites/${websiteSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await waitForHydration(page, 'input[aria-label="Listing page"]');
    const note = 'Jev reads 59.00 as the Price on product 1';
    await expect.poll(() => page.getByTestId('jev-note').filter({ hasText: note }).count(), { timeout: 30_000 }).toBe(1);
    expect(await rowStatusText('Price'), "the note is not in Price's status column").toContain(note);
    await page.locator('button[aria-label^="Price on product 1: "]').click();
    await expect.poll(() => page.getByTestId('jev-text').innerText(), { timeout: 10_000 }).toBe('Jev: 59.00 (0.93)');
    await shootViewportBothThemes(page, 'app-site-verification-jev');
    expect(problems, problems.join('\n')).toEqual([]);
  }, 120_000);
```

(`proofPageCaptures` returns a record by url; check its value shape in `latestProofPageCaptures` — if it is `{ status, captureId, … } | null`, read `captureId` as above. Import `seedJevReading` from `'../../api/src/test-helpers/seed-jev-reading'` beside the other seed imports. Product 1's Price on that website was typed 79.00 by the previous test, so Jev's 59.00 differs.)

Run: `pnpm --filter @robot/app exec tsc --noEmit` (the smoke itself runs on `main` after the merge).

- [ ] **Step 3: Docs.**
  - `.env.example`, after `ANTHROPIC_API_KEY=`:
    ```
    # Jev at Verify, in shadow (spec 2026-10-16): off unless JEV_SHADOW=1 and a TypeSafe key is set.
    TYPESAFE_API_KEY=
    JEV_SHADOW=
    # Readings per UTC day across the api-server (one per proof-page capture); default 2000.
    JEV_DAILY_READINGS=
    ```
  - `CLAUDE.md` Environment list: `TYPESAFE_API_KEY`, `JEV_SHADOW`, `JEV_DAILY_READINGS` with one line each (as above); Key Technical Decisions, after the variant line: `- Jev at Verify, in shadow (2026-10-16): with JEV_SHADOW=1 and a TypeSafe key, each proof-page capture gets one Jev reading (screenshot once in state): which candidate each ambiguous text/money/number field is, which variant the page shows. Shown where Jev differs ("Jev reads …"), recorded against what the customer verifies, never applied.`
  - `docs/handoff.md`: a section "## Jev at Verify, in shadow (2026-10-16)" in the style of "The variant the address names (2026-10-14)": what a customer sees (the two notes, the detail-bar text), how it was proven (tests per package, smoke and live check: "see the plan's status"), deviations (the planner's notes above), known gaps (no re-read on a contract change; booleans/images/descriptions not asked; no store-JSON variant fallback), how to turn it on (`JEV_SHADOW=1`, `TYPESAFE_API_KEY`, `JEV_DAILY_READINGS`), how to read the numbers (`pnpm --filter @robot/api exec tsx src/jev-agreement.ts`). A "Newest:" paragraph above the previous one, and a next-work item: "after ~20 websites, read the agreement and decide §9".
  - The spec's status: `**Status:** implemented on \`feat/jev-at-verify\`, 2026-10-16; merge, final review, the route smoke and the live check: see \`docs/handoff.md\`.` plus a `**Deviations:**` list copying the planner's notes.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/test-helpers/seed-jev-reading.ts packages/app/src/routes-smoke.test.ts
git commit -m "test(app): route smoke reads a seeded Jev reading's row note and detail-bar text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git add docs/handoff.md CLAUDE.md .env.example docs/superpowers/specs/2026-10-16-jev-at-verify-shadow-design.md
git commit -m "docs: Jev at Verify, in shadow — handoff section, key decision, env template, spec status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### After the merge (the controller, not a task)

- Route smoke on `main` against `pnpm dev:all` (25 + 1 tests).
- Spec §11 live step: with `JEV_SHADOW=1` set for the api-server (Marko restarts `pnpm dev:all` with it in `.env`), re-capture the proof pages of Ruggable, Gymshark, Colourpop and Kith in the campaign project ("Try again" on each card), read the notes and the detail-bar text, SELECT the `jev_readings` rows (status, picks, `input_tokens`, `cost_usd`); expected total ≈ $0.01.
