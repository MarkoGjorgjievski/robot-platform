# "Shown on the page" — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A run flags every certified value the product's page does not show, the run page and the Sample panel count and name them, the judge report measures the flag against the paid verdict; and at Verify a Title that is not the page's heading never reads "agreed" and a typed value the page does not show warns.

**Architecture:** Part A is a pure check in `@robot/scraper` (`shownOnPage`) computed inside `runVerifiedExtraction` on the capture in memory, stored by `extract-item.ts` in the unused `extractions.validation_result` column, aggregated by `load-run-coverage.ts`, and rendered by the run page and the Sample panel; the judge CLI reads the stored flag into its report. Part B adds `headingText` and `pageText` to the `suggestMarks` query and two pure rules in the app's `verification-model`.

**Tech Stack:** TypeScript ESM; vitest; Drizzle + Postgres; tRPC v11; TanStack Start + React 19 + Tailwind v4; Playwright for the route smoke.

**Spec:** `docs/superpowers/specs/2026-10-12-shown-on-the-page-design.md`

## Global Constraints

- The check never changes a value, a hit, a path stat or a run's status (spec §8 property 1): a run with every value shown produces byte-identical rows and stats.
- Types not checked: `url`, `image`, `boolean`, `date` → `null` (spec D2). An `xpath` path is `true` without a comparison.
- Copy is exact (spec §7 and §B3): fill table `8 not shown` / `not checked`; panel title `Values not shown on their page`; panel row `{Field}: {n} of {m} values are not on the product's page · from {source} ({path})`; panel sentence `A value the page does not show for that product is usually another product's or the page's SEO text. Add one of these products as a proof page and mark the field there.`; cell title `not shown on the page`; summary `{rows} rows · {confidence}% confidence · {n} values not shown on their page`; Sample `{n} values not shown on their page: {fields}`; row reason `not the page's heading on product n`; cell word `not on this page`.
- No migration: `extractions.validation_result` (jsonb, unused) holds `{ shown, paths }`.
- **Sequencing:** Task 3 touches `judge-run.ts`/`judge-run-report.ts`, which the branch `feat/judge-changes` also changes; this plan's branch is cut from `main` AFTER that branch merges, and Task 3 moves the judge's number matcher onto Task 1's module rather than keeping two.
- Tests per package only, never `pnpm -r test`; one Chromium-heavy process at a time; the route smoke once, at the end (Task 6), never while a campaign batch runs on the same servers.
- Commits by explicit path; never `git add -A`/`.`; never stage `packages/app/src/routeTree.gen.ts`; every message ends `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `.js` suffix on relative imports in scraper/api; none in app; `@robot/app` never imports `@robot/scraper`/`@robot/api`.

## Review Focus

1. A value shown only inside an `alt`/`title` attribute or a `<script>` JSON blob is NOT shown: the visible-text helper strips tags, scripts and styles, so attribute text never counts. → Task 1 test (JSON-LD description present only in a script → `false`).
2. A number rendered with a unit glued on (`4.5★`, `12€`, `1.144 Bewertungen`) is shown: tokens are split on non-digit boundaries around the number. → Task 1 tests.
3. A page with an empty body (a capture that produced no visible text) flags every checkable value `false` and never throws. → Task 1 test.
4. An older run (no `validation_result`) renders the run page exactly as today: no panel, no marks, no summary suffix, "not checked" in the fill table. → Task 2 and Task 4 tests.
5. At Verify, a Title suggestion equal to the heading except for case or whitespace is still the heading (normalised comparison); a page with no heading box at all leaves the rule inert (agreed as today). → Task 5 tests.

---

### Task 1: `shownOnPage` and the companion `shown` map (`@robot/scraper`)

**Files:**
- Create: `packages/scraper/src/verify/shown-on-page.ts`, `shown-on-page.test.ts`
- Modify: `packages/scraper/src/verify/verified-extraction.ts` (compute per field; `VerifiedExtractionResult.shown`), `packages/scraper/src/index.ts` (export)
- Test: `packages/scraper/src/verify/verified-extraction.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Shown = boolean | null;
  export function pageTextOf(html: string): string;            // visibleTextFromHtml, NFKC, lower-cased, whitespace collapsed
  export function numberShownInText(value: unknown, type: 'number' | 'money', text: string, fieldWords: string[]): boolean;
  export function shownOnPage(field: { type: CustomerFieldType; key: string; concept: string }, path: CertifiedPath, value: unknown, pageText: string): Shown;
  // VerifiedExtractionResult gains: shown: Record<string, Shown>
  ```

- [ ] **Step 1: Failing tests** (`shown-on-page.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { numberShownInText, pageTextOf, shownOnPage } from './shown-on-page.js';

