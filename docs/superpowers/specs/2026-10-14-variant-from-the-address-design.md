# The variant the address names — design

**Status:** implemented on `feat/variant-from-address`, 2026-10-14; merge, final review, the route
smoke and the live check: see the plan's status and `docs/handoff.md`.

**Deviations:**
- §7, wrong-variant fires only when every comparable kind disagrees, not some — a label alone
  never decides; a query pair counts only when the page shows a pair of the same name, and an id
  counts only from a variant-style key (`variant`, `variant_id`, `variantId`, `sku`); tracking and
  affiliate query keys are ignored (Task 1 ruling, after a review finding that the merged set gave
  false negatives on multi-axis pages).
- §5 rule 3 (label): the exact-label key list is narrower than written — `size`, `color`,
  `colour`, `option1`–`option3`, the values of `selectedOptions`/`options`/`additionalProperty`,
  `variesBy`, an entry's own known axis keys, and the sku's suffix; `name`/`title` match by
  containing every page label of three characters or more, not equality; a rule-2 contradiction
  ends the match before rule 3 is tried (Task 2 ruling, after `?size=5` matched `width`/`height`/
  `length` positions).
- §5's "matching never reads prices or availability" shipped as a key-substring exclusion: any key
  containing `price`, `availab`, `stock`, `inventory`, `quantity` or `offers` is never read, not
  only keys literally named price or availability.
- §4, the ready check sees only the address half of the page variant (`named`), not the page's own
  selection (`selected`); on a picker-only site a `[page]` path waits out the ready timeout before
  the right values land — slower, not wrong (Task 2 minor, deferred).
- §6, the row warning checks each cell's own proving path for a fixed array index inside a
  structured path (xpath paths excluded from the check), rather than whether a `[page]` path
  exists anywhere else in the field's certified list.
- §9, `toEntry` does not keep `selectedOptions` on a variant entry, only its text values; the id
  fields (`url`, `@id`, `id`, `variant_id`) are kept as written.
- Outside the brief: the capture file (`capture-store`'s `writeCaptureFile`) now persists
  `pageVariant`, which it did not before this branch.
- §12 / property 8, fragments are kept whenever they carry a `key=value` pair, as written; the
  shipped test also keeps text fragments (`#:~:text=`) and hash routes (`#!/x?id=3`) — a known
  gap, not yet tightened to key=value parts only.

Design approved in conversation 2026-10-14 (Marko: the row means what the page shows for this
address — the selected variant's values, not an aggregate; approach A, the `[page]` address form;
a page that does not show the named variant is a failed capture). Spec written the same day.

Builds on `2026-10-01-variants-design.md` (one row per variant, product and variant keys, "a run
never stops to ask"), `2026-10-09-honest-page-verdicts-design.md` (one verdict per capture, one
sentence everywhere) and `2026-09-29` certification (candidates, safety, ranking). Evidence:
`docs/testing/2026-10-11-campaign-2.md` ("the variant chosen in the URL is ignored", the largest
source of real wrong values that Verify passes) and the per-site notes under
`docs/testing/results/campaign-2026-10-11/`.

## 1. The problem

A certified path is one fixed address, `offers[0].price` or `hasVariant[3].sku`. It reads the
same position on every page, and nothing in the pipeline compares the page's address with the
page's data. So a run stores the base price, the first size's barcode or the first colour's
stock whatever the address asked for:

| Site | The address | What was stored | What the page showed |
|---|---|---|---|
| Ruggable | `/products/x?size=6x9&system=rug-cvr` | the 2'x3' price and SKU | $499.00, SKU `…-06x09` |
| Skullcandy | `/products/x?variant=45061353865273` | the first colour's "in stock" | "OUT OF STOCK" for the colour named |
| Burrow | `?Fabric=Camel+-+Top+Grain+Leather&Leg+Finish=…` | the base price 1565 | $2,801 |
| Glossier | `?variant=44415832752373` | the mini size's price | $24 for the 177 mL selected |
| Kith | `/products/khwa030083-338` (no variant named) | `offers[0]`: the sold-out XXS | XS to XXL selectable |
| Puma | `/pd/x/312123?swatch=16` | swatch 16's SKU | the page rendered swatch 17 |

Verify cannot catch it. When the proof pages show the default variant, a first-entry path
certifies cleanly (Burrow, 8 of 8). When they show another variant, the right entry sits at a
different index on each page, so no single path certifies (Ruggable, 0 of 3, `ambiguous`).

## 2. What changes, in one paragraph

**A row's values are the values of the variant the address names; when the address names none,
the variant the page shows selected on load.** Every capture works out its *page variant* from the
address and the page. A certified path gains one address form, `[page]`, that reads an array by
the page variant instead of by index: `offers[page].price` resolves to the one offer whose url,
id, sku, option values or label match the page variant, and to nothing when none or more than one
does, never to entry 0. Verify proposes the `[page]` form whenever the typed value sits in the
matching entry and ranks it above the fixed index, so Ruggable's three proof pages certify one
path. A proof page whose address names a variant that the certified path does not honour gets a
row warning. A page that does not show the variant its address names is a failed capture with one
sentence, like a wall or a 404, not a row. Paths without `[page]` behave exactly as today.

## 3. The page variant (`@robot/browser`, `page-variant.ts`)

`PageVariant = { ids: string[]; pairs: Array<{ name: string; value: string }>; labels: string[]; named: boolean; selected: boolean }`,
computed once per capture and stored on it as `capture.pageVariant` (absent on captures built
outside the browser, like today's `timings`). Its parts:

- **From the address** (`named: true` when any of these yields something): every query pair
  (`variant=45061…` → `ids`; `size=6x9`, `Fabric=Camel - Top Grain Leather`, `color=031`,
  `swatch=16` → `pairs` and `labels`); a fragment with `key=value` pairs the same way (`#sku=…`);
  the last path segment's trailing tokens after the product handle are NOT read (too noisy;
  `-black-m` is left for a later spec). Values are URL-decoded and trimmed.
- **From the page** (`selected: true` when found): the option the page marks selected inside a
  variant picker — `[aria-checked="true"]`, `[aria-selected="true"]`, `option:checked`,
  `input:checked` with its label text — read by the same picker script `variant-dom.ts` already
  uses to list options (`buildVariantPickerScript`), restricted to the picker's own container so a
  review widget's `.selected` never counts; and the page data's `selectedVariant`,
  `selectedVariantId`, `selected_variant`, `current_variant` keys (id or object with `id`/`sku`),
  found by the existing `findEntitySubtree` preference for `selected*` keys.
- `ids` and `labels` are stored as given; matching normalises (§5).

A capture with `named: true` whose page shows a *different* selection gets the verdict of §7 —
"different" meaning the address and the page's selection carry the same kind of thing (an id
and an id, a pair and a pair, a label and a label) and none agrees after normalisation. An
address naming only an id (`?variant=123`) against a picker showing only a label ("Chill Grey")
is not comparable, so it is never a wrong variant; the page data decides per path (§4). A capture with
`named: false` uses the page's selection as its variant; with neither, `pageVariant` is present
but empty and `[page]` resolves to nothing everywhere.

