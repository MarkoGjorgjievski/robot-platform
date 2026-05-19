# Ideas Backlog

Exploratory items that aren't release-staged yet. When an idea is concrete enough to ship, it moves to `docs/roadmap.md` under the right version. When it earns a spec, it moves to `docs/superpowers/specs/`.

**Status legend:**
- 🔬 **Investigated** — we've poked at it, here's what we learned
- 💡 **Sketched** — direction proposed, not yet validated
- 🎯 **Promising** — worth a small spike before committing

---

## Field discovery

How we identify which extracted values map to which schema fields. Today's chain: exact name → alias list → suffix match in flattened API JSON → AI fallback. Real customer schemas have names that don't match the source data, so this chain misses easy wins.

### 🔬 Description-based field matching (previously attempted, deliberately disabled)

**Current state.** `findFieldValue` in `packages/scraper/src/structured-extractor.ts` accepts a `_description` parameter (line 123, underscore prefix indicates unused). The comment at line 160 says: *"No fuzzy matching — it causes too many false positives on complex APIs."* So the feature was implemented, tested, and disabled. The test in `structured-extractor-aliases.test.ts` still expects the feature to work and currently fails — vestigial.

**The example that motivated it.** Customer schema field `shipping_weight` with description `"the package weight of the product"`. API returns a key `package_weight`. Exact-name match misses, alias list doesn't help, suffix match misses. Description tokenization ("package weight") would catch it.

**Why the first attempt failed.** Tokenizing the description and matching tokens against keys produces false positives in big API blobs — words like "name", "type", "status", "id" appear all over. The matcher would attach to whatever shallow key happened to contain a token.

**What "doing it right" probably looks like.**
- Tokenize the description, drop stop words and high-frequency English words (the, of, a, ...)
- Weight tokens by inverse document frequency *across the current API payload* — a token that appears in 50 keys is worth less than a token that appears in 2
- Require a multi-token match (e.g., ≥2 of the high-IDF tokens) rather than any single hit
- Penalize matches deep in the JSON tree (same heuristic as the existing suffix matcher)
- Threshold a confidence score — if no candidate clears it, return null and let AI fallback handle it
- Better still: do this as a *re-ranking* over candidates that already passed name/alias matching, not as a primary signal

**Adjacent idea:** use an embedding model to score description-token-vs-key-name similarity. Slower and pricier than tokenization, but probably more robust. Could run as a *second-stage* matcher only when the cheap path returns null — same cost-tier discipline as the rest of the extraction chain.

**Action items if we revisit:**
- Decide whether to fix the abandoned implementation or delete the disabled parameter + test entirely (right now the test is misleading — it's testing a feature that's been turned off).
- Pick a corpus of real failures (cases where AI fallback had to fire because name/alias matching missed) and use that as the evaluation set.

### 💡 Sibling-context field discovery

Many fields are identifiable by the values *around* them, not by their key names. A number prefixed with `$` is probably a price. A 5-digit number near "ZIP" or "postal" is a zip code. A date-shaped string near "expires" is an expiry date.

Today's structured extractor matches purely by key name. The DOM/XPath path eventually picks this up via AI, but at structured-data-extraction time we ignore the surrounding context.

Direction:
- After flattening an API blob, when a key has a primitive value, look at sibling primitives in the same object — do they include unit symbols, format markers, or known field tokens?
- For DOM extraction: look at the element's previous sibling text, label `<for>` attribute, parent's text content.
- Cheap heuristic; could meaningfully cut the AI-fallback hit rate.

### 💡 Type-shape inference

If the customer asks for `price` (type: number) and the API returns a string `"$24.99"`, the existing transform layer cleans it. But what if the customer asks for `weight` (number) and the API returns `"2.5 lbs"`? Right now we need an explicit transform. Direction: at match time, score candidates by whether their value's *shape* parses as the requested type after a standard set of cleanups (strip units, parse decimals). A field that parses cleanly is a stronger candidate than one that doesn't.

### 💡 Customer-corrected examples as training signal

When a user click-to-selects a value to override AI's choice, today we save the path. Adjacent idea: also save the *pair* (field name + correct value example). Over time, build a corpus of (schema field → real-world value example) for each customer. Use it to:
- Recognize when a fresh API blob contains a value that *matches a customer's known example* even when the key name is different
- Detect when a field's value space has shifted (a price field suddenly emits non-numbers — site change)
- Seed AI prompts with a few-shot example pulled from this corpus

### 💡 Image-grounded field discovery

