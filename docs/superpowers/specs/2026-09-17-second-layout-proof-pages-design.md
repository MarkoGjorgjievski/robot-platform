# Second layout, first increment: extra proof pages — design

**Status:** approved by Marko 2026-09-17 with all three recommendations (D1 six pages, D2 one-page evidence allowed and flagged, D3 blanks only on pages four to six). Builds the "cheap
version" of `2026-09-11-second-layout-learning-design.md`: no AI discovery, no
new vendor. The customer certifies a second layout with the gesture they
already know: a proof page and an expected value.

## 1. The problem, restated

A run over three listings, 600 products. On some products of the third
listing, `price` comes back empty because those pages carry a different layout
or JSON-LD shape. Today the cells stay empty, nothing learns, and a handful of
misses stays under the drift threshold (`DRIFT_MISS_SHARE` 0.2), so nothing is
flagged either. The customer has no way to fix it: a website has exactly three
proof pages, and `certify` only certifies a path that is correct on all of
them, so a page of the second layout cannot be added without breaking the
first.

## 2. What changes, in one paragraph

A website may have three to six proof pages. A field certifies when its paths
together cover every proof page it has an expected value on, and no chosen
path is ever wrong on any of them. The run page groups a run's empty cells by
field and by listing and offers "Use as proof page" on a missed product. That
opens the Schema tab with the product as a fourth page; the customer types the
one missing value and verifies. The existing backfill then re-fetches only the
missed products. Extraction at scale is unchanged: it already tries a field's
certified paths in order and takes the first that resolves.

## 3. The certification rule (`packages/scraper/src/verify/certify.ts`)

Today: a candidate certifies iff it is correct on every captured page; the
certified list is those candidates, ranked (api, json-ld, meta, xpath; shorter
first), capped at `MAX_CERTIFIED_PATHS` (5).

New, for a field with expected values on pages P:

- A candidate is **safe** iff on every page in P it is correct or resolves to
  nothing. A candidate that resolves to a wrong value anywhere in P is never
  certified, whatever else it gets right. This is what makes an ordered list
  safe at scale: on a proof page, no chosen path can win with a wrong value.
- The field **certifies** iff some set of at most 5 safe candidates covers P:
  every page in P has at least one chosen candidate correct on it.
