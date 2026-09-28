# Table-first verification and drift repair — design

**Date:** 2026-09-28. **Status:** asked for by Marko after the plan 5 review
("auto-extract first, confirm only what is uncertain; drift detection that
proposes a fix"); spec for review. Two parts, one plan each: **A** first.
**Changes** the Verification tab's layout (`2026-09-25-verification-tab-design.md`
§2.2–§2.4); its listing, product cards, marking, suggestions, autosave, gate
and Verify stand. The engine (`2026-09-18-schema-stepper-with-marks-design.md`
§3) and certification are unchanged. No model is added (§C).

## Why

On Ikea (live check, 2026-09-25) the page's own data suggested all 8 fields on
all 3 products and the customer still made **43 clicks**, every one a
confirmation of something we already knew. The customer's effort goes where
we are certain, not where we are unsure. And a verified website that stops
extracting a field is only flagged today (`sources.driftedFields`, set after a
run) — nothing on screen says so, and nothing proposes the fix.

What stays: nothing is certified that the customer did not accept, and nothing
extracts at scale that did not certify. Verified data is what we sell.

---

## Part A — Table-first

### A1. The screen

```
[ listing input ………………………………… ] [Find products]
[Accept all agreed (6)]                                   [Verify 8 fields · free]

            │ ▣ Oak chair   │ ▣ Pine stool  │ ▣ Birch table │
Field       │ /p/1  ready   │ /p/2  ready   │ /p/3  ready   │
────────────┼───────────────┼───────────────┼───────────────┼──────────────────────
Title       │ Oak chair     │ Pine stool    │ Birch table   │ agreed      [Accept]
Price       │ 129.99        │ 219.99        │ 149.00        │ agreed      [Accept]
Brand       │ IKEA          │ IKEA          │ IKEA          │ same on every product — check it
Rating      │ 4.5           │ —             │ 4.1           │ missing on product 2
SKU         │ A1  ✓         │ B2  ✓         │ C3  ✓         │ ✓ verified
────────────┴───────────────┴───────────────┴───────────────┴──────────────────────
▼ Pine stool — screenshot (opens when a cell is clicked)
```

- **The product cards become the table's column heads** (photo, title, short
  URL, screenshot state, ×); **+ Add product** is the last column head while
  there are fewer than six.
- **One row per field.** Each cell shows the value for that product in mono,
  with a 2 px left rail in the cell's state colour — grey (nothing), orange
  (suggested), green (accepted: ticked or typed), red (Verify says it does not
  hold). The row is the battery, spread out with its values.
- **The last column says what the row needs** (A2) and holds its one action:
  **Accept** for an agreed row; after a Verify, the verdict badge as today
  (verified / fails on product n / changed since verified / checking…).
- **Clicking any cell** opens that product's screenshot under the table with
  the field's element outlined (its answer, or its suggestion's boxes).
  Marking there works exactly as now: click an element, pick the field, tick.
  The screenshot panel closes with Escape or ×.
- **Expanding a row** (its name) shows the descriptor and, for the selected
  product, Type it — what the sidebar row held.
- **Above the table:** **Accept all agreed (n)**, the Verify button with its
  price and reason, the save line, Go to Extract.
- The fields sidebar goes: the table carries everything it showed.
- Narrow screens: the table scrolls sideways in its own container; the field
  column is sticky.

### A2. What a row needs — the agreement rule

A pure function, `rowStatus(field, board, liveSuggestions, captures, verdict)`,
answers one of:

| Status | When | Last column |
|---|---|---|
| `accepted` | every product has an answer (products 4–6 may be blank) | nothing, or the verdict after Verify |
| `agreed` | every captured product 1–3 has a live suggestion, and every suggestion is **one place** on its page (a single box, or page data with no box), **valid for the type**, and **from the same source path** (`via.source` + `via.path` equal on every product), and the values are **not all identical** | agreed · **Accept** |
| `same-everywhere` | as `agreed`, but every product shows the same value | "same on every product — check it" |
| `needs-you` | anything else | the first reason: "missing on product n", "found in n places on product n", "comes from different places", "not a money amount on product n", "screenshot not ready on product n" |

- **Same source path** is the confidence signal: one JSON-LD path (or one API
  path) that yields a valid value on every product is what certification
  itself looks for, so an agreed row is very likely to certify.
- **Identical values are not agreement.** A site-wide string (the shop's name
  offered as Brand, a delivery banner offered as Availability) looks agreed on
  every product; the engine's own weak-evidence rule already distrusts a value
  that is the same on every page. Such a row is shown, with its warning, and
  accepted one cell at a time or row-wise with a second click ("Accept anyway").
- A row whose suggestions came from another product (a transfer after a tick)
  counts as agreed under the same rule; `via` is the transferred path.

### A3. Accepting