We already send screenshots to Claude for schema validation. What we don't do: cross-reference the *extracted* values against the screenshot. A "price" field that the structured extractor says is `$24.99` should be visible on screen at that value. If it's not — that's a strong signal the path is wrong and we should fall through to AI.

Doable cheaply with a vision pass that asks Claude to confirm "does the screenshot show price=$24.99?" — yes/no. Skip when the source is API-only (no screenshot) or when confidence is already high.

### 🔬 Analyze sees values that Extract can't capture (the example-vs-extract gap)

**Observation from v1.1a dogfood, 2026-05-19, Amazon Godiva product.** The `analyze` step's AI proposed 16 fields and produced *example values* for all 16 — the correct prices, dimensions, weights, descriptions, etc. Those examples come from the AI reading the screenshot + markdown + structured data during schema discovery. They're effectively ground truth.

The `extract` step then resolved only 4/16. The other 12 fields (`price`, `image_url`, `asin`, `availability`, `size_options`, `product_description`, `ingredients`, `diet_type`, `weight`, `dimensions`, `upc`, `best_sellers_rank`) fell to AI XPath generation, which produced selectors that didn't match. Amazon has no `__NEXT_DATA__` and sparse JSON-LD, so Tasks 4-5 of v1.1a couldn't help.

**The architectural mismatch.** The analyze AI *sees* data through a multi-modal lens (screenshot + DOM markdown + structured data) and quotes confident examples. The extract AI then has to generate a *programmatic* XPath that captures the same values from raw DOM. These are different cognitive tasks; the second one is harder, and our XPath generation step doesn't have access to the first task's hints.

**Direction.**
- **Pass the analyze-step example values into the XPath generation prompt** as targets. "Find an XPath that selects this exact text: `12.3 Ounce`." Reverses the burden — instead of asking AI to invent a generic selector for the `weight` field, ask it to invent a selector that returns a specific known value.
- This is essentially the same primitive as click-to-select (v2.1), but the "click target" is the AI's own example value rather than a user click. Reverse-search style.
- Combine with image-grounded validation: extract returns `weight=12.3 Ounce`, vision pass confirms screenshot shows `12.3 Ounce` in the dimensions section.

**Symptom this would fix.** Today's resolution gap on hard-to-XPath pages (Amazon detail pages, complex product specs, retailer review sections). Pages where the value is visible but the structural path to it is non-obvious.

**Action items if we revisit.**
- Add `exampleValue?: string` to the `SchemaField` payload (probably already present as `example_value` in `selectorsJson`).
- Pass `field.example_value` through to `agent.generateSelectors` as a "find an XPath that yields this value" hint.
- Measure: rerun the Amazon Godiva test case before/after; expect resolution rate to climb from 4/16 toward the analyze-time field count.

### 🔬 Cache trusts itself even when paths return wrong values

**The bug.** Domain intelligence cache prunes paths only when they return `null` repeatedly (the `>10 uses, <10% hit rate` rule in the cache scoring). It does not prune paths that return *non-null but incorrect* values. If a cached XPath/JSON path was built from URL A and is now being applied to URL B (different layout, different product type on the same domain), it may still match a DOM node or JSON key — just the *wrong* one. The path is happily logged as a "hit" and the cache keeps reusing it.

**The user-visible symptom.** Surfaced during Phase 4 dogfooding: a cached `www.ikea.com / detail` row built from URL A (a pillow product) was applied to URL B (a different IKEA product). `product_name` and `description` came back as values from the wrong page section but were non-null, so cross-validation didn't flag them and the cache kept its confidence intact.

**Why cross-validation isn't catching it.** Today's cross-validation (in `resolveFromCache`) compares values returned by different *paths* for the same field. If only one path is cached for a given field, there's nothing to compare it against. If multiple paths exist and they all extract the same wrong value (e.g., all DOM paths pointing into the same wrong section), the majority wins — but it's wrong-majority.

**What "doing it right" might look like.**
- **Schema-stable shape check.** A `price` field that historically returned numeric values now starts returning long strings → flag the path as suspect. The structured extractor has plausibility checks (numeric range etc.); apply them to cache hits as well, not just AI-discovered values.
- **Domain-intel page-fingerprint.** Before applying cached paths to a fresh page, compare a structural fingerprint (e.g., presence of certain JSON-LD types, top-level API endpoint shape, key meta tags) against what was true when the cache was built. Mismatch → skip the cache, run AI fresh.
- **Periodic re-validation against AI.** For domains with many cached runs, occasionally run the full AI chain anyway and compare its result to what the cache produced. Disagreements demote path confidence.
- **Image-grounded validation as a check on cached values** (cross-references with the "Image-grounded field discovery" idea above). If the screenshot doesn't show `$24.99` but the cache says `price=$24.99`, the cache is wrong.

