# The variant the address names — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A run's row carries the values of the variant its address names (or the one the page shows selected): every capture computes a page variant, a certified path can read an array by it with the `[page]` address form, Verify proposes and prefers that form, a proof page whose address names a variant the certified path ignores gets a row warning, and a page that does not show the named variant fails its capture with one sentence.

**Architecture:** `@robot/browser` computes `PageCapture.pageVariant` from the address, a selection script the caller passes in (`CaptureOptions.selection`, so browser never imports scraper) and the page data's `selected…` keys, and decides the new `wrong-variant` verdict. `@robot/scraper` owns the matching (`verify/page-variant-match.ts`), the `[page]` step in `getByDotPath` (a `ctx` threaded through `resolveStructured`, `evaluatePath`, the ready check and certification), the `[page]` twin in candidate search and its ranking, the selection script (`variant-dom.ts`) and the fragment rule. `@robot/api` returns the page variant beside `headingText`/`pageText` and fails a run item on the new verdict exactly as on a wall. `@robot/app` shows the row warning. Paths without `[page]` and captures without a page variant behave byte-for-byte as today.

**Tech Stack:** TypeScript ESM; vitest; Playwright (browser tests against a local `http` server); tRPC v11 + Drizzle/Postgres; TanStack Start + React 19.

**Spec:** `docs/superpowers/specs/2026-10-14-variant-from-the-address-design.md`

**Planner's notes (deviations from the spec's letter, each within its intent):**
- Matching rule 3 (labels): for an entry's `name`/`title` the normalised labels are matched by *containment*, and then every page label must be contained (Burrow's `?Fabric=Moss Green - Performance Flatweave&Leg Finish=Black - Metal` against the entry name "Range 4-Piece … - Moss Green - Performance Flatweave / Black - Metal": every entry's name carries "Black - Metal", so one contained label alone would match them all); equality of any one label stays for `size`, `color`, `colour`, the sku suffix and axis values. A contained label of fewer than 3 normalised characters never matches.
- Glossier's stored capture carries no variants API body (only reviews), so the Shopify `variants[].id` fixture comes from Skullcandy's own `/products/<handle>.json` body, which the capture holds.
- Burrow's intercepted GraphQL body carries no `selectedOptions`; its match comes from rule 3 on the JSON-LD `hasVariant` names and from `color`/`material` axis values (rule 2's "an entry key that equals the pair's name" does not fire for `Fabric`; the label rule does).
- The selection DOM script lives in `@robot/scraper`'s `variant-dom.ts` (`buildSelectionScript`) and reaches the browser through a new `CaptureOptions.selection` string, the way `annotate` and `ready.script` already do; the page data's `selected…` walk is a small function inside `@robot/browser` (it must not import `findEntitySubtree`).
- The run-item failure needs no api code: `extract-item.ts` already throws `CaptureProblemError` for any non-`ok` verdict and `execute-run.ts`'s `wallSentence` already returns null for kinds other than `refused`/`challenge`. Task 4 pins both with tests instead of changing them.
- The smoke never clicks Verify: Task 5's smoke test seeds a stored verification result whose Price cell path is `offers[0].price` on a proof page addressed `?variant=…` and reads the row warning; the `[page]` certification itself is pinned in Task 2's unit tests.

## Global Constraints

- Copy, exact (spec §10): verdict sentence `The page did not show the variant the address names (swatch=16).` with the address's own text in the parentheses; Verification row warning `reads the first variant, not the one the address names on product 3` with the product number.
- `[page]` resolves to exactly one entry or to nothing — never entry 0 (spec §11 property 1); a path without `[page]` resolves byte-for-byte as today, with or without a page variant (property 2); matching never reads a price or an availability (property 3).
- `PageVariant.named` comes only from the address, `selected` only from the page; a capture built outside the browser has no `pageVariant` (property 4).
- `wrong-variant` only when `named` and `selected` are both true, the two carry a comparable kind (id/id, pair/pair, label/label) and none of that kind agrees; it never feeds backoff; a run item with it has no row and no path stats (property 5).
- The path string is its own identity: no new `CertifiedPath` field, no new `Transform`; `pathId`, drift, path stats, ops and the domain cache are untouched.
- Fragments survive planning only when they carry `key=value` pairs; grouping and deduplication are unchanged (property 8).
- Tests per package only: `pnpm --filter @robot/<pkg> exec vitest run <file>`; never `pnpm -r test`; the browser's Chromium tests one file at a time; the route smoke once, at the end, on `main` after the merge against `pnpm dev:all` that Marko runs — never start or restart a server; never click a button that shows a dollar amount.
- Commits by explicit path; never `git add -A`/`.`; never stage `packages/app/src/routeTree.gen.ts`; every message ends `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `.js` suffix on relative imports in browser/scraper/api; none in app; `@robot/browser` never imports `@robot/scraper`; `@robot/app` never imports `@robot/scraper` except `@robot/scraper/normalize`, and never `@robot/api`.

## Review Focus

1. An address whose query carries tracking noise beside the variant (`?variant=123&utm_source=x&gclid=abc`) must name the variant by its id and never let `utm_source` or `gclid` become a pair that fails every match. → Task 1 test "tracking parameters are not pairs".
2. A Shopify `offers.url` that is relative (`/products/x?variant=42385836179511`, Ruggable) must match the page's `?variant=` id exactly as an absolute url would. → Task 2 test "a relative entry url still yields its variant id".
3. Two entries that both match (a size `M` in two colours, each with `size: "M"` and the address naming only `?size=M`) must resolve to nothing, not to the first. → Task 2 test "two matching entries resolve to nothing".
4. A proof page captured before this change (no `pageVariant` in its stored file) must certify, warn and resolve exactly as today: no warning, `[page]` candidates never proposed. → Task 2 test "no page variant: [page] yields nothing and the index path is unchanged"; Task 5 test "no page variant on record: no warning".
5. A page whose picker marks a selection the address does not name (`?variant=A` while the page preselects B) must fail the capture, while a page that shows no picker at all must not. → Task 1 tests "named A, page shows B → wrong-variant" and "named A, no selection on the page → ok".

---

### Task 1: The page variant and the wrong-variant verdict (`@robot/browser`)

**Files:**
- Create: `packages/browser/src/page-variant.ts`, `packages/browser/src/page-variant.test.ts`
- Modify: `packages/browser/src/types.ts` (`PageVariant`, `PageCapture.pageVariant`, `CaptureVerdict` `wrong-variant`, `CaptureOptions.selection`), `packages/browser/src/verdict-copy.ts`, `packages/browser/src/playwright-browser.ts` (compute after the structured data, decide the verdict), `packages/browser/src/index.ts` (exports)
- Test: `packages/browser/src/page-variant.test.ts`, `packages/browser/src/capture-verdict.test.ts` (one Chromium case), `packages/browser/src/verdict.test.ts` (sentence)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  // types.ts
  export type PageVariant = { ids: string[]; pairs: Array<{ name: string; value: string }>; labels: string[]; named: boolean; selected: boolean };
  PageCapture.pageVariant?: PageVariant;               // absent on captures built outside the browser
  CaptureVerdict |= { kind: 'wrong-variant'; status: number; named: string };
  CaptureOptions.selection?: string;                   // a self-invoking page script returning Selection | null
  // page-variant.ts
  export type Selection = { ids?: string[]; pairs?: Array<{ name: string; value: string }>; labels?: string[] };
  export function addressVariant(url: string): { ids: string[]; pairs: Array<{ name: string; value: string }>; labels: string[]; text: string };
  export function selectedInPageData(data: { ldJson: unknown[]; nextData: unknown; initialState: unknown }, apiBodies: unknown[]): Selection;
  export function pageVariantFrom(url: string, picker: Selection | null, pageData: Selection): PageVariant;
  export function wrongVariant(pv: PageVariant, url: string): string | null;   // the address's own text when the page shows another variant, else null
  export function normalizeLabel(s: string): string;   // lowercase, strip quotes/primes/punctuation, collapse spaces, drop leading zeros in digit runs
  ```

- [ ] **Step 1: Failing tests** — create `packages/browser/src/page-variant.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addressVariant, normalizeLabel, pageVariantFrom, selectedInPageData, wrongVariant } from './page-variant.js';

describe('addressVariant', () => {
  it('reads a Shopify variant id, option pairs, labels and a key=value fragment', () => {
    expect(addressVariant('https://s.example/products/x?variant=45061353865273')).toEqual({ ids: ['45061353865273'], pairs: [{ name: 'variant', value: '45061353865273' }], labels: [], text: 'variant=45061353865273' });
    const r = addressVariant('https://r.example/products/x?size=6x9&system=rug-cvr');
    expect(r.ids).toEqual([]);
    expect(r.pairs).toEqual([{ name: 'size', value: '6x9' }, { name: 'system', value: 'rug-cvr' }]);
    expect(r.labels).toEqual(['6x9', 'rug-cvr']);
    expect(r.text).toBe('size=6x9&system=rug-cvr');
    const b = addressVariant('https://b.example/products/x?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal');
    expect(b.pairs).toEqual([{ name: 'Fabric', value: 'Moss Green - Performance Flatweave' }, { name: 'Leg Finish', value: 'Black - Metal' }]);
    expect(addressVariant('https://s.example/p/1#sku=p1-blue').pairs).toEqual([{ name: 'sku', value: 'p1-blue' }]);
  });
  it('tracking parameters are not pairs', () => {
    const a = addressVariant('https://s.example/products/x?variant=123&utm_source=x&gclid=abc&fbclid=1&ref=mail');
    expect(a.pairs).toEqual([{ name: 'variant', value: '123' }]);
    expect(a.ids).toEqual(['123']);
    expect(a.text).toBe('variant=123');
  });
  it('an address with no query and no key=value fragment names nothing', () => {
    expect(addressVariant('https://k.example/products/khwa030086-001#reviews')).toEqual({ ids: [], pairs: [], labels: [], text: '' });
  });
  it('a numeric id-like value names an id; a word names a label', () => {
    expect(addressVariant('https://p.example/pd/x/312123?swatch=16').ids).toEqual([]);
    expect(addressVariant('https://p.example/pd/x/312123?swatch=16').labels).toEqual(['16']);
    expect(addressVariant('https://l.example/PH5522-00.html?color=031').labels).toEqual(['031']);
  });
});

describe('normalizeLabel', () => {
  it('equates the address spelling, the label spelling and a sku suffix', () => {
    expect(normalizeLabel('6x9')).toBe(normalizeLabel("6'x9'"));
    expect(normalizeLabel('06x09')).toBe(normalizeLabel('6x9'));
    expect(normalizeLabel('Moss Green - Performance Flatweave')).toBe('moss green performance flatweave');
    expect(normalizeLabel('XXL ')).toBe('xxl');
  });
});

describe('selectedInPageData', () => {
  it('reads selectedVariant / selected_variant / currentVariant ids and skus from page data and api bodies', () => {
    const s = selectedInPageData(
      { ldJson: [], nextData: { props: { pageProps: { selectedVariant: { id: 7, sku: 'ABC-M' } } } }, initialState: null },
      [{ product: { current_variant: 'gid://shopify/ProductVariant/45061353865273' } }],
    );
    expect(s.ids).toEqual(['7', '45061353865273']);
    expect(s.labels).toEqual(['ABC-M']);
  });
  it('finds nothing in data with no selected key', () => {
    expect(selectedInPageData({ ldJson: [{ '@type': 'Product', name: 'x' }], nextData: null, initialState: null }, [])).toEqual({});
  });
});

describe('pageVariantFrom', () => {
  it('named from the address, selected from the page', () => {
    const pv = pageVariantFrom('https://s.example/products/x?variant=123', { labels: ['Chill Grey'] }, {});
    expect(pv).toEqual({ ids: ['123'], pairs: [{ name: 'variant', value: '123' }], labels: ['Chill Grey'], named: true, selected: true });
  });
  it('an unnamed address uses the page selection alone', () => {
    const pv = pageVariantFrom('https://k.example/products/khwa030086-001', { pairs: [{ name: 'size', value: 'XS' }], labels: ['XS'] }, {});
    expect(pv.named).toBe(false);
    expect(pv.selected).toBe(true);
    expect(pv.pairs).toEqual([{ name: 'size', value: 'XS' }]);
  });
  it('neither: present but empty', () => {
    expect(pageVariantFrom('https://k.example/products/x', null, {})).toEqual({ ids: [], pairs: [], labels: [], named: false, selected: false });
  });
});

describe('wrongVariant', () => {
  const url = 'https://p.example/pd/x/312123?swatch=16';
  it('named A, page shows B → the address text', () => {
    const pv = pageVariantFrom(url, { labels: ['17'], pairs: [{ name: 'swatch', value: '17' }] }, {});
    expect(wrongVariant(pv, url)).toBe('swatch=16');
  });
  it('named A, page shows A → null', () => {
    expect(wrongVariant(pageVariantFrom(url, { labels: ['16'] }, {}), url)).toBeNull();
  });
  it('named A, no selection on the page → null', () => {
    expect(wrongVariant(pageVariantFrom(url, null, {}), url)).toBeNull();
  });
  it('an id against a label is not comparable → null', () => {
    const u = 'https://s.example/products/x?variant=123';
    expect(wrongVariant(pageVariantFrom(u, { labels: ['Chill Grey'] }, {}), u)).toBeNull();
  });
  it('an id against another id → the address text', () => {
    const u = 'https://s.example/products/x?variant=123';
    expect(wrongVariant(pageVariantFrom(u, {}, { ids: ['999'] }), u)).toBe('variant=123');
  });
});
```

