# Ideas Backlog

Exploratory items that aren't release-staged yet. When an idea is concrete enough to ship, it moves to `docs/roadmap.md` under the right version. When it earns a spec, it moves to `docs/superpowers/specs/`.

**Status legend:**
- 🔬 **Investigated** — we've poked at it, here's what we learned
- 💡 **Sketched** — direction proposed, not yet validated
- 🎯 **Promising** — worth a small spike before committing

---

## Field discovery

How we identify which extracted values map to which schema fields. Today's chain: exact name → alias list → suffix match in flattened API JSON → AI fallback. Real customer schemas have names that don't match the source data, so this chain misses easy wins.

### 🔬 Entry-point resolution: a hub page is not the listing (Marko, 2026-08-26)

Pasting `newegg.com/GPU-Video-Graphics-Device/Category/ID-38` revealed the gap: that URL is a
**featured/hub page** — curated tiles, no real pagination — while the actual listing sits behind
its "SHOP ALL PRODUCTS" link. Marko's framing, which is the right product shape: *the platform
should not fight the hub page; it should find and offer the real listing entry point.*

What it would look like: when a listing-mode analysis lands on a page that doesn't behave like a
listing (few/no repeating product rows, no pagination detected, no product-bearing API), look for
hub-to-listing links ("shop all", "view all", "see all N products", the category link carrying a
page parameter) and propose the target URL to the user — "this looks like a hub; the full listing
appears to be at X, use it instead?" Confirmation stays with the human; the finder can be
heuristic first, AI fallback, same ladder as pagination detection. Fits vision Pillar 4
(agent finds the data layer once) and reuses `scroll-probe`-style cheap verification: the
candidate link is a real listing iff it grows/paginates.

Until built, the failure mode it prevents is recorded by the 2026-08-26 incident: a hub URL run
in detail mode produced 28% confidence and a wall of dashes.

### 🔬 Label every candidate instead of picking one ("one page, many prices")

> **PREMISE CONFIRMED 2026-08-19 — but the mechanism I proposed was WRONG. See "What the fixed-path check actually found".** The idea stands and is stronger than when it was filed; the seller-rotation story behind it does not.

**The observation** (values as read on 2026-08-18; several had changed by the next day — see the 2026-08-19 check below, which is the better evidence). A Newegg product page exposes many price-shaped values at once, all real:

| Path | Value |
|---|---|
| `MainItem.OriginalUnitPrice` | 395 |
| `MainItem.LowestPrice30Days` | 391.05 |
| `MainItem.ItemPriceRange.PriceRangeMin` | 395 |
| `MainItem.ItemPriceRange.PriceRangeMax` | 764.84 |
| `MainItem.MapPrice` | 0 (minimum advertised, unset here) |
| `MainItem.VolumeDiscount.PromotionPrice1-3` | 0 (bulk tiers, unset here) |

Ratings are the same shape: `Review.Rating = 5` vs `Review.RatingOneDecimal = 4.9`; `Seller.SellerRating = 5` vs `SellerRatingOneDecimal = 4.7` vs `SellerRatingLast12M`.

Consequence for the Tier 2 reports: several fields marked **wrong** on 2026-08-18 were not extraction failures. `price: 398`, `rating: 4.9`, `seller_rating: 5` are each a genuine value from that page. The extractor picked a valid candidate and nothing told it which one was wanted — **a disambiguation failure, not an extraction failure**. Four of the five "wrong" verdicts in that report are of this kind, so the honest correct-rate is better than it reads, and the judge cannot tell the difference without knowing customer intent.

