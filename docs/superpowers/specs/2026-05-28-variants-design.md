# Variants — Design Spec

**Date:** 2026-05-28
**Status:** Approved — ready for implementation planning
**Related:** [`docs/superpowers/specs/2026-05-22-testing-strategy-design.md`](2026-05-22-testing-strategy-design.md), [`docs/superpowers/specs/2026-05-13-dashboard-architecture-redesign-design.md`](2026-05-13-dashboard-architecture-redesign-design.md)

## Motivation

The current schema model is flat — a row of scalar fields per product. That misses the part of a product page customers actually care about: **what colors does this come in, what sizes, what pack quantities, what's each variant's SKU/price/image**. Real product data is a parent + N variants.

After P2 of the testing strategy landed, the dogfood report exposed two symptoms of this gap:
1. Tier 1 fixtures (Nike, IKEA Kallax) can only assert headline scalars — the JSON-LD `hasVariant[]` data sitting in the captured fixture is unused.
2. There is no schema mechanism for a customer to *ask for* variants, even when the page clearly publishes them.

This spec adds variants as a first-class field type and extends the existing extraction chain (mechanical → cache → AI → cache-save) to handle them.

## Pinned decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Output shape | Nested array on the parent product (`{ ..., variants: [...] }`) |
| Variant sub-schema | Required core (`sku`, `price`, `image_url`) + open discovered axes (color, size, quantity, capacity, finish, …) |
| Discovery trigger | Auto-propose `variants` when ProductGroup or DOM variant signals detected; customer can toggle/force-request |
| Extraction sources (v1) | JSON-LD `ProductGroup.hasVariant[]` → cached path replay → AI fallback → cache the AI's path |
| Judge strategy | One verdict per `variants` array (cost-efficient, coarse) |
| Scope | Approach B — Mechanical + AI fallback (excludes nextData walker, intercepted-API walker, dashboard rendering) |

## Design

### 1. Data model + schema discovery

**`FieldType`** (in `packages/agent/src/types.ts`): add `'variant_array'` to the existing union.

**Variant value shape:**
```typescript
export type Variant = {
  sku?: string | null;
  price?: number | null;
  image_url?: string | null;
  [axis: string]: unknown;   // discovered axes: color, size, quantity, capacity, …
};
```

The required-core fields are *expected* but may be `null` when a page doesn't expose them. Axes are whatever the source publishes. Siblings of the same product are assumed to share the same axis-set, even though values differ — non-uniform variant shapes within one product are out of scope for v1.

