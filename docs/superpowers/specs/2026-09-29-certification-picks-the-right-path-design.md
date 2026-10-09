# Certification picks the right path — design

**Date:** 2026-09-29. **Status:** agreed in conversation with Marko (2026-09-28/29),
spec for review. Changes certification (`packages/scraper/src/verify/certify.ts`
and its callers) and the Verification tab's answer rules
(`2026-09-28-table-first-and-drift-repair-design.md` Part A, now on `main`).
Nothing else about verification changes: proof pages, answers, the gate, the
autosave, Verify, extraction at scale.

## 1. Why — what Ikea showed (2026-09-28, Marko's own run, read-only)

| Field | What happened | Cause |
|---|---|---|
| In stock | certified `api → priority` (value `1`) and `api → [n].cashAndCarry`, not `json-ld → offers.availability` | a yes/no value matches any field that is 1/true on every proof page; API outranks JSON-LD; nothing checks the path *means* stock |
| In stock | product 1 saved `https://schema.org/InStock`, products 2–3 saved `Available` | ticking product 1 carried the answer, and the carry **replaced** products 2–3's JSON-LD suggestions with `1` from `api → priority`; the customer then clicked the visible text instead |
| Main image | fails on all three products (the badge said "product 1") | product 1's answer came from a click: `…_s5.jpg?f=s` (a size parameter); JSON-LD says `…_s5.jpg`; image URLs are compared exactly, so nothing is correct on all three pages and pages 2–3 fall through to `ambiguous` |
| Main image | a near miss stored as `[object Object]` | a JSON-LD `ImageObject` was turned into text |
| Clicks | 24 to an enabled Verify (plan 5: 43) | 21 of them on three rows — Price and In stock ("comes from different places", product 3 is a combination with variants), SKU ("found in 2–3 places") |

The first row is the serious one: at scale an out-of-stock product whose
`priority` is still 1 would be reported **in stock**, silently. The same
weakness applies to every field whose proof pages share one value (yes/no
fields, Brand, currency).

Rule kept, at Marko's request: **API stays the first-ranked source.** The
changes below decide *which* API (or JSON-LD, meta, page) paths may compete,
not the order among those that may.

## 2. Certification

### C1. The path the customer confirmed is remembered and tried first

- When the customer accepts a page-data or carried suggestion (tick, Accept,
  Accept all), the answer keeps the suggestion's path: the verification set
  gains `paths[key][url] = { source, path }`, beside `marks`. Round-tripped by
  `updateBinding` like marks (a whole-record save); dropped when the answer's
  value changes (typed over, re-marked) exactly as a stale mark is.
- `fieldHash` covers `paths` like it covers marks, so changing a confirmed
  path makes the field not current.
- `gatherCandidates` adds every confirmed path as a candidate. Among the paths
  that are safe and correct on every proof page, **a confirmed path is
  certified first**; the ranking (API, JSON-LD, meta, page) orders the rest.
- A confirmed path is still only a candidate: it must be correct or empty on
  every checked page, like any path.

### C2. Weak fields need a path that fits the field

A field is **weak** when a value match cannot tell paths apart:
- its type is yes/no, **or**
- every proof page's expected value normalises to the same value (today's
  `weakEvidence`).

For a weak field, a candidate may be certified only if it is:
- a **confirmed path** (C1), or
- a **mark's XPath** (the customer pointed at the element), or
- a **structured path that fits the field's concept**: its tail matches the
  concept's vocabulary (`CONCEPT_PATHS` in `suggest-marks.ts`, moved to one
  shared module and extended — availability: `availability`, `inStock`,
  `in_stock`, `isAvailable`, `is_available`, `stock`, `stockStatus`,
  `stock_status`, `available`, `buyable`, `purchasable`; brand, currency as
  today).

Unmarked DOM hits and structured paths that do not fit are dropped for weak
fields. When nothing is left, the cells fail with a new reason,
`no_fitting_path`: hint "We can't tell which value on this page is {field} —
mark it on the screenshot" (and the row reads "needs you" on the tab).

A field with no concept (a custom field without a catalogue entry) is weak
only by the same-value rule, and then only confirmed paths and marks qualify.

### C3. Images are the same image when host and path match