**The idea (Marko's, and better than "make the extractor choose").** Don't resolve the ambiguity at extraction time. Extract and **label all candidates**, show them to the customer, and let them choose. The API frequently exposes more than the UI does, so this is upside, not noise.

Splits cleanly along the existing data model:

- **Per-domain** (`domain_intelligence`) — the *catalogue* of what this domain can yield. "Newegg offers six price-ish values" is a fact about Newegg, discovered and cached once.
- **Per-dataset** (the customer schema) — *which* candidates that customer wants, under what names. A fact about the customer. Two customers can want different prices from the same URL and both be right.

**Why this is more than ergonomics: it dissolves a real architectural problem.** `domain_intelligence` is keyed by `(domain, pageType, field name)`. If customer A's `price` means "lowest across sellers" and customer B's means "featured seller", they collide in one row — and the conflict detector added in 4307564 would fire on every marketplace domain, reporting two correct answers as a disagreement. Distinct labelled fields (`price_featured_seller`, `price_lowest_30d`, …) are not competing paths for one field, so there is no collision and the detector goes back to meaning what it should.

**Scope columns.** A price without its seller is uninterpretable on a marketplace page. The general rule: *when a field's value is scoped by an entity the page exposes — seller, variant, region, quantity tier — that scope must travel with the value as its own column.* `variant_array` already established this shape for variants; sellers are the same pattern.

**Cost.** Cheaper than it sounds. The API blob is already fetched, so enumerating candidates is mechanical and free. The expensive part is *labelling* them, which is one AI pass per domain, cached like everything else. The real cost is UI: six price fields presented flatly is worse than one wrong number, so grouping and sensible defaults are the actual work.

**What the fixed-path check actually found (2026-08-19).**

Seven captures of the same URL over ~17 minutes, reading FIXED dot-paths so extraction-path variance was held constant. Results:

*Refuted — the mechanism.* **Every path was stable across all seven captures.** There is no per-request seller rotation. The 402.99 → 398 → 395 spread across the 2026-08-18 runs is therefore *not* explained by rotation; it is better explained by different extraction paths reading different fields, plus genuine day-to-day change. My original causal story was wrong, and it was wrong in the specific way worth remembering: three variables moved together and I attributed the effect to the most interesting one.

*Confirmed — and more strongly than the original filing.* One page carries several simultaneously-valid prices. As of 2026-08-19:

| Source | Value |
|---|---|
| **What the page DISPLAYS** (`price-current`) | **$389.99**, labelled "Save: 29%" |
| `MainItem.OriginalUnitPrice` | 679.99 |
| `MainItem.FinalPrice` | 399.99 |
| `MainItem.ItemPriceRange.PriceRangeMin` | 396 |

*New, and the most actionable finding.* **The displayed price matches none of the API fields.** `FinalPrice` sounds authoritative and is not what a shopper pays. So the extraction chain can return a value that is real, stable, internally consistent and *still not the number on the page* — a plausible wrong answer, which is worse than an obviously wrong one, and which neither the shape validator nor page-corroboration would catch (679.99 and 399.99 are perfectly well-formed prices).

*Also.* `Seller.SellerName` was `MobileMonster` on 2026-08-18 and `null` on 2026-08-19 — the marketplace seller genuinely comes and goes day to day. A `seller` scope column will often be empty, and that emptiness is information ("sold by Newegg directly"), not a gap.

**What this changes about the design.** Labelling is not just a convenience for customers choosing between equally-good options — it is the only way to distinguish *the price shown to a shopper* from *a real number in the API that means something else*. The label has to carry that distinction explicitly (`price_displayed` vs `price_list` vs `price_range_min`), and "which one does the page show" should probably be a first-class, separately-verified property, since it is the one most customers actually mean.

**Still unchecked from the original list:**

- **Check whether it generalises.** Newegg is a marketplace; marketplaces may be the unusual case. Count the price-shaped candidates on Target and Barnes & Noble (both already in the live corpus, both capturable). If they expose one price each, this is a marketplace feature, not a platform feature, and belongs behind a per-domain flag rather than in the core model.
- **Check that customers actually want it.** The whole design assumes a customer wants to choose among prices. If in practice they always want "the price a shopper would pay", this is over-engineering and the simpler answer is a good per-domain default with an override.
- **Watch for candidate explosion.** Six price fields on one domain is manageable; sixty across a schema is not. Measure before designing the UI.

**If confirmed**, this deserves its own spec — it touches the cache key, the schema editor, the conflict detector, and the results view, and it interacts with `variant_array`. Do not fold it into a correctness pass.

### ✅ FIXED — the capture navigated away from the requested page (2026-08-19)

> **Root cause was NOT what this entry originally claimed.** It was filed as structured-data entity confusion. The actual cause: our own popup-dismissal pass clicked a link and left the page. See the resolution at the end.

**Live instance, first run against Barnes & Noble.** The page is the NOOK GlowLight 4, an e-reader. The extraction resolved 18/19 fields and most of them describe **a different product** — a $9.99 accessory cover sold on the same page:

```
[correct] product_name : "NOOK GlowLight 4"                          (src=api)
[wrong]   price        : 9.99                                        (src=json-ld)
[wrong]   variants     : Daffodil @9.99, Silver Sparkle @9.99, …     (cover colours)
[wrong]   key_features : "Secure closure with magnetic tab", …       (a case, not a reader)
[unverif] product_url  : …/nook-glowlight-4-and-4e-cover-in-daffodil-…
```

The *name* is right and nearly everything else belongs to the accessory.

**Why the existing defences miss it.** This is the same family as the `ProductRelationInfoV3` mis-rank and the `Configs[0].name` poisoning — a value that is real, well-formed, and about the wrong entity — but every guard built so far is aimed slightly elsewhere:

- **Page corroboration** only checks name-like fields (`product_name`, `brand`, `title`) and only from `api`/`api-ai` sources. `price: 9.99` is a number from `json-ld`, so it is exempt twice over. And it *would* corroborate anyway — the cover's price genuinely is on the page.
- **The shape validator** sees a perfectly good price.
- **Request ranking** does not apply: this came from JSON-LD, not an intercepted API. The page simply carries several JSON-LD blocks and the mechanical extractor took a field from the wrong one.
- **The conflict detector** would only fire if two paths disagreed; here one path confidently returns one wrong answer.

**What the fix probably needs.** `findEntitySubtree` already exists for scoping `__NEXT_DATA__` to a product node (v1.1b Phase 0.3), and this is the same problem one level up: choosing *which entity on the page* the schema refers to, then scoping every field to it. Candidate signals: the JSON-LD block whose `name` best matches the page `<title>` or `<h1>`; the block carrying the highest-priced offer; the one the breadcrumb points at. Whatever the rule, the important property is that **all fields resolve against the same entity** — a name from one block and a price from another is worse than either alone, because it is self-consistent nonsense.

**Resolution — the diagnosis above was wrong, and the real cause was ours.**

`capture.url` told the story the moment I looked at it:

```
requested : /w/nook-glowlight-4-barnes-noble/1145507276?ean=9780594205821
captured  : /w/nook-glowlight-4-and-4e-cover-in-daffodil-barnes-noble/1140326163
```

**The browser left the page.** `dismissPopups` clicks a deliberately broad selector list — `"Close"`, `"OK"`, `[aria-label="Close"]`, `[role="dialog"] button` — and on a real page a broad click list eventually hits a link. Three captures in four ended on an accessory's product page. The JSON-LD was never wrong; it correctly described the page we had drifted to. Nothing was mixing entities, and no amount of structured-data scoping would have helped.

Worth keeping as a lesson about diagnosis: I inferred "multi-entity page" from the *values*, wrote a plausible mechanism, and started building a filter for it. The URL — one field, already in the capture — refuted the whole story in seconds. Check what you were given before modelling what you were not.

**Fixed two ways** (`returnIfNavigatedAway` in `playwright-browser.ts`, entity filter in `entity-match.ts`):

1. After dismissal and expansion, compare `page.url()`'s pathname against the requested one. On a mismatch, log it and navigate back. Deliberately *no* second dismissal pass — that is what moved us, and a popup left standing costs far less than silently capturing a different product.
2. `filterEntitiesForPage` drops structured-data blocks whose identifiers conflict with the **requested** URL. Kept as a safety net even though it was built for the wrong diagnosis: it is the check that would have caught this from the data alone, and it costs nothing.

Verified: 4/4 captures now stay on target and extract `NOOK GlowLight 4`, $149.99, sku 9780594205821 — the guard firing on 3 of them. Previously $9.99.

**What this implies beyond B&N.** Any site where dismissal clicks a link has been silently capturing the wrong page, and the resulting data looks perfect. Worth re-checking the corpus fixtures — they were captured with the same dismissal pass — and worth narrowing the dismissal selectors so they cannot match anchors at all.

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

**UPDATE (v1.1b, shipped 2026-05-20):** the reverse-search direction above shipped — `generateSelectors` is multimodal and value-targeted, lifting Amazon Godiva 4/16 → 12/16. But dogfooding + the v1.5 Phase 5 domain views surfaced two follow-ups (below).

### 🔬 Reverse-search overfits XPaths to the literal value

**Observation (v1.5 Phase 5 domain-views dogfood, 2026-05-20, `www.amazon.com / detail`).** Inspecting the cached `rating` paths showed three accumulated XPaths, two of which hardcode the literal value:

```
[0] //span[@class='a-icon-alt' and contains(text(), 'out of 5')] | …    ← generic, generalizes
[1] //span[@class='a-icon-alt'][contains(text(), '4.1')]                ← hardcodes "4.1"
[2] //span[@class='a-icon-alt' and contains(text(), '4.1')]             ← hardcodes "4.1"
```

`review_count` shows the same pattern (one path hardcodes `(27)`). The v1.1b reverse-search prompt ("write an XPath that returns this value") makes the model bake the target *value* into the selector's text predicate. Such a path only matches a product whose rating is exactly 4.1 — it won't generalize to the next variant (rating 4.7), where only the generic path survives. So value-targeting, while it lifted resolution, can produce brittle non-generalizing selectors that pollute the cache and give false confidence (they log a "hit" on the page they were born from).

**Direction.**
- Tighten the selector-generation system prompt: use the seen value to *locate* the right element, then write a selector keyed on **structure/attributes** (`@class`, `@id`, `@data-*`, label proximity), NOT on the literal value text. Explicitly: "do not put the value itself inside `contains(text(), …)` — anchor on stable structure."
- Optionally post-filter generated XPaths: if the selector string contains the literal target value, down-rank or reject it in favor of a structural alternative.
- Cross-reference with the cache-lifecycle pruning (near-duplicate / brittle paths should age out): [[cache-lifecycle]].

### 🔬 `ai-vision`-only fields never amortize (re-pay AI every run)

**Observation (same dogfood).** `price`, `upc`, `asin` had **0 cached paths after 5 runs**. Root cause for `price`: it only ever resolved via the v1.1b `ai-vision` fallback (the model reading the value off the screenshot). By design `ai-vision` values are *delivered for the run but not cached as a reusable path* (empty path — they aren't selectors). So a field the AI can only *see* (not *select*) re-pays the AI on every run and never becomes free — defeating the cache's whole economic premise for that field. (`upc`/`asin` are a different gap: not on the rendered DOM at all — UPC isn't shown on Amazon PDPs; ASIN is in the URL / a details table the selector didn't target.)

**Direction.**
- When `ai-vision` is the *only* resolver for a field across N runs, attempt to derive a generalizable selector from the AI-seen value's DOM location (turn the vision hit into a cached XPath), or flag the field as "AI-only — not cached" in the UI so the cost is visible.
- Source identifiers structurally where possible: `asin` from the URL pattern, `upc`/`gtin` from JSON-LD / structured data, rather than the rendered DOM.
- Image-grounded validation ([[image-grounded-field-discovery]]) pairs naturally here — confirm the ai-vision value against the screenshot before trusting it.

### 🔬 AI API analysis picks identity fields out of internal config blobs (2026-08-18)

**Live instance, fully diagnosed — this is the `otFlat` family, but first-party, so the noise filter cannot see it.**

On the 2026-08-18 Newegg dogfood, `product_name` resolved to
`"Similar Seller Recommendation on OrderTracking and ProductList page"` (source `api`),
and the cache learned the path `Configs[0].name`.

The chain, from the run log:

1. Newegg's top-ranked intercepted API is `product/api/ProductRealtime` (37KB). It contains a `Configs` array of *internal feature-flag descriptions*, each with a `name` key.
2. JSON-LD was **absent** on this capture (the page degraded — the same capture that timed out on screenshot). In the previous run JSON-LD was present and `product_name` was correct, which is why this only appears intermittently.
3. With no structured data to satisfy it, `product_name` fell through to AI API analysis, which matched a `name` key inside `Configs[0]` and returned it with confidence 0.8.
4. `saveDomainCache` stored it. The cache now holds two paths for `product_name` — json-ld `name` (correct) and api `Configs[0].name` (garbage) — with `conflictCount: 1` and identical `hits: 1, misses: 0`.

**What this exposes.**
- **Path ranking ignores source authority.** `pathScore` is recency-weighted hit rate then confidence; `resolveFromCache` sorts human-first and then purely by that score. A publisher-declared JSON-LD `name` and an arbitrary API dot-path are treated as equally trustworthy, so a tie is broken by array order. For *identity* fields (name, sku, brand) structured data should outrank a guessed API path.
- **Conflict is detected and then ignored.** `conflictCount` was incremented and nothing consumed it. That counter is the signal a human-review flag should hang off — per the project's own rule that degradation is flagged, never auto-reset.
- **Nothing corroborates an AI-API value against the page.** A real product name appears in `<title>` or an `<h1>`; this string appears in neither. A cheap containment check against the captured HTML/title would have rejected it, and would generalise to the whole family.

**Deliberately not fixed here.** The correct fix is a design decision (source-priority ranking vs page corroboration vs consuming `conflictCount`), and auto-purging the poisoned row would violate the "flag for human review, never auto-reset" rule in CLAUDE.md. **The `www.newegg.com / detail` cache row is currently poisoned** and will keep serving the bad `product_name` whenever JSON-LD is missing.

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

### 🔬 Junk intercepted requests waste AI-analysis slots

During the Nike v1.1b dogfood, after `nextData` was correctly scoped small, the 5-source cap's remaining slots were filled by large but worthless intercepted requests — privacy-compliance frames, a Salesforce chat-widget config, and an i18n async-chat blob (~22–42 KB each). `collectAiAnalysisSources` now keeps `inline://` sources first (Phase 0.4), so correctness is fine, but those junk sources still occupy intercepted slots and cost one AI `extractFromApi` call each. `discoverSchema` already filters obvious infra URLs (translation/localisation/config/analytics/tracking/feature-flag); applying a similar denylist to `collectAiAnalysisSources`'s intercepted requests would cut wasted AI calls. Deferred (not correctness-affecting); be careful not to exclude real product APIs — see the "don't skip messy sources" principle.

---

## Cache lifecycle

### 💡 Cache lifecycle — pruning, within-batch correction, backfill (deferred from v1.1b)

v1.1b stopped at "always consult the cache." The existing per-path prune (≥5 uses & ≤10% hit rate) and 5-path cap are kept as-is. Deferred, to be designed against real volume data:
- **Per-path prune tuning** — revisit the 5-use / 10% / 5-path-cap constants once we have multi-thousand-run domains.
- **Within-batch second pass** — when a path discovered late in a batch would have fixed earlier inputs in the same batch, re-run the batch's own failed fields at the end.
- **Historical backfill** — re-scrape already-delivered data when a materially better path appears (opt-in; expensive).
- **Exploration-rate control** — today cross-validation exercises all paths every run; if early-exit is ever added for cost, exploration must be reintroduced as a rate so challenger paths still earn hits.

Why milestones were rejected: absolute total-use milestones (1/5/…/10k) can't judge a path at small N and don't scale across customers (100-input vs 100k/day). Per-path evidence is the right primitive — which the existing prune already uses.

### 🔬 DomainIntelligence `www.` key inconsistency

`domainIntelligence.domain` is stored inconsistently: `extract` (`scraper.ts`) saves the full hostname (`www.amazon.com`) while `analyze` and other lookups strip `www.` (`amazon.com`). A single site can therefore accumulate two cache rows that never share paths, and the v1.5 Phase 5 `/domains` library shows both. Surfaced while building the global domain views (read-only, so they just display what's stored). Fix: normalize the cache key (strip `www.` everywhere, or canonicalize on write) — a cache-hygiene change with a one-time migration to merge existing split rows. Out of scope for the read-only views.

---

## Pipeline reliability

### 🔬 `@robot/browser` hardening (capture robustness + testability)

Surfaced in a 2026-06-30 code audit of `packages/browser/src`. The extraction *chain* is sound; the capture *layer* underneath it is the least-defended part of the codebase and is the most likely source of flaky production scrapes. Recording the specifics so a future implementor doesn't re-derive them.

**Current state.**
- **Monolithic class.** `PlaywrightBrowser` in `packages/browser/src/playwright-browser.ts` is one ~750-line class holding navigation, popup dismissal, content expansion, network interception, HTML cleaning, extraction, and pagination. `dismissPopups` (~68 lines), `expandHiddenContent` (~117 lines), and the request-ranking block are all inlined as private methods.
- **No tests on the core class.** Only the *peripheral pure* functions are tested (`screenshot-tiles.test.ts`, `pagination-detector.test.ts`, `intercept-noise.test.ts`, `set-content-evaluate.test.ts`). The risky behavior — popup dismissal, content expansion, request ranking, fallback navigation — has zero unit coverage because it's welded to a live `chromium` instance. `setContentEvaluate` exists as a seam but is only exercised for basic XPath, not for replaying a fixture page through dismissal/ranking.
- **Sleep-based waits, not state-based.** ~8 hardcoded `waitForTimeout` calls (popups 1500ms, between dismiss clicks 800ms, post-expand 500ms, `domcontentloaded` fallback grace 3000ms, between pagination pages 1000ms). These are guesses against unobservable state; slow sites fail silently, fast sites waste wall-clock. Tab-expansion also uses in-page `setTimeout(... i*300)` (`expandHiddenContent`), which bypasses Playwright's actionability checks.
- **Substring-based request ranking.** `rankRequests` scores intercepted bodies with `body.includes('"price"')` etc. (`playwright-browser.ts:568-587`). A response whose URL or unrelated text contains `"price"` scores as product data; a real product API with unusual key names scores low. The scoring weights (`+5`, `+4`, `-10`, size bands 1–50KB = product) are e-commerce-tuned and will misrank job/news/SaaS sources. **This is the one genuine silent-failure risk in the package** — a mis-ranked top source means the wrong JSON goes to AI analysis. (The `catch{}` blocks in `scraper/src/executor.ts` look alarming but are *correct*: they run inside `page.evaluate`, where a bad XPath should yield "no match," not a throw. Left as-is deliberately.)

**What "doing it right" looks like.**
- Extract `dismissPopups`, `expandHiddenContent`, and `rankRequests` into standalone functions; `rankRequests` becomes a pure `(requests, pageUrl) => ranked` and gets unit tests directly.
- Replace `body.includes(...)` ranking with parse-once-then-inspect-keys (the bodies are already JSON-filtered), so `/api/messages/pricing` stops matching `"price"`.
- Make the popup/expand/skip selector lists and the scoring weights constructor config, so a domain can override them — and so news/jobs/SaaS can be tuned without forking. Honors the "don't skip messy sources" principle: tune, don't exclude.
- Replace fixed sleeps with state waits where one exists (`waitForLoadState`, `waitForSelector` on the dismissed overlay's disappearance); keep a *capped* fallback sleep only where no observable signal exists, and `log` when the fallback fires.
- Add fixture-replay tests through `setContentEvaluate`: feed a captured HTML + intercepted-request set, assert dismissal count and the ranked top source. This reuses the Tier-1 corpus machinery already built for `@robot/scraper`.

**Action items if we revisit.**
- Land `rankRequests` extraction + parse-based scoring + its unit test first (highest correctness payoff, smallest blast radius).
- Then the function extractions + fixture-replay tests for dismissal/expansion.
- Treat the magic-number sweep (named constants at module top) as a follow-on, not a blocker.

## Tech debt / code structure

### 💡 Extract the `scraper.extract` orchestration out of the router

`extractRouter`'s `extract` procedure in `packages/api/src/routers/scraper.ts` is a ~470-line mega-procedure: it owns capture, cached-field resolution, the mechanical → cached-path → cached-XPath → cross-validate → AI-API → AI-XPath → tile-escalation chain, *and* the HTTP/tRPC boundary all in one function. It's the densest business logic in the repo sitting in the thinnest-should-be layer. It works and is covered by the api test suite, but it's the hardest thing in the codebase to modify safely. Direction: lift the chain into an `extraction-orchestrator.ts` service in `packages/scraper` (where its siblings already live — `build-result-rows`, `collect-ai-analysis-sources`), leaving the router as a thin Zod-validated adapter. Same move would let the v2 listing→detail crawler reuse the chain instead of duplicating it. Not urgent; do it the next time `extract` needs a non-trivial change rather than as a standalone refactor.

### 💡 Collapse the per-method provider branching in `@robot/agent`

`SchemaAgent` (`packages/agent/src/schema-agent.ts`) repeats the same `if (this.anthropic) { callWithTool(...) } else { ollama.callWithJson(...); normalize(...) }` shape in ~6 methods, and maintains parallel Anthropic/Ollama prompt builders (`selectorGenerationUserContent` vs `ollamaSelectorPrompt`) that can drift. A single `Provider` interface with `callStructured(system, userContent, schema)` — Anthropic implements it with `tool_use`, Ollama with JSON-prompt-plus-extract-plus-normalize — would remove the branching and the duplicate prompt paths. Also folds in: the `as DiscoveredSchema`/`as string[]` casts on LLM output should become a real validation (Zod parse) at the provider boundary so malformed responses fail loudly instead of at a downstream runtime error, and the scattered magic numbers (HTML truncation 50k/30k, backoff 1000/10000, judge `max_tokens` 16, hardcoded `claude-sonnet-4-20250514` in the judges) should move into one config. Low risk, ~2-3 days, prompts unchanged.
