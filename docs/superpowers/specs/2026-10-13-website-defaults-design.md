# A website's default values — design

**Status:** approved in conversation 2026-10-13 (Marko: a default is per website, any field can
have one, a certified path overrides it, "so it's not either or"); spec written the same day.
Computed values ("true unless an out-of-stock trigger is seen", "this element's presence means
No") were discussed and dropped from this spec (§11).

**Status:** implemented on `feat/website-defaults` and merged into `main` 2026-10-13 (fast-forward,
`8008afa`) after a whole-branch review (0 critical, 3 important, one fix wave, re-review clean).
Route smoke on `main`: 23 of 24 on the first run (the failure was the test's own stale key lookup,
fixed in `42df0e2`); the re-run and the §10 live check are still to run (`docs/handoff.md`).

**Deviations:**
- `Certification.defaults` stores the trimmed text as typed; normalisation happens at fill time
  (`applyDefaults` → `renderDefault`), not at load as §5 words it — one normalising point rather
  than two, rows come out identical either way (Task 3 ruling).
- §6's "a default cell whose path read the default shows it as a found value after Verify" was
  not drawn: the table reads no cell's `found` today (answers, segments and badges only), so a
  default cell keeps its muted default after Verify; the row's verified badge and its n/m still
  say it passed (Task 5 ruling, parked).
- With a default, an unaccepted suggestion on products 1–3 no longer blocks Verify — certification
  still tries every candidate, and a suggestion equal to the default certifies its path on default
  cells; one that differs leaves the row needs-you with Accept visible (Task 5 ruling, parked;
  consistent with §6).
- An invalid default stops the Verify gate with `{Field} default: {error}`, naming the field —
  added in Task 5's review; the spec did not say how an invalid default surfaces at the gate.
- `FieldCoverage.defaulted` is a required count (0 when none), like `notShown`, rather than the
  optional shape §7 implies.

Builds on `2026-10-10-proof-page-coverage-design.md` (Part B, "Not on this product": a checked
page whose answer is nothing) and `2026-10-12-shown-on-the-page-design.md` (the not-shown flag,
the typed-value warning at Verify). Follows `2026-09-29` certification (confirmed paths, marks,
weak fields) and the 2026-09-09 contract: a field's name and type live on the project; a website
owns only where that field is on it and what it says.

## 1. The problem

A project collects the same fields from websites that state them differently. The Brand of a
product on Amazon is whatever the page says; on gymshark.com every product is a Gymshark product
and most pages do not say so anywhere a path can read. Today the only way through Verify is to
make something up: the campaign worker typed the site's tagline, "Gymshark | We Do Gym", as the
Brand on three proof pages, a tagline path certified, and all sixty rows carried it (campaign 2,
batch A, `docs/testing/results/campaign-2026-10-11/gymshark.md`). The not-shown flag now catches
that after the run; nothing lets the customer say the true thing before it: **on this website,
unless the page says otherwise, the Brand is Gymshark.**

The same shape appears for any field a website implies rather than states: a shop's own currency
or country, a single seller, a condition ("new") a marketplace shows only for used items, a
delivery note that is the same for every product.

## 2. What changes, in one paragraph

A website's binding gains a **default** per field: a typed value, in the field's type, that a run
writes into every cell its certified paths leave empty. A default and the paths are not
alternatives. Where a path reads a value, the path wins (a collab product whose page data says
"Gymshark x Whitney Simmons" keeps it); where every path misses, the default stands. At Verify a
cell left blank on a field with a default is a *default cell*: the path may read the default there
or read nothing, and both are correct; a field whose proof pages are all default cells and whose
candidates all fail certifies **by default only**, with no path and no AI call. Every value a
default filled is marked as such on the run page, counted per field, reported by the coverage
check and the drift check, shown in ops, and judged like any other value, because a default is
the customer's own guess about the website and the product has to show them where it was used.

## 3. The verification set

`VerificationSet` gains `defaults?: Record<fieldKey, string>` beside `expected` and `absent`: the
default as typed, trimmed; an empty string is no default. `bindingInput` gains the same map;
`bindingProblems` validates each default with `validateExpected(type, value)` (the type's own
error, e.g. "Brand: a default must be text" reads as the expected-value errors do, prefixed with
the field name and "default"). Any field type may have a default; an image or url default is a
fixed address, allowed, and is as odd as it sounds.

A default and "not on this product" are incompatible on one field: the default would fill the
cell the customer said is empty. Setting a default clears that field's absent marks (the tab does
it on the board; the server refuses a binding that carries both: "Brand: a default and 'not on
this product' cannot both be set"). On a field with a default the cell action "Not on this
product" is not offered.

A field with a default is checked on **every** proof page, including pages four to six: a blank
cell there is a default cell, not "not checked here", because the default is a claim about every
product on the website and every page is evidence against it. A typed value equal to the default
(by `valuesEqual`) is a default cell too. The "needs a value on at least two products" rule (spec
2026-10-10 §B1) does not apply to a field with a default: the default is the value on every page
the customer did not type one on.

`fieldHash` adds `default: <trimmed>` when set and uses every proof page as the field's pages;
`definitionHash` adds the sorted `defaults` map. Sets written before this change have no
`defaults` and hash as they do today, so nothing stored loses currency.

## 4. Certification (`certify.ts`, `run-verification.ts`)

`CertifyInput` gains `defaultValue?: string`. With it:

- **Checked pages:** every captured url (§3). `expected[url]` stays whatever was typed; a
  blank or default-equal cell is a *default cell*.
- **Evaluation on a default cell:** a candidate is correct iff it resolves to nothing **or** to a
  value equal to the default; a candidate that resolves to anything else is wrong there, so it is
  unsafe and never certifies, whatever it gets right elsewhere (the safety rule is unchanged).
- **A candidate must read something:** a candidate is certifiable only if it is correct *with a
  value* on at least one checked page. A path that resolves to nothing on every page proves
  nothing and is dropped before cover and ranking. `provenOn` and the cover's "one path proven on
  two pages" count only pages where the candidate read a value, as absent pages already do.
- **Weak field:** with every cell a default cell the field's values are all one value, so
  `isWeakField` holds and only a confirmed path, a marked element or a concept-fitting
  structured path may certify (spec 2026-09-29 C2). Unchanged, and exactly right here: a
  `brand.name` JSON-LD path fits the concept; a random DOM node that happens to read "Gymshark"
  (the header logo's alt text) does not.
- **Default only:** when no candidate certifies *and every checked page is a default cell*, the
  field passes by default only: `FieldVerification` gains `defaultOnly: true`, `certified` stays
  `[]`, every captured cell is `{ status: 'pass', found: '' }`. This takes precedence over the
  weak-field `no_fitting_path` result. A typed value that differs from the default on any page
  (the collab product) keeps today's behaviour: the field fails on that cell with `not_found`
  (or `different_value`) until a path reads it, and the field never certifies by default only.
- **No AI for a default-only field:** `runVerification` skips the AI fallback when the field has a
  default and every checked page is a default cell; the model would be paid to search for a value
  the customer already said the page need not show. With a differing typed value the fallback runs
  as today.
- `CellResult` on a default cell after certification: `pass` with `found: ''` when the winning
  path read nothing, `found: <value>` when it read the default. The Verify count "n/m" counts
  every proof page.
- `allPassed`, and `currentKeys` in `current-certification.ts`: a field is passed and current when
  `certified.length > 0 || defaultOnly === true` and every cell passes.

On gymshark.com with the default "Gymshark" and nothing typed: the JSON-LD `brand.name` path reads
"Gymshark" on the three proof pages → correct with a value on all three → certifies (not default
only). Where a product page carries no brand in its data, the run's path misses and the default
fills. With one collab proof page typed "Gymshark x Whitney Simmons": the path reads that there
and "Gymshark" elsewhere → certifies on four pages; the default never fires on a page whose data
names the brand. On a site with no brand anywhere: every candidate reads nothing → dropped →
default only, free.

## 5. Extraction (`verified-extraction.ts`, `extract-item.ts`, `current-certification.ts`)

- `Certification` gains `defaults: Record<fieldKey, string>` (the set's `defaults`, normalised
  for the field's type: `renderValue(type, normalize(type, default))`, so a money default "22"
  and a typed "22.00" write the same thing). `VerifiedField` gains `defaultValue?: string`.
- `runVerifiedExtraction`: after the certified paths, a field still `null` with a `defaultValue`
  gets it. The path stats are untouched: a miss is still a miss for the path (its hit rate is
  what drift and ops read). The result gains `defaulted: string[]` (the field keys the default
  filled) and `shown[key] = null` for them: the value was not read from the page, so there is
  nothing to check against it.
- **Readiness:** a field with a default does not block the ready check — its paths may
  legitimately never resolve on a product (the collab brand on a plain product, in reverse), and
  waiting out the poll deadline on every such product is what the lean-capture work removed.
  When *no* field blocks readiness (every certified field has a default), the check waits for the
  defaulted fields' paths instead, so the capture is not taken at `load` with nothing to wait for.
- **Variant rows:** `buildVariantRows` overwrites variant-level fields from the list's entries; an
  entry that leaves one empty gets the default too. One pure function in `@robot/scraper`,
  `applyDefaults(row, fields): { row, defaulted: string[] }`, serves the product row (inside
  `runVerifiedExtraction`) and each variant row (in `extract-item.ts`, after `buildVariantRows`).
- `extractions.validation_result` gains `defaulted: string[]`: the field keys the default filled
  on at least one row of the item. On a run without variants that is exact per product; on a
  list-method run it is per product, like `shown`.
- A defaulted field does not count as a hit in the item's `confidence` (that number says what the
  paths produced) and never adds to `absentFields`.
- **Drift** (`drift.ts`): a path that stops hitting on a defaulted field would be hidden by the
  default, so `emptyShares` treats a row as empty for a field with a default when the item's
  `validationResult.defaulted` names it. `flagDrift` receives the default keys from the
  certification. A default-only field has no path and never drifts; `run-drift-check.ts` already
  classifies only fields with paths.
- **The coverage check** (`run-coverage-check.ts`): the sampled read records a field as `empty`
  when the paths missed, read from the result's `defaulted` as well as `data` (the data now
  carries the default). A default-only field is not sampled (no path to sample).