- **Selection.** If any safe candidate is correct on all of P, the result is
  exactly today's: all such candidates, ranked as today, capped at 5. A
  website with one layout certifies byte-for-byte as it does now. Otherwise,
  greedy cover: repeatedly take the safe candidate correct on the most
  still-uncovered pages (ties by today's rank) until P is covered or 5 are
  chosen. The chosen list is ordered by pages covered, then today's rank.
- When a field needed more than one layout, each certified path records the
  pages it was proven on (`provenOn: string[]`, optional on `CertifiedPath`,
  ignored by `pathId` and by extraction). A one-layout result carries no
  `provenOn`, so it stays byte-for-byte what it is today. The
  Schema tab's cell line reads "from json-ld" as today; a field with more than
  one layout adds "· layout 2" on the pages the second path proved.
- **One-page evidence.** A path proven on a single page is weaker than one
  proven on three: several nodes can hold the same value on one page. The
  result carries `thinEvidence: true` for a field any of whose paths has
  `provenOn.length === 1`, and the status strip says "price: second layout
  proven on one page · add another page of that layout to be sure". It does
  not block certification. (Decision D2.)
- Cell results keep their four fail reasons. A page no chosen path covers
  fails as today (`not_found`, `different_value`, `type_mismatch`,
  `ambiguous`), computed against the best safe candidate for that page.

`runVerification` needs no structural change: it already certifies from the
cached paths first and searches only when that fails, so after a fourth page
is added the seven unaffected fields re-certify from their stored paths with
no search and no AI, and only the missed field searches page four.

## 4. Proof pages: three to six, blanks allowed on the extra ones

- `VERIFY_URL_COUNT = 3` becomes `VERIFY_URL_MIN = 3`, `VERIFY_URL_MAX = 6`
  (Decision D1). `bindingInput.urls` is `.min(3).max(6)`.
- The first three pages are as today: every field needs an expected value on
  each. On pages four to six a blank cell means "not checked here": the
  customer adds a page for one field without having to type the other seven.
  `bindingProblems` enforces this; `validateExpectedClient` mirrors it.
  (Decision D3.)
- A field's pages P (section 3) are the pages it has a non-blank expected
  value on. `fieldHash` hashes P instead of all urls, so adding a page for
  `price` leaves the other fields current. `previousIsStale` becomes per
  field for the same reason: a stored result is reusable when the field's own
  pages and expected values are unchanged.
- `weakEvidence` (all expected values identical) is computed over P.
- `allPassed` is unchanged in meaning: every field certified and every
  checked cell passing.

## 5. The run page: where the customer finds out

`crawl.coverage` already reports per-field filled and missing counts and the
gap items; the run page already renders them (`BackfillGapsPanel`). Added:

- **`crawl.misses({ runId })`**: for each field with empty cells, the count,
  and the misses grouped by the listing each product came from. Every run
  item already carries it (`run_items.input_values.url`, e.g. the Ikea run's
  items all read `{"url": ".../cat/two-seater-sofas-10668/"}`); items without
  one (product urls given directly) form a single "given directly" group. Each
  group has its count and up to ten product urls. No schema change.
  Confirmed-absent cells are excluded, as in coverage. Pure read.
- **On the run page**, for a verified website, above the gaps panel: one line
  per field, e.g. "price is empty on 38 products · 36 from
  /cat/two-seater-sofas · 2 from /cat/armchairs". Expanding a group lists its
  products (opens in a new tab) each with **Use as proof page**.
- **Use as proof page** navigates to the website's Schema tab with
  `?addPage=<url>&field=<key>`.

## 6. The Schema tab: the fourth column

- The grid already maps its columns over `state.urls`; `URL_COUNT` becomes the
  minimum. After the last page column: **Add page** (hidden at six). Pages four
  to six have a remove control in their header popover; the first three do not.
- Arriving with `?addPage`: the page is appended (or focused if already
  present), the named field's cell on it is focused, and a one-line note above
  the grid says "Added from run <date>: type what price should be on this
  page, then verify." Blank cells on that column read "not checked".
- Verify pricing must stay honest. `verifyEstimate` prices as AI-reachable
  only the fields whose last result has no certified path. That is wrong once
  pages can be added: `price` has a certified path from pages 1–3, yet page
  four may need AI if the mechanical search finds nothing there. New rule: a
  field is AI-reachable when its last result has no certified path **or** its
  `fieldHash` no longer matches (its pages or expected values changed). The
  label then reads "up to $0.05" for the one field, and "free" only when that
  is true. The budget rule stands: never click a Verify that shows a dollar
  amount without Marko's say-so.

## 7. Repairing the run

The backfill path already works for a verified website: `crawl.backfill`
requires certification, creates the child run with `target_fields`, and
`extract-item.ts`'s certified branch honours that focus and merges into the
parent. After a successful verify the run page's gaps panel is the repair:
"Re-fetch 38 products for price". Two copy changes for a verified website:
the estimate reads "free" (certified paths never call AI; today it shows an
"up to" AI figure), and the dead-field strategy choice is hidden (it is an
analysis-chain concept).

## 8. What does not change

- `runVerifiedExtraction`: tries a field's paths in order, first resolving
  value wins, a miss is an honest miss. No fallback, no discovery.
- The rule that only a certified path fills a customer's cell.
- Path stats per host (`recordVerifiedPathStats`) and drift.
- Verification of the first three pages, including its capture settings.

## 9. Safety properties the tests must pin

1. One layout: `certify`'s output for every existing fixture is unchanged.
2. Two layouts: pages 1–3 proven by path A, page 4 by path B; A resolves to
   nothing on page 4 → certified `[A, B]`, all cells pass.
3. A resolves to a **wrong** value on page 4 → A is not safe; the field does
   not certify with A in the list, and page 4's cell fails `different_value`.
   This is the case that would silently corrupt a run, and it must fail loud.
4. Nothing covers page 4 → the field does not certify; pages 1–3 still show
   pass cells against the best safe candidate so the customer sees what works.
   (Only with more than three pages: a three-page field's failure cells stay
   exactly as they are today.)
5. A blank cell on page 4 for field X: X's pages are 1–3, X's hash is
   unchanged, X's stored result is reused without a capture-dependent search.
6. Blank on pages 1–3 is still a validation error.
7. `misses` groups by listing and excludes confirmed-absent cells.
8. At scale, `[A, B]` on a layout-2 page yields B's value; on a layout-1 page
   A's (an existing property of `runVerifiedExtraction`, pinned explicitly).
9. `verifyEstimate` counts a field with a changed hash as AI-reachable, and
   reads free when only unchanged, certified fields are in scope.

## 10. Files

- `packages/scraper/src/verify/`: `certify.ts`, `types.ts`, `constants.ts`,
  `run-verification.ts` (+ tests; new fixture page `shop-example/p4` with a
  second layout)
- `packages/api/src/verify/binding-input.ts`, `routers/sources.ts` (the
  estimate and status readers that assume three), `routers/crawl.ts`
  (`misses`), `crawl/coverage.ts` or a new `crawl/misses.ts` (+ tests)
- `packages/dashboard/src/lib/schema-grid.ts`, `schema-tab-view.ts`,
  `components/schema-grid.tsx`, `page-header-cell.tsx`,
  `routes/source-schema.tsx`, `routes/source-run-detail.tsx`, a new
  `components/run-misses.tsx`, `lib/backfill-preview.ts` (+ tests, UI smoke)

## 11. Not in this increment

- Automatic discovery of the second layout's path without an expected value
  (steps 2–3 of the 2026-09-11 note; TypeSafe note of 2026-09-17).
- Using the other missed pages as unlabelled evidence to pick between
  candidate paths. The strongest answer to one-page evidence, but it needs
  captures of the missed pages; revisit if thin evidence bites in practice.
- A blank on the first three pages meaning "this field is not on this
  product". Real (a product with no reviews has no rating) but separate.
- Speeding up verification captures the way certified runs were (the
  proof-page captures still wait for `networkidle`).

## 12. Decisions (all three taken as recommended, 2026-09-17)

- **D1. Six proof pages at most.** Enough for three layouts at two pages each;
  keeps the grid readable. Alternative: no cap.
- **D2. A second layout may certify on one page, flagged as thin evidence.**
  Alternative: require two pages per layout, safer but twice the typing for
  the customer before their run is fixed.
- **D3. Blank cells are allowed only on pages four to six.** Alternative:
  require every cell on every page, which forces seven retyped values to fix
  one field.
