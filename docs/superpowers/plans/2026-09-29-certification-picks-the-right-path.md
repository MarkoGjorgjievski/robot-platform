# Certification picks the right path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Certification stops choosing coincidental paths (Ikea's In stock on `api → priority`), images verify despite size parameters, and the Verification tab collects answers that carry their confirmed path — cutting Ikea from 24 clicks to about 7.

**Architecture:** One new scraper module, `verify/field-fit.ts`, owns the concept vocabulary and the "weak field" rule; `certify` applies it to every candidate set (including the domain-cache shortcut) and orders confirmed paths first. The verification set gains `paths` (the structured path each answer was accepted from), round-tripped like `marks` and folded into `fieldHash`. The engine's comparison learns that two image URLs differing only in their query are the same image and reads URL objects. The app model records `via` on accepted answers and gains the majority / one-place / yes/no rules; the table gains a one-click cell accept.

**Tech Stack:** TypeScript, vitest; `@robot/scraper` (verify), `@robot/api` (tRPC, zod), `@robot/app` (TanStack Start, React); Postgres for API tests; Playwright for the smoke and the live check.

**Spec:** `docs/superpowers/specs/2026-09-29-certification-picks-the-right-path-design.md` (read it whole; §7 decisions 1–4 are approved).

## Global Constraints

- **API stays the first-ranked source.** The changes decide which paths may compete; among those, the order stays API → JSON-LD → meta → page, with one exception: a confirmed path goes first (spec §7.1).
- Weak = the field's type is `boolean`, **or** every checked proof page's expected value normalises to the same value (and there is more than one page).
- Image equality: host (lower-cased) + path, ignoring query and fragment. Type `url` keeps today's exact comparison.
- Yes/no display words: "In stock" / "Out of stock" for concept `availability`, otherwise "Yes" / "No". The saved value is never rewritten.
- `fieldHash` and `definitionHash` must be byte-identical for a verification set that has no `paths` (existing websites stay current).
- Nothing is re-certified automatically; the audit is read-only.
- Customer wording only on screen ("field", "product", "page"; never "path", "via", "concept", "candidate").
- **Budget rule:** no implementer or test clicks Verify with an Anthropic key present. The live check clicks Verify only on the keyless :4100 stack after asserting "· free".
- **No implementer signs in as `markodjordjievski@gmail.com`** or writes org `default`/`mar` data. The audit (Task 6) reads the local database read-only.
- Commits by explicit path; messages end with a `Co-Authored-By:` line for the model that wrote them.
- Test gate per package: `pnpm --filter <pkg> test -- --maxWorkers=2`. Postgres (`robot-platform-db`) must be up.

## Review Focus