**Shape validation** (extend `packages/scraper/src/shape-validator.ts`). The `variant_array` validator rejects:
- non-array values
- items that aren't plain objects
- arrays where *every* item has `sku`/`price`/`image_url` all-null (signals confusion with a recommendations carousel or related-products list — fail loud, don't pollute cache)

URL trimming and price normalization reuse the existing per-axis validators.

**Schema discovery** (`SchemaAgent.discoverSchema` in `packages/agent/src/schema-agent.ts`): propose a `variants` field of type `variant_array` when *either* signal is present in the capture:
- `capture.structuredData.ldJson` contains an object with `@type === 'ProductGroup'` and non-empty `hasVariant[]`, **or**
- AI vision detects a variant picker / color swatch grid / size dropdown in the above-fold screenshot (extend the existing discovery prompt — no new agent call)

The wizard renders `variants` as a normal toggle-able discovered field. Customer can also force-request it by adding `variants` to `requestedFields`.

**Extracted output example** (Nike Air Jordan):
```json
{
  "product_name": "Jordan 12 Retro Baby/Toddler Shoes",
  "brand": "Nike",
  "price": 80,
  "variants": [
    { "sku": "850000-003", "price": 80, "image_url": "https://...", "color": "Black/Varsity Red" },
    { "sku": "850000-170", "price": 80, "image_url": "https://...", "color": "Taxi" }
  ]
}
```

### 2. Extraction chain + caching

**Source 1 — JSON-LD walker** (extend `packages/scraper/src/structured-extractor.ts`). When `extractFromStructuredData` sees a field of type `variant_array`:

1. Scan `capture.structuredData.ldJson` for `@type === 'ProductGroup'` with non-empty `hasVariant[]`.
2. For each variant `Product` in `hasVariant[]`, build a `Variant` object:
   - `sku` ← `mpn || sku || productID` (first non-empty)
   - `price` ← `offers.price` (number; coerce string-numbers)
   - `image_url` ← `image` (first element if array)
   - Pass through `color`, `size`, `material`, `pattern` (any Schema.org axis property present) directly as discovered axes
3. Return `{ value: variants, source: 'json-ld', path: 'ldJson[ProductGroup].hasVariant' }`. (The `path` string is opaque — it's a cache key, not a JSONPath query. The walker is plain JS.)

**Source 2 — Cached path replay** (extend `packages/scraper/src/domain-cache.ts`). `FieldPathSet` for a `variant_array` field stores ranked paths the same way as scalar fields. Two new path source-types:

- `{ source: 'json-ld', path: 'ldJson[ProductGroup].hasVariant', confidence: 0.95 }` — replay walks the captured JSON-LD again (cheap; deterministic).
- `{ source: 'ai-discovered-variants', path: '<opaque hint string>', confidence: 0.6 }` — the AI fallback's output stored as a hint. Replay re-walks the captured structured data **or** the DOM under that hint (the hint identifies *where* on the page the AI found the variants, so a future deterministic walker can reproduce the result).

`buildCachedXPathScript` is not used for `variant_array` — variants come from structured data, not DOM queries, so the cached replay is in JS, not in-page eval.

**Source 3 — AI fallback** (new method `SchemaAgent.extractVariants` in `packages/agent/src/schema-agent.ts`). Triggered when `variants` is in the requested schema AND no JSON-LD `ProductGroup` was found AND no cached variant path resolved.

Signature:
```typescript
extractVariants(capture: PageCapture, screenshot: Buffer): Promise<{
  variants: Variant[];
  path_hint: string;
}>;
```

Prompt (concrete text in `packages/agent/src/prompts.ts`):
> You are extracting product variants from a page. Below is a screenshot and the page's `__NEXT_DATA__` blob (truncated to 50KB if longer). Find the variant picker — color swatches, size dropdown, capacity selector, pack-size buttons. Return JSON `{variants: [{sku, price, image_url, color?, size?, ...}], path_hint: "<short string describing where you found it, e.g. 'color swatch buttons in DOM' or 'nextData.props.product.variants'>"}`. If you can't see a variant picker, return `{variants: [], path_hint: ""}`. No explanation.

On success, persist `{ source: 'ai-discovered-variants', path: result.path_hint, confidence: 0.6 }` to `domainIntelligence.fieldPaths['variants']` so the next run on the same domain replays from cache and skips the AI call.

**Chain order for `variants`** (matches the existing chain pattern):
1. JSON-LD ProductGroup walker (Source 1)
2. Cached path replay (Source 2)
3. Cross-validation: no-op for variant arrays — keep the first non-empty source rather than try to merge
4. AI fallback (Source 3) — only if all above produced an empty array AND `variants` is in the requested schema
5. Cache the AI's `path_hint`

### 3. Testing — Tier 1 (fixture replay)

`packages/scraper/src/__fixtures__/corpus.test.ts` learns to assert variant arrays.

**Helper:** `expectVariantsMatch(actual: unknown, expected: Variant[])` in `corpus.test.ts`:
- Asserts `actual` is an array of the same length as `expected`.
- For each `expected` variant, find a matching `actual` variant by key:
  - if `expected.sku` is non-null → match on `sku`
  - else → match on the first non-null discovered axis value (color, size, …)
- For each match, assert `price`, `image_url`, and any other axis values from `expected` are equal (modulo URL whitespace trim).
- Order is **not** asserted (JSON-LD `hasVariant[]` ordering can flip between captures).

**Fixture updates:**
- `nike-air-jordan-detail.json` — re-fill `expected.variants` from the ProductGroup `hasVariant[]` already in the captured JSON-LD. Two entries: `{sku: "850000-003", color: "Black/Varsity Red", price: 80}` and `{sku: "850000-170", color: "Taxi", price: 80}` (plus image_urls). No re-capture needed.
- `ikea-kallax-detail.json` — IKEA has no JSON-LD `ProductGroup`, so this fixture exercises the AI fallback. Re-run capture + replay through the AI once to populate the cache + write the result into `expected.variants`.
  - **Risk:** if the AI fallback returns inconsistent variants on IKEA (e.g. it sees only the currently-selected color rather than the full picker, or hallucinates a variant set), ship Nike-only assertions in v1 and add a TODO comment in the fixture stub for IKEA variants. Don't quietly drop it; the spec must be explicit about partial coverage.

### 4. Testing — Tier 2 (dogfood judge)

`packages/api/src/dogfood.ts` detects the new field type and routes to a variant-aware judge.

**New file** `packages/agent/src/judge-variants.ts` exporting:
```typescript
export async function judgeVariantArray(opts: {
  screenshot: Buffer;
  variants: Variant[];
  apiKey: string;
  model?: string;
}): Promise<JudgeVerdict>;
```

Reuses the existing `JudgeVerdict` type (`correct | wrong | not-on-page | error`) — the verdict envelope and report row format stay identical, so the P2.3 tally counters (`totalWrong`, `totalNotOnPage`, `totalError`, `totalAbsent`) work without changes.

**Prompt:**
> You see a webpage screenshot and an extracted JSON array of product variants. Each item should correspond to a selectable variant on the page (different color, size, capacity, etc.). Reply with EXACTLY one word: "correct" (count and content roughly match the page's variant picker), "wrong" (variants visible on the page differ materially from the extracted list), or "not-on-page" (this page does not show variants). No explanation.

**Report row format:**
```
- [correct] variants: 2 variants: [Black/Varsity Red @80, Taxi @80] (src=json-ld)
- [wrong]   variants: 4 variants: [white, black-brown, oak, ...] (src=ai-discovered-variants)
```

The condensed value rendering (first axis + price per variant, ellipsis past 3) keeps report lines readable without losing the judgable content.

### 5. v1 done definition

Concrete gate for "merge and move on":
- `pnpm -r test` is green workspace-wide; Nike's `expected.variants` is asserted.
- `pnpm --filter @robot/api dogfood` produces a report where IKEA Kallax shows a non-empty `variants` extraction with a non-`error` judge verdict (`correct`, `wrong`, or `not-on-page` are all OK as gates — we just need the AI-fallback path exercised end-to-end and a real verdict from the judge, not the synthetic `error` that means "judge wasn't called"). In practice IKEA Kallax does show color variants, so `not-on-page` would be a separate problem to investigate, but it doesn't block v1 merge.
- The new `variant_array` type is consumed by every relevant unit: `discoverSchema`, `extractFromStructuredData`, `shape-validator`, `domain-cache` (FieldPathSet ranking), the replay helper, and the judge. No half-wired paths.

### 6. Out of scope (explicit deferrals)

- **nextData walker for variants** — sites that publish variants only in `__NEXT_DATA__` (some non-Schema.org Next.js stores). Cache structure leaves a slot; v2.
- **Intercepted-API variant arrays** — sites whose product API JSON contains a `variations` block (Amazon, some Shopify). v2.
- **Dashboard rendering** of variant arrays (chips/swatches) — blocked by the v1.5 UI freeze. The current result viewer will show the raw nested JSON, which is acceptable for internal use.
- **Variant-level pricing tiers / bundle options / gift wrap** — semantic axes beyond "different SKU at different price/image". Punt until a customer asks.
- **Cross-product variant comparison** ("all Jordan 12 colorways across all sellers") — a different feature.
- **Cache-poisoning fix for the `product_name: "otFlat"` family** — the bad cached api_path that pulls from a cookie consent JSON. A separate one-evening task tracked in the testing-strategy roadmap; not bundled here.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| AI fallback returns inconsistent variants on IKEA between runs | Medium | Cache the first successful result; deterministic replay; explicit Tier 1 partial-coverage carve-out |
| `variant_array` shape leaks through the API surface and breaks the dashboard JSON viewer | Low | Dashboard already renders unknown values as JSON — the change is additive |
| AI cost escalation if many sites hit the fallback path | Low (current corpus is small) | Cache the `path_hint` after first success; AI runs at most once per (domain, page-shape) pair |
| Schema discovery starts proposing `variants` on pages that aren't products (e.g., a category listing with sub-products) | Medium | Discovery only proposes when `ProductGroup` JSON-LD OR a variant-picker DOM signal is present — both are strong signals; if false positives surface, tighten the prompt |
| IKEA cache poisoning (`otFlat` etc.) infects variant extraction the same way it infected `product_name` | Medium | Shape validator rejects all-null-core variants; AI fallback's `path_hint` is opaque so a corrupted path produces an empty replay, not garbage |

## Implementation footprint estimate

~4-5 days end-to-end, roughly:
- Day 1: `FieldType` extension, `Variant` type, `shape-validator` update, JSON-LD walker in `structured-extractor.ts`
- Day 2: AI fallback prompt + `SchemaAgent.extractVariants` + integration into the chain
- Day 3: Cache plumbing for variant paths, Tier 1 assertion helper in `corpus.test.ts`
- Day 4: Nike fixture variants populated and gated; IKEA fixture AI-fallback shakeout
- Day 5: Dogfood judge integration (`judge-variants.ts`), report row rendering, end-to-end dogfood run

Buffer for fixture iteration if the AI fallback is flaky on IKEA.