## 6. The Verification tab (`@robot/app`)

**Setting a default.** The expanded field row (`FieldDetails`) gains a third input under "Type
it": **Default for this website**, validated as the typed value is, autosaved with the binding.
Beside it, when the default is set, one line of muted text: "Fills every product the paths leave
empty." The row status `same-everywhere` ("same on every product — check it") gains a second
action beside "Accept anyway": **Make it the default**, which sets the default to that value and
accepts the row (the cells keep their suggested value and path, so the path certifies and the
default is the fallback). The row status for a yes/no field is never `same-everywhere` (A6), so
that action never offers a boolean default; the input does.

**The default input warns like a typed value** (spec 2026-10-12 §B2): when the §3 shown check
finds the default on none of the proof pages' text, "not on any proof page" in warning colour
beside the input, with the title "No proof page shows this value; it will still fill every product
the paths leave empty." Never blocks. The tagline default would read it; "Gymshark" (in the
header of every page) would not.

**Cells.** A blank cell on a field with a default shows the default in muted text with the title
"This website's default; a path that reads a value here wins" — the same rendering as
`ABSENT_TEXT` uses for an absent cell, with the value in place of the words. `rowStatus`: a blank
cell with a default and no suggestion is not "missing on product n"; a suggestion equal to the
default agrees as today; a suggestion that differs follows the normal flow ("check product n",
majority). `verifyGate`: a field with a default never reads "still needs product n"; a product
four to six still needs at least one real answer on some field. "Not on this product" is hidden
on the field's cells (§3), and setting a default clears the field's absent cells on the board.