1. **A variant/combination product whose confirmed path differs from the others** (Ikea product 3: `offers.offers[0].availability` vs `offers.availability`). Expected: both confirmed paths qualify and together cover all pages. Test: Task 1 `confirmed paths from different products cover together`.
2. **A custom field with no catalogue concept whose three values are identical.** Expected: only confirmed paths and marks qualify; otherwise `no_fitting_path`, never a random match. Test: Task 1.
3. **An existing website saved before `paths` existed.** Expected: `fieldHash` unchanged, so it stays verified. Test: Task 1 hash test.
4. **Two different images at the same path with different query ids** (`/img?id=1` vs `/img?id=2`). Expected: they now compare equal — accepted risk for type image only; the url type must still tell them apart. Test: Task 2 pins both.
5. **A click on an outlined element whose suggestion value fails the field's type.** Expected: falls back to the element's own value (today's pick), never saves an invalid value. Test: Task 4 `pickAnswer`.

---

## File map

- Create `packages/scraper/src/verify/field-fit.ts` (+ test): `CONCEPT_PATHS`, `pathFitsConcept`, `isWeakField`.
- Modify `packages/scraper/src/verify/certify.ts` (+ test), `run-verification.ts` (+ test), `types.ts`, `suggest-marks.ts`, `transfer-marks.ts` (+ test), `normalize.ts` (+ test), `search-structured.ts`.
- Modify `packages/api/src/verify/binding-input.ts`, `packages/api/src/routers/sources.ts` (transfer `from.via` pass-through if needed); create `packages/api/src/scripts/audit-certified-paths.ts` (+ a pure `audit-certified-paths-core.ts` with a test).
- Modify `packages/app/src/lib/site/verification-model.ts` (+ test), `packages/app/src/lib/site/verification-view.ts` (hint for `no_fitting_path`), `packages/app/src/components/verification/verification-table.tsx`, `field-details.tsx`, the route `packages/app/src/routes/_app/projects/$project/sites/$site/index.tsx`.
- Docs: `docs/testing/2026-09-2x-certification-live.md`, `docs/handoff.md`.

---

### Task 1: Scraper — weak fields need a fitting path; confirmed paths first

**Files:**
- Create: `packages/scraper/src/verify/field-fit.ts`, `packages/scraper/src/verify/field-fit.test.ts`
- Modify: `packages/scraper/src/verify/types.ts`, `certify.ts`, `run-verification.ts`, `suggest-marks.ts`
- Test: `packages/scraper/src/verify/certify.test.ts`, `run-verification.test.ts`

**Interfaces — Produces:**

```ts
// field-fit.ts
export const CONCEPT_PATHS: Record<string, string[]>;   // moved from suggest-marks.ts, availability extended
export function pathFitsConcept(concept: string, path: string): boolean;   // tail match, indices removed, case-insensitive
export function isWeakField(type: CustomerFieldType, expectedValues: string[]): boolean;
// types.ts
export type ConfirmedPath = { source: 'api' | 'json-ld' | 'meta'; path: string };
// VerificationSet gains:  paths?: Record<string, Record<string, ConfirmedPath>>;  // fieldKey → url → path the answer was accepted from
// FailReason gains 'no_fitting_path'
// certify.ts — CertifyInput gains:  confirmed?: ConfirmedPath[]; markXPaths?: string[];
```

**Rules:**
- `CONCEPT_PATHS.availability` = `['offers.availability', 'availability', 'inStock', 'in_stock', 'isAvailable', 'is_available', 'stock', 'stockStatus', 'stock_status', 'available', 'buyable', 'purchasable']`; every other list as today. `suggest-marks.ts` imports `CONCEPT_PATHS` from `field-fit.ts` (no behaviour change there).
- `pathFitsConcept(concept, path)`: `const p = path.replace(/\[\d+\]/g, '').toLowerCase();` true when some tail `t = tail.toLowerCase()` satisfies `p === t || p.endsWith('.' + t)`. Unknown concept → false.
- `isWeakField(type, values)`: `type === 'boolean'`, or `values.length > 1` and every value normalises (`normalize(type, v)`) to the same non-null string.
- In `certifyCandidates`, after today's `dedupe(...)` filter:
  - `weak = isWeakField(field.type, Object.values(expected))`;
  - `isConfirmed(c) = c.source !== 'xpath' && (input.confirmed ?? []).some((p) => p.source === c.source && p.path === c.path)`;
  - add a candidate `{ source, path, transform: 'identity' }` for every confirmed path not already present (by source+path);
  - when `weak`, keep a candidate only if `isConfirmed(c) || (c.source === 'xpath' && (input.markXPaths ?? []).includes(c.path)) || (c.source !== 'xpath' && pathFitsConcept(field.concept, c.path))`;
  - when `weak` and nothing is kept: every captured checked page's cell is `{ status: 'fail', reason: 'no_fitting_path' }`, `certified: []`.
  - Ordering: replace `rankCertified(...)` in the one-layout pick and in `greedyCover` with `rankConfirmedFirst(paths)` = confirmed candidates (in `rankCertified` order) followed by the rest (in `rankCertified` order).
- `gatherCandidates` is unchanged (confirmed paths enter through `certify`).
- `run-verification.ts`: for each field pass `confirmed: Object.values(set.paths?.[field.key] ?? {})` (deduped by source+path) and `markXPaths: Object.values(set.marks?.[field.key] ?? {}).flatMap((m) => m.xpaths)` to **every** `certify` call (the cache shortcut, the gathered set, and after AI).
- `fieldHash`: add `...(paths ? { paths } : {})` where `paths` = the field's `set.paths` entries for checked pages, sorted by url, as `{ source, path }` — omitted when there are none, so hashes of sets without `paths` do not change. `definitionHash` the same.

- [ ] **Step 1: Write the failing tests.**

`field-fit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isWeakField, pathFitsConcept } from './field-fit.js';

describe('pathFitsConcept', () => {
  it('matches a concept tail, ignoring array indices and case', () => {
    expect(pathFitsConcept('availability', 'offers.availability')).toBe(true);
    expect(pathFitsConcept('availability', 'offers.offers[0].availability')).toBe(true);
    expect(pathFitsConcept('availability', 'product.InStock')).toBe(true);
    expect(pathFitsConcept('availability', 'priority')).toBe(false);
    expect(pathFitsConcept('availability', '[0].cashAndCarry')).toBe(false);
    expect(pathFitsConcept('brand', 'brand.name')).toBe(true);
    expect(pathFitsConcept('no_such_concept', 'anything')).toBe(false);
  });
});

describe('isWeakField', () => {
  it('is weak for yes/no fields and for fields whose values are all the same', () => {
    expect(isWeakField('boolean', ['Available', 'no'])).toBe(true);
    expect(isWeakField('text', ['IKEA', 'ikea ', 'IKEA'])).toBe(true);
    expect(isWeakField('text', ['IKEA', 'Muji'])).toBe(false);
    expect(isWeakField('text', ['IKEA'])).toBe(false);
    expect(isWeakField('money', ['129.99', '$129.99', '219.99'])).toBe(false);
  });
});
```

`certify.test.ts` — add (reuse the file's capture/deps helpers; read its top first):

```ts
describe('weak fields need a fitting path', () => {
  // Three in-stock products: an unrelated API field equals 1 everywhere, JSON-LD says InStock.
  const cap = (url: string) => ({
    url, html: '<html><body><span class="s">Available</span></body></html>',
    structuredData: { ldJson: [{ '@type': 'Product', offers: { availability: 'https://schema.org/InStock' } }], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [{ url: `${url}/api`, method: 'GET', status: 200, isJson: true, parsedJson: { priority: 1 } }],
  });
  const urls = ['https://s.example/p/1', 'https://s.example/p/2', 'https://s.example/p/3'];
  const field = { key: 'in_stock', name: 'In stock', type: 'boolean' as const, description: '', concept: 'availability' };
  const expected = Object.fromEntries(urls.map((u) => [u, 'Available']));
  const captures = Object.fromEntries(urls.map((u) => [u, cap(u)]));

  it('certifies offers.availability, not an unrelated API field that happens to be 1', async () => {
    const candidates = [{ source: 'api', path: 'priority', transform: 'identity' }, { source: 'json-ld', path: 'offers.availability', transform: 'identity' }] as const;
    const r = await certify({ field, expected, captures, candidates: [...candidates] }, { evalXPaths: async () => ({}) });
    expect(r.certified.map((p) => `${p.source} ${p.path}`)).toEqual(['json-ld offers.availability']);
  });

  it('fails with no_fitting_path when nothing fits and nothing was confirmed', async () => {
    const r = await certify({ field, expected, captures, candidates: [{ source: 'api', path: 'priority', transform: 'identity' }] }, { evalXPaths: async () => ({}) });
    expect(r.certified).toEqual([]);
    expect(Object.values(r.cells).every((c) => c.status === 'fail' && c.reason === 'no_fitting_path')).toBe(true);
  });

  it('a confirmed path qualifies even when its name does not fit, and goes first', async () => {
    const r = await certify({ field, expected, captures, confirmed: [{ source: 'api', path: 'priority' }], candidates: [{ source: 'json-ld', path: 'offers.availability', transform: 'identity' }] }, { evalXPaths: async () => ({}) });
    expect(r.certified[0]).toMatchObject({ source: 'api', path: 'priority' });
  });

  it('confirmed paths from different products cover together', async () => {
    const c3 = { ...cap(urls[2]!), structuredData: { ...cap(urls[2]!).structuredData, ldJson: [{ '@type': 'Product', offers: { offers: [{ availability: 'https://schema.org/InStock' }] } }] } };
    const r = await certify({ field, expected, captures: { ...captures, [urls[2]!]: c3 },
      confirmed: [{ source: 'json-ld', path: 'offers.availability' }, { source: 'json-ld', path: 'offers.offers[0].availability' }], candidates: [] }, { evalXPaths: async () => ({}) });
    expect(r.certified.map((p) => p.path).sort()).toEqual(['offers.availability', 'offers.offers[0].availability']);
  });

  it('a custom field with identical values and no concept only takes confirmed paths or marks', async () => {
    const f = { ...field, key: 'shop', name: 'Shop', type: 'text' as const, concept: 'shop' };
    const r = await certify({ field: f, expected: Object.fromEntries(urls.map((u) => [u, '1'])), captures, candidates: [{ source: 'api', path: 'priority', transform: 'identity' }] }, { evalXPaths: async () => ({}) });
    expect(r.certified).toEqual([]);
  });

  it('a non-weak field is unaffected', async () => {
    const f = { key: 'price', name: 'Price', type: 'money' as const, description: '', concept: 'price' };
    const caps = Object.fromEntries(urls.map((u, i) => [u, { ...cap(u), interceptedRequests: [{ url: `${u}/api`, method: 'GET', status: 200, isJson: true, parsedJson: { amount: [10, 20, 30][i] } }] }]));
    const r = await certify({ field: f, expected: Object.fromEntries(urls.map((u, i) => [u, String([10, 20, 30][i])])), captures: caps, candidates: [{ source: 'api', path: 'amount', transform: 'identity' }] }, { evalXPaths: async () => ({}) });
    expect(r.certified[0]).toMatchObject({ source: 'api', path: 'amount' });
  });
});
```

(If `certify.test.ts`'s capture type needs more fields — `title`, `markdown` … — reuse its own helper to build captures; the assertions are what matter.)

`run-verification.test.ts` — add: `fieldHash` of a set without `paths` equals the value computed before this change (store the literal from a first run of the test on `main`'s code, or compare against a copy of the field without `paths`); with `paths` for one url it changes; and the field's `paths` reach `certify` (spy on the deps or assert the certified result prefers a confirmed path in a small two-candidate fixture).

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @robot/scraper exec vitest run src/verify/field-fit.test.ts src/verify/certify.test.ts src/verify/run-verification.test.ts`.

- [ ] **Step 3: Implement** as the Rules above. `field-fit.ts`:

```ts
// Which structured paths may stand for a field whose values alone cannot tell
// paths apart (spec 2026-09-29 C2). One vocabulary for suggestions, the carry
// and certification.
import { normalize } from './normalize.js';
import type { CustomerFieldType } from './types.js';

export const CONCEPT_PATHS: Record<string, string[]> = {
  product_name: ['name', 'og:title', 'title', 'productName', 'product_name', 'headline'],
  price: ['offers.price', 'price', 'product:price:amount', 'currentPrice', 'current_price', 'salePrice', 'sale_price'],
  description: ['description', 'og:description', 'productDescription', 'product_description'],
  image_url: ['image', 'images', 'og:image', 'image.url', 'thumbnailUrl', 'primary_image_url'],
  brand: ['brand.name', 'brand', 'manufacturer', 'brand_name'],
  sku: ['sku', 'productID', 'mpn', 'gtin', 'gtin13', 'code', 'item_id', 'product_id'],
  availability: ['offers.availability', 'availability', 'inStock', 'in_stock', 'isAvailable', 'is_available', 'stock', 'stockStatus', 'stock_status', 'available', 'buyable', 'purchasable'],
  rating: ['aggregateRating.ratingValue', 'ratingValue', 'rating'],
  review_count: ['aggregateRating.reviewCount', 'reviewCount', 'review_count', 'ratingCount'],
  currency: ['offers.priceCurrency', 'priceCurrency', 'product:price:currency'],
};

export function pathFitsConcept(concept: string, path: string): boolean {
  const tails = CONCEPT_PATHS[concept];
  if (!tails) return false;
  const p = path.replace(/\[\d+\]/g, '').toLowerCase();
  return tails.some((t) => { const x = t.toLowerCase(); return p === x || p.endsWith(`.${x}`); });
}

export function isWeakField(type: CustomerFieldType, expectedValues: string[]): boolean {
  if (type === 'boolean') return true;
  if (expectedValues.length < 2) return false;
  const norms = new Set(expectedValues.map((v) => normalize(type, v)));
  return norms.size === 1 && !norms.has(null);
}
```

Note `suggest-marks.ts`'s own `tailMatches` stays case-sensitive (no behaviour change); only certification uses `pathFitsConcept`. Export `field-fit.ts` from `verify/index.ts` if that module re-exports its siblings.

- [ ] **Step 4: Run — expect PASS**, then `pnpm --filter @robot/scraper test -- --maxWorkers=2` and `pnpm --filter @robot/api test -- --maxWorkers=2` (the API consumes these types).
- [ ] **Step 5: Commit.**

```bash
git add packages/scraper/src/verify/field-fit.ts packages/scraper/src/verify/field-fit.test.ts packages/scraper/src/verify/types.ts packages/scraper/src/verify/certify.ts packages/scraper/src/verify/certify.test.ts packages/scraper/src/verify/run-verification.ts packages/scraper/src/verify/run-verification.test.ts packages/scraper/src/verify/suggest-marks.ts packages/scraper/src/verify/index.ts
git commit -m "feat(scraper): a yes/no or same-value field certifies only a path that fits it, confirmed paths first"
```

---

### Task 2: Scraper — images, URL objects, and the carry follows the fit rule

**Files:**
- Modify: `packages/scraper/src/verify/normalize.ts` (+ test), `certify.ts` (near misses), `transfer-marks.ts` (+ test)

**Interfaces — Produces:** `valuesEqual('image', a, b)` true when host+path match; `normalize('image' | 'url', { url | contentUrl | '@id' })` reads the object; near misses never contain `[object Object]`; `transferMarks` for a weak field (boolean type) only carries candidates that are the mark's XPaths or fit the concept.

- [ ] **Step 1: Failing tests.** `normalize.test.ts`:

```ts
describe('images and url objects', () => {
  it('treats image URLs differing only in the query as the same image', () => {
    expect(valuesEqual('image', 'https://www.ikea.com/a/b_s5.jpg?f=s', 'https://www.ikea.com/a/b_s5.jpg')).toBe(true);
    expect(valuesEqual('image', 'https://WWW.ikea.com/a/b.jpg#x', 'https://www.ikea.com/a/b.jpg?w=200')).toBe(true);
    expect(valuesEqual('image', 'https://x.example/img?id=1', 'https://x.example/img?id=2')).toBe(true); // accepted risk (Review Focus 4)
    expect(valuesEqual('image', 'https://x.example/a.jpg', 'https://x.example/b.jpg')).toBe(false);
  });
  it('keeps page URLs exact', () => {
    expect(valuesEqual('url', 'https://x.example/p?id=1', 'https://x.example/p?id=2')).toBe(false);
  });
  it('reads an ImageObject or a url object', () => {
    expect(normalize('image', { '@type': 'ImageObject', url: 'https://x.example/a.jpg' })).toBe('https://x.example/a.jpg');
    expect(normalize('image', { contentUrl: 'https://x.example/b.jpg' })).toBe('https://x.example/b.jpg');
    expect(normalize('url', { '@id': 'https://x.example/p/1' })).toBe('https://x.example/p/1');
    expect(normalize('image', { width: 10 })).toBeNull();
  });
});
```

`certify.test.ts`: a failing image field whose JSON-LD `image` is an `ImageObject` yields near misses that are URLs, never `'[object Object]'`.

`transfer-marks.test.ts`: a boolean field carried from a page whose API holds `{ priority: 1 }` and whose JSON-LD holds `offers.availability` → the carried `via` is `json-ld offers.availability`, not `api priority`.

- [ ] **Step 2: Run — expect FAIL** (`vitest run src/verify/normalize.test.ts src/verify/certify.test.ts src/verify/transfer-marks.test.ts`).
- [ ] **Step 3: Implement.**
  - `normalize.ts` `url(raw, ctx)`: when `raw` is a plain object, take `raw.url ?? raw.contentUrl ?? raw['@id']` (first string) and continue; otherwise as today.
  - `valuesEqual`: for `type === 'image'`, compare `imageKey(na) === imageKey(nb)` where `imageKey(u) = { const x = new URL(u); return x.hostname + x.pathname; }` (the normalised strings are already absolute and host-lower-cased). `normalize` itself is unchanged for images (stored values keep their query).
  - `certify.ts` near misses: map raw values through `displayRaw(raw)` = string/number/boolean → `String`; object → its url/contentUrl/@id if a string, else omitted; arrays → joined display of items.
  - `transfer-marks.ts`: after `gatherCandidates`, when `isWeakField(field.type, [from.expected])` (i.e. boolean) filter `ranked` with the same rule as certification (mark XPaths from `from.mark?.xpaths`, else `pathFitsConcept(field.concept, c.path)` for structured candidates). Export a small shared helper from `certify.ts` — `qualifiesForWeak(field, c, { confirmed, markXPaths })` — and use it in both places (no duplicated rule).
- [ ] **Step 4: PASS**, then the scraper gate.
- [ ] **Step 5: Commit.**

```bash
git add packages/scraper/src/verify/normalize.ts packages/scraper/src/verify/normalize.test.ts packages/scraper/src/verify/certify.ts packages/scraper/src/verify/certify.test.ts packages/scraper/src/verify/transfer-marks.ts packages/scraper/src/verify/transfer-marks.test.ts
git commit -m "fix(scraper): an image is the same image whatever its size parameter; url objects are read; the carry follows the fit rule"
```

---

### Task 3: API — the confirmed path is saved with the answer

**Files:**
- Modify: `packages/api/src/verify/binding-input.ts`
- Test: `packages/api/src/routers/sources-binding.test.ts`

**Interfaces — Produces:** `bindingInput.paths?: Record<fieldKey, Record<url, { source: 'api' | 'json-ld' | 'meta'; path: string (≤ 2000) }>>`; `prepareBinding` stores `verificationSet.paths` for non-blank cells whose url is in `urls`, omitted when empty; `bindingProblems` unchanged.

- [ ] **Step 1: Failing tests** (reuse the file's `createProjectWithSource` setup):

```ts
describe('updateBinding keeps the path each answer was accepted from', () => {
  it('stores paths for answered cells and drops them for blank ones', async () => {
    const f = await createProjectWithSource(caller, { tag: 'bind-paths', fields: [{ name: 'In stock', type: 'boolean' }] });
    try {
      const k = f.keys['In stock']!;
      const saved = await caller.sources.updateBinding({
        sourceId: f.sourceId, urls: f.urls, draft: true, descriptions: { [k]: 'stock' },
        expected: { [k]: { [f.urls[0]!]: 'https://schema.org/InStock', [f.urls[1]!]: '' } },
        paths: { [k]: { [f.urls[0]!]: { source: 'json-ld', path: 'offers.availability' }, [f.urls[1]!]: { source: 'json-ld', path: 'offers.availability' } } },
      });
      const set = saved!.verificationSet as { paths?: Record<string, Record<string, unknown>> };
      expect(set.paths).toEqual({ [k]: { [f.urls[0]!]: { source: 'json-ld', path: 'offers.availability' } } });
      const again = await caller.sources.updateBinding({ sourceId: f.sourceId, urls: f.urls, draft: true, descriptions: { [k]: 'stock' }, expected: { [k]: { [f.urls[0]!]: 'yes' } } });
      expect((again!.verificationSet as { paths?: unknown }).paths).toBeUndefined(); // a whole-record save without paths erases them
    } finally { await f.cleanup(); }
  });
});
```

- [ ] **Step 2: FAIL**, **Step 3: implement** (zod `confirmedPathInput = z.object({ source: z.enum(['api', 'json-ld', 'meta']), path: z.string().max(2000) })`; in `prepareBinding` build `paths` like `marks`, keeping a url only when `input.urls.includes(u)` and the cell is non-blank), **Step 4: PASS** + `pnpm --filter @robot/api test -- --maxWorkers=2`.
- [ ] **Step 5: Commit.**

```bash
git add packages/api/src/verify/binding-input.ts packages/api/src/routers/sources-binding.test.ts
git commit -m "feat(api): an answer keeps the path it was accepted from"
```

---

### Task 4: App model — answers carry their path; majority, one place, yes/no; badge names every product

**Files:**
- Modify: `packages/app/src/lib/site/verification-model.ts` (+ test), `packages/app/src/lib/site/verification-view.ts` (+ test)

**Interfaces — Produces:**

```ts
export type Field = { key: string; name: string; type: FieldType; description: string; concept?: string };
export type Answer = { value: string; mark: Mark | null; via?: Via };      // via only when accepted from a suggestion with a structured path
export type RowStatus =
  | { kind: 'accepted' } | { kind: 'agreed' } | { kind: 'same-everywhere' }
  | { kind: 'majority'; odd: number[] }                                     // A4: accept takes the majority, odd products left orange
  | { kind: 'needs-you'; reason: string; product?: number };
export type Badge = { kind: 'verified' } | { kind: 'fails'; products: number[] } | { kind: 'changed' } | { kind: 'checking' } | null;
export function failsText(products: number[]): string;                    // "fails on product 1" / "fails on products 1 and 3" / "fails on products 1, 2 and 3"
export function displayValue(field: Field, value: string): string;         // A6 yes/no words; other types unchanged
export function suggestionAnswer(boxes: Box[], field: Field, s: Suggestion, url: string): Answer; // A5 + C1: the answer a tick/accept stores
export function pickAnswer(boxes: Box[], boxIndex: number, field: Field, url: string, s?: Suggestion): Answer | { error: string }; // A3
export function acceptRow(board: Board, field: Field, live: Suggestions, boxesByUrl: Record<string, Box[] | undefined>, only?: Via): Board;
```

**Rules:**
- `structured(s)` = `s.via && ['api', 'json-ld', 'meta'].includes(s.via.source)`.
- **One place (A5):** `placesOf(boxes, s, field, url)` = `pointable(boxes, s.boxes)`; if `structured(s)` and every pointable box's `valueFromBox(box, field.type)` value `valuesEqual`s `s.value`, it counts as **1** (`rowStatus` no longer says "found in n places" for it).
- `suggestionAnswer`: if exactly one pointable box → `answerFromSuggestion(box, …)`; else `{ value: s.value, mark: null }`; in both cases add `via: s.via` when `structured(s)`.
- `pickAnswer`: if `s` exists, `structured(s)`, `pointable(boxes, s.boxes).includes(boxIndex)` and `validateValue(field.type, s.value) === null` → `suggestionAnswer`-style answer with the clicked box as mark (via `answerFromSuggestion`) plus `via`; otherwise `valueFromBox(boxes[boxIndex], field.type)` as today (no `via`).
- **Majority (A4):** in `rowStatus`, after collecting `offered`: when not all share one via, group offered by `source path`; if the largest group has ≥ 2 members and every member has a via → `{ kind: 'majority', odd: <products not in that group> }`; else as today ("comes from different places"). The lone-page-data rule and `same-everywhere` apply before/after exactly as today, the latter to the majority's values.
- **Yes/no (A6):** `same-everywhere` never returned for `field.type === 'boolean'` (return `agreed`).
- `acceptRow(…, only?)`: when `only` is given, accept only cells whose suggestion's via equals it; answers built with `suggestionAnswer`. `acceptAllAgreed` accepts `agreed` rows fully and `majority` rows with `only` = the majority via.
- `boardFrom` reads `set.paths?.[key]?.[url]` into `Answer.via`; `toBindingInput` emits `paths` (omitted when empty) from answers that have `via`.
- `badge` returns `{ kind: 'fails', products: [...] }` listing every card whose cell fails; `failsText` formats it.
- `displayValue(field, value)`: boolean → `normalize('boolean', value)` (from `@robot/scraper/normalize`) `'true'` → "In stock" when `field.concept === 'availability'` else "Yes"; `'false'` → "Out of stock" / "No"; unparseable → value; other types → value.
- `verification-view.ts` `hintFor('no_fitting_path', …)` → "We can't tell which value on this page is this field. Mark it on the screenshot." (add the reason to its `FailReason` union).

- [ ] **Step 1: Failing tests** in `verification-model.test.ts` (reuse `U`, `board()`, `box`, `mergeSuggestions`, `liveSuggestions` helpers and the `sug(value, boxes, via)` helper from the table-first tests):

```ts
const JL = { source: 'json-ld', path: 'offers.availability' };
const JL3 = { source: 'json-ld', path: 'offers.offers[0].availability' };
const stock: Field = { key: 'in_stock', name: 'In stock', type: 'boolean', description: '', concept: 'availability' };
const sku: Field = { key: 'sku', name: 'SKU', type: 'text', description: '', concept: 'sku' };

describe('the table-first rules, revised', () => {
  it('names the odd product and accepts only the majority', () => {
    const b = board();
    const live = liveFor(b, 'in_stock', [sug('https://schema.org/InStock', [0], JL), sug('https://schema.org/InStock', [0], JL), sug('https://schema.org/InStock', [0], JL3)]);
    expect(rowStatus(stock, b, live, maps())).toEqual({ kind: 'majority', odd: [3] });
    const next = acceptRow(b, stock, live, maps(), JL);
    expect(next.answers.in_stock![U[0]!]).toMatchObject({ value: 'https://schema.org/InStock', via: JL });
    expect(next.answers.in_stock![U[2]!]).toBeUndefined();
  });
  it('yes/no fields are never "same on every product"', () => {
    const b = board();
    const live = liveFor(b, 'in_stock', [sug('https://schema.org/InStock', [0], JL), sug('https://schema.org/InStock', [0], JL), sug('https://schema.org/InStock', [0], JL)]);
    expect(rowStatus(stock, b, live, maps()).kind).toBe('agreed');
  });
  it('a structured value shown in several places counts as one place, accepted without a mark', () => {
    const m = { ...maps(), [U[0]!]: boxesOf(['A1', 'A1']), [U[1]!]: boxesOf(['B2', 'B2', 'B2']), [U[2]!]: boxesOf(['C3']) };
    const b = board();
    const SK = { source: 'json-ld', path: 'sku' };
    const live = liveFor(b, 'sku', [sug('A1', [0, 1], SK), sug('B2', [0, 1, 2], SK), sug('C3', [0], SK)]);
    expect(rowStatus(sku, b, live, m).kind).toBe('agreed');
    expect(acceptRow(b, sku, live, m).answers.sku![U[0]!]).toEqual({ value: 'A1', mark: null, via: SK });
  });
  it('several places from the page search still need a person', () => {
    const m = { ...maps(), [U[0]!]: boxesOf(['A1', 'A1']) };
    const live = liveFor(board(), 'sku', [sug('A1', [0, 1], { source: 'xpath', path: '//x' }), sug('B2', [0], { source: 'xpath', path: '//x' }), sug('C3', [0], { source: 'xpath', path: '//x' })]);
    expect(rowStatus(sku, board(), live, m)).toMatchObject({ kind: 'needs-you', reason: 'found in 2 places on product 1' });
  });
  it('an answer keeps its path through a save and a reload', () => {
    const b = answer(board(), 'in_stock', U[0]!, { value: 'https://schema.org/InStock', mark: null, via: JL });
    const input = toBindingInput(b, [stock]);
    expect(input.paths).toEqual({ in_stock: { [U[0]!]: JL } });
    const back = boardFrom({ schemaDefinition: [stock], verificationSet: { urls: input.urls, expected: input.expected, paths: input.paths } });
    expect(back.answers.in_stock![U[0]!]!.via).toEqual(JL);
  });
  it('clicking the outlined element accepts its suggestion; any other element reads its own text', () => {
    const bx = boxesOf(['Available', 'Something']);
    const s = { captureId: 'c', value: 'https://schema.org/InStock', boxes: [0], origin: 'page-data' as const, via: JL };
    expect(pickAnswer(bx, 0, stock, U[0]!, s)).toMatchObject({ value: 'https://schema.org/InStock', via: JL });
    expect(pickAnswer(bx, 1, sku, U[0]!, undefined)).toMatchObject({ value: 'Something', mark: expect.anything() });
    const bad = { ...s, value: 'not a yes/no' };
    expect(pickAnswer(bx, 0, stock, U[0]!, bad)).toMatchObject({ value: 'Available' });
  });
  it('the badge names every failing product', () => {
    expect(failsText([1])).toBe('fails on product 1');
    expect(failsText([1, 3])).toBe('fails on products 1 and 3');
    expect(failsText([1, 2, 3])).toBe('fails on products 1, 2 and 3');
  });
  it('shows yes/no answers in one form', () => {
    expect(displayValue(stock, 'https://schema.org/InStock')).toBe('In stock');
    expect(displayValue(stock, 'Available')).toBe('In stock');
    expect(displayValue(stock, 'out of stock')).toBe('Out of stock');
    expect(displayValue({ ...stock, concept: 'remote' }, 'yes')).toBe('Yes');
    expect(displayValue(sku, 'A1')).toBe('A1');
  });
});
```

Update the existing `badge` tests to the `products` shape, and add a carry test for A1 in Task 5's scope only if the rule lives in the model (it does: see Task 5 note).

- [ ] **Step 2: FAIL**, **Step 3: implement** the Rules, **Step 4: PASS** + `pnpm --filter @robot/app exec tsc --noEmit` (fix callers of `badge`/`Badge.product` minimally: `BadgeView` uses `failsText(badge.products)`), `pnpm --filter @robot/app test -- --maxWorkers=2`.
- [ ] **Step 5: Commit.**

```bash
git add packages/app/src/lib/site/verification-model.ts packages/app/src/lib/site/verification-model.test.ts packages/app/src/lib/site/verification-view.ts packages/app/src/lib/site/verification-view.test.ts packages/app/src/components/verification/field-details.tsx
git commit -m "feat(app): answers keep the path they came from; the odd product is named; one structured value is one place; yes/no reads as yes/no"
```

---

### Task 5: App — the tab uses the new rules; a carry never replaces page data; one-click cell accept

**Files:**
- Modify: `packages/app/src/lib/site/verification-model.ts` (+ test) — A1 in `mergeSuggestions`
- Modify: `packages/app/src/components/verification/verification-table.tsx`, the route `index.tsx`

**Changes:**
1. **A1** — `mergeSuggestions(prev, incoming, url, captureId, origin, board)`: when `origin === 'from-product'` and `prev[key]?.[url]?.origin === 'page-data'`, skip. Test first:

```ts
it('a carried suggestion never replaces a page-data one', () => {
  const b = board();
  let s = mergeSuggestions({}, { in_stock: { value: 'https://schema.org/InStock', boxes: [0], via: JL } }, U[1]!, 'c1', 'page-data', b);
  s = mergeSuggestions(s, { in_stock: { value: '1', boxes: [0], via: { source: 'api', path: 'priority' } } }, U[1]!, 'c1', 'from-product', b);
  expect(s.in_stock![U[1]!]!.value).toBe('https://schema.org/InStock');
  s = mergeSuggestions(s, { in_stock: { value: 'x', boxes: [0], via: JL } }, U[2]!, 'c2', 'from-product', b);
  expect(s.in_stock![U[2]!]!.origin).toBe('from-product');
});
```

2. **Route** — every place an answer is built from a suggestion uses `suggestionAnswer` (tick in suggestion mode, the row hint's "page data" accept, Accept, Accept all); a pick uses `pickAnswer(boxes, pop.box, field, pop.url, live[key]?.[pop.url])` (A3); cells render `displayValue(field, value)`; `majority` rows show "different place on product {odd…} — check it" with **Accept** calling `acceptRow(…, majorityVia)`; the Verify reason logic treats `majority` like `agreed` for "Accept all agreed first".
3. **A7** — in `verification-table.tsx`, a suggested cell whose suggestion is one place shows a small ✓ button on hover and focus (`aria-label="Accept {field} on product {n}"`, visible text-less icon with `title`), calling a new `TableCell.onAccept?()`; the route supplies it only for one-place suggestions and builds the answer with `suggestionAnswer`.
4. The `no_fitting_path` hint reaches the row's details through `verification-view.ts` (Task 4).

- [ ] **Step 1: A1 test → FAIL → implement → PASS.**
- [ ] **Step 2: Route and table changes.**
- [ ] **Step 3: Verify** — `pnpm --filter @robot/app exec tsc --noEmit`; `pnpm --filter @robot/app test -- --maxWorkers=2`; with `pnpm dev:all` up, `pnpm test:ui:app` (never clicks Verify; update its selectors if a label changed; restore `docs/testing/screens/*.png` you did not mean to change).
- [ ] **Step 4: Commit.**

```bash
git add packages/app/src/lib/site/verification-model.ts packages/app/src/lib/site/verification-model.test.ts packages/app/src/components/verification/verification-table.tsx "packages/app/src/routes/_app/projects/\$project/sites/\$site/index.tsx" packages/app/src/routes-smoke.test.ts
git commit -m "feat(app): the tab keeps page data over a carry, accepts one cell in one click, and names the odd product"
```

---

### Task 6: Audit, the free live run on Ikea, and the docs

**Files:**
- Create: `packages/api/src/scripts/audit-certified-paths-core.ts` (+ `.test.ts`), `packages/api/src/scripts/audit-certified-paths.ts`
- Create: `docs/testing/2026-09-2x-certification-live.md` (actual date); Modify: `docs/handoff.md`, `docs/testing/ui-check-app-verification.mts`

**Audit** — pure core:

```ts
// For each certified field on a website: would its certified paths still qualify under spec 2026-09-29 C2?
export type AuditRow = { website: string; field: string; paths: string[]; ok: boolean; why?: string };
export function auditField(args: {
  website: string;
  field: { key: string; name: string; type: CustomerFieldType; concept: string };
  set: VerificationSet;
  certified: Array<{ source: string; path: string }>;
}): AuditRow;
```

`ok` = the field is not weak (`isWeakField(type, checked expected values)`), or every certified path qualifies (confirmed via `set.paths`, a mark XPath, or `pathFitsConcept`). `why` = "yes/no field certified on paths that do not name it" etc. Test: Ikea-like fixture (`priority` → not ok; `offers.availability` → ok; a money field → ok). The CLI loads every source with a verification set and its latest completed verification (read-only Drizzle queries only — `select`, never `update`/`insert`/`delete`), prints a table, and exits. Run it once and paste the output into the live note. `package.json` script not needed; run with `pnpm --filter @robot/api exec tsx src/scripts/audit-certified-paths.ts`.

**Live** (`docs/testing/ui-check-app-verification.mts`, keyless :4100 + an app on :3100 pointed at it, throwaway `check-*`, the same Ikea Cabinets products; assert "· free" before Verify): record clicks to an enabled Verify (expected ≈ 7), rows before any click, which path In stock certified (expected `json-ld offers.availability` or an API path that fits), Main image verified on all three, the verified count. Stop both extra servers by port.

**Docs:** a handoff section "Certification picks the right path (2026-09-2x)" in the house style — what landed per commit, rulings, the live numbers, the audit output, open items — and its "Read this first" line.

- [ ] **Step 1: Audit core test → FAIL → implement → PASS**; run the CLI read-only; save its output.
- [ ] **Step 2: Live run**; numbers into the live note.
- [ ] **Step 3: Full gate** — db, browser, agent, scraper, api, dashboard, api-server, app, each `pnpm --filter @robot/<pkg> test -- --maxWorkers=2`.
- [ ] **Step 4: Docs.**
- [ ] **Step 5: Commit** by explicit paths.

```bash
git commit -m "test: certification's live run on Ikea and the certified-path audit; recorded"
```