- **Accept (row):** for each product with a live suggestion, write the answer
  exactly as a tick on that suggestion does today (`answerFromSuggestion`: the
  value, and the element as its mark only when the element shows that value by
  the engine's comparison). One autosave.
- **Accept all agreed:** the same for every `agreed` row. Never touches a
  `same-everywhere` or `needs-you` row, or any cell that already has an answer.
- **Cell-level:** clicking an orange cell and pressing ✓ in the screenshot's
  popover (or in the cell's own small popover for a page-data value) accepts
  that one cell, as today.
- Undo: an accepted cell can be cleared from its popover (Remove), as today.

Nothing is accepted without a click. The gate, the autosave, Verify and
certification are unchanged.

### A4. Engine and API

None needed: `suggestMarks` and `transferMarks` already answer `via` and
`boxes`. `rowStatus` and the acceptance helpers are pure additions to
`lib/site/verification-model.ts`.

### A5. Testing

- Unit: `rowStatus` for every status and reason, including one place vs
  several, page data vs a box, differing `via.path`, identical values, a
  product without a capture, products 4–6 left blank; Accept-all touching only
  agreed rows and never an answered cell.
- Smoke (fixture server, free, never Verify): three products, **Accept all
  agreed** turns the agreed rows green in one click; a `needs-you` row opens
  its screenshot on a cell click and is marked there; reload keeps everything.
- Live, free (keyless :4100, throwaway identity): Ikea again; record clicks to
  reach Verify (target: ≤ 5, against 43) and the verified count.

---

## Part B — Drift repair

### B1. What exists

After a certified run, `flagDrift` (`packages/api/src/crawl/drift.ts`) marks a
field drifted when at least `DRIFT_MISS_SHARE` (20 %) of at least
`DRIFT_MIN_ROWS` (5) rows came back empty, on the run and on
`sources.driftedFields`. A new Verify clears it. The new app shows none of it.

### B2. What the customer sees

- **Everywhere a website appears** (the project's websites table, the website
  header): "n fields stopped extracting", in warn colour.
- **On the Verification tab:** a banner — "Price and Rating stopped extracting
  in the run of 26 Sep (41 % and 38 % of products empty)" — and the drifted
  rows marked in the table. The repair (B3) has usually already run by the
  time the customer looks; the banner shows its result.

### B3. The repair check — free, no model, changes nothing by itself

`sources.checkDrift({ sourceId })`, also started automatically when a run
flags drift:

1. **Re-capture every proof page** (the proof-page capture, three at a time,
   as the tab does).
2. For each drifted field, on the fresh captures:
   - **Still resolves.** The field's certified paths still read the expected
     values on every proof page → the proof pages did not change; other
     products lay the field out differently. Result: `other-layout` — point to
     the run's missed products and "use as proof page" (the existing
     second-layout flow).
   - **Moved.** The certified paths fail, but certification's mechanical
     candidate search (the same `gatherCandidates` Verify uses, **no AI step**)
     finds a path that reads the stored expected value on every proof page →
     `moved`, with the new element on each page (its box, for outlining).
   - **Value changed.** A path at the field's old place or by its concept reads
     a different valid value on some page (a price that changed) → `changed`,
     with the new value per page.
   - **Not found.** None of the above → `lost`.
   - A proof page that no longer loads (404, redirect to a listing, blocked) →
     `page-gone` for that product.
3. Store the result as a **drift check** (new table `drift_checks`:
   `source_id`, `run_id`, `created_at`, `results` jsonb per field, `status`
   `running | done | failed`). **Certification, answers and paths are not
   touched.**

The check costs nothing: page loads and code. It never calls a model.

### B4. Applying a repair

On the Verification tab, each drifted row shows its result:

| Result | The row offers |
|---|---|
| `moved` | the new element outlined on each product's screenshot beside the old one; **Accept new location** → the row's answers get the new elements as marks (values unchanged) |
| `changed` | "page now shows X (was Y)" per product; **Accept new values** → the answers take the new values and elements |
| `other-layout` | "The products you verified still work; some others differ" → **See missed products** (the run page's misses) |
| `lost` / `page-gone` | "Mark it again" (opens the product's screenshot) / "Replace product n" (the grid's ×, next product from the listing) |

Accepting writes answers through the normal autosave; the row then needs a
**Verify** like any change (free when the new paths are mechanical). Only a
completed Verify certifies the new paths and clears the drift flag — the
repair proposes, the customer accepts, certification decides.

### B5. Testing

- Unit: the classification from fixture captures (the shop-example triple
  with a moved price, a changed price, a missing field, a still-working field).
- API: `checkDrift` writes a `drift_checks` row, never a `source_verifications`
  row, never changes `verificationSet` or `driftedFields`; org-scoped.
- Live, free: a local fixture site whose layout the test changes between two
  runs (no outside website needs to change for the test).

---

## C. Not in this design

- **Jev / TypeSafe.** The natural next step is a Choice for "found in n places"
  and a yes/no check on agreed rows (the September 17 note), calibrated on the
  customers' own accepted answers. Deliberately out: the table-first rule
  above is code and measurable first.
- Auto-accepting anything, or certifying a repair without a Verify.
- A `keepalive` save on page close (open decision from plan 5).
- Drift alerts by email; per-row QA of run output.

## D. Decisions to confirm

1. **The table replaces the fields sidebar** (fields as rows, products as
   columns, the screenshot opens under the table on demand).
2. **Identical values across products are never "agreed"** — they need a
   second click.
3. **The repair check runs automatically** when a run flags drift (free:
   three to six page loads), not only on a button.
4. **Order:** Part A, then Part B, then the redesign's cut-over (deleting
   `@robot/dashboard`).
