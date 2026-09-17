# Second-layout learning for certified runs — design note (draft, not yet decided)

**Status:** discussed 2026-09-11; the cheap version (three to six proof pages, a
never-wrong-anywhere cover rule, `crawl.misses` grouped by field and listing,
the Schema tab's "Add page") landed 2026-09-17 — see
`2026-09-17-second-layout-proof-pages-design.md`. Companion note:
`2026-09-11-lean-capture-for-certified-runs-design.md`. This is the more
important of the two for correctness at scale; lean capture is the smaller
change.

## The scenario that exposed the gap

A project with three listing URLs, 200 products each, 600 product pages in a
run. The first 400 hit their certified paths: fast, free, correct. On the last
200, a field (say price) misses on some products, because that listing's
product pages carry a slightly different layout or a different JSON-LD shape.

## What happens today

- The cells stay empty. A verified website runs its certified paths only
  (`runVerifiedExtraction`); a miss is an honest miss. Nothing tries another
  way to get the value and nothing learns.
- Each path's hit or miss is booked per host via `recordVerifiedPathStats`.
- After the run, `flagDrift` flags a field on the run and the website if its
  empty share is at least `DRIFT_MISS_SHARE` (0.2) over at least
  `DRIFT_MIN_ROWS` (5) rows. A few misses in 600 stay under that, so the
  customer sees empty cells and no flag.
- The repair sweep and backfill (`repair-sweep.ts`, `backfill.ts`) belong to
  the analysis chain for unverified websites. They do not run for a verified
  one, because they would fill cells with paths no human confirmed.

The rule that only a certified path may fill a customer's cell is right and
stays. What is missing is a way to certify a second layout once a run has
found one.

## What the data model already gives us

- A field's certification is a list of paths (`Certification.paths[key]:
  CertifiedPath[]`), ranked by `rankCertified` (api, then json-ld, meta, xpath;
  shorter first), capped at `MAX_CERTIFIED_PATHS`, and tried in order by
  `runVerifiedExtraction` until one resolves. Two layouts are two paths on the
  same field. "Check against both next time" is how it already behaves.
- Certification (`certify.ts`) needs, per field, expected values on proof pages
  and a candidate list; a candidate certifies when it produces the expected
  value on every proof page it is checked against. The AI fallback
  (`ai-fallback.ts`) proposes candidates given the expected value and near
  misses; it does not work without an expected value.
- Every run item carries `input_index`, so a miss can be attributed to the
  listing it came from.

Open question to settle in the design: the current rule is "a path certifies
only if it works on all three proof pages." A second-layout path will, by
construction, not resolve on the original three pages. The rule needs to
become "a path certifies on the pages it was proven against, and a field is
covered when the union of its paths covers every proof page." This is the one
change to the certification semantics, and it must not weaken the first
layout's guarantee.

## Design

1. **Group the misses.** After a certified run, the run page shows misses per
   field grouped by listing: "38 products missed price, all from listing 3",
   with the pages listed. Pure read over `extractions` plus `run_items`.

2. **Discover once per layout, not per product.** Take one missed product and
   run the proof sheet's own search (`searchStructured`, the DOM search, then
   Claude as the last resort) to find a path that yields a value for the field
   on that page. Then check the candidate resolves on the other missed pages of
   the group. One AI call per group, roughly the cost of one verify.
   Needs a variant of the AI fallback that proposes a value and a path without
   an expected value; today's prompt searches for a known value.

3. **Confirm, then certify.** Show the customer the candidate: the value it
   found on the sample page and "resolves on 38 of 38". The customer confirms
   the value is right, the same gesture as typing an expected value on a proof
   page. The confirmed page becomes an additional proof page for that field;
   the path certifies on it and joins the field's list. Nothing is written to
   a cell before that confirmation.

4. **Repair the run.** Re-run only the missed products with the new path
   (a repair item with `target_fields` narrowed to the field, which
   `extract-item.ts` already honours). No full re-run.

5. **Next time, both layouts work.** The field's paths are tried in order;
   the first layout's path still wins on the first 400 products, the second
   layout's on the rest. Path stats keep booking hits and misses per path, so
   a layout that disappears prunes itself the way any path does.

## The cheap version, available almost today

Without steps 2 and 3: the customer picks one of the missed products from the
grouped list, adds it as another proof page on the Schema tab, types the
expected value, and verifies. The path that works on that layout certifies and
joins the list. This reuses the whole verification flow and only needs step 1
(the grouped miss list with a "use as proof page" action) plus the
certification-rule change above. Recommended as the first increment; the
automatic discovery in steps 2 and 3 builds on it.

## Not in scope

- Filling any cell from an unconfirmed path, on a verified website. Never.
- Raising the drift threshold or turning drift into a repair trigger. Drift
  stays a signal; this note is about what the customer can do with it.
- The unverified-website repair engine (`2026-08-28-repair-engine-design.md`).
  It is a different chain and stays as it is.