**Adjacent.** Right now the cache's `example_value` (used by `sandbox.analyze` to populate the "Example" column in the schema editor) is the *last* extracted value, regardless of whether it was correct. So a stale-cache symptom often appears at analyze-time as "the example column shows values from a different page." Could clarify the UI ("Last seen example, may not match this URL") OR run a quick fresh extraction on analyze to populate example_value from the current page.

**Action items if we revisit.**
- Add a plausibility-check pass on cache hits, not just AI-discovered values.
- Decide whether to weaken cache trust by default (e.g., always run a 1-field AI sanity check) vs. keep the cheap path and add explicit re-validation triggers.
- Build a corpus of (URL, cached_value, actual_value) tuples from real failures to measure how often this happens.

---

## Extraction completeness

The pipeline currently treats `analyze` (schema proposal) and `extract` (resolved values) as independent outputs. The user-facing invariant should be: *every field that's discovered AND toggled-on returns a row in the result*, with `value: null` if it couldn't be resolved. Today fields get silently dropped, and the cache compounds the loss by forgetting they ever existed.

### 🔬 Discovered + toggled-on fields are silently dropped from the result

**The bug.** `packages/api/src/routers/scraper.ts:496-504` builds `discoveredResults` by iterating `Object.entries(finalData)` — i.e., only fields that successfully resolved. The `requested` tier handles this correctly (iterates schemaFields, fills `null` for unresolved), but the `discovered` tier doesn't.

**Symptom.** Amazon Godiva: analyze proposed 14 fields, user toggled all 14, extract resolved 9. The result table showed 9 rows. The 5 unresolved fields (sizes, flavours, etc.) were not shown — not even as "not_found." The user has no way to tell that the AI agreed those fields exist but couldn't extract them this run.

**Fix.** Mirror the `requested` tier: iterate `schemaFields.filter(f => f.tier === 'discovered')`, return `value: finalData[name] ?? null` and `status` derived the same way. One small code change, contract restored.

### 🔬 Cache forgets discovered-but-unresolved fields

**The bug.** `saveDomainCache` (in `packages/scraper/src/domain-cache.ts`) only writes path entries for fields in `fieldResults` — i.e., fields that resolved with at least one path. Discovered fields that produced no path are not persisted anywhere.

**Symptom.** Run 1 on Amazon Godiva: 14 discovered, 9 resolved → cache stores 9 paths. Run 2 hits cache. `sandbox.analyze` reads `cache.fieldPaths`, returns the 9 keys as the schema, and skips AI re-discovery. The 5 lost fields are now invisible — the user can't even ask the system to try again.

**Why it's structurally wrong.** The cache conflates two things: *which fields exist on this page-type* (a schema fact) and *how to resolve their values* (a path fact). They should be persisted separately, but today the path map doubles as the schema.

**Fix options.**
- **Cheap.** Write an entry into `fieldPaths` with `paths: []` for discovered-but-unresolved fields. Existing analyze cache-hit logic returns them in the schema for free; the empty paths array signals "AI needs to re-attempt this field" on extract.
- **Cleaner.** Add a sibling column `discoveredSchema` to `domain_intelligence` that snapshots the last analyze's full field list (name + type + description), independent of resolution. Keep `fieldPaths` as the resolution layer.
- Either way, the analyze cache-hit path should re-run AI discovery if the cached schema age exceeds a threshold OR if any field has been failing for N runs — so failed fields get re-attempted instead of permanently forgotten.

### 💡 Cache hit eclipses user-typed requested fields

**The bug.** When the user types requested fields in the sandbox textarea and pastes a URL that hits the domain cache, fields the user explicitly asked for but that don't exist in the cache are silently dropped from the schema. The cache acts as the authoritative schema instead of as a resolution shortcut.

**Why it's wrong.** Cache key is conceptually `(domain, field)`, not `domain`. The cache should answer "do we have paths for this field?" — not "what fields exist on this domain?" If the user asks for `package_weight` on a domain we've never extracted that field from, the right behavior is: run AI discovery for that field, return it in the result, and cache the new path for next time.

**What "doing it right" looks like.** On cache hit, partition the user's requested fields into (cached paths exist) and (no paths). Run cached paths for the first group, run AI discovery + selector generation for the second, merge into one schema. Cost: AI fires once per new-field-per-domain — same per-field economics as today's "first run on a fresh domain," just amortized across multiple sessions instead of paid in full up front.