- [ ] **Step 2: Run, expect failure** — `pnpm --filter @robot/browser exec vitest run src/page-variant.test.ts` → FAIL (module not found).

- [ ] **Step 3: Types** — in `packages/browser/src/types.ts`, after `CaptureTimings`:

```ts
/**
 * Which variant this page is showing (spec 2026-10-14 §3): what the address
 * names (`named`) and what the page marks selected (`selected`). Absent on
 * captures built outside the browser (fixtures, replays), like `timings`.
 */
export type PageVariant = {
  /** Variant ids: `?variant=`, a `variant_id`, a selected variant's id. */
  ids: string[];
  /** Option pairs from the address's query or fragment, and the picker's selection, as given. */
  pairs: Array<{ name: string; value: string }>;
  /** Free labels: the pairs' values, a selected option's text, a selected sku. */
  labels: string[];
  /** The address named a variant (a query pair or a key=value fragment, tracking parameters excluded). */
  named: boolean;
  /** The page showed a selection (a picker's selected option or a `selected…` key in its data). */
  selected: boolean;
};
```

Add to `PageCapture` (after `pageHeight`): `pageVariant?: PageVariant;` with the comment "Spec 2026-10-14 §3. Absent on captures built outside the browser." Add to `CaptureVerdict`: `| { kind: 'wrong-variant'; status: number; named: string }` with the comment "The address named a variant the page did not show (spec 2026-10-14 §7); `named` is the address's own text." Add to `CaptureOptions`:

```ts
  /**
   * A self-invoking page script returning the picker's current selection
   * (`{ ids?, pairs?, labels? }` or null) — `buildSelectionScript()` in
   * @robot/scraper's variant-dom.ts. Evaluated once, after the structured
   * data, into `PageCapture.pageVariant` (spec 2026-10-14 §3). Unset: the
   * page variant is read from the address and the page data alone.
   */
  selection?: string;
```

- [ ] **Step 4: `page-variant.ts`:**