**After Verify.** A default cell whose winning path read nothing keeps the muted default; one whose
path read the default shows it as a found value. A default-only field's badge reads **verified**
with the row word "default only · no path reads it on this website" in muted text. The Verify
button's count and the "n/m" after the badge count every proof page.

## 7. The run page, ops, the judge

- `crawl.coverage`'s `FieldCoverage` gains `defaulted: number` (items where the default filled
  the field) and `RunCoverage` gains `defaultedItems` (url + field keys, first 500, as
  `unshownItems`). The column head's badge reads **default on n** beside "n not shown"; a
  defaulted cell carries a muted left rail with the title "this website's default"; the summary
  line reads "60 rows · 100% confidence · 60 values from the website's defaults" when n > 0; the
  Sample panel states the same fact. The unshown panel is unchanged (a defaulted value is never
  flagged not shown).
- Ops website page: each field's row shows "Default: Gymshark" when set; a default-only field's
  path list reads "no path — every product gets the default" in place of the empty list, and its
  state is `current` like any passed field.
- The judge (`judge-run.ts`): a defaulted value is judged like any other — that is how a wrong
  default is found. The report's `shown` column reads "default" for it, and the confusion table
  leaves defaulted values out (the flag never saw them).
- Export: values only, unchanged. The CSV does not say which cells were defaults; the run page does.

## 8. Copy table