**Why we're deferring.** UX is currently good — paste URL, fields appear. Adding partial-cache-hit + partial-AI-fallback complicates the loading state and result attribution. Wait until the dashboard's analyze/extract UX next changes shape (e.g., when the tier-visualization or progress-streaming work lands), then incorporate this in the same pass.

**Action items if we revisit.**
- Refactor `analyze` cache-hit branch to compute set difference between user-requested fields and cached field names
- Run AI discovery on the difference, merge with cached schema before returning
- Persist new paths via the existing `saveDomainCache` flow
- Related: [[extraction-completeness]] handles the symmetric case (cache forgets fields AI proposed but couldn't resolve); this idea handles the case where the *user* types in fresh fields that the cache has never seen.

### 🎯 Treat `__NEXT_DATA__` / JSON-LD blobs as first-class extraction sources

**Position.** SSR-hydration blobs (`__NEXT_DATA__`, Apollo cache, Nuxt's `__NUXT__`, Remix data routes, plus any sufficiently rich JSON-LD) often hold the *cleanest* version of product data on the page — cleaner than the rendered DOM, sometimes cleaner than public APIs. The current architecture explicitly skips these sources because mechanical extraction returned dirty values during early experiments. That was the right immediate call (stop the bleeding) and the wrong long-term call (left a major source on the table with no recovery path). AI API analysis only iterates `capture.interceptedRequests`; AI never sees `structuredData.nextData` either. So the source falls into a gap: too noisy for mechanical, invisible to AI.

**Why mechanical produced dirty data from these blobs.** Four compounding issues, all addressable:
- **Key-name collisions.** A nextData blob has 30+ keys named `title` (page title, breadcrumb item title, recommendation card title, search facet title, actual product title). Mechanical flattens to one namespace and matches by suffix; first hit wins, often wrong.
- **No subtree identification.** Treats the whole blob as one flat dict instead of asking "where's the main product entity?" first. A 500KB nextData blob is 99% chrome, 1% product.
- **Path-blind matching.** Keeps the leaf key but throws away the JSON path. `props.pageProps.product.price` and `recommendations[3].price` look identical after flattening.
- **No shape validation.** A field that resolves to "Customer reviews" for `description` is logged as a hit; we never check whether the value's shape matches the requested type.

**Direction: improve the extraction, don't exclude the source.** This is consistent with the core economics — AI does expensive discovery once, cache makes it free thereafter. Today that loop runs for intercepted XHRs only; extending it to structured-data blobs is the same pattern applied to a richer surface.

1. **Entity-subtree identification.** Before extracting, find the product/article/place subtree. Heuristics: keys literally named `product`, `item`, `detail`; deepest subtree with the most schema-relevant keys clustered together (`name + price + description + images` is structurally a product). Once located, only match within that subtree. Drops the noise floor by 100×.
2. **Path-aware AI + cache loop, same as XHRs.** Pass the located subtree (or the raw blob, capped by size) to AI API analysis. AI returns `nextData.props.pageProps.product.title` once; mechanical replays the dot-path on every future run for free. The cache already supports dot-paths against arbitrary JSON — this is just an additional source it can be pointed at.
3. **Type/shape validation as a post-filter.** Price parses as currency. Description is >20 chars and isn't a UI label. SKU matches the URL slug pattern. Apply at the boundary between resolution and result. Wrong shape → reject and fall through, don't log as a hit.
4. **Cross-source corroboration.** If JSON-LD says `price=$24.99` and nextData has 5 price candidates, the JSON-LD match wins. Existing cross-validation pattern; just include structured-data sources as participants.

**Symptom this would have fixed.** Amazon Godiva variant data (sizes, flavours) lives in `__NEXT_DATA__`. Mechanical skipped it. AI API analysis never saw it. AI XPath fired and produced selectors that matched the variant *buttons* rather than the data list — hit or miss per page.

**Adjacent.** Subtree identification is the same primitive needed for [[sibling-context-field-discovery]] and image-grounded validation — locate the entity, then operate within its neighborhood.

**Action items if we revisit.**
- Audit which sites have which structured-data surfaces present (probably already in `domain_intelligence.hasJsonLd` / `hasNextData`).
- Build subtree-identification as a standalone util with a test corpus of real blobs.
- Decide cap on blob size for AI API analysis (token cost vs. coverage).

---

## (Other categories — add as ideas land)

Pipeline reliability, UX innovations, performance, data quality, business-model experiments. Add sections here as ideas accumulate.