```ts
// packages/browser/src/page-variant.ts
// Which variant a page is showing (spec 2026-10-14 §3): what the address
// names and what the page marks selected. Pure; the picker's selection is
// read by a script the caller passes in (`CaptureOptions.selection`), so
// this package never depends on the scraper's DOM scripts.
import type { PageVariant } from './types.js';

export type Selection = { ids?: string[]; pairs?: Array<{ name: string; value: string }>; labels?: string[] };

/** Query keys that never name a variant: analytics, referrers, pagination. */
const NOISE_KEYS = /^(utm_|gclid$|fbclid$|msclkid$|ref$|referrer$|source$|campaign$|_ga$|_gl$|page$|sort$|q$|search$|lang$|locale$|currency$|srsltid$|_pos$|_sid$|_ss$|_kx$|mc_)/i;
/** A value that is an id: digits only, or a Shopify gid, 6+ characters. */
const ID_VALUE = /^(gid:\/\/shopify\/ProductVariant\/)?\d{6,}$/;

export function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”'"`′″]/g, '')
    .replace(/\b0+(\d)/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function idOf(value: string): string | null {
  const m = ID_VALUE.exec(value.trim());
  if (!m) return null;
  return value.trim().replace(/^gid:\/\/shopify\/ProductVariant\//, '');
}

/** What the address names: every query pair and key=value fragment pair that is not noise. */
export function addressVariant(url: string): { ids: string[]; pairs: Array<{ name: string; value: string }>; labels: string[]; text: string } {
  const pairs: Array<{ name: string; value: string }> = [];
  const parts: string[] = [];
  let u: URL;
  try { u = new URL(url); } catch { return { ids: [], pairs: [], labels: [], text: '' }; }
  const take = (params: URLSearchParams) => {
    for (const [k, v] of params) {
      const name = k.trim(), value = v.trim();
      if (!name || !value || NOISE_KEYS.test(name)) continue;
      pairs.push({ name, value });
      parts.push(`${name}=${value}`);
    }
  };
  take(u.searchParams);
  const hash = u.hash.replace(/^#/, '');
  if (hash.includes('=')) take(new URLSearchParams(hash));
  const ids = pairs.map((p) => idOf(p.value)).filter((x): x is string => x !== null);
  const labels = pairs.filter((p) => idOf(p.value) === null).map((p) => p.value);
  return { ids, pairs, labels, text: parts.join('&') };
}

const SELECTED_KEY = /^(selected|current)_?(variant|option|sku|offer)/i;
const MAX_DEPTH = 8;
const MAX_NODES = 5_000;

function collect(node: unknown, out: Selection, depth: number, budget: { n: number }, viaSelected: boolean): void {
  if (budget.n-- <= 0 || depth > MAX_DEPTH || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const v of node.slice(0, 50)) collect(v, out, depth + 1, budget, viaSelected); return; }
  const obj = node as Record<string, unknown>;
  if (viaSelected) {
    const id = obj.id ?? obj.variant_id ?? obj.variantId;
    if (typeof id === 'number' || typeof id === 'string') { const s = idOf(String(id)) ?? String(id); (out.ids ??= []).push(s); }
    if (typeof obj.sku === 'string' && obj.sku.trim()) (out.labels ??= []).push(obj.sku.trim());
    if (typeof obj.title === 'string' && obj.title.trim()) (out.labels ??= []).push(obj.title.trim());
  }
  for (const [k, v] of Object.entries(obj)) {
    const sel = SELECTED_KEY.test(k);
    if (sel && (typeof v === 'string' || typeof v === 'number')) {
      const s = idOf(String(v));
      if (s) (out.ids ??= []).push(s); else if (String(v).trim()) (out.labels ??= []).push(String(v).trim());
      continue;
    }
    collect(v, out, depth + 1, budget, sel);
  }
}

/** `selected…`/`current…` variant, option, sku or offer keys in the page data and the JSON bodies seen. */
export function selectedInPageData(data: { ldJson: unknown[]; nextData: unknown; initialState: unknown }, apiBodies: unknown[]): Selection {
  const out: Selection = {};
  const budget = { n: MAX_NODES };
  for (const root of [data.nextData, data.initialState, ...data.ldJson, ...apiBodies]) collect(root, out, 0, budget, false);
  if (out.ids) out.ids = [...new Set(out.ids)];
  if (out.labels) out.labels = [...new Set(out.labels)];
  return out;
}

function merge(a: Selection | null | undefined, b: Selection | null | undefined): Selection {
  return {
    ids: [...new Set([...(a?.ids ?? []), ...(b?.ids ?? [])])],
    pairs: [...(a?.pairs ?? []), ...(b?.pairs ?? [])],
    labels: [...new Set([...(a?.labels ?? []), ...(b?.labels ?? [])])],
  };
}

const hasAny = (s: Selection) => (s.ids?.length ?? 0) + (s.pairs?.length ?? 0) + (s.labels?.length ?? 0) > 0;

export function pageVariantFrom(url: string, picker: Selection | null, pageData: Selection): PageVariant {
  const named = addressVariant(url);
  const shown = merge(picker, pageData);
  const all = merge({ ids: named.ids, pairs: named.pairs, labels: named.labels }, shown);
  return { ids: all.ids!, pairs: all.pairs!, labels: all.labels!, named: named.pairs.length > 0, selected: hasAny(shown) };
}

/**
 * The address's own text when the page shows a different variant from the
 * one it names (spec 2026-10-14 §7): the two carry a comparable kind and
 * nothing of that kind agrees. Not comparable → null; no selection → null.
 */
export function wrongVariant(pv: PageVariant, url: string): string | null {
  if (!pv.named || !pv.selected) return null;
  const named = addressVariant(url);
  // What the page showed is everything in `pv` that the address did not put there.
  const shownIds = pv.ids.filter((id) => !named.ids.includes(id));
  const namedPairKeys = new Set(named.pairs.map((p) => `${p.name}\u0000${p.value}`));
  const shownPairs = pv.pairs.filter((p) => !namedPairKeys.has(`${p.name}\u0000${p.value}`));
  const shownLabels = pv.labels.filter((l) => !named.labels.includes(l));
  const verdicts: boolean[] = [];
  if (named.ids.length && shownIds.length) verdicts.push(named.ids.some((id) => shownIds.includes(id)));
  if (named.pairs.length && shownPairs.length) {
    verdicts.push(named.pairs.some((n) => shownPairs.some((s) => normalizeLabel(s.name) === normalizeLabel(n.name) && normalizeLabel(s.value) === normalizeLabel(n.value))));
  }
  if (named.labels.length && shownLabels.length) {
    verdicts.push(named.labels.some((n) => shownLabels.some((s) => normalizeLabel(s) === normalizeLabel(n) || normalizeLabel(s).includes(normalizeLabel(n)))));
  }
  if (verdicts.length === 0) return null;   // nothing comparable
  return verdicts.some(Boolean) ? null : named.text;
}
```

Note for the implementer: `wrongVariant`'s "shown" sets subtract the address's own contribution because `pageVariantFrom` merges both; a page that selects the named variant (`?swatch=16`, picker says `16`) leaves `shownLabels` empty for that kind and the pair check compares `swatch=16` with `swatch=16` → agrees → null. The test "named A, page shows A" pins it.

- [ ] **Step 5: Sentence** — in `verdict-copy.ts` add to the switch: `case 'wrong-variant': return \`The page did not show the variant the address names (${v.named}).\`;`. Add to `verdict.test.ts` (or a new `verdict-copy.test.ts` if the file has no sentence tests):

```ts
it('wrong-variant names the address text', () => {
  expect(verdictSentence({ kind: 'wrong-variant', status: 200, named: 'swatch=16' }, 'https://p.example/pd/x?swatch=16')).toBe('The page did not show the variant the address names (swatch=16).');
});
```

- [ ] **Step 6: Capture wiring** — in `playwright-browser.ts`, import `{ pageVariantFrom, selectedInPageData, wrongVariant, type Selection } from './page-variant.js'`. After `const [html, title, structuredData] = await Promise.all([...])`, add:

```ts
        // Spec 2026-10-14 §3: which variant this page shows. The picker's
        // selection comes from the caller's script (scraper's variant-dom),
        // the data's `selected…` keys from what was captured. Never throws.
        let picker: Selection | null = null;
        if (options.selection) {
          picker = await page.evaluate(options.selection).then((v) => (v && typeof v === 'object' ? (v as Selection) : null)).catch((err) => {
            if (isCrash(err)) throw err;
            console.warn(`[browser] selection script failed on ${url}: ${(err as Error).message.split('\n')[0]}`);
            return null;
          });
        }
        const apiBodies = intercepted.filter((r) => r.isJson && r.parsedJson !== null).map((r) => r.parsedJson);
        const pageVariant = pageVariantFrom(page.url(), picker, selectedInPageData(structuredData, apiBodies));
```

Then where `verdict` is computed, after `classifyVerdict(...)`:

```ts
        const named = verdict.kind === 'ok' ? wrongVariant(pageVariant, url) : null;
        const finalVerdict: CaptureVerdict = named !== null ? { kind: 'wrong-variant', status: verdict.status, named } : verdict;
```

and return `verdict: finalVerdict` plus `pageVariant,` in the returned object (beside `pageHeight`). `wrongVariant` reads the REQUESTED `url` (what the customer asked for), `pageVariantFrom` the final `page.url()` (what the page shows); import `CaptureVerdict` type if not already.

- [ ] **Step 7: Exports** — `index.ts`: `export { addressVariant, normalizeLabel, pageVariantFrom, selectedInPageData, wrongVariant, type Selection } from './page-variant.js';` and add `PageVariant` to the type export list.

- [ ] **Step 8: One Chromium case** in `capture-verdict.test.ts`: serve `/swatch` that renders a picker with `aria-checked="true"` on a label the address does not name, and assert the verdict. Add to the server: `if (u.pathname === '/swatch') return res.writeHead(200, { 'content-type': 'text/html' }).end(\`${PRODUCT}<div role="radiogroup" aria-label="Colour"><button role="radio" aria-checked="false">16</button><button role="radio" aria-checked="true">17</button></div>\`);` and the test:

```ts
it('a page whose picker selects a variant the address does not name is wrong-variant; no selection script → ok', async () => {
  const selection = `(() => { const el = document.querySelector('[role="radio"][aria-checked="true"]'); return el ? { labels: [el.textContent.trim()], pairs: [{ name: 'swatch', value: el.textContent.trim() }] } : null; })()`;
  const c = await browser.capture(`${base}/swatch?swatch=16`, { selection });
  expect(c.verdict).toEqual({ kind: 'wrong-variant', status: 200, named: 'swatch=16' });
  expect(c.pageVariant).toMatchObject({ named: true, selected: true, labels: expect.arrayContaining(['16', '17']) });
  const plain = await browser.capture(`${base}/swatch?swatch=16`);
  expect(plain.verdict).toEqual({ kind: 'ok', status: 200 });
  expect(plain.pageVariant).toMatchObject({ named: true, selected: false });
}, 60_000);
```

- [ ] **Step 9: Run** — `pnpm --filter @robot/browser exec vitest run src/page-variant.test.ts src/verdict.test.ts` then `src/capture-verdict.test.ts` alone; `pnpm --filter @robot/browser exec tsc --noEmit`. Expected: all pass, tsc clean.

- [ ] **Step 10: Commit**

```bash
git add packages/browser/src/page-variant.ts packages/browser/src/page-variant.test.ts packages/browser/src/types.ts packages/browser/src/verdict-copy.ts packages/browser/src/verdict.test.ts packages/browser/src/playwright-browser.ts packages/browser/src/index.ts packages/browser/src/capture-verdict.test.ts
git commit -m "feat(browser): every capture knows its page variant; a page that does not show the variant the address names is wrong-variant

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Matching and the `[page]` address form (`@robot/scraper`)

**Files:**
- Create: `packages/scraper/src/verify/page-variant-match.ts`, `packages/scraper/src/verify/page-variant-match.test.ts`, `packages/scraper/src/verify/__fixtures__/page-variant/{skullcandy,ruggable,kith,burrow}.json`
- Modify: `packages/scraper/src/domain-cache.ts` (`getByDotPath` ctx), `packages/scraper/src/verify/search-structured.ts` (`resolveStructured` ctx), `packages/scraper/src/verify/verified-extraction.ts` (`evaluatePath`, `buildReadyCheck`), `packages/scraper/src/verify/certify.ts` (ctx per page), `packages/scraper/src/verify/drift-classify.ts` and `transfer-marks.ts` (pass the capture's page variant through), `packages/scraper/src/domain-lock.ts` (`reportVerdict` pacing), `packages/scraper/src/verify/index.ts` / `src/index.ts` (exports)
- Test: `page-variant-match.test.ts`, `domain-cache.test.ts` (or `dot-path.test.ts` if none), `search-structured.test.ts`, `verified-extraction.test.ts`, `certify.test.ts`, `domain-lock-backoff.test.ts`

**Interfaces:**
- Consumes: `PageVariant`, `normalizeLabel` from `@robot/browser`.
- Produces:
  ```ts
  // page-variant-match.ts
  export function matchesPageVariant(entry: unknown, pv: PageVariant): boolean;
  export function pickPageEntry(arr: unknown[], pv: PageVariant | undefined): unknown;   // the one match, else undefined
  export type PathContext = { pageVariant?: PageVariant };
  // domain-cache.ts
  export function getByDotPath(obj: unknown, path: string, ctx?: PathContext): unknown;   // `[page]` step
  // search-structured.ts
  export function resolveStructured(capture, source, path, ctx?: PathContext): unknown;
  // verified-extraction.ts: evaluatePath/isReady pass { pageUrl, pageVariant: capture.pageVariant }
  ```

- [ ] **Step 1: Fixtures** — write the four files under `packages/scraper/src/verify/__fixtures__/page-variant/`, copied from the campaign's stored captures (the shapes below are the real ones, trimmed; keep them this small):

`skullcandy.json`:
```json
{
  "url": "https://www.skullcandy.com/products/crusher-evo?variant=45242474037305",
  "ldJson": [
    { "@type": "Product", "name": "Crusher® Evo - True Black", "offers": { "@type": "Offer", "availability": "http://schema.org/InStock", "price": 209.99, "url": "https://www.skullcandy.com/products/crusher-evo?variant=45061353865273" } },
    { "@type": "Product", "name": "Crusher® Evo - Chill Grey", "offers": { "@type": "Offer", "availability": "http://schema.org/OutOfStock", "price": 209.99, "url": "https://www.skullcandy.com/products/crusher-evo?variant=45242474037305" } },
    { "@type": "ProductGroup", "hasVariant": [
      { "@type": "Product", "name": "Crusher® Evo - True Black", "sku": "S6EVW-N740", "offers": { "url": "https://www.skullcandy.com/products/crusher-evo?variant=45061353865273", "availability": "http://schema.org/InStock", "price": 209.99 } },
      { "@type": "Product", "name": "Crusher® Evo - Chill Grey", "sku": "S6EVW-N744", "offers": { "url": "https://www.skullcandy.com/products/crusher-evo?variant=45242474037305", "availability": "http://schema.org/OutOfStock", "price": 209.99 } },
      { "@type": "Product", "name": "Crusher® Evo - Realtree", "sku": "S6EVW-T991", "offers": { "url": "https://www.skullcandy.com/products/crusher-evo?variant=44522482794553", "availability": "http://schema.org/InStock", "price": 219.99 } }
    ] }
  ],
  "api": [ { "product": { "id": 7191195713593, "variants": [ { "id": 45061353865273, "sku": "S6EVW-N740", "available": true }, { "id": 45242474037305, "sku": "S6EVW-N744", "available": false } ] } } ]
}
```

`ruggable.json`:
```json
{
  "url": "https://ruggable.com/products/ryder-soft-white-plush-rug?size=6x9&system=rug-cvr",
  "ldJson": [ { "@type": "ProductGroup", "variesBy": ["https://schema.org/size"], "hasVariant": [
    { "@type": "Product", "sku": "RUG-CVR-IND-RCT-PLS-PH015-05x07", "size": "5'x7'", "name": "Ryder | 5'x7'", "offers": { "url": "/products/ryder-soft-white-plush-rug?variant=42385836146743", "price": "439.00" } },
    { "@type": "Product", "sku": "RUG-CVR-IND-RCT-PLS-PH015-06x09", "size": "6'x9'", "name": "Ryder | 6'x9'", "offers": { "url": "/products/ryder-soft-white-plush-rug?variant=42385836179511", "price": "569.00" } },
    { "@type": "Product", "sku": "RUG-CVR-IND-RCT-PLS-PH015-08x10", "size": "8'x10'", "name": "Ryder | 8'x10'", "offers": { "url": "/products/ryder-soft-white-plush-rug?variant=42385836212279", "price": "799.00" } }
  ] } ],
  "api": []
}
```

`kith.json` (the address names nothing; the picker selects XS):
```json
{
  "url": "https://kith.com/products/khwa030086-001",
  "picker": { "pairs": [ { "name": "size", "value": "XS" } ], "labels": ["XS"] },
  "ldJson": [ { "@type": "Product", "name": "Kith Women Elvina Paneled Hoodie - Black", "offers": [
    { "@type": "Offer", "sku": "2000372077", "availability": "https://schema.org/OutOfStock", "price": 810, "url": "https://kith.com/products/khwa030086-001?variant=45144745017472", "additionalProperty": { "@type": "PropertyValue", "name": "size", "value": "XXS" } },
    { "@type": "Offer", "sku": "2000372078", "availability": "https://schema.org/InStock", "price": 810, "url": "https://kith.com/products/khwa030086-001?variant=45144745050240", "additionalProperty": { "@type": "PropertyValue", "name": "size", "value": "XS" } },
    { "@type": "Offer", "sku": "2000372079", "availability": "https://schema.org/InStock", "price": 810, "url": "https://kith.com/products/khwa030086-001?variant=45144745083008", "additionalProperty": { "@type": "PropertyValue", "name": "size", "value": "S" } }
  ] } ],
  "api": []
}
```

`burrow.json`:
```json
{
  "url": "https://burrow.com/products/range-plus-4-piece?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal",
  "ldJson": [ { "@type": "ProductGroup", "variesBy": ["https://schema.org/color", "https://schema.org/material", "Leg Finish"], "hasVariant": [
    { "@type": "Product", "name": "Range 4-Piece One Arm Sofa Lounger - Moss Green - Performance Flatweave / Black - Metal", "sku": "FLRST-SC-RGPL-S3-A1-C1-MGF-BM", "color": "Moss Green", "material": "Performance Flatweave", "offers": { "@type": "Offer", "price": "1306.0", "availability": "https://schema.org/InStock" } },
    { "@type": "Product", "name": "Range 4-Piece One Arm Sofa Lounger - Navy Blue - Performance Flatweave / Black - Metal", "sku": "FLRST-SC-RGPL-S3-A1-C1-NBF-BM", "color": "Navy Blue", "material": "Performance Flatweave", "offers": { "@type": "Offer", "price": "1306.0", "availability": "https://schema.org/InStock" } },
    { "@type": "Product", "name": "Range 4-Piece One Arm Sofa Lounger - Camel - Top Grain Leather / Black - Metal", "sku": "FLRST-SC-RGPL-S3-A1-C1-CTL-BM", "color": "Camel", "material": "Top Grain Leather", "offers": { "@type": "Offer", "price": "2801.0", "availability": "https://schema.org/InStock" } }
  ] } ],
  "api": []
}
```

- [ ] **Step 2: Failing tests** — create `page-variant-match.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pageVariantFrom, type PageVariant } from '@robot/browser';
import { matchesPageVariant, pickPageEntry } from './page-variant-match.js';
import { getByDotPath } from '../domain-cache.js';
import { resolveStructured } from './search-structured.js';

type Fx = { url: string; picker?: { pairs?: Array<{ name: string; value: string }>; labels?: string[] }; ldJson: Record<string, unknown>[]; api: unknown[] };
const load = (name: string): Fx => JSON.parse(readFileSync(new URL(`./__fixtures__/page-variant/${name}.json`, import.meta.url), 'utf8'));
const pvOf = (fx: Fx): PageVariant => pageVariantFrom(fx.url, fx.picker ?? null, {});
const captureOf = (fx: Fx) => ({
  structuredData: { ldJson: fx.ldJson, nextData: null, initialState: null, meta: {} },
  interceptedRequests: fx.api.map((parsedJson) => ({ url: 'https://x/api', method: 'GET', resourceType: 'fetch', responseStatus: 200, responseHeaders: {}, responseBody: '', contentType: 'application/json', bodySize: 1, isJson: true, parsedJson, timestamp: 0 })),
});

describe('matchesPageVariant', () => {
  it('rule 1: a Shopify ?variant= id matches an entry url, an @id, an id or a variant_id', () => {
    const pv = pvOf(load('skullcandy'));
    expect(matchesPageVariant({ offers: { url: 'https://www.skullcandy.com/products/crusher-evo?variant=45242474037305' } }, pv)).toBe(true);
    expect(matchesPageVariant({ offers: { url: 'https://www.skullcandy.com/products/crusher-evo?variant=45061353865273' } }, pv)).toBe(false);
    expect(matchesPageVariant({ id: 45242474037305 }, pv)).toBe(true);
    expect(matchesPageVariant({ variant_id: '45242474037305' }, pv)).toBe(true);
    expect(matchesPageVariant({ '@id': 'https://x/p?variant=45242474037305#offer' }, pv)).toBe(true);
  });
  it('a relative entry url still yields its variant id', () => {
    const pv = pageVariantFrom('https://ruggable.com/products/ryder?variant=42385836179511', null, {});
    expect(matchesPageVariant({ offers: { url: '/products/ryder-soft-white-plush-rug?variant=42385836179511' } }, pv)).toBe(true);
  });
  it('rule 2: option pairs match selectedOptions / options / option1-3 / an entry key named like the pair', () => {
    const pv = pageVariantFrom('https://k.example/p?size=XS', null, {});
    expect(matchesPageVariant({ selectedOptions: [{ name: 'Size', value: 'xs' }] }, pv)).toBe(true);
    expect(matchesPageVariant({ options: [{ name: 'size', value: 'XS' }] }, pv)).toBe(true);
    expect(matchesPageVariant({ option1: 'XS' }, pv)).toBe(true);
    expect(matchesPageVariant({ size: 'XS' }, pv)).toBe(true);
    expect(matchesPageVariant({ size: 'S' }, pv)).toBe(false);
    expect(matchesPageVariant({ additionalProperty: { name: 'size', value: 'XS' } }, pv)).toBe(true);
  });
  it('rule 2: a pair the entry does not carry is ignored, but one pair must match', () => {
    const pv = pvOf(load('ruggable'));   // size=6x9 & system=rug-cvr
    expect(matchesPageVariant({ size: "6'x9'" }, pv)).toBe(true);
    expect(matchesPageVariant({ material: 'wool' }, pv)).toBe(false);
  });
  it('rule 3: a label matches a size, colour, axis value, a sku suffix, or is contained in a name', () => {
    const rug = pvOf(load('ruggable'));
    expect(matchesPageVariant({ sku: 'RUG-CVR-IND-RCT-PLS-PH015-06x09' }, rug)).toBe(true);
    expect(matchesPageVariant({ sku: 'RUG-CVR-IND-RCT-PLS-PH015-05x07' }, rug)).toBe(false);
    const bur = pvOf(load('burrow'));
    expect(matchesPageVariant(load('burrow').ldJson[0]!.hasVariant[0], bur)).toBe(true);
    expect(matchesPageVariant(load('burrow').ldJson[0]!.hasVariant[2], bur)).toBe(false);
  });
  it('a label of fewer than three characters never matches by containment', () => {
    const pv = pageVariantFrom('https://p.example/pd/x?swatch=16', null, {});
    expect(matchesPageVariant({ name: 'Model 2016 Classic' }, pv)).toBe(false);
    expect(matchesPageVariant({ swatch: '16' }, pv)).toBe(true);
  });
  it('matching never reads a price or an availability; an empty page variant matches nothing', () => {
    const pv = pageVariantFrom('https://k.example/p?size=810', null, {});
    expect(matchesPageVariant({ price: 810, availability: 'InStock' }, pv)).toBe(false);
    const empty = pageVariantFrom('https://k.example/p', null, {});
    expect(matchesPageVariant({ size: '' }, empty)).toBe(false);
    expect(matchesPageVariant({ id: 1 }, empty)).toBe(false);
  });
});

describe('pickPageEntry', () => {
  it('exactly one match → that entry; two matching entries resolve to nothing; none → nothing', () => {
    const pv = pageVariantFrom('https://k.example/p?size=M', null, {});
    const one = [{ size: 'S' }, { size: 'M', sku: 'a' }];
    expect(pickPageEntry(one, pv)).toEqual({ size: 'M', sku: 'a' });
    const two = [{ size: 'M', color: 'red' }, { size: 'M', color: 'blue' }];
    expect(pickPageEntry(two, pv)).toBeUndefined();
    expect(pickPageEntry([{ size: 'S' }], pv)).toBeUndefined();
    expect(pickPageEntry(one, undefined)).toBeUndefined();
  });
});

describe('getByDotPath with [page]', () => {
  const rug = load('ruggable');
  it('resolves offers by the page variant, never entry 0', () => {
    const pv = pvOf(rug);
    expect(getByDotPath(rug.ldJson[0], 'hasVariant[page].offers.price', { pageVariant: pv })).toBe('569.00');
    expect(getByDotPath(rug.ldJson[0], 'hasVariant[page].sku', { pageVariant: pv })).toBe('RUG-CVR-IND-RCT-PLS-PH015-06x09');
  });
  it('no page variant: [page] yields nothing and the index path is unchanged', () => {
    expect(getByDotPath(rug.ldJson[0], 'hasVariant[page].offers.price')).toBeUndefined();
    expect(getByDotPath(rug.ldJson[0], 'hasVariant[page].offers.price', { pageVariant: pageVariantFrom('https://r.example/p', null, {}) })).toBeUndefined();
    expect(getByDotPath(rug.ldJson[0], 'hasVariant[0].offers.price', { pageVariant: pvOf(rug) })).toBe('439.00');
    expect(getByDotPath(rug.ldJson[0], 'hasVariant[0].offers.price')).toBe('439.00');
  });
  it('[page] on a non-array yields nothing', () => {
    expect(getByDotPath({ offers: { price: 1 } }, 'offers[page].price', { pageVariant: pvOf(rug) })).toBeUndefined();
  });
});

describe('resolveStructured with a page variant', () => {
  it('skullcandy: one block per colour — offers[page].availability reads the block whose offer matches', () => {
    const fx = load('skullcandy');
    const ctx = { pageVariant: pvOf(fx) };
    // `offers` is an object per block; `[page]` on it must not break a block-level read. The variant list is the ProductGroup's.
    expect(resolveStructured(captureOf(fx), 'json-ld', 'hasVariant[page].offers.availability', ctx)).toBe('http://schema.org/OutOfStock');
    expect(resolveStructured(captureOf(fx), 'api', 'product.variants[page].available', ctx)).toBe(false);
    expect(resolveStructured(captureOf(fx), 'json-ld', 'hasVariant[0].offers.availability', ctx)).toBe('http://schema.org/InStock');
  });
  it('kith: the address names nothing, the picker selects XS → offers[page] is the XS offer', () => {
    const fx = load('kith');
    expect(resolveStructured(captureOf(fx), 'json-ld', 'offers[page].availability', { pageVariant: pvOf(fx) })).toBe('https://schema.org/InStock');
    expect(resolveStructured(captureOf(fx), 'json-ld', 'offers[page].sku', { pageVariant: pvOf(fx) })).toBe('2000372078');
  });
  it('burrow: option pairs in the address, names in the data', () => {
    const fx = load('burrow');
    expect(resolveStructured(captureOf(fx), 'json-ld', 'hasVariant[page].offers.price', { pageVariant: pvOf(fx) })).toBe('1306.0');
    const camel = { ...fx, url: 'https://burrow.com/products/range-plus-4-piece?Fabric=Camel+-+Top+Grain+Leather&Leg+Finish=Black+-+Metal' };
    expect(resolveStructured(captureOf(camel), 'json-ld', 'hasVariant[page].offers.price', { pageVariant: pvOf(camel) })).toBe('2801.0');
  });
});
```

- [ ] **Step 3: Run, expect failure** — `pnpm --filter @robot/scraper exec vitest run src/verify/page-variant-match.test.ts` → FAIL (module not found).

- [ ] **Step 4: `page-variant-match.ts`:**

```ts
// packages/scraper/src/verify/page-variant-match.ts
// Does an array entry describe the page's variant? (spec 2026-10-14 §5.)
// Three rules, any one suffices; the `[page]` step succeeds only when exactly
// one entry matches. Never reads a price or an availability.
import { normalizeLabel, type PageVariant } from '@robot/browser';

export type PathContext = { pageVariant?: PageVariant };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);

