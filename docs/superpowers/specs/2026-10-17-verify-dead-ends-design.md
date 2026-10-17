# Verify dead ends — design

**Status:** written 2026-10-17 at Marko's request ("can you write specs and plan at the same time?
UX changes at the end"), together with its plan
(`docs/superpowers/plans/2026-10-17-verify-dead-ends.md`). Not yet reviewed by Marko. The seven
items come from campaign 2, group 3 (`docs/testing/2026-10-11-campaign-2.md`, "Verify has dead ends
an honest customer cannot pass") and the per-site notes under
`docs/testing/results/campaign-2026-10-11/`. Every cause below was read in the code on `main` @
`8860875`; none of the seven was already fixed, so none is dropped.

## 1. Why

An honest customer, typing or marking what the product page shows, still gets stuck at Verify on
seven kinds of page. Each one either leaves the button disabled with no way forward, or fails a
field with a reason that sends the customer the wrong way. The campaign hit them on kith, glossier,
puma, skims, skullcandy, sigmabeauty, gymshark and ruggable.

| # | Dead end | Seen on |
|---|---|---|
| 1 | A project field this website does not have at all | kith Rating, glossier SKU, puma DE Rating |
| 2 | A suggestion on products 4–6 blocks Verify although the field has a default | Marko, gymshark Brand on product 4 |
| 3 | A brand held only in the shop's name is never a candidate | gymshark, sigmabeauty, kith |
| 4 | "Several places match" on pages where the value was found fine | skullcandy Brand, puma SKU, ruggable Price |
| 5 | A marked value comes back altered, and retyping drops the mark | puma "Style: …", glossier image, skims description |
| 6 | A rounded number never matches the page data (4.8 shown, 4.7610064 stored) | ruggable Rating |
| 7 | The cost label is about 2.4× low; the variant-address warning has no action | skims, ruggable, skullcandy; Marko |

## 2. A field this website does not have (item 1)

**Cause.** "Not on this product" exists per cell (spec 2026-10-10 §B1), but rule D3 says a field
marked absent anywhere needs a value on at least two products. `verifyGate`
(`packages/app/src/lib/site/verification-model.ts`) stops with "Rating needs a value on at least two
products" and `bindingProblems` (`packages/api/src/verify/binding-input.ts`) refuses the save with
the same words. A field absent on every product therefore has no way through. The project's dataset
owns the field (spec 2026-09-09 §4), so the customer cannot drop it for one website either.

Behind the rule there is a second trap. If the binding were let through today, `certifyCandidates`
would see no page with a value: every candidate is "correct" (empty) on every page, so a cached
domain path that reads nothing on the proof pages would certify as one layout and read whatever it
finds at scale.

**Rule.**
- A field is **not on this website** when every proof page it is checked on is marked "not on this
  product", products 1–3 included, and no page carries a value. Products 4–6 may be absent or blank.
- Such a field passes Verify without a path. `certify` returns before evaluating any candidate:
  `certified: []`, every captured checked page `{ status: 'pass', found: '' }`, `notOnWebsite: true`,
  `aiCalled: false`. No search, no AI.
- D3 still holds for a field with some values: absent on some products and a value on exactly one
  is refused, as today.
- A run leaves the field empty on every product. With no paths it never reaches the coverage
  check's sample (which only reads fields with paths) and never blocks a product's readiness.
- A field passed this way is current like a default-only field (`current-certification.ts`), so
  Extract unlocks.
- Changing any cell back to a value changes the field's hash; the field then verifies as usual.
- A default and "not on this product" still never coexist (spec 2026-10-13 §3).

**Copy.**
- Row word beside the verified badge: `not on this website · left empty on every product`.
- The D3 reason at the gate: `{Field} needs a value on at least two products, or "not on this product" on every one`. The server's problem says the same after `{Field}: `, as its other problems do.
- Ops, a website's field: `no path — not on this website, left empty`

**Tests.**
- certify: all three pages absent with a cached path that reads nothing → `certified: []`,
  `notOnWebsite: true`, every cell passes; with a cached path that reads a value on one page, the
  same (no path is ever certified for such a field).
- certify: two absent and one value → unchanged from today.
- run-verification: an all-absent field makes no AI call and counts as passed in `allPassed`.
- bindingProblems: all absent on 1–3, blank on 4 → no problem; absent on two, a value on one → the new D3 text.
- verifyGate: all absent → ok; two absent and one value → the new D3 text.
- current-certification: a `notOnWebsite` result whose cells all pass is current.
- badge reads verified; the row word shows only while the field is unchanged.

## 3. A suggestion on products 4–6 with a default (item 2)

**Cause.** `verifyGate` skips a blank cell on products 1–3 when the field has a default (spec
2026-10-13 §6, Task 5 ruling), but its products 4–6 branch returns
`{Field} has a suggestion to confirm on product {n}` for any live suggestion, default or not.
Marko met it on gymshark: "Re-verify Brand has a suggestion to confirm on product 4", button
disabled.

**Rule.** On products 4–6, as on 1–3, a blank cell of a field with a default is a default cell: a
pending suggestion there never blocks. Certification already tries every candidate on a default
cell (spec 2026-10-13 §4), so a suggestion equal to the default certifies its path and one that
differs leaves the row needs-you with Accept visible, as on products 1–3.

**Copy.** None new. The existing reason stays for a field with no default.

**Tests.** verifyGate: Brand with default "Gymshark", a live suggestion on product 4, no answer →
ok. The same without a default → the existing reason.

## 4. The shop's name as a brand (item 3)

**Cause.** A brand typed the same on every proof page is a weak field (`isWeakField`,
`field-fit.ts`): only a confirmed path, a marked element or a structured path whose name fits the
concept may certify it. The brand vocabulary (`CONCEPT_PATHS.brand`) lists `brand.name`, `vendor`,
`manufacturer` and similar, but neither `og:site_name` nor the offer's seller. So on gymshark
(`brand.name` is "Gymshark | We Do Gym", `og:site_name` is "Gymshark") and sigmabeauty ("Sigma
Beauty" in `og:site_name` and `offers.seller.name`) the honest brand is never a candidate, and the
cell reads "Not found on this page". The suggestion side (`suggestMarks`) uses the same vocabulary,
so it never offers the shop's name either.

**Rule.**
- `og:site_name` and `seller.name` join the brand vocabulary, last, after every product-level path.
  The suggestion order lists `brand.name` first, and certification ranks JSON-LD before meta, so a product-level brand wins wherever it exists and is right.
- Nothing else changes: the candidate must still read the customer's value on every proof page it
  is checked on. A multi-brand shop's name cannot certify for products of other brands, since it is
  wrong on their pages.
- On kith the suggestion stays "Kith Women" (`brand.name` exists and ranks first). Typing "Kith"
  now certifies through `og:site_name`.

**Copy.** None.

**Tests.**
- pathFitsConcept: brand fits `og:site_name` and `offers.seller.name`; product_name still does not fit `og:site_name`.
- certify: three pages with `og:site_name` "Gymshark" and `brand.name` "Gymshark | We Do Gym",
  typed "Gymshark" ×3 → certified `[og:site_name]`.
- suggestMarks: a page with no brand in its data and `og:site_name` "Sigma Beauty" suggests
  "Sigma Beauty"; a page with `brand.name` suggests that.

## 5. "Several places match" where the value was found (item 4)

**Cause.** The cell reason `ambiguous` (`certifyCandidates`) is not about several places on one
page. It is given to a page where some candidate reads the right value but no certification came
out: either another page could not be covered, or the candidates right here read something else on
another page. The customer reads "Several places match. Add what makes yours different to the
description." Rewriting the description changes nothing, because the description does not take part
in certification.

Two paths reach it:
- **Another page is the problem.** Skullcandy Brand: products 2–3 read "Skullcandy" from
  `brand.name`, product 1 has no such data and its vendor says "Skullcandy US". `brand.name` is safe
  (right on 2–3, empty on 1), but nothing covers product 1. Products 2–3 should read as found, and
  product 1 carries the diagnosis. A safe path already turns a page green in that case, but only with
  more than three proof pages (spec 2026-09-17 §9 property 4 kept three-page cells unchanged).
- **The value is in a different place on each product.** Puma's typed style codes and ruggable's
  price: each page has an element showing the value, but no one XPath reads it on every product. The
  honest next step is to mark it, so its element joins the candidates (spec 2026-09-18 §3.5).

The near misses shown with the reason can also equal the expected value (skullcandy's
`["Skullcandy"]`), which reads as nonsense.

"Identical candidates" in the campaign notes is this: the same value reached by several paths on one
page, none of which works on every product. The board's own count of places (`placesOf`) already
treats a structured value shown in several identical places as one place, so the board side needs no
change.

**Rule.**
- A page where a safe candidate reads the right value passes, whatever the number of proof pages.
  The field still fails while any page fails, and the badge still names the failing products.
  The two-of-three diagnosis keeps precedence (spec 2026-09-17 §9 property 3).
- `ambiguous` keeps its name in stored results, but its copy says what happened and what to do.
- Near misses equal to the page's expected value are left out.

**Copy.** `ambiguous`: `Found on this product, but not in the same place as on the others. Mark it on the screenshot.`

**Tests.**
- certify, three pages, the skullcandy shape → products 2–3 `pass` with `brand.name`, product 1
  `different_value` "Skullcandy US", nothing certified.
- certify: a page where the only correct candidates are wrong on another page → `ambiguous`.
- certify: no near miss equals the page's expected value.
- hintFor('ambiguous') returns the new copy.
- The existing three-page fixture tests that pinned `ambiguous` on a covered page are updated to
  `pass`, each one listed in the task's report.

## 6. Marked values come back altered (item 5)

**Cause.** A mark is built in the app from the box map (`valueFromBox`, `box-map.ts`) and checked at
Verify by reading its XPaths (`buildXPathProbeScript`). The two read different things:

- **Text.** The box map keeps an element's own text nodes only, cut at 500 characters. The probe
  reads the whole `textContent`. A paragraph with links (skims) or a long description loses words in
  the stored value, then fails against what its own XPath reads.
- **Images and links.** A mark's XPaths point at the element. For `<img>` the probe then reads the
  element's text, which is empty, so a marked image can never certify (glossier: "Not found on this
  page"). The box value is also `currentSrc`, the rendition the browser chose from `srcset`, which
  may be another file than the `src` attribute. Glossier's doubled query string comes from there.
- **Labels.** A marked line "Style: 398846_01" is stored whole (puma), so every row of the run
  carries "Style: ". Typing "398846_01" instead removes the mark: the cell's `onType` stores
  `{ value, mark: null }`, and the server drops any mark whose text does not equal its value.

**Rule.**
- The box map's `text` is the element's whole `textContent`, whitespace collapsed, up to 2,000
  characters (the server's mark limit). Only elements with some text of their own are kept, as today,
  so containers do not multiply.
- An image box's `src` is the element's `src` attribute, resolved (`img.src`); `currentSrc` only when
  there is none. A link box keeps `href`.
- An image mark is read through `/@src`, a link mark through `/@href`, so the probe reads the attribute.
  The engine adds the suffix when a mark becomes a candidate, so marks stored before this change
  work without re-marking.
- **A leading label.** For fields whose concept is `sku`, `brand`, `availability`, `rating`,
  `review_count` or `currency`, a marked text of the form `Label: value` (a label of at most 30
  characters with no digits, then a colon) stores `value`. The mark keeps the element and its whole
  text. Titles, descriptions and custom fields never lose text: "Star Wars: The Mandalorian Tee"
  stays whole.
- Certification reads such a mark through a new transform, `after_label`, which strips the same
  label. The transform is only used for mark XPaths; structured paths and the DOM search never
  infer it, and the AI is never offered it.
- The server keeps a mark whose text, or whose text after its label, equals the value.
- Retyping a marked cell keeps the mark when the typed value equals the mark's text or its text after
  the label. Any other typed value drops the mark, as today, so a mark never points at another value.

**Copy.** None new.

**Tests.**
- afterLabel: "Style: 398846_01" → "398846_01"; "Art.-Nr.: 12345" → "12345"; "Star Wars: The
  Mandalorian" untouched when the concept is product_name; "Top 5: great" untouched (digits in label).
- applyTransform('after_label') on the same strings.
- gatherCandidates: an image mark yields `…/@src` candidates; a stored mark without the suffix gets it.
- gatherCandidates: a sku mark yields an `after_label` candidate beside the identity one.
- certify: three sku marks on "Style: …" lines with typed "398846_01" values → certified with `after_label`, cells found "398846_01".
- bindingProblems/prepareBinding: a mark whose text is "Style: 398846_01" with value "398846_01" is kept.
- valueFromBox: sku box "Style: 398846_01" → value "398846_01" with the mark; an image box reads `src`.
- the typed-cell rule keeps the mark on a typed "398846_01" and drops it on "123".
- box map (Chromium test): a paragraph with a link keeps the link's words; an image with a `srcset` reports its `src`.

## 7. Rounded numbers (item 6)

**Cause.** `valuesEqual` (`packages/scraper/src/verify/normalize.ts`) compares normalised numbers
exactly. Ruggable's widget shows 4.8; its JSON-LD holds 4.7610064. The typed 4.8 never matches, so
the rating cannot certify from the page data.

**Rule.**
- For `number` fields, a value with d ≥ 1 decimals equals a value with more decimals when the
  difference is at most half a unit of the d-th decimal (4.8 matches 4.75 to 4.85). The comparison is
  symmetric.
- A whole number never rounds: "5" does not match 4.6. Money is unchanged.
- The run stores the page data's value (4.7610064), as it does for every certified structured path.
  The run's shown check already counts 4.761 as shown when the page prints 4.8 (`renderings` in
  `shown-on-page.ts` includes one and two decimals).

**Copy.** None.

**Tests.**
- valuesEqual('number', 4.7610064, '4.8') true; ('4.9', 4.7610064) false; ('5', 4.6) false; ('4.80', 4.8) true; money ('4.8', 4.7610064) false.
- certify: typed 4.8 / 4.6 / 4.9 against data 4.761 / 4.57 / 4.93 → certified `aggregateRating.ratingValue`.

## 8. The cost label and the address warning (item 7)

**The estimate. Cause.** The Verify button shows `fields × EST_AI_COST_PER_FIELD_USD` with $0.05 per
field. One AI call reads every checked proof page's capture, and the campaign's calls cost
$0.08–$0.17:

| Site | Label | Spent | AI calls | Pages |
|---|---|---|---|---|
| skims | Re-verify 1 field · up to $0.05 | $0.1521 | 1 | 3 |
| ruggable | Re-verify 2 fields · up to $0.10 | $0.2235 | 2 | 3 |
| skullcandy | Re-verify 8 fields · up to $0.40 | $0.3317 | 2 | 4 |
| sigmabeauty | Verify 8 fields · up to $0.40 | $0.1031 | 1 | 3 |

**Rule.** The estimate is per AI-reachable field per checked proof page:
`EST_AI_COST_PER_FIELD_PAGE_USD = 0.06`. A three-page field reads up to $0.18, which covers the
largest three-page call seen ($0.1521); a four-page one $0.24. The rest of `verifyEstimate` (which
fields can reach AI, the free cases) is unchanged. `perFieldUsd` in its result becomes the per-field
figure for the source's page count.

**Only staff see it.** Marko, 2026-10-17: "once we have paying customers we don't want to show any
price to the customer. We will have a different payment plan, to be decided later." The estimate stays
honest for staff and is never shown to a customer (§8a). A customer reads `Verify 8 fields`; staff read
`Verify 8 fields · up to $1.44`. The "up to" figure is a worst case, every field needing the AI.

## 8a. Customers see no money (item 7, Marko's decision)

**Rule.**
- A customer sees no money amount anywhere in the app, and no "free" either: a word about price
  promises something about a payment plan that is not decided.
- Staff see every amount as today. Staff means an operator, or a staff session inside the customer's
  org: `session.isOperator || !!session.staff`, the test the site route already uses for staff-only
  readings.
- One pure helper decides it: `showsMoney(session)` in `packages/app/src/lib/money-visibility.ts`.
  Every customer-facing amount goes through it. Ops screens are staff-only already and stay as they
  are.
- The places, found by searching the app for dollar formatting, `Usd`/`cost`/`spend` values and the
  word "free" in labels:

| Place | Customer reads | Staff read |
|---|---|---|
| Verify button (`lib/site/verify-button.ts`) | `Verify 8 fields`, `Re-verify 2 fields`, `Verify variants` | today's label, with `· free` or `· up to $X` |
| Address warning button (§8) | `Re-verify this field` | `Re-verify this field · free` |
| Repair preview summary (`lib/site/backfill-preview.ts` `previewSummary`, in `components/runs/backfill-panel.tsx`) | `12 pages` | `12 pages — up to ~$0.36 if no cache answers` or `— free` |
| Extract sample description (`components/extract/extract-sample.tsx`) | the sentence without `No AI. Free.` | today's sentence |
| Usage page total (`components/usage/usage-total.tsx`, `routes/_app/usage.tsx`) | pages captured this month, no spend | spend and pages |
| Usage table (`components/usage/usage-table.tsx`, `lib/usage-view.ts`) | no Spend column | the Spend column |
| Usage page empty text (`routes/_app/usage.tsx`, "its spend will show here") | words about pages, not spend | today's text |
| Robot staff activity in the customer's Settings (`lib/staff-view.ts` `formatStaffEntry`, `components/staff/staff-activity-list.tsx`) | no cost after an entry | `· $1.24` when the run spent something |

- The org runs list (`lib/org-runs-view.ts`) carries `costUsd` on its rows but renders no amount
  (`OrgRunView` has no cost). It stays that way; a test pins that the view has no cost.
- The Extract strip (`components/extract/extract-strip.tsx`) and the run pages show no amount today.
  The route smoke pins that.

**Tests.**
- `showsMoney`: a customer session false; an operator true; a staff session in a customer org true.
- Each place above: its pure view function hides the amount for a customer and shows it for an
  operator and a staff session.
- The route smoke, signed in as a customer, finds no `$` followed by a digit on the Verification tab,
  the Extract tab, a run page and Usage.

**The address warning. Cause.** The 2026-10-14 warning ("reads the first variant, not the one the
address names on product n") shows on a certified field whose proving path indexes a variant list.
It offers no action, and the main Re-verify skips the field, because the field is current. Even a
forced re-verify would keep the old path: the domain-cache shortcut in `runVerification` certifies
from the cached paths first, and a path the customer accepted from a suggestion is ranked first
(`rankConfirmedFirst`), so its `[page]` twin never wins.

**Rule.**
- The warning carries a button, `Re-verify this field` (staff read `Re-verify this field · free`, §8a),
  which runs Verify for that field alone (`onlyKeys: [key]`). The button is disabled while anything runs.
- In `runVerification`, a cache-shortcut result is not kept when one of its certified paths has a
  fixed index on a variant list and a proof page's address names a variant. The field then searches
  like any other, and the search's `[page]` paths join the candidates.
- A `[page]` path counts as confirmed when its fixed-index twin was confirmed, so it ranks first among
  the confirmed paths, as it does among the rest (spec 2026-10-14 §4).
- If no `[page]` path reads the right value, the old path certifies again and the warning stays.
  It is still free: the old path is among the candidates and still correct, so no AI is called.

**Copy.** Customer `Re-verify this field`; staff `Re-verify this field · free`.

**Tests.**
- verifyEstimate: one AI-reachable field on three pages → `upperBoundUsd` 0.18; on four → 0.24.
- The Verify button's label carries the amount for staff only (§8a).
- A test pinning that the three-page figure covers the largest call seen (0.1521).
- run-verification: cached `offers[0].price` on pages whose address names a variant → the shortcut
  is not kept, search finds `offers[page].price`, certified first.
- certify: confirmed `offers[0].price` and candidate `offers[page].price`, both correct → `[page]` first.
- The status cell renders the button with the warning, and it calls Verify with that one key.

## 9. Copy table

| Where | Text |
|---|---|
| Row word, field not on this website | `not on this website · left empty on every product` |
| D3 reason, gate | `{Field} needs a value on at least two products, or "not on this product" on every one` |
| D3 problem, server | `{Field}: needs a value on at least two products, or "not on this product" on every one` |
| Ops, field not on this website | `no path — not on this website, left empty` |
| Cell hint, `ambiguous` | `Found on this product, but not in the same place as on the others. Mark it on the screenshot.` |
| Address warning button, customer | `Re-verify this field` |
| Address warning button, staff | `Re-verify this field · free` |
| Verify button, customer | `Verify {n} fields`, `Re-verify {n} fields`, `Verify variants` (no price word) |
| Verify button, staff | today's label with `· free` or `· up to ${X}` |
| Repair preview, customer | `{n} pages` |
| Usage, customer | pages captured; no spend, no Spend column |

No customer string names a tool, a model or a mechanism, and none shows money (memory rule
`customer-copy-no-internals`; Marko, 2026-10-17, on prices).
"Page data" and "the screenshot" are already customer words on this tab.

## 10. Safety properties

1. A field not on this website never certifies a path, so it never writes a value at scale. That
   holds even when a cached path reads something on a proof page.
2. A field absent on some products and valued on one is still refused (D3).
3. The shop's name certifies as the brand only when it equals the customer's value on every proof
   page the field is checked on. It is never certified as a page's brand where the page shows another.
4. A page turning green under §5 never changes whether a field certifies. Only the cells change,
   and the badge still names every failing product.
5. A label is stripped only for the six listed concepts, and only a digit-free label of at most 30
   characters before a colon. A title or a description is never shortened.
6. A mark is kept on retype only when the element still shows the typed value.
7. Rounding applies only to numbers with at least one decimal. A whole number, money, and every
   other type compare as today.
8. Every result, set and estimate with none of the new fields behaves as today. `notOnWebsite` is
   omitted, never written as `false` or `undefined`.
9. The address warning's re-verify can only replace a fixed-index path with its `[page]` twin or
   certify the same path again. It never calls AI.
10. A customer session never sees a money amount or a price word in the app. Every amount reaches
    the screen through `showsMoney`; an operator and a staff session see them as today.

## 11. Not in this spec

- Running the AI fallback when every cell is `no_fitting_path` (gymshark, thomann). §4 removes the
  gymshark case. The rule against guessing a weak field stays.
- Silent failures at Verify: skims' HTTP 412, skullcandy's time-out, ridge's typed description with
  no reason.
- Typed style codes found by the DOM search behind a label (puma typed, not marked). Marking works
  after §6.
- Captures that open overlays over the place to mark (thomann). Captures are a separate group.
- Storing a rating rounded to the precision the customer typed.
- Removing amounts from the API's answers to a customer session. The app hides them, but
  `verifyEstimate`, `usage` and `runs.listByOrg` still send them; a customer could read them in the
  browser's developer tools. It belongs with the payment plan.
- Customer copy that names "AI" without a price (`reExtractLabel`, "AI only where the cache can't
  answer"). It is a `customer-copy-no-internals` matter, not money.
- The UX polish Marko will describe. It is the plan's last code task and starts only once he has
  said what it covers.

## 12. Recommended decisions

1. **Estimate per page at $0.06, staff only.** Decided by Marko 2026-10-17: customers see no price.
   For staff, an eight-field first Verify on three pages reads "up to $1.44". That is a worst case,
   every field needing the AI; real first Verifies in campaign 2 cost $0.00–$0.33. An upper bound
   that is never exceeded beats one exceeded 3×.
2. **The shop's name as a brand path**, ranked last. Recommended; the safety holds through the
   per-page check (§10 property 3).
3. **Labels stripped for six concepts only.** Recommended. A wider rule would shorten titles with a
   colon.
4. **Rounded ratings store the page data's precise value.** Recommended; no other path is rounded.
5. **"Not on this website" through three cell answers**, with no row-level button in this spec. A
   row action ("Not on this website" for every product) belongs to the UX polish task if Marko
   wants it.
