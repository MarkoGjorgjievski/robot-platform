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

---

## (Other categories — add as ideas land)

Pipeline reliability, UX innovations, performance, data quality, business-model experiments. Add sections here as ideas accumulate.