const ID_KEYS = ['id', 'variant_id', 'variantId', 'productID'] as const;
const URL_KEYS = ['url', '@id'] as const;
const LABEL_KEYS = ['size', 'color', 'colour', 'option1', 'option2', 'option3'] as const;
const NAME_KEYS = ['name', 'title'] as const;
const MIN_CONTAINED = 3;

/** The variant id an entry carries: its id keys, or `variant=`/`id=` in its url or @id, relative urls included. */
function entryIds(entry: Obj): string[] {
  const out: string[] = [];
  for (const k of ID_KEYS) { const t = text(entry[k]); if (t) out.push(t.replace(/^gid:\/\/shopify\/ProductVariant\//, '')); }
  const urls: string[] = [];
  for (const k of URL_KEYS) { const t = text(entry[k]); if (t) urls.push(t); }
  if (isObj(entry.offers)) for (const k of URL_KEYS) { const t = text(entry.offers[k]); if (t) urls.push(t); }
  for (const u of urls) {
    const q = u.includes('?') ? u.slice(u.indexOf('?') + 1).replace(/#.*$/, '') : '';
    for (const [k, v] of new URLSearchParams(q)) if (k === 'variant' || k === 'id' || k === 'variant_id') out.push(v);
  }
  return out;
}

/** The option pairs an entry carries, name → value, from selectedOptions/options/additionalProperty, option1-3 and its own axis keys. */
function entryPairs(entry: Obj): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const k of ['selectedOptions', 'options', 'additionalProperty']) {
    const v = entry[k];
    const arr = Array.isArray(v) ? v : isObj(v) ? [v] : [];
    for (const o of arr) if (isObj(o)) { const n = text(o.name), val = text(o.value); if (n && val) out.push({ name: n, value: val }); }
  }
  for (const [k, v] of Object.entries(entry)) {
    if (k === 'price' || k === 'availability' || k === 'offers') continue;
    const t = text(v);
    if (t && k.length <= 20) out.push({ name: k, value: t });
  }
  return out;
}

function entryLabels(entry: Obj): { exact: string[]; names: string[] } {
  const exact: string[] = [];
  for (const k of LABEL_KEYS) { const t = text(entry[k]); if (t) exact.push(t); }
  for (const p of entryPairs(entry)) exact.push(p.value);
  const sku = text(entry.sku);
  if (sku) { exact.push(sku); const i = sku.lastIndexOf('-'); if (i >= 0) exact.push(sku.slice(i + 1)); }
  const names: string[] = [];
  for (const k of NAME_KEYS) { const t = text(entry[k]); if (t) names.push(t); }
  return { exact, names };
}

export function matchesPageVariant(entry: unknown, pv: PageVariant): boolean {
  if (!isObj(entry)) return false;
  // Rule 1: id.
  if (pv.ids.length) { const ids = entryIds(entry); if (pv.ids.some((id) => ids.includes(id))) return true; }
  // Rule 2: option pairs — every page pair the entry carries by name must agree; at least one must.
  if (pv.pairs.length) {
    const eps = entryPairs(entry);
    let matched = 0, contradicted = 0;
    for (const p of pv.pairs) {
      const same = eps.filter((e) => normalizeLabel(e.name) === normalizeLabel(p.name));
      if (same.length === 0) continue;
      if (same.some((e) => normalizeLabel(e.value) === normalizeLabel(p.value))) matched++; else contradicted++;
    }
    if (matched > 0 && contradicted === 0) return true;
  }
  // Rule 3: labels. Any one label equal to a size/colour/axis value/sku suffix
  // matches; containment in a name matches only when EVERY page label is
  // contained (Burrow: every entry's name ends "/ Black - Metal", so the Leg
  // Finish label alone would match them all).
  if (pv.labels.length) {
    const { exact, names } = entryLabels(entry);
    const ex = exact.map(normalizeLabel);
    const nm = names.map(normalizeLabel);
    const norms = pv.labels.map(normalizeLabel).filter((n) => n !== '');
    if (norms.some((n) => ex.includes(n))) return true;
    if (nm.length && norms.length && norms.every((n) => n.length >= MIN_CONTAINED && nm.some((name) => name.includes(n)))) return true;
  }
  return false;
}

/** The one entry of `arr` describing the page's variant; undefined for none, several, or no page variant. */
export function pickPageEntry(arr: unknown[], pv: PageVariant | undefined): unknown {
  if (!pv) return undefined;
  const hits = arr.filter((e) => matchesPageVariant(e, pv));
  return hits.length === 1 ? hits[0] : undefined;
}
```

- [ ] **Step 5: `getByDotPath` with `[page]`** — in `domain-cache.ts`, replace the function:

```ts
import { pickPageEntry, type PathContext } from './verify/page-variant-match.js';

/**
 * Navigate a JSON object using dot-notation path. Supports array indexing
 * ("data.items[0].price") and, with a page variant in `ctx`, the `[page]`
 * step (spec 2026-10-14 §4): the one entry describing the page's variant,
 * or nothing. Without `ctx`, `[page]` yields nothing.
 */
export function getByDotPath(obj: unknown, path: string, ctx?: PathContext): unknown {
  const parts = path.split(/\.|\[(\d+|page)\]/).filter(Boolean);
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;

    if (part === 'page') {
      if (!Array.isArray(current)) return undefined;
      current = pickPageEntry(current, ctx?.pageVariant);
      continue;
    }
    const index = parseInt(part, 10);
    if (!isNaN(index) && Array.isArray(current)) {
      current = current[index];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  return current;
}
```

Check the import does not form a cycle (`page-variant-match.ts` imports only `@robot/browser`). If `domain-cache.ts` importing from `verify/` is a problem for the package's layering, move `pickPageEntry`/`matchesPageVariant` to `packages/scraper/src/page-variant-match.ts` (top level) and re-export from `verify/index.ts`; say so in the report.

- [ ] **Step 6: `resolveStructured` ctx** — in `search-structured.ts`:

```ts
export function resolveStructured(
  capture: Pick<PageCapture, 'structuredData' | 'interceptedRequests'>,
  source: 'api' | 'json-ld' | 'meta',
  path: string,
  ctx?: PathContext,
): unknown {
  if (source === 'meta') return capture.structuredData.meta[path];
  const containers = source === 'api' ? apiBodies(capture) : capture.structuredData.ldJson;
  for (const c of containers) {
    const v = getByDotPath(c, path, ctx);
    if (nonEmpty(v)) return v;
  }
  return undefined;
}
```

Import `type PathContext` from `./page-variant-match.js`.

- [ ] **Step 7: Extraction and certification ctx** — `verified-extraction.ts`: `evaluatePath(field, path, structured, probe, ctx: { pageUrl: string; pageVariant?: PageVariant })` passes `ctx` to `resolveStructured`; in `runVerifiedExtraction` build `const ctx = { pageUrl: capture.url, pageVariant: capture.pageVariant }`; in `buildReadyCheck(fields, pageUrl)` the snapshot has no page variant yet — add `pageVariant?: PageVariant` as a third parameter (`buildReadyCheck(fields, pageUrl, pageVariant?)`) and pass `ctx = { pageUrl, pageVariant }`; `captureUnderLock` cannot know the page variant before the capture, so it passes `addressVariant`-only: `pageVariantFrom(req.url, null, {})` (import from `@robot/browser`) — the address part is known up front, and that is what `[page]` paths need on the Shopify sites. `certify.ts`: in the evaluation loop `const ctx = { pageUrl: capture.url, pageVariant: capture.pageVariant }` (`CaptureLike` gains `pageVariant?: PageVariant` via `Pick<PageCapture, …, 'pageVariant'>`), passed to `resolveStructured`; `drift-classify.ts:81` and `transfer-marks.ts:62` pass `{ pageVariant: capture.pageVariant }` the same way. Add to `verified-extraction.test.ts`:

```ts
it('a certified [page] path writes the variant the address names and misses honestly when none matches', async () => {
  const fx = JSON.parse(readFileSync(new URL('./__fixtures__/page-variant/ruggable.json', import.meta.url), 'utf8'));
  const capture = { ...fakeCapture(fx.url, fx.ldJson), pageVariant: pageVariantFrom(fx.url, null, {}) };
  const fields = [{ key: 'price', type: 'money' as const, concept: 'price', paths: [{ source: 'json-ld' as const, path: 'hasVariant[page].offers.price', transform: 'identity' as const }] }];
  const r = await runVerifiedExtraction({ url: fx.url, fields }, { browser: fakeBrowser(), capture });
  expect(r.data.price).toBe(569);
  const other = { ...capture, url: 'https://ruggable.com/products/ryder?size=12x18&system=rug-cvr', pageVariant: pageVariantFrom('https://ruggable.com/products/ryder?size=12x18&system=rug-cvr', null, {}) };
  const miss = await runVerifiedExtraction({ url: other.url, fields }, { browser: fakeBrowser(), capture: other });
  expect(miss.data.price).toBeNull();
  expect(miss.stats[0]).toMatchObject({ hit: false });
});
```

(`fakeCapture`/`fakeBrowser` are whatever helpers that test file already uses to build a `PageCapture` and an `IBrowser` with `setContentEvaluate`; reuse them by their real names.)

- [ ] **Step 8: Certification with `[page]` paths** — add to `certify.test.ts`:

```ts
describe('certify — the [page] address form (spec 2026-10-14 §4)', () => {
  const price = { key: 'price', name: 'Price', type: 'money' as const, description: 'the price', concept: 'price' };
  const rug = JSON.parse(readFileSync(new URL('./__fixtures__/page-variant/ruggable.json', import.meta.url), 'utf8'));
  // Three proof pages of the same rug at three sizes: the 6x9 entry sits at a different index on each.
  const pageAt = (url: string, order: number[]) => ({
    url, html: '<html></html>', interceptedRequests: [],
    structuredData: { ldJson: [{ ...rug.ldJson[0], hasVariant: order.map((i) => rug.ldJson[0].hasVariant[i]) }], nextData: null, initialState: null, meta: {} },
    pageVariant: pageVariantFrom(url, null, {}),
  });
  const U = ['https://r.example/p/a?size=6x9', 'https://r.example/p/b?size=6x9', 'https://r.example/p/c?size=6x9'];
  const captures = { [U[0]!]: pageAt(U[0]!, [1, 0, 2]), [U[1]!]: pageAt(U[1]!, [0, 1, 2]), [U[2]!]: pageAt(U[2]!, [2, 0, 1]) };
  const expected = { [U[0]!]: '569.00', [U[1]!]: '569.00', [U[2]!]: '569.00' };
  const pagePath = { source: 'json-ld' as const, path: 'hasVariant[page].offers.price', transform: 'identity' as const };
  const idx0 = { source: 'json-ld' as const, path: 'hasVariant[0].offers.price', transform: 'identity' as const };
  const idx1 = { source: 'json-ld' as const, path: 'hasVariant[1].offers.price', transform: 'identity' as const };
  const deps = { evalXPaths: async () => ({}) };

  it('a [page] path correct with a value on three pages at different indexes certifies as one layout', async () => {
    const r = await certify({ field: price, expected, captures, candidates: [idx0, idx1, pagePath] }, deps);
    expect(r.certified).toEqual([pagePath]);
    expect(Object.values(r.cells).every((c) => c.status === 'pass')).toBe(true);
  });
  it('a [page] path wrong on any page never certifies', async () => {
    const wrong = { ...expected, [U[2]!]: '799.00' };
    const r = await certify({ field: price, expected: wrong, captures, candidates: [pagePath] }, deps);
    expect(r.certified).toEqual([]);
  });
  it('a numeric-index path that is also correct everywhere ranks below the [page] twin', async () => {
    const same = { [U[0]!]: pageAt(U[0]!, [1, 0, 2]), [U[1]!]: pageAt(U[1]!, [1, 0, 2]), [U[2]!]: pageAt(U[2]!, [1, 0, 2]) };
    const r = await certify({ field: price, expected, captures: same, candidates: [idx1, pagePath] }, deps);
    expect(r.certified[0]).toEqual(pagePath);
    expect(r.certified[1]).toEqual(idx1);
  });
});
```

Implement the ranking in `rankCertified`: before the source/length order, a path containing `[page]` ranks above one that equals it with `[page]` replaced by a numeric index:

```ts
const INDEXED = /\[(\d+)\]/g;
const pageForm = (p: string) => p.replace(INDEXED, '[page]');
export function rankCertified(paths: CertifiedPath[]): CertifiedPath[] {
  return [...paths].sort((a, b) => {
    const twins = a.source === b.source && pageForm(a.path) === pageForm(b.path) && a.path !== b.path;
    if (twins) return a.path.includes('[page]') ? -1 : 1;
    return SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || a.path.length - b.path.length;
  });
}
```

(`[page]` is longer than `[1]`, so without this rule the length order would put the index form first.)

- [ ] **Step 9: Pacing** — `domain-lock.ts` `reportVerdict`: `if (kind === 'ok' || kind === 'wrong-variant') { backoff.delete(domain); return; }`. Test in `domain-lock-backoff.test.ts`:

```ts
it('wrong-variant clears a backoff like ok: the host answered', () => {
  reportVerdict('shop.example', 'challenge');
  expect(backoffRemainingMs('shop.example')).toBeGreaterThan(0);
  reportVerdict('shop.example', { kind: 'wrong-variant', status: 200, named: 'swatch=16' });
  expect(backoffRemainingMs('shop.example')).toBe(0);
});
```

- [ ] **Step 10: Capture-check pin** — in `capture-check.test.ts` (create beside `capture-check.ts` if it does not exist):

```ts
it('a wrong-variant capture is a capture problem with the verdict sentence', () => {
  const c = { url: 'https://p.example/pd/x?swatch=16', html: '', title: '', verdict: { kind: 'wrong-variant' as const, status: 200, named: 'swatch=16' } };
  expect(captureProblem(c, c.url)).toEqual({ reason: 'The page did not show the variant the address names (swatch=16).', verdict: c.verdict });
});
```

- [ ] **Step 11: Exports** — `verify/index.ts` (or `src/index.ts`, wherever `certify` is exported): `export { matchesPageVariant, pickPageEntry, type PathContext } from './page-variant-match.js';`.

- [ ] **Step 12: Run** — `pnpm --filter @robot/scraper exec vitest run src/verify/page-variant-match.test.ts src/verify/certify.test.ts src/verify/verified-extraction.test.ts src/domain-lock-backoff.test.ts src/verify/capture-check.test.ts`, then the scraper suite once, then `pnpm --filter @robot/scraper exec tsc --noEmit`. Expected: all pass (the pre-existing `transfer-marks` image-array flake aside), tsc clean.

- [ ] **Step 13: Commit**

```bash
git add packages/scraper/src/verify/page-variant-match.ts packages/scraper/src/verify/page-variant-match.test.ts packages/scraper/src/verify/__fixtures__/page-variant packages/scraper/src/domain-cache.ts packages/scraper/src/verify/search-structured.ts packages/scraper/src/verify/verified-extraction.ts packages/scraper/src/verify/verified-extraction.test.ts packages/scraper/src/verify/certify.ts packages/scraper/src/verify/certify.test.ts packages/scraper/src/verify/drift-classify.ts packages/scraper/src/verify/transfer-marks.ts packages/scraper/src/domain-lock.ts packages/scraper/src/domain-lock-backoff.test.ts packages/scraper/src/verify/capture-check.test.ts packages/scraper/src/verify/index.ts
git commit -m "feat(scraper): the [page] address form reads an array by the page's variant — matching rules, the dot-path step, certification ranking, pacing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add `packages/scraper/src/index.ts` if the export lives there.)

---

### Task 3: Verify proposes `[page]`; the selection script; entries keep their ids; fragments (`@robot/scraper`)

**Files:**
- Modify: `packages/scraper/src/verify/search-structured.ts` (`searchStructured` emits the `[page]` twin), `packages/scraper/src/verify/ai-fallback.ts` (the page variant in the prompt), `packages/scraper/src/verify/variant-dom.ts` (`buildSelectionScript`), `packages/scraper/src/verify/verified-extraction.ts` (`captureUnderLock` passes `selection`), `packages/scraper/src/verify/proof-page-capture.ts` (`captureProofPage` passes `selection`), `packages/scraper/src/verify/run-verification.ts` (`defaultCapture` passes `selection`), `packages/scraper/src/verify/variant-detect.ts` (`toEntry` keeps ids), `packages/scraper/src/crawl/product-link-group.ts` (fragment rule)
- Test: `search-structured.test.ts`, `ai-fallback.test.ts`, `variant-dom.test.ts` (Chromium), `variant-detect.test.ts`, `plan-run-product-group.test.ts` or a new `product-link-group.test.ts` unit case

**Interfaces:**
- Consumes: `PageVariant`, `addressVariant` from `@robot/browser`; `matchesPageVariant` (Task 2).
- Produces:
  ```ts
  // variant-dom.ts
  export function buildSelectionScript(): string;   // page script → { pairs: [{name, value}], labels: string[] } | null
  // variant-detect.ts: VariantList.entries[i] may carry url, @id, id, variant_id (as text) beside axes/sku/price
  ```

- [ ] **Step 1: Failing tests** — add to `search-structured.test.ts`:

```ts
describe('searchStructured — the [page] twin (spec 2026-10-14 §4)', () => {
  const rug = JSON.parse(readFileSync(new URL('./__fixtures__/page-variant/ruggable.json', import.meta.url), 'utf8'));
  const capture = { url: rug.url, structuredData: { ldJson: rug.ldJson, nextData: null, initialState: null, meta: {} }, interceptedRequests: [], pageVariant: pageVariantFrom(rug.url, null, {}) };
  it('beside the index path whose entry is the page variant, emits the [page] form; other indexes get no twin', () => {
    const out = searchStructured(capture, 'money', '569.00');
    const paths = out.map((c) => c.path);
    expect(paths).toContain('hasVariant[1].offers.price');
    expect(paths).toContain('hasVariant[page].offers.price');
    expect(out.find((c) => c.path === 'hasVariant[page].offers.price')).toMatchObject({ source: 'json-ld', transform: 'identity' });
    const other = searchStructured(capture, 'money', '439.00');
    expect(other.map((c) => c.path)).toContain('hasVariant[0].offers.price');
    expect(other.map((c) => c.path)).not.toContain('hasVariant[page].offers.price');
  });
  it('no page variant on the capture: no twin', () => {
    const { pageVariant: _, ...plain } = capture;
    expect(searchStructured(plain, 'money', '569.00').map((c) => c.path)).not.toContain('hasVariant[page].offers.price');
  });
});
```

Add to `variant-detect.test.ts`:

```ts
it('entries keep url, @id, id and variant_id as text (spec 2026-10-14 §9)', () => {
  const kith = JSON.parse(readFileSync(new URL('./__fixtures__/page-variant/kith.json', import.meta.url), 'utf8'));
  const list = detectVariantList({ url: kith.url, structuredData: { ldJson: kith.ldJson, nextData: null, initialState: null, meta: {} }, interceptedRequests: [] });
  expect(list?.entries[1]).toMatchObject({ sku: '2000372078', url: 'https://kith.com/products/khwa030086-001?variant=45144745050240' });
  const api = { url: 'https://s.example/p', structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} }, interceptedRequests: [{ url: 'https://s.example/products/x.json', method: 'GET', resourceType: 'fetch', responseStatus: 200, responseHeaders: {}, responseBody: '', contentType: 'application/json', bodySize: 1, isJson: true, parsedJson: { product: { variants: [{ id: 45061353865273, sku: 'A', option1: 'Black', price: '209.99' }, { id: 45242474037305, sku: 'B', option1: 'Grey', price: '209.99' }] } }, timestamp: 0 }] };
  expect(detectVariantList(api)?.entries[0]).toMatchObject({ id: '45061353865273', sku: 'A' });
});
```

(Use the file's real detector name if it is not `detectVariantList`; the brief's reader checks `variant-detect.ts`'s export.)

Add a unit case for the fragment rule — in `plan-run-product-group.test.ts` or a new `product-link-group.test.ts` without Chromium:

```ts
describe('largestProductGroup — fragments (spec 2026-10-14 §8)', () => {
  const L = 'https://s.example/collections/all';
  it('a key=value fragment survives on the item address; a plain fragment is stripped; grouping is unchanged', () => {
    const anchors = [
      { href: 'https://s.example/products/a#sku=a-blue', text: 'A' },
      { href: 'https://s.example/products/b#reviews', text: 'B' },
      { href: 'https://s.example/products/c', text: 'C' },
      { href: 'https://s.example/products/c#sku=c-red', text: 'C red' },
    ];
    expect(largestProductGroup(anchors, L)).toEqual([
      'https://s.example/products/a#sku=a-blue',
      'https://s.example/products/b',
      'https://s.example/products/c',
      'https://s.example/products/c#sku=c-red',
    ]);
  });
});
```

- [ ] **Step 2: Run, expect failure** — the three test files → FAIL on the new cases.

- [ ] **Step 3: The twin in `searchStructured`** — `walk` visits `arr[i]` paths; add a parallel visit: when the capture carries a page variant and an array's entry `i` is the one `pickPageEntry` returns, also visit the same subtree under `${path}[page]`. Implement by extending `walk` with a `pv` argument:

```ts
function walk(value: unknown, path: string, depth: number, visit: Visit, pv?: PageVariant): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    if (path !== '') visit(path, value);
    const pageEntry = pv ? pickPageEntry(value, pv) : undefined;
    value.slice(0, MAX_ARRAY_ITEMS).forEach((v, i) => {
      walk(v, `${path}[${i}]`, depth + 1, visit, pv);
      if (pageEntry !== undefined && v === pageEntry) walk(v, `${path}[page]`, depth + 1, visit, pv);
    });
    return;
  }
  …unchanged…
}
```

`searchStructured(capture: Pick<PageCapture, 'url' | 'structuredData' | 'interceptedRequests' | 'pageVariant'>, …)` passes `capture.pageVariant` to every `walk`. `searchStructuredByConcept` the same (drift's "changed" search).

- [ ] **Step 4: The AI fallback** — `buildProposePrompt`: after `=== PAGE ${url} ===`, when `capture.pageVariant?.named`, add the line `This address names a variant: ${JSON.stringify(capture.pageVariant.pairs)}. An array may be addressed by it as arr[page] (the entry whose url, id, sku or option values match).`; `FallbackEvidence.captures` values gain `pageVariant?` through `CaptureLike`. Test in `ai-fallback.test.ts`:

```ts
it('tells the model the page variant and the [page] form when the address names one', () => {
  const prompt = buildProposePrompt({ field, expected: { [url]: '569.00' }, captures: { [url]: { ...capture, pageVariant: pageVariantFrom(url, null, {}) } }, nearMisses: {} });
  expect(prompt).toContain('This address names a variant');
  expect(prompt).toContain('arr[page]');
});
```

- [ ] **Step 5: The selection script** — in `variant-dom.ts` add:

```ts
/**
 * The picker's current selection (spec 2026-10-14 §3): inside each picker
 * `findPickersIn` finds, the option marked selected — `option:checked`,
 * `input:checked` (its label), `[aria-checked="true"]`, `[aria-selected="true"]`,
 * `[aria-pressed="true"]`. Returns `{ pairs, labels }` or null when no picker
 * shows a selection. A review widget's `.selected` never counts: only the
 * variant controls `isVariantControl` accepts are read.
 */
export function buildSelectionScript(): string {
  return `(() => {
    ${PAGE_SCRIPT_PRELUDE}
    const controlRe = /${CONTROL_PATTERN}/i;
    const excludeRe = /${EXCLUDE_PATTERN}/i;
    const excludeTokenRe = /${EXCLUDE_TOKEN_PATTERN}/i;
    const isVariantControl = ${isVariantControl.toString()};
    const isExcluded = ${isExcluded.toString()};
    const isHidden = ${isHidden.toString()};
    const buildLabelForMap = ${buildLabelForMap.toString()};
    const radioLabel = ${radioLabel.toString()};
    const buttonLabel = ${buttonLabel.toString()};
    const matchedWord = ${matchedWord.toString()};
    const axisOf = ${axisOf.toString()};
    const fieldsetOnlyHasGroup = ${fieldsetOnlyHasGroup.toString()};
    const radioGroupAxis = ${radioGroupAxis.toString()};
    const findPickersIn = ${findPickersIn.toString()};
    const labelForMap = buildLabelForMap();
    const pairs = [], labels = [];
    const push = (axis, text) => { const t = (text || '').replace(/\\s+/g, ' ').trim(); if (!t) return; pairs.push({ name: axis, value: t }); labels.push(t); };
    for (const el of document.body ? document.body.querySelectorAll('*') : []) {
      if (!isVariantControl(el, controlRe) || isExcluded(el, excludeRe, excludeTokenRe) || isHidden(el)) continue;
      for (const picker of findPickersIn(el, controlRe, labelForMap)) {
        const a = picker.anchorEl;
        if (a.tagName === 'SELECT') { const o = a.options[a.selectedIndex]; if (o && a.selectedIndex > 0) push(picker.axis, o.textContent); continue; }
        const sel = a.matches('[aria-checked="true"],[aria-selected="true"],[aria-pressed="true"]') ? a : a.querySelector('[aria-checked="true"],[aria-selected="true"],[aria-pressed="true"],input:checked');
        if (!sel) continue;
        push(picker.axis, sel.tagName === 'INPUT' ? radioLabel(sel, labelForMap) : buttonLabel(sel));
      }
    }
    return pairs.length ? { pairs, labels } : null;
  })()`;
}
```

(`radioLabel`/`buttonLabel` are the file's existing helpers; match their real signatures when inlining — the implementer reads `variant-dom.ts` first.) Chromium test in `variant-dom.test.ts`, following its existing `PlaywrightBrowser.evaluate` pattern:

```ts
it('buildSelectionScript reads the selected size radio and a selected colour button, and null with no selection', async () => {
  const html = `<form><fieldset><legend>Size</legend><label><input type="radio" name="size" value="xs"> XS</label><label><input type="radio" name="size" value="s" checked> S</label></fieldset>
    <div class="color-swatches" role="radiogroup" aria-label="Color"><button role="radio" aria-checked="false">Black</button><button role="radio" aria-checked="true">Chill Grey</button></div></form>`;
  const r = await browser.evaluate(dataUrl(html), buildSelectionScript());
  expect(r).toEqual({ pairs: [{ name: 'size', value: 'S' }, { name: 'color', value: 'Chill Grey' }], labels: ['S', 'Chill Grey'] });
  const none = await browser.evaluate(dataUrl('<form><fieldset><legend>Size</legend><label><input type="radio" name="size" value="xs"> XS</label><label><input type="radio" name="size" value="s"> S</label></fieldset></form>'), buildSelectionScript());
  expect(none).toBeNull();
}, 30_000);
```

(`dataUrl`/`browser` as that test file already defines them; the axis names come from `axisOf`, so assert on what it returns for a `<legend>Size</legend>` fieldset and an `aria-label="Color"` group — adjust the expected names to the script's real output and say so in the report.)

- [ ] **Step 6: Callers pass the script** — `verified-extraction.ts` `captureUnderLock`: `selection: buildSelectionScript()` in the capture options; `proof-page-capture.ts` `captureProofPage`: the same; `run-verification.ts` `defaultCapture` (or wherever `browser.capture` is called for proof pages in Verify): the same. Import from `./variant-dom.js`.

- [ ] **Step 7: Entries keep ids** — `variant-detect.ts` `toEntry`: after `price`, add

```ts
  for (const k of ['url', '@id', 'id', 'variant_id'] as const) {
    const t = toText(raw[k]);
    if (t !== undefined) out[k] = t;
  }
  if (isPlainObject(raw.offers)) { const u = toText((raw.offers as PlainObject).url); if (u !== undefined && out.url === undefined) out.url = u; }
```

`VariantList.entries` doc: "plus url/@id/id/variant_id as text when present (spec 2026-10-14 §9), unread until the next plan". Confirm `buildVariantRows` and `variant-certify` ignore unknown entry keys (they read axes/sku/price by name) — say so in the report with file:line.

- [ ] **Step 8: Fragments** — `product-link-group.ts` `largestGroup`: replace `u.hash = '';` with

```ts
    // Spec 2026-10-14 §8: a fragment that carries key=value pairs names a
    // variant and stays on the item's address; any other fragment is noise.
    if (!/^#[^=]+=/.test(u.hash)) u.hash = '';
```

Deduplication (`seen`) then keys on the href with the kept fragment, so `/products/c` and `/products/c#sku=c-red` are two items, as the test expects. Check `plan-source.ts`'s exact-URL dedupe and `normalizeVariantLink` (strips the hash for the product key) still behave: `_product_key` for a `#sku=` item is the hash-less url — note it in the report.

- [ ] **Step 9: Run** — the five test files, the scraper suite once (Chromium files one at a time), `tsc --noEmit`. Expected: all pass, tsc clean.

- [ ] **Step 10: Commit**

```bash
git add packages/scraper/src/verify/search-structured.ts packages/scraper/src/verify/search-structured.test.ts packages/scraper/src/verify/ai-fallback.ts packages/scraper/src/verify/ai-fallback.test.ts packages/scraper/src/verify/variant-dom.ts packages/scraper/src/verify/variant-dom.test.ts packages/scraper/src/verify/verified-extraction.ts packages/scraper/src/verify/proof-page-capture.ts packages/scraper/src/verify/run-verification.ts packages/scraper/src/verify/variant-detect.ts packages/scraper/src/verify/variant-detect.test.ts packages/scraper/src/crawl/product-link-group.ts packages/scraper/src/crawl/product-link-group.test.ts
git commit -m "feat(scraper): Verify proposes and prefers [page] paths; captures read the picker's selection; variant entries keep their ids; key=value fragments survive planning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Use the real test file for the fragment case in the `git add`.)

---

### Task 4: The api returns the page variant and fails an item honestly (`@robot/api`)

**Files:**
- Modify: `packages/api/src/routers/sources.ts` (`suggestMarks` returns `pageVariant`), `packages/api/src/crawl/extract-item.test.ts`, `packages/api/src/crawl/execute-run.test.ts`
- Test: `packages/api/src/routers/sources-suggest-marks.test.ts` (or the file that tests `suggestMarks` today), the two above

**Interfaces:**
- Consumes: `PageCapture.pageVariant` (stored whole in the capture file `readCaptureFile` returns), the `wrong-variant` verdict.
- Produces: `sources.suggestMarks` output gains `pageVariant: PageVariant | null` beside `headingText` and `pageText`.

- [ ] **Step 1: Failing test** — in the `suggestMarks` test file, with a stored capture whose `pageVariant` is `pageVariantFrom('https://s.example/p/1?variant=123', null, {})`:

```ts
it('returns the capture\'s page variant beside headingText and pageText, and null for a capture from before', async () => {
  const out = await caller.sources.suggestMarks({ captureId });
  expect(out.pageVariant).toEqual({ ids: ['123'], pairs: [{ name: 'variant', value: '123' }], labels: [], named: true, selected: false });
  const old = await caller.sources.suggestMarks({ captureId: oldCaptureId });   // a stored capture without pageVariant
  expect(old.pageVariant).toBeNull();
});
```

(Build the two captures the way that file already seeds captures on disk through `writeCaptureFile`.)

- [ ] **Step 2: Implement** — in `suggestMarks`'s return: `pageVariant: capture.pageVariant ?? null,` with the comment "Spec 2026-10-14 §6: the Verification tab's row warning compares a proof page's named variant with the certified path's entry."

- [ ] **Step 3: Pin the run-item failure** — in `extract-item.test.ts`, using the file's existing fakes (a `browser` whose `capture` returns a capture with a given verdict):

```ts
it('a wrong-variant capture fails the item with the sentence: no row, no path stats (spec 2026-10-14 §7)', async () => {
  const verdict = { kind: 'wrong-variant' as const, status: 200, named: 'swatch=16' };
  const deps = fakeDeps({ captureVerdict: verdict });
  await expect(extractItem(item('https://p.example/pd/x?swatch=16'), deps)).rejects.toMatchObject({ name: 'CaptureProblemError', message: 'The page did not show the variant the address names (swatch=16).', verdict });
  expect(deps.recordStats).not.toHaveBeenCalled();
  expect(deps.persistRows).not.toHaveBeenCalled();
});
```

In `execute-run.test.ts`:

```ts
it('wrong-variant is not a wall: no streak, no breaker', () => {
  expect(wallSentence(new CaptureProblemError('The page did not show the variant the address names (swatch=16).', { kind: 'wrong-variant', status: 200, named: 'swatch=16' }))).toBeNull();
});
```

(Name the fakes as the file names them; if `extract-item.test.ts` has no verdict-driven fake, add the smallest one that returns a capture with `verdict` set, mirroring how the wall case is tested.)

- [ ] **Step 4: Run** — the three test files, then the api suite once, `tsc --noEmit`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routers/sources.ts packages/api/src/routers/sources-suggest-marks.test.ts packages/api/src/crawl/extract-item.test.ts packages/api/src/crawl/execute-run.test.ts
git commit -m "feat(api): the captures query returns the page variant; a wrong-variant capture fails its item with the sentence and never trips the wall breaker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Use the real `suggestMarks` test file name.)

---

### Task 5: The Verification tab's row warning and the route smoke (`@robot/app`)

**Files:**
- Modify: `packages/app/src/lib/site/verification-model.ts` (`addressWarning`), `packages/app/src/lib/site/verification-view.ts` (`PageVariantLike`), `packages/app/src/components/verification/verification-table.tsx` (`StatusCell` shows it), `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx` (`pageFacts[url].pageVariant`, pass the warning), `packages/app/src/routes-smoke.test.ts` (a seeded result on a `?variant=` proof page)
- Test: `packages/app/src/lib/site/verification-model.test.ts`, the smoke

**Interfaces:**
- Consumes: `suggestMarks().pageVariant` (Task 4); stored `FieldVerification.cells[url].path` (`{ source, path }`).
- Produces:
  ```ts
  export type PageVariantLike = { ids: string[]; pairs: Array<{ name: string; value: string }>; labels: string[]; named: boolean; selected: boolean };
  export const ADDRESS_WARNING = (n: number) => `reads the first variant, not the one the address names on product ${n}`;
  export function addressWarning(key: string, results: VerificationResultsLike | null, cards: Card[], pageVariants: Record<string, PageVariantLike | null | undefined>): string | null;
  // pageFacts: Record<string, { headingText: string | null; pageText: string; pageVariant?: PageVariantLike | null }>
  ```

- [ ] **Step 1: Failing tests** — in `verification-model.test.ts`:

```ts
describe('addressWarning (spec 2026-10-14 §6)', () => {
  const cards = [{ url: 'https://r.example/p/a?size=6x9', title: 'A' }, { url: 'https://r.example/p/b', title: 'B' }, { url: 'https://r.example/p/c?size=6x9', title: 'C' }];
  const named = { ids: [], pairs: [{ name: 'size', value: '6x9' }], labels: ['6x9'], named: true, selected: false };
  const unnamed = { ids: [], pairs: [], labels: [], named: false, selected: false };
  const pv = { [cards[0]!.url]: named, [cards[1]!.url]: unnamed, [cards[2]!.url]: named };
  const resultsWith = (path: string) => ({ price: { certified: [{ source: 'json-ld', path, transform: 'identity' }], cells: Object.fromEntries(cards.map((c) => [c.url, { status: 'pass' as const, found: '569.00', path: { source: 'json-ld' as const, path } }])) } });
  it('a certified index path on a named proof page warns with the first such product', () => {
    expect(addressWarning('price', resultsWith('hasVariant[0].offers.price'), cards, pv)).toBe('reads the first variant, not the one the address names on product 1');
  });
  it('a [page] path never warns', () => {
    expect(addressWarning('price', resultsWith('hasVariant[page].offers.price'), cards, pv)).toBeNull();
  });
  it('an unnamed address never warns; a path with no array index never warns', () => {
    expect(addressWarning('price', resultsWith('hasVariant[0].offers.price'), cards, { [cards[0]!.url]: unnamed, [cards[2]!.url]: unnamed })).toBeNull();
    expect(addressWarning('price', resultsWith('offers.price'), cards, pv)).toBeNull();
  });
  it('no page variant on record: no warning', () => {
    expect(addressWarning('price', resultsWith('hasVariant[0].offers.price'), cards, {})).toBeNull();
    expect(addressWarning('price', resultsWith('hasVariant[0].offers.price'), cards, { [cards[0]!.url]: null })).toBeNull();
  });
  it('no results, or a failed field: no warning', () => {
    expect(addressWarning('price', null, cards, pv)).toBeNull();
    expect(addressWarning('price', { price: { certified: [], cells: {} } }, cards, pv)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect failure** — `pnpm --filter @robot/app exec vitest run src/lib/site/verification-model.test.ts` → FAIL (`addressWarning` not exported).

- [ ] **Step 3: Implement** — `verification-view.ts`: `export type PageVariantLike = { ids: string[]; pairs: Array<{ name: string; value: string }>; labels: string[]; named: boolean; selected: boolean };` (mirrors `@robot/browser`'s `PageVariant`, never imported). `verification-model.ts`:

```ts
export const ADDRESS_WARNING = (n: number) => `reads the first variant, not the one the address names on product ${n}`;

const INDEXED_STEP = /\[\d+\]/;

/**
 * Spec 2026-10-14 §6: a certified field whose proving path on a proof page
 * addresses an array by a fixed index, while that page's address names a
 * variant, reads the first variant whatever the address says. Pure; the page
 * variant per url comes from the captures query, the proving path from the
 * stored cell. Never changes a cell's status or the badge.
 */
export function addressWarning(
  key: string,
  results: VerificationResultsLike | null,
  cards: Card[],
  pageVariants: Record<string, PageVariantLike | null | undefined>,
): string | null {
  const r = results?.[key];
  if (!r || r.certified.length === 0) return null;
  for (const [i, card] of cards.entries()) {
    const pv = pageVariants[card.url];
    if (!pv?.named) continue;
    const cell = r.cells[card.url] as { status: string; path?: { path: string } } | undefined;
    const path = cell?.status === 'pass' ? cell.path?.path : undefined;
    if (!path || path.includes('[page]') || !INDEXED_STEP.test(path)) continue;
    return ADDRESS_WARNING(i + 1);
  }
  return null;
}
```

(`VerificationResultsLike`'s cells type may need `path?: { path: string }` widened — do it in that type, not with a cast, if the type allows.) `verification-table.tsx`: `StatusCell` gains `addressWarning: string | null` and renders it like `defaultOnlyWord` (a muted `text-warn` span under the status, in the `accepted`/`agreed` cases and whenever the badge is `verified`); `TableRow` carries it. The route: `pageFacts` type gains `pageVariant?: PageVariantLike | null`; the `setPageFacts` block stores `pageVariant: d.pageVariant`; each row gets `addressWarning: addressWarning(f.key, results, board.cards, Object.fromEntries(Object.entries(pageFacts).map(([u, f]) => [u, f.pageVariant])))`.

- [ ] **Step 4: Run** — the model test → PASS; `pnpm --filter @robot/app exec tsc --noEmit` clean; the app unit suite once.

- [ ] **Step 5: The smoke** — in `routes-smoke.test.ts`, extend the shop: a product `/p/11` ("Widget F") whose JSON-LD carries `offers: [ { price: '59.00', url: '/p/11?variant=f1', sku: 'F1' }, { price: '79.00', url: '/p/11?variant=f2', sku: 'F2' } ]` and whose page shows `$79.00` when the query is `?variant=f2`, listed on `/l` as `/p/11?variant=f2`. Add a test after the coverage walk, following the seeded-verification pattern that test uses (`seed…` helpers in the test file; no Verify click):

```ts
it('a proof page whose address names a variant that the certified path ignores reads the row warning', async () => {
  expect(projectSlug).not.toBeNull(); expect(websiteSlug).not.toBeNull();
  const api = apiAs(await sessionCookie(context));
  const site = await api.sources.get.query({ projectSlug: projectSlug!, sourceSlug: websiteSlug! });
  const priceKey = site.fields.find((f) => f.name === 'Price')!.key;
  // Product 1's card is swapped for /p/11?variant=f2 with Price typed 79.00 and a stored result
  // whose proving path is offers[0].price (the f1 price) — what a Verify from before this change
  // would have certified on a page whose address names f2.
  await seedVerifiedBaseline(site.id, { urls: [`${SHOP}/p/11?variant=f2`, `${SHOP}/p/2`, `${SHOP}/p/3`], paths: { [priceKey]: [{ source: 'json-ld', path: 'offers[0].price', transform: 'identity' }] } });
  await page.goto(`${APP}/projects/${projectSlug}/sites/${websiteSlug}`, { waitUntil: 'networkidle', timeout: 30_000 });
  await waitForHydration(page, 'main');
  await expect.poll(() => page.getByText('reads the first variant, not the one the address names on product 1', { exact: true }).count(), { timeout: 30_000 }).toBe(1);
  await shootViewportBothThemes(page, 'app-site-verification-address-warning');
});
```

(`seedVerifiedBaseline` is the coverage test's baseline seeder — reuse its real name and shape; the proof-page capture of `/p/11?variant=f2` must run so `suggestMarks` has a `pageVariant`: the tab captures cards on load, as the coverage walk relies on.) Also serve `/p/11` in `shopPage` and link it on `/l` AFTER the existing cards so the finder's first three stay `/p/1..3`. Do NOT run the smoke in this task (it runs on `main` after the merge); run `tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/lib/site/verification-model.ts packages/app/src/lib/site/verification-model.test.ts packages/app/src/lib/site/verification-view.ts packages/app/src/components/verification/verification-table.tsx "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx" packages/app/src/routes-smoke.test.ts
git commit -m "feat(app): the Verification tab warns when a proof page's address names a variant the certified path ignores; smoke fixture for it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs

**Files:**
- Modify: `docs/handoff.md` (a new section at the top of the dated sections, the "Newest" paragraph, next-work item 9's variant sub-item), `CLAUDE.md` (one Key Technical Decisions line after the defaults line), `docs/superpowers/specs/2026-10-14-variant-from-the-address-design.md` (status line)

- [ ] **Step 1: Handoff section** — insert before `## A website's default values (2026-10-13)`:

```markdown
## The variant the address names (2026-10-14)

Spec `docs/superpowers/specs/2026-10-14-variant-from-the-address-design.md`, plan
`docs/superpowers/plans/2026-10-14-variant-from-the-address.md`. Branch `feat/variant-from-address`
from `main`, six tasks (subagent-driven); the whole-branch review, the merge, the route smoke on
`main` and the live check: see the plan's status.

**What a customer gets** (spec §2): a row's values are the values of the variant the address
names, or the one the page shows selected when the address names none. Every capture computes a
page variant; a certified path can read an array by it with `[page]` (`offers[page].price`,
`hasVariant[page].sku`), which resolves to the one matching entry and to nothing otherwise, never
entry 0. Verify proposes `[page]` whenever the typed value sits in the matching entry and ranks it
above the fixed index, so Ruggable's three proof pages certify one path though the 6x9 entry sits
at a different index on each. A proof page whose address names a variant the certified path
ignores reads "reads the first variant, not the one the address names on product n" in its row. A
page that does not show the variant its address names fails its capture: "The page did not show
the variant the address names (swatch=16)." — a failed item with one sentence, no row, no backoff.

**How it was proven:** per-task reviews; unit tests on entry shapes copied from the campaign's
stored captures (Skullcandy's one-block-per-colour JSON-LD and Shopify `variants[].id`,
Ruggable's `hasVariant[].sku …-06x09` and `size "6'x9'"`, Kith's `offers[]` with a selected size,
Burrow's option pairs against entry names); Chromium tests for the selection script and the
wrong-variant verdict; the route smoke's seeded warning. Live, free, after the merge: Verify on
Ruggable, Skullcandy, Kith and Glossier, a small Extract on each, Puma expected to fail its
capture with the new sentence.

**Deviations from the spec:** label matching is by containment for an entry's `name`/`title`
(Burrow), equality elsewhere; the selection DOM script lives in scraper's `variant-dom.ts` and
reaches the browser through `CaptureOptions.selection`; Glossier's variants fixture comes from
Skullcandy's `/products/<handle>.json` body (Glossier's stored capture holds only reviews).

**Known gaps / next:** folding `?variant=` siblings under one product key and picking the row
the address names in one-row-per-variant mode (entries now keep their ids for it); the finder
counting swatch addresses as separate products; a variant named in the path's trailing tokens
(`-black-m`); clicking the option the address names on sites that ignore the address (Puma fails
honestly instead); aggregates per field; `__NEXT_DATA__` as a certifiable source.
```

- [ ] **Step 2: The "Newest" paragraph and item 9** — a new "**Newest: [The variant the address names (2026-10-14)](#the-variant-the-address-names-2026-10-14).**" paragraph above the defaults one (demote the defaults paragraph to "Before it:"), two sentences in the same voice. In next-work item 9, change "the variant chosen in the URL is ignored" to "the variant chosen in the URL is ignored — addressed 2026-10-14, see the section".

- [ ] **Step 3: CLAUDE.md** — after the defaults line in Key Technical Decisions: `- The variant the address names (2026-10-14): every capture knows its page variant; a certified path reads an array by it with \`[page]\` (the one matching entry or nothing, never entry 0); Verify proposes and prefers that form; a page that does not show the variant its address names fails its capture with one sentence.`

- [ ] **Step 4: Spec status line** — replace the status paragraph with: `**Status:** implemented on \`feat/variant-from-address\`, 2026-10-14; merge, final review, the route smoke and the live check: see the plan's status and \`docs/handoff.md\`.` and add a `**Deviations:**` list with the three from the planner's notes.

- [ ] **Step 5: Commit**

```bash
git add docs/handoff.md CLAUDE.md docs/superpowers/specs/2026-10-14-variant-from-the-address-design.md
git commit -m "docs: the variant the address names — handoff section, key decision, spec status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