| where | reads |
|---|---|
| expanded row, input label | Default for this website |
| expanded row, under a set default | Fills every product the paths leave empty. |
| expanded row, warning | not on any proof page |
| warning title | No proof page shows this value; it will still fill every product the paths leave empty. |
| row action (same-everywhere) | Make it the default |
| cell (blank, default set) | the default, muted |
| cell title | This website's default; a path that reads a value here wins |
| row word, default only | default only · no path reads it on this website |
| binding problem | Brand: a default and "not on this product" cannot both be set |
| binding problem, bad type | Brand: default — a number is needed (the type's own `validateExpected` text) |
| run column head | default on 60 |
| run cell title | this website's default |
| run summary line | 60 rows · 100% confidence · 60 values from the website's defaults |
| coverage row line (default set, paths) | The default filled 17 of 20 sampled products |
| coverage row line (default only) | Every product gets the default |
| ops, default set | Default: Gymshark |
| ops, default only | no path — every product gets the default |
| judge report column | default |

## 9. Safety properties the tests must pin

1. A path that resolves to a value other than the default on any default cell never certifies,
   whatever it gets right elsewhere.
2. A path that resolves to nothing on every checked page never certifies, even on a field whose
   cells are all default cells.
3. A field certifies by default only iff every checked page is a default cell and no candidate
   certifies; a typed value differing from the default anywhere forbids it, and the cell fails as
   today.
4. No AI call is made for a field that qualifies for default only.
5. At extraction, the default fills only a cell every certified path left empty; a path's value
   always wins; the path stats record the miss; `defaulted` names exactly the filled keys; `shown`
   is null for them.
6. A defaulted field never counts toward `confidence` and never lands in `absentFields`.
7. Drift on a field with a default reads the default-filled share, not the row's emptiness.
8. The binding refuses a default beside an absent mark on the same field, and a default that fails
   the field's type.
9. Sets, results and extractions written before this change behave byte-for-byte as today: no
   `defaults` → no default cells, no `defaultOnly`, no `defaulted`.

## 10. Testing

- **Unit, scraper:** `certify` with a default (properties 1–3; the gymshark examples of §4; a
  weak-field default-only pass over `no_fitting_path`); `fieldHash` moves when a default is set and
  not when another field's does; `applyDefaults`; `runVerifiedExtraction` on a fixture whose page
  carries no brand (default fills, stats miss, shown null) and one whose JSON-LD names it (path
  wins); the ready check with and without non-defaulted fields.
- **Unit, api:** `bindingProblems` (property 8); `currencyOf` with `defaultOnly`; `emptyShares`
  on defaulted rows; `computeCoverage`'s `defaulted` and `defaultedItems`; the coverage check's
  `empty` from `defaulted`; the ops field row.
- **Unit, app:** `rowStatus` with a default (blank cell not missing; agreeing and differing
  suggestions); `verifyGate` with a default; `cellText` for a default cell; `resultsSummary` and
  the column badge; the same-everywhere action; the default input's warning via `typedNotShown`.
- **Route smoke:** a seeded website with Brand default "Gymshark" and a seeded run whose
  `validationResult.defaulted` names it on every item — the column head "default on 10", the cell
  rail, the summary line, and the Verification tab's input, cell text and default-only row word.
- **Live, free:** the credit campaign's Gymshark website: set the Brand default, clear the typed
  tagline, re-Verify (mechanical; the JSON-LD brand path should certify with the default as
  fallback), extract ten products, read the run page. Then the same on a website with no brand in
  its data, to see default only. Both under the memory `anthropic-api-budget`'s rule: never a
  click that shows a dollar amount.

## 11. Not in this spec

- **Computed values** of any kind: "true unless a trigger is seen", "this element's presence means
  No", a value derived from two others. Dropped 2026-10-13. The boolean default plus a marked
  "Sold out" badge works through this spec's rules only when the badge's text normalises to a
  yes/no word, and that is a consequence, not a feature.
- A project-level default that every website inherits; a per-product override; a default on the
  variant axis columns.
- A default and "not on this product" on the same field.
- Showing a default in the export as anything but the value.

## 12. Decisions (recommended, 2026-10-13)

1. The default lives on the website's verification set, not the contract (the 2026-09-09 rule:
   the project owns name and type, the website owns what it says).
2. Every proof page is a checked page for a field with a default (§3), rather than keeping the
   pages four to six "not checked" rule: more evidence against a wrong path, no cost.
3. A default-only certification is a pass, current, and free of AI; it is distinguished everywhere
   it shows (row word, ops, run page) rather than hidden as a normal pass.
4. A defaulted field does not block readiness, with the all-defaulted exception (§5).
5. Drift reads the default-filled share (§5) rather than leaving defaulted fields un-watched.
6. The judge judges defaulted values; the not-shown flag does not.