## 4. The `[page]` address form (`@robot/scraper`)

- `getByDotPath(obj, path, ctx?)` in `domain-cache.ts` accepts `[page]` as an array step when
  `ctx.pageVariant` is given: the step picks the single entry of the array that `matchesPageVariant`
  (§5) and returns `undefined` when zero or several entries match. Without `ctx`, or with an empty
  page variant, `[page]` yields `undefined`. A `[page]` step on a non-array yields `undefined`.
  Numeric steps are unchanged.
- `resolveStructured(capture, source, path, ctx?)` passes the capture's `pageVariant` through;
  the "first container where the path is non-empty" rule stays, so on Skullcandy's
  one-block-per-colour JSON-LD `offers[page].availability` is read from the block whose offer
  matches, because only that block yields a value.
- `evaluatePath` (`verified-extraction.ts`) and certification's evaluation (`certify.ts`) pass the
  capture's page variant in `ctx` beside `pageUrl`. The ready check's `isReady` sees it too (the
  snapshot carries the capture's current page variant; it is computed before the first poll).
- **Identity:** the path string is its own identity; `pathId`, `CertifiedPath`, drift, the path
  stats, ops and the domain cache need no new field. `CertifiedPath.transform` is unchanged.
- **Candidates (`searchStructured`)**: beside every `arr[i].leaf` candidate whose value matches
  the typed value, when entry `i` is the page variant's match the search also emits
  `arr[page].leaf` (same source, same transform). `rankCertified` ranks a `[page]` path above a
  path that differs from it only by a numeric index; among `[page]` paths the existing order
  (api, json-ld, meta; shorter first) stays.
- **The AI fallback** (`proposeWithAi`) is told the page variant per page and may propose `[page]`
  paths; every proposal still goes through certification unchanged.
- The domain cache's stored paths may contain `[page]` like any other path; `cachedPaths` returns
  them as candidates as today.

## 5. Matching (`matchesPageVariant(entry, pageVariant)` in `@robot/scraper`, `verify/page-variant-match.ts`)

An entry matches when any one rule holds; the array step succeeds only when exactly one entry
matches.

1. **Id:** a page `id` equals the entry's `id`, `variant_id`, `variantId`, `productID`, or the
   value of `variant`/`id` in the query of the entry's `url` or `@id` (`…?variant=4506…#offer`).
   Ids compare as trimmed strings.
2. **Option pairs:** every page `pair` has an entry match by name and value, ignoring case,
   surrounding spaces and runs of spaces, against `selectedOptions[{name,value}]`,
   `options[{name,value}]`, `option1`–`option3` (name unknown: value only), or an entry key that
   equals the pair's name (`size`, `color`, `colour`, `Fabric`). Pairs the entry does not carry at
   all are ignored (Ruggable's `system=rug-cvr`), but at least one pair must have matched.
3. **Label:** a page `label` equals, after normalisation, an entry's `size`, `color`, `colour`,
   `name`, `title`, `sku` suffix after the last `-`, or an axis value — where normalisation
   lowercases, strips quotes, apostrophes, primes and punctuation, collapses spaces, and drops
   leading zeros in digit runs (`6x9` ≡ `6'x9'` ≡ `06x09`).

Matching never reads prices or availability. A page variant with nothing to match (empty) matches
nothing.

## 6. Verify (`run-verification.ts`, `certify.ts`, the Verification tab)

- Proof-page captures compute their page variant (§3); certification evaluates `[page]` paths
  with it per page, so a path is correct on a page when the matched entry's leaf equals the typed
  value, and reads nothing when the page has no match (safe, not proven, as an empty read is today).
- **The row warning.** After a Verify, a field whose certified paths include no `[page]` form, on
  a proof page whose address names a variant (`named: true`) and whose certified path's entry is
  not the page variant's match, reads in its status column: "reads the first variant, not the one
  the address names on product n". It never blocks; it tells the customer that a proof page on a
  non-default variant is needed (or that the typed value is the default variant's). The check is
  pure (`verification-model.ts`, from the stored `FieldVerification.cells[url].path` and a new
  per-capture `pageVariant` the captures query returns beside `headingText`/`pageText`).
- The Verify count, the badge, `fieldHash` and `definitionHash` are unchanged (the path text is
  already part of the result; the page variant is a property of a capture, not of the set).

## 7. A page that does not show the named variant (`@robot/browser` verdicts)

A new verdict kind beside `ok | refused | challenge | not-found | redirected | blank`:
`{ kind: 'wrong-variant', status, named: string }` — set when the address named a variant
(§3 `named: true`), the page shows a selection (`selected: true`), the two carry a comparable
kind (id/id, pair/pair, label/label), and none of that kind agrees; `named` is the address's own
text (`swatch=16`). Its sentence everywhere (`verdictSentence`):
**"The page did not show the variant the address names (swatch=16)."** Consumers behave as for
`blank`: a run item fails with the sentence (no row, no path stats), a proof card shows it, the
listing bar shows it; the per-host backoff is NOT fed (`reportVerdict` treats it as `ok` for pacing:
the host answered). A page that shows no selection at all (`selected: false`) is never
`wrong-variant`: the page data may still carry the named entry, and `[page]` decides per path.

## 8. Planning and item addresses (`@robot/scraper` `crawl/product-link-group.ts`, `@robot/api` `plan-source.ts`)

A fragment that carries `key=value` pairs is kept on the item's address (today every fragment is
stripped before grouping); a fragment without one is stripped as today. Grouping and
deduplication otherwise stay as they are: `?variant=A` and `?variant=B` remain two items (folding
them under one product is §12).

## 9. Variant list entries keep their ids (`variant-detect.ts`)

`toEntry` keeps `url`, `@id`, `id`, `variant_id` and `selectedOptions` on an entry beside the
axes, sku and price it keeps today, so a later plan can pick the row the address names and fold
siblings. Nothing reads them in this spec; `buildVariantRows` is unchanged.

## 10. Copy table

| where | reads |
|---|---|
| verdict sentence | The page did not show the variant the address names (swatch=16). |
| Verification row warning | reads the first variant, not the one the address names on product 3 |
| run item failure (as every verdict) | the sentence above |

## 11. Safety properties the tests must pin

1. `[page]` resolves to exactly one entry or to nothing: zero matches → nothing; two matches →
   nothing; never entry 0.
2. A path without `[page]` resolves byte-for-byte as today, with or without a page variant.
3. Matching never reads a price or an availability; an empty page variant matches nothing.
4. A page variant's `named` comes only from the address, `selected` only from the page; a
   capture built outside the browser has no `pageVariant`.
5. `wrong-variant` is set only when `named` and `selected` are both true and nothing matches; it
   never feeds backoff; a run item with it has no row and no path stats.
6. Certification with `[page]` paths: a `[page]` path wrong on any page never certifies; correct
   with a value on two pages at different indexes certifies as one layout; a numeric-index path
   that is also correct ranks below it.
7. The row warning fires only for a `named` proof page whose certified entry is not the match,
   and never changes a cell's status or the badge.
8. Fragments: `#sku=123` survives planning on the item address; `#reviews` does not; grouping is
   unchanged.

## 12. Not in this spec

- Folding `?variant=` siblings under one product key, and picking the row the address names in
  one-row-per-variant mode (the entries now keep the ids for it).
- The finder counting swatch addresses as separate products (Lacoste: 60 rows, 18 products).
- Reading a variant from the path's trailing tokens (`-black-m`).
- Clicking the option the address names when the site ignores the address (Puma): the capture
  fails honestly instead.
- Aggregates per field ("in stock if any size is"); `__NEXT_DATA__` as a certifiable source.
- Lacoste's "size barcode vs product reference" SKU question: a which-leaf question, not a
  which-entry one.

## 13. Testing

- **Unit, browser:** `pageVariantOf(url, pickerSelection, pageDataSelection)` on the six
  addresses of §1 plus `#sku=`, plus a no-variant address with a selected option; `wrong-variant`
  decision; `verdictSentence`.
- **Unit, scraper:** `getByDotPath` with `[page]` (property 1, 2); `matchesPageVariant` on entry
  shapes copied from the campaign's stored captures — Skullcandy's `offers.url ?variant=`,
  Ruggable's `hasVariant[].sku …-06x09` and `size "6'x9'"`, Burrow's `selectedOptions`, Kith's
  `offers[]` with a selected size, Glossier's Shopify `variants[].id` (fixtures under
  `packages/scraper/src/verify/__fixtures__/page-variant/`); `searchStructured` emitting the
  `[page]` twin and `rankCertified` ordering it first; `certify` property 6 on three fixture
  pages where the 6x9 entry sits at index 2, 0 and 4; `resolveStructured` reading the matching
  block on a one-block-per-colour JSON-LD.
- **Unit, api/app:** `product-link-group` fragment rule; the Verification row warning
  (`rowStatus`-adjacent pure function) and the captures query carrying `pageVariant`; run item
  failure copy for the new verdict.
- **Route smoke:** a fixture product with an `offers[]` array and a `?variant=` address whose
  Verify certifies `offers[page].price`; the row warning on a fixture whose path reads index 0.
- **Live, free:** Verify on Ruggable, Skullcandy, Kith and Glossier (mechanical where the JSON-LD
  carries the entries), then a small Extract on each; Burrow needs the intercepted API; Puma
  should fail its capture with the new sentence. Under the budget memory's rule: never a click
  that shows a dollar amount without Marko.

## 14. Files

- `packages/browser/src/page-variant.ts` (new), `types.ts` (`PageCapture.pageVariant`,
  `CaptureVerdict` `wrong-variant`), `verdict.ts`, `verdict-copy.ts`, `playwright-browser.ts`
  (compute after navigation, before the ready poll; picker selection via `variant-dom`'s script).
- `packages/scraper/src/domain-cache.ts` (`getByDotPath` ctx), `verify/page-variant-match.ts`
  (new), `verify/search-structured.ts`, `verify/certify.ts` (ctx, ranking), `verify/run-verification.ts`,
  `verify/verified-extraction.ts`, `verify/ai-fallback.ts`, `verify/variant-detect.ts` (`toEntry`),
  `crawl/product-link-group.ts`, `domain-lock.ts` (`reportVerdict` pacing).
- `packages/api/src/crawl/extract-item.ts` (the failed item path already exists for verdicts),
  `routers/sources.ts` (captures query: `pageVariant`), `verify/proof-page-capture.ts`.
- `packages/app/src/lib/site/verification-model.ts` (the warning), `verification-view.ts`,
  `components/verification/verification-table.tsx`, `routes-smoke.test.ts`; `docs/handoff.md`,
  `CLAUDE.md`.

## 15. Decisions (approved 2026-10-14)

1. The row means the selected variant's values, never an aggregate (Marko: "first").
2. Approach A: the `[page]` address form, not entity scoping or DOM reading (Marko: "A").
3. No silent fallback: a page that does not show the named variant fails its capture (§7).
4. The path string stays the identity; no new transform, no new `CertifiedPath` field.
5. Fragments survive only when they carry `key=value` pairs.
6. Variant rows and the finder are out of scope; entries keep their ids for the next plan.