const xp = { source: 'xpath' as const, path: '//h1', transform: 'identity' as const };
const ld = { source: 'json-ld' as const, path: 'description', transform: 'identity' as const };
const text = (f: 'text' | 'number' | 'money' | 'url' | 'image' | 'boolean' | 'date', key = 'f') => ({ type: f, key, concept: key });

describe('pageTextOf', () => {
  it('drops scripts, styles and tags, collapses whitespace, lower-cases, NFKC', () => {
    expect(pageTextOf('<p>Hello&nbsp;  WORLD</p><script>{"description":"hidden"}</script><style>.x{}</style>')).toBe('hello world');
  });
});

describe('numberShownInText', () => {
  it.each([
    ['4.5', 'rated 4.5 out of 5 stars', true], ['4.5', 'rated 4,5 von 5', true], ['4.5', '4.50 average', true],
    ['12', 'price $12.00 today', true], ['910', 'myr 910', true], ['1144', '(1,144) reviews', true], ['1144', '1.144 bewertungen', true],
    ['4.5', '4.5★ overall', true], ['12', '12€', true],
    ['12', 'sku 1200-12x price 15', false], ['4.5', 'nothing here', false],
  ])('%s in "%s" → %s', (v, t, expected) => { expect(numberShownInText(v, 'number', t, ['rating'])).toBe(expected); });
  it('a bare 0 counts only next to the field words', () => {
    expect(numberShownInText('0', 'number', 'code p0-0 size 0.5', ['rating'])).toBe(false);
    expect(numberShownInText('0', 'number', 'rating 0 reviews', ['rating', 'reviews'])).toBe(true);
    expect(numberShownInText(0, 'number', '0 reviews', ['reviews'])).toBe(true);
  });
});