`valuesEqual` / `normalize` for type **image** compares scheme-less
`host + path`, ignoring the query string and the fragment
(`…_s5.jpg?f=s` = `…_s5.jpg`). Type **url** keeps today's exact comparison
(a query string can be the page's identity). Applies everywhere the engine's
comparison runs: certification, suggestions, transfers, the tab.

### C4. Structured values that are objects are read, never stringified

For image and url fields, an object value yields its `url`, `contentUrl` or
`@id` (in that order), in `resolveStructured` and the structured search. No
cell result (`found`, `nearMisses`) ever stores `[object Object]`: objects
are read as above or left out.

### C5. The verdict names every failing product

The badge reads "fails on product 1", "fails on products 1 and 3",
"fails on products 1, 2 and 3".

## 3. How answers are collected (the Verification tab)

### A1. A carried suggestion never replaces a page-data one

`mergeSuggestions` with origin `from-product` skips a cell that holds a
page-data suggestion. A carry fills only products with no suggestion.

### A2. The carry follows C2

`transferMarks` applies the same fit rule to its candidates for weak fields
(one shared function with certification), so a tick on In stock carries
`offers.availability`, never `priority`.

### A3. Clicking the outlined element accepts its suggestion

When the customer clicks an element that the chosen field's suggestion
outlines on this product, the click is treated as accepting that suggestion:
the suggestion's value and path are saved (C1), with the element as its mark.
Clicking any other element saves the element's text, as today.

### A4. "Comes from different places" names the odd product

When the suggestions on products 1–3 disagree on their path but **two or
more share one path**, the row reads "different place on product n — check
it" and **Accept** takes the majority's cells only; product n's cell stays
orange with its own suggestion. Accept all includes the majority part of such
rows. (Ikea: Price and In stock, products 1–2 accepted, product 3 — the
combination — left for a person, which is where a person belongs.)

### A5. Several places, one structured value, is one place

A suggestion whose path is structured (API, JSON-LD, meta) and whose outlined
elements all show that same value counts as **one place**; it is accepted
without a mark (the path is the evidence, C1). Suggestions found by the page
search keep today's "found in n places" rule.

Zero boxes is not one place: since 2026-10-09 such a suggestion makes the row
`needs-you` ("only in the page data on product n").

### A6. Yes/no fields

- **Same on every product** does not apply to yes/no fields (every product in
  stock is normal); C2 protects certification instead.
- Cells show a yes/no value normalised: "In stock" / "Out of stock" for the
  availability concept, "Yes" / "No" otherwise. The saved value stays as given
  (it is the evidence).

### A7. Accept one cell without opening the screenshot

An orange cell whose suggestion is one place (A5) shows a ✓ on hover and
focus (`aria-label="Accept {field} on product {n}"`): one click accepts it,
as a tick would. The screenshot stays one click away for anything else.

## 4. Existing verified websites

The rules change which paths may certify. Nothing is re-certified
automatically:
- A read-only audit (`pnpm --filter @robot/api exec tsx src/scripts/audit-certified-paths.ts`)
  lists, per website, the fields whose current certified path would not
  qualify under C2 (e.g. Ikea's In stock on `priority`), without writing.
- The customer re-verifies those fields from the tab (free when the paths are
  mechanical). The audit's output goes in the handoff.

## 5. Testing

- **Unit (scraper):** C2 on a fixture where an unrelated API field equals 1 on
  every page next to `offers.availability` → certifies `offers.availability`;
  nothing fitting → `no_fitting_path`; a confirmed path wins over a
  higher-ranked fitting path; C3 image equality with and without a query,
  url still exact; C4 an ImageObject; C5 the badge text.
- **Unit (app):** A1 a carry never replaces a page-data suggestion; A3 a click
  on an outlined element saves the suggestion's value and path; A4
  majority/odd-product status and Accept; A5 one place; A6 no
  same-everywhere for yes/no and the display words.
- **API:** `paths` round-trips through `updateBinding`, is dropped with a
  changed value, and moves `fieldHash`.
- **Live, free** (keyless :4100, throwaway identity, the same Ikea Cabinets
  products): In stock certifies `offers.availability` (or an API path whose
  name fits); Main image verifies on all three; clicks to an enabled Verify
  recorded (expected ≈ 7, from 24).
- **Audit:** run once against the local database (read-only) and record the
  result.

## 6. Not in this design

- Variants (a separate design; Marko 2026-09-29: the customer chooses variant
  handling at setup — usually one row per variant — and a run never stops to
  ask). This spec's A4 leaves combination/variant products to a person.
- Jev (parked).
- Changing the source order (API stays first).
- Drift repair (Part B of the 2026-09-28 spec).

## 7. Decisions to confirm

1. A confirmed path goes first among the paths that qualify, ahead of a
   higher-ranked one — the customer's evidence beats the default order.
2. "Weak" means yes/no fields **and** any field whose proof pages share one
   value.
3. Yes/no cells show "In stock / Out of stock" (availability) or "Yes / No".
4. Existing websites are audited and re-verified by the customer, never
   re-certified automatically.