describe('shownOnPage', () => {
  const page = pageTextOf('<h1>Super Shock Shadow</h1><p>Drift</p><div class="price">$12.00</div><p>Rated 4.5 out of 5</p><p>A long description that starts here and goes on for quite a while, longer than eighty characters in total so that the prefix rule applies.</p><script type="application/ld+json">{"description":"SEO text nobody shows"}</script>');
  it('an xpath value is shown by definition', () => expect(shownOnPage(text('text'), xp, 'anything', page)).toBe(true));
  it('url, image, boolean, date are not checked', () => {
    for (const t of ['url', 'image', 'boolean', 'date'] as const) expect(shownOnPage(text(t), ld, 'x', page)).toBeNull();
  });
  it('text: a normalised substring', () => {
    expect(shownOnPage(text('text'), ld, 'super shock SHADOW', page)).toBe(true);
    expect(shownOnPage(text('text'), ld, 'SEO text nobody shows', page)).toBe(false);          // Review Focus 1
    expect(shownOnPage(text('text'), ld, 'Drift', page)).toBe(true);                           // on the page, though not the heading
  });
  it('text over 80 characters: its first 80', () => {
    const long = 'A long description that starts here and goes on for quite a while, longer than eighty characters in total so that the prefix rule applies. And then it is folded away by the page.';
    expect(shownOnPage(text('text'), ld, long, page)).toBe(true);
  });
  it('money and number', () => {
    expect(shownOnPage(text('money'), ld, '12', page)).toBe(true);
    expect(shownOnPage(text('money'), ld, '15', page)).toBe(false);
    expect(shownOnPage({ type: 'number', key: 'rating', concept: 'rating' }, ld, 4.5, page)).toBe(true);
    expect(shownOnPage({ type: 'number', key: 'rating', concept: 'rating' }, ld, 0, page)).toBe(false);
  });
  it('an empty page flags every checkable value false and never throws', () => {               // Review Focus 3
    expect(shownOnPage(text('text'), ld, 'x', pageTextOf(''))).toBe(false);
    expect(shownOnPage(text('money'), ld, '12', '')).toBe(false);
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @robot/scraper exec vitest run src/verify/shown-on-page.test.ts` → module not found.

- [ ] **Step 3: Implement** (`shown-on-page.ts`):

```ts
// Is a certified value shown on the product's rendered page? (spec 2026-10-12 §3)
// Pure and free: the capture's visible text is in memory at extraction time.
import type { CertifiedPath, CustomerFieldType } from './types.js';
import { visibleTextFromHtml } from '../corroborate-value.js';

export type Shown = boolean | null;
const PREFIX = 80;
const UNCHECKED: ReadonlySet<string> = new Set(['url', 'image', 'boolean', 'date']);

export function pageTextOf(html: string): string {
  return visibleTextFromHtml(html).normalize('NFKC').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normText(v: unknown): string {
  return String(v ?? '').normalize('NFKC').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Every common rendering of a number: decimal mark `.` or `,`, with or without thousands separators, one or two decimals. */
function renderings(n: number): string[] {
  const out = new Set<string>();
  const fixed = (d: number) => n.toFixed(d);
  for (const s of [String(n), fixed(1), fixed(2)]) {
    out.add(s); out.add(s.replace('.', ','));
    const [int, frac] = s.split('.');
    const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    out.add(frac ? `${grouped}.${frac}` : grouped);
    out.add(frac ? `${grouped.replace(/,/g, '.')},${frac}` : grouped.replace(/,/g, '.'));
  }
  if (Number.isInteger(n)) out.add(String(n));
  return [...out];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function numberShownInText(value: unknown, type: 'number' | 'money', text: string, fieldWords: string[]): boolean {
  const raw = String(value ?? '').replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n) || raw === '') return false;
  if (n === 0) {
    // A bare 0 proves nothing (Decathlon's rating fallback): only next to the field's own words.
    const words = fieldWords.map(escape).join('|');
    return words.length > 0 && new RegExp(`(?:${words})\\s*[:]?\\s*0(?!\\d)|(?<!\\d)0\\s*(?:${words})`).test(text);
  }
  return renderings(Math.abs(n)).some((r) => new RegExp(`(?<![\\d.,])${escape(r)}(?![\\d])`).test(text));
}

export function shownOnPage(field: { type: CustomerFieldType; key: string; concept: string }, path: CertifiedPath, value: unknown, pageText: string): Shown {
  if (UNCHECKED.has(field.type)) return null;
  if (path.source === 'xpath') return true;
  if (value === null || value === undefined || value === '') return null;
  if (field.type === 'number' || field.type === 'money') {
    return numberShownInText(value, field.type, pageText, [field.key, field.concept, ...field.concept.split(/[_\s]+/)].map(normText).filter(Boolean));
  }
  const v = normText(value);
  if (v === '') return null;
  const needle = v.length > PREFIX ? v.slice(0, PREFIX) : v;
  return pageText.includes(needle);
}
```

(`CustomerFieldType` values: check `packages/scraper/src/verify/types.ts` `CUSTOMER_FIELD_TYPES` for the exact names of the url/image/boolean/date/money/number/text types and use those.)

In `verified-extraction.ts`, after the `data`/`stats` loop: `const pageText = pageTextOf(capture.html); const shown: Record<string, Shown> = {}; for (const f of req.fields) { const hit = stats.find((s) => s.key === f.key && s.hit); shown[f.key] = hit ? shownOnPage(f, hit.path, hit.value, pageText) : null; }` and return it. `VerifiedField` needs `concept` (it has it). Export `shownOnPage`, `numberShownInText`, `pageTextOf`, `type Shown` from the index.

- [ ] **Step 4: Property 1 test** in `verified-extraction.test.ts`: with the fake browser the file uses, `data` and `stats` are byte-identical to before (snapshot the previous expectation) and `shown` carries `true` for a JSON-LD price present in the html, `false` for a description absent from it, `null` for an image.

- [ ] **Step 5: Run** — `pnpm --filter @robot/scraper test`; `tsc --noEmit`.

- [ ] **Step 6: Commit** — explicit paths, message `feat(scraper): shownOnPage — is a certified value on the product's rendered page; runVerifiedExtraction returns the flag per field`.

---

### Task 2: Store the flag and count it (`@robot/api`)

**Files:**
- Modify: `packages/api/src/crawl/extract-item.ts` (`persistRows(rows, confidence, metadata, validationResult?)` → the extraction insert gets `validationResult: { shown, paths }` where `paths[key]` is the hit path from `verified.stats`), `packages/api/src/crawl/coverage.ts` (`FieldCoverage` gains `notShown: number; checked: number`; `RunCoverage` gains `unshownItems: Array<{ url: string; fields: string[] }>`; `computeCoverage` takes per item `shown: Record<string, boolean | null> | null`), `packages/api/src/crawl/load-run-coverage.ts` (loads `extraction.validationResult`)
- Test: `packages/api/src/crawl/extract-item.test.ts` (persisted `validationResult`), `coverage.test.ts` (counts; Review Focus 4: items without the flag count as not checked; `unshownItems` capped at 50 in item order)

- [ ] **Step 1: Failing tests** — read the two test files' fixtures; add: `computeCoverage([{name:'price'},{name:'description'}], [{…, row: {price:'12', description:'x'}, shown: { price: true, description: false }}, {…, row: {price:'15', description:'y'}, shown: null}])` → price `{ notShown: 0, checked: 1 }`, description `{ notShown: 1, checked: 1 }`, `unshownItems: [{ url: <first>, fields: ['description'] }]`; extract-item: the certified branch persists `validationResult.shown` equal to the fake `extractVerified`'s `shown`.
- [ ] **Step 2: Implement.** `persistRows` gets a fourth optional argument; the certified branch passes `{ shown: verified.shown, paths: Object.fromEntries(verified.stats.filter(s => s.hit).map(s => [s.key, s.path])) }`; the non-certified branches pass nothing.
- [ ] **Step 3: Run** — `pnpm --filter @robot/api test`; `tsc --noEmit`.
- [ ] **Step 4: Commit** — `feat(api): a run stores whether each certified value was shown on its page; the coverage report counts the values that were not`.

---

### Task 3: The judge measures the flag (`@robot/api`, after `feat/judge-changes` merged)

**Files:**
- Modify: `packages/api/src/judge-run.ts` (the rows query also selects `extractions.validationResult`; each judged `Cell` gets `shown: boolean | null | undefined` from it), `judge-run-report.ts` (`Cell.shown?`; per-value rows show `shown` as `true` / `false` / `—`; the summary gains the confusion table: wrong & not shown, wrong & shown, right & not shown, right & shown, unflagged), `judge-local.ts` (from the judge-changes branch: replace its number matcher with `numberShownInText` from `@robot/scraper`, same behaviour; keep its tests)
- Test: `judge-run-report.test.ts` (the table on a fixture of six cells)

- [ ] Steps: failing test → implement → `pnpm --filter @robot/api exec vitest run src/judge-run-report.test.ts src/judge-local.test.ts` → full api tests → commit `feat(judge): the report shows the stored shown-on-the-page flag beside each verdict and a confusion table`.

---

### Task 4: The run page and the Sample panel (`@robot/app`)

**Files:**
- Modify: `packages/app/src/lib/site/coverage-view.ts` (`notShownBadge(cov): string | null` → `n not shown` / `not checked` / null per spec), `lib/site/run-screen-view.ts` (`resultsSummary(rowCount, confidence, notShown?)` with the suffix; `unshownRows(coverage, nameOf, paths)` → the panel rows' text), `lib/site/extract-view.ts` (`sampleFacts` gains the `{n} values not shown on their page: {fields}` fact), `components/runs/results-table.tsx` (column head shows the badge after the fill badge; a not-shown cell gets `border-l-2 border-warn` and `title="not shown on the page"` — the table needs per-row `unshown: Set<fieldKey>` built by the route from `unshownItems`), `components/runs/unshown-panel.tsx` (new: title, one row per field with up to five product links and "Use as proof page" via the run page's existing `?addPage` link, the sentence), the run route `$run.tsx` (renders the panel under the fill table when `notShown > 0`), `components/extract/extract-sample.tsx` (passes the count)
- Test: `coverage-view.test.ts`, `run-screen-view.test.ts`, `extract-view.test.ts` (the copy, exact), Review Focus 4 (null coverage → today's strings)

- [ ] Steps: failing tests for the three pure functions → implement → `pnpm --filter @robot/app test`; `tsc --noEmit` → commit `feat(app): the run page counts, names and marks the values the product's page does not show; the Sample panel counts them too`.

---

### Task 5: Part B — the heading rule and the typed-value warning (`@robot/api`, `@robot/app`)

**Files:**
- Modify: `packages/api/src/routers/sources.ts` `suggestMarks` (~line 790–802): the response gains `headingText: string | null` (the text of the first box with `tag === 'h1'` in `meta.boxes`, else the largest box among `h1`…`h3` by `rect.w * rect.h`, else null) and `pageText: string` (`pageTextOf(capture.html)` capped at 8,000 characters)
- Modify: `packages/app/src/lib/site/verification-model.ts`: `Suggestions` entries are keyed per url — add a parallel `pageFacts: Record<url, { headingText: string | null; pageText: string }>` kept by the route from the suggestMarks results (~index.tsx line 537–545); `rowStatus(field, board, live, boxesByUrl, failedUrls?, failedKinds?, pageFacts?)`: for `field.concept === 'product_name'`, a suggestion whose normalised value ≠ the normalised `headingText` (when a heading exists) → `{ kind: 'needs-you', reason: \`not the page's heading on product ${n}\`, product: n }` before the places check; `typedNotShown(field, answer, pageText): boolean` → true when the answer has no mark and no via, the field's type is checkable, and the §3 rule (reuse the same text/number logic — re-declare a small `textShown`/`numberShown` in the app, since the app cannot import the scraper; keep the two in step by the same tests) says not shown
- Modify: `components/verification/verification-table.tsx`: `TableCell.notOnPage?: boolean` → the cell's text gets `text-warn` and `title="The page does not show this value; a path that produces it will be certified anyway. Mark it on the screenshot if it is there, or use \"Not on this product\"."` and the word `not on this page` after the value; the route sets it from `typedNotShown`
- Test: `verification-model.test.ts` (B3's cases; Review Focus 5: case/whitespace-insensitive heading match; no heading → agreed as today), `sources` test for `headingText`/`pageText`

- [ ] Steps: failing tests → implement → api and app tests, `tsc` ×2 → commit `feat(verify): a Title that is not the page's heading never reads agreed; a typed value the page does not show warns`.

---

### Task 6: The route smoke

**Files:**
- Modify: `packages/app/src/routes-smoke.test.ts`: (a) the seeded run helper (`packages/api/src/test-helpers/seed-variants-run.ts` or a new `seed-unshown-run.ts`) writes an extraction with `validationResult: { shown: { description: false, price: true }, paths: {…} }` → the run page shows `1 not shown` in the Description column head, the panel `Values not shown on their page` with the row text, the cell title, the summary suffix; (b) a fixture product `/p/10` whose JSON-LD `name` is "Widget E (Drift)" while its `<h1>` is "Widget E" — added by URL as a 5th card in the coverage test's flow (after the absent step) → the Title row reads `not the page's heading on product 5`; (c) a typed Brand "Widget shop | We Do Widgets" on card 1 → the cell reads `not on this page`.
- Needs `pnpm dev:all` and NO campaign batch running on the same servers (the smoke's wall test backs the shop's host off; the campaign's browser use would collide) — the controller schedules it.

- [ ] Steps: fixture → test → `pnpm test:ui:app` once → commit with the refreshed screenshots.

---

### Task 7: Live check, handoff, spec status

- Live, free: `crawl.coverage` on the campaign-2 Gymshark run (id in `docs/testing/results/campaign-2026-10-11/gymshark.md`) after a re-Extract of 10 products (free): the panel names Brand (the tagline) as not shown; on Colourpop's run the titles are shown (expected: B1's job, not Part A's); record in `docs/testing/results/2026-10-12-shown-on-the-page-live-check.md`.
- Handoff: a section, the next-work list, "What NOT to redo" (never drop or re-extract on the flag; never check at Verify beyond B1/B2).
- Spec status line + deviations. Commit.

---

## Self-review

**Spec coverage.** §3 (the check, every type rule, the 80-char prefix, the `0` rule) → Task 1. §4 (storage in `validation_result`, backfill/repair rows through the same code, old rows "not checked") → Task 2. §5 (fill table figure, the panel with "Use as proof page", the cell mark, the summary line, the Sample line; ops unchanged) → Task 4. §6 (judge column + confusion table) → Task 3. Part B B1/B2/B3 → Task 5; B3's smoke → Task 6. §8 properties 1–7 → Tasks 1 (1–5), 2 (6), 4 (7). §9 testing → Tasks 1–5 unit, 6 smoke, 7 live.

**Placeholders.** Task 1 carries full code and tests; Tasks 2–5 name the exact functions, signatures, copy and test cases and the files' current line areas (the implementer reads them); the heading-box rule and the app-side re-declaration are spelled out.

**Type consistency.** `Shown = boolean | null` everywhere; `validationResult = { shown: Record<key, Shown>; paths: Record<key, CertifiedPath> }` in Tasks 2, 3, 4, 6; `notShown`/`checked`/`unshownItems` in Tasks 2 and 4; `headingText`/`pageText` in Task 5's api and app.

**Review Focus.** 1, 2, 3 → Task 1 tests; 4 → Tasks 2 and 4; 5 → Task 5.
