# Schema stepper with marks — design

**Date:** 2026-09-18. **Status:** approved in conversation, spec for review.
**Supersedes** the Schema tab's editing surface from
`2026-09-08-mvp-flow-and-workspace-design.md` §5.6; the proof sheet, the
certification rules (`2026-09-04`, `2026-09-17`) and the contract on the
dataset (§4) are unchanged.

## 1. Why

Today a customer sets up a website by typing an expected value per field per
proof page into a grid. Typing is slow, invites format mismatches ("1.299,00"
against "1299"), and cannot say *which* of several identical values on a page
is the field, which is the `ambiguous` failure. The customer is looking at the
product page in another tab the whole time.

This design replaces the grid's editing surface with a three-step flow: choose
fields from a catalogue, give a listing URL from which we pick three proof
pages, then mark each field by clicking it on a screenshot of the page. The
grid survives as the read-only proof sheet at the end. Verification and
certification run exactly as they do now; a click is a better way of producing
an expected value plus one more XPath candidate, nothing more.

No model is involved in the stepper. Pre-highlights come from the structured
data the capture already carries (JSON-LD, meta, API bodies), matched against
the visible elements in code. TypeSafe/Jev was considered for pre-highlighting
and rejected: the customer is one click away on a screen built for that click,
and cross-page agreement is a better confidence number than a model's
probability. Its real use remains second-layout discovery, where no customer is
in the loop (`2026-09-17-typesafe-evaluation-note.md`).

## 2. The flow

One stepper per website: **1 · Fields → 2 · Pages → 3 · Mark → Proof sheet**,
on the Schema tab's route, using the Extract tab's `Stepper` component
(`packages/dashboard/src/components/stepper.tsx`). The step is a search param,
`?step=fields|pages|mark&page=<n>`, so links can land on a step.

### 2.1 Fields

Fields (name, type) live on the project's dataset and are shared by its
websites; this step is a second surface on the same `datasets.*` mutations.

- A row of schema types: Product, Listing item, Article, Job, Property, Event,
  Custom. Picking one shows that type's catalogue, grouped. For Product:
  *Identity* (title, subtitle, brand, SKU, GTIN, product URL), *Price* (price,
  was-price, currency, discount, unit price), *Availability* (in stock, stock
  count, delivery), *Content* (description, bullet points, specifications),
  *Media* (main image, gallery), *Rating* (rating, review count), *Taxonomy*
  (category, breadcrumbs, tags). 20 to 30 entries per type.
- Each catalogue entry is a chip with a preset `CustomerFieldType`; clicking it
  calls `datasets.addField`. "Add your own" adds a custom field with a name and
  a type. The project's current fields are listed on the right, editable as on
  the project home (rename, retype, delete).
- For the project's second website the list is already full and reads "shared
  with n websites"; adding a field there says "This adds the field to n
  websites". The catalogue still works.
- The catalogue is a static module, `packages/api/src/schema-catalogue.ts`,
  exposed as `datasets.catalogue`. The project home's "Add field" offers the
  same catalogue.
- Next is enabled with at least one field.

### 2.2 Pages

- One listing URL input. On paste: `sources.checkListingPage` (product links,
  pager) and `sources.findProductPages`; the first three product pages fill
  three proof-page slots and a background capture starts for each
  (`sources.captureProofPage`). A slot shows a thumbnail once its capture lands,
  with **Swap** (paste a different product URL) and, on failure, the reason with
  **Try again**.
- **No listing page** turns the slots into plain URL inputs. A listing that
  yields no product links does the same and says so; the listing URL is kept
  either way.
- Fewer than three pages found: the found ones fill slots, the rest wait for a
  pasted URL.
- **Add page** allows pages four to six, as the proof sheet does today.
- The listing URL is saved as the Extract tab's first listing page via
  `sources.setListingPages` when that tab has no pages yet
  (`parameters.inputMode` unset). When it does, the stepper leaves the tab's
  pages alone and shows the listing URL as already known.
- Next is enabled once every slot has a landed capture.

### 2.3 Mark

Layout: the page's screenshot on the left, scrollable, at its captured width
scaled to fit; on the right one row per field showing the value, its source
(`clicked`, `suggested · from JSON-LD`, `page data`, `typed`, `from page 1`)
and, after verification exists, the cross-page agreement bar.

- Clicking a row selects it. Hovering the screenshot outlines the innermost
  element under the pointer (from the box map, §3.2); `Alt` widens to its
  parent. Clicking writes the element's text into the selected row, stores the
  element as the cell's mark, and selects the next unfilled row.
- Every row's value is also a text input, so a field that is not on the screen
  is typed as today. Typing clears that cell's mark.
- Image fields take the element's `src`, url fields its `href`. A text field on
  an element with no text shows "this element has no text".
- A value that fails the field's type (`validateExpected`) shows the existing
  message and is not saved until fixed.
- **Page 1** opens with pre-highlights (§3.3). **Pages 2 and 3** open with page
  1's paths already run on them (§3.4): each found element is outlined and its
  text fills the row; the customer confirms or clicks the right element. An
  empty row means nothing resolved.
- After the last page, Verify runs automatically and the flow lands on the
  proof sheet.

### 2.4 Proof sheet

The existing grid (`SchemaGrid`, `PageHeaderCell`, `StatusStrip`), read-only:
green/red cells with the same hints, the same strip states. Controls: **Edit
fields** (step 1), **Edit pages** (step 2), **Mark again** on a page header
(step 3 on that page; from a red cell, with that field selected), **Import
values** (the existing paste and CSV/XLSX import, kept as the fast path for a
customer with a spreadsheet), and the existing `Re-verify n fields · free /
up to $X` button for later changes. Extract stays locked until every cell is
green. The page header's pencil popover is removed; step 2 owns the URLs.

### 2.5 Arrivals

- Add website dialog: after `sources.createInProject`, navigate to
  `?step=fields` when the project has no fields, else `?step=pages`.
- The run page's `?addPage=<url>&field=<key>` opens step 2 with the page
  appended, then step 3 on that page with the field selected.

## 3. Engine

### 3.1 Proof-page capture and readiness

`sources.captureProofPage({ sourceId, url })` runs `browser.capture` with
`waitUntil: 'load'` and a new ready check, `buildProofPageReadyCheck`
(`packages/scraper/src/verify/proof-page-ready.ts`): ready when the page's
main-content text length is unchanged between two polls **and** at least one
structured source (a JSON-LD block, a meta description, or a JSON response) has
landed; otherwise the existing 8 s poll deadline and bounded settle apply.
`when: 'after-expand'` so "show more" content is in the screenshot. This is the
substitute for `buildVerificationReadyCheck`, which needs values we do not have
yet. Verification's own capture is unchanged and is skipped when a stored
proof-page capture is fresh (§3.5).

Proof-page captures take up to six tiles (9,216 px) instead of `MAX_TILES = 3`;
other captures are unchanged. The viewer says "page cut at N px" at the bottom
when the page was longer.

### 3.2 Box map

After the popup and expand rounds, one `page.evaluate` builds the box map: for
every visible element whose own text (not its descendants') is non-empty, plus
every visible `img` and `a`:

```
{ xpaths: string[]; text: string; rect: { x, y, w, h }; tag: string;
  kind: 'text' | 'image' | 'link'; src?: string; href?: string }
```

`xpaths` are the generator's up-to-three candidates per element (nearest stable
anchor, next anchor up, body-rooted), already built for verification
(`dom-scripts.ts`, `2b45b0c`); `rect` is in page pixels, absolute, so it lines
up with the stacked tiles. Typical page: 300 to 1,500 boxes, tens of KB. Stored
in `captures.metadata.boxes`; tiles as PNGs under `CAPTURES_DIR`
(`captures.screenshotPath` holds the first, the rest follow a `-<n>` suffix);
HTML and structured data as today.

### 3.3 Pre-highlights: `suggestMarks(capture, fields)`

Pure, free, no browser. For each field, `searchStructured` yields candidate
values from JSON-LD, meta and API bodies by the field's concept (`offers.price`
→ price, `name` → title, `sku`, `brand.name`, `image`,
`aggregateRating.ratingValue`, and their meta equivalents). Each candidate value
is matched against the box map with `valuesEqual` for the field's type:

- one visible match: the suggested mark, outlined, row reads
  "suggested · from JSON-LD" (or the source);
- several: all outlined, row reads "found in n places, click the right one";
- none visible but a structured value exists: the row is filled with it, source
  "page data", no outline (a SKU in JSON-LD only);
- nothing: the row waits for a click or typed text.

A suggestion has no special status; a click replaces it.

### 3.4 Transfer: `transferMarks(source, fromUrl, toUrls)`

On leaving page 1, `certify`'s candidate gathering runs with page 1's values and
marks over the stored captures, and for each field the best path that resolves
on page n is evaluated there (`setContentEvaluate`, offline). The viewer
outlines the resolved element and fills the row with what it read, source
"from page 1". Confirming writes that text as the page's expected value and the
element as its mark. Nothing resolves: empty row.

### 3.5 Marks in the binding and in certification

A mark is `{ xpaths: string[]; text: string; rect }` per field per page:
`marks[key][url]` beside `expected[key][url]` on the binding.
`sources.updateBinding` gains `marks` (optional; existing callers untouched).
`bindingProblems` keeps its rules: a mark always carries a value, so "type at
least one expected value per page" still holds, and a mark on a blank cell is
refused. A save is the whole binding: a client that omits `marks` erases them,
so the stepper and the proof sheet's Import values path both round-trip marks.
A mark whose text no longer equals its cell's value (an import rewrote the
cell) is dropped on save; image and link marks carry their value in `src`/
`href`, not text, and are kept. The location hint (`descriptions[key]`) stays required by the API;
the stepper sends the catalogue entry's description, or the field's name, since
the mark screen has no input for it (amendment 2026-09-18, engine plan).

`fieldHash` covers a mark's `xpaths` and `text`, not its `rect`, so a moved
element with the same path stays current and a changed path goes stale like a
retyped value.

In `certify`, a mark's XPaths join the DOM search's candidates. A mark never
certifies by itself: it must be correct or empty on every checked page like
any path. When a page has a mark for a field, the DOM search's other hits for
the same value on that page are dropped, which settles `ambiguous`. That is
the whole change to certification.

Verification reuses a stored proof-page capture that is younger than
`CAPTURE_REUSE_MAX_AGE_MS`; older ones are re-captured as today.

## 4. API

| Procedure | Purpose |
|---|---|
| `sources.captureProofPage({ sourceId, url })` → `{ captureId }` | start a background proof-page capture |
| `sources.proofPageCapture({ captureId })` → `{ url, status, tiles: string[], boxes, pageHeight, capturedHeight, contentHeight, error?, capturedAt? }` | polled at 2 s, like `crawl.status`; a `capturing` row older than `PROOF_PAGE_STALL_MS` (3 min) is closed as `failed` / `stalled` |
| `sources.suggestMarks({ captureId, fieldKeys })` → `{ captureId, fields }` | §3.3, over the stored capture |
| `sources.transferMarks({ sourceId, fromUrl, toUrls })` → per url `{ captureId, fields } \| null` | §3.4, over stored captures; `null` = that page has no fresh capture |

Heights (amendment 2026-09-18, engine plan): `pageHeight` is the document's
measured height; `capturedHeight` is how much of it the tiles cover (the viewer
says "page cut at N px" when `pageHeight > capturedHeight`); `contentHeight`
is the bottom edge of the lowest mapped box. Boxes below `capturedHeight` are
dropped at capture time, so every index the API returns can be outlined.
`pageHeight: 0` means unknown (a capture that did not report one), not an
empty page; the viewer must not draw a cut for it. The
`captureId` in a response names the box map its indices refer to; the screens
must check it against the slot's capture before drawing.
| `sources.updateBinding` + `marks` | §3.5 |
| `datasets.catalogue({ type })` | the static catalogue |

Reused as they are: `sources.checkListingPage`, `sources.findProductPages`,
`sources.setListingPages`, `sources.verify`, `datasets.addField` and friends.

Migrations: none. Marks are binding JSON; the box map is `captures.metadata`.

## 5. Edge cases

- Capture fails or is blocked: slot shows the reason, **Try again** and
  **Swap**; step 3 needs every slot landed (the `not_captured` rule).
- Click on a container holding several values: the row shows the whole text;
  the innermost-element hover and `Alt` let the customer pick the right level.
- Transfer reads a different value than the page shows: the customer sees the
  outlined element and its text and clicks the right one; verification reports
  a disagreement it cannot reconcile, as now.
- Second website's step 1 adds a field to every website in the project and
  drops that field's certification there, as `datasets.addField` already does.
- Volatile XPaths from a click: `looksVolatile` and the three-anchor generator
  apply; the mark stores all three candidates and certification chooses.
- Pages four to six: step 2 adds them; step 3 walks whatever pages exist.

## 6. Testing

- **Unit, no browser:** `suggestMarks` on the `shop-example` fixture triple
  (box maps added to the fixtures): one element per field, several for a value
  present twice, none for an absent value; `transferMarks` on the same
  fixtures; `fieldHash` changes on a mark's path or text, not its rect;
  `bindingProblems` with marks; the catalogue module (valid types, unique keys
  per schema type).
- **Real Chromium, no network:** the box-map script on fixture HTML via
  `setContentEvaluate` returns boxes whose XPaths resolve back to the same
  element with the same text; the proof-page ready check passes on a settled
  fixture page.
- **Existing verify tests** stay green with `marks` absent.
- **Dashboard:** view-logic tests (`lib/schema-stepper-view.ts`: reachable
  steps, slot states, row source labels); `RUN_UI_SMOKE=1` walks step 1 with a
  catalogue click, step 2 with three pasted URLs, and asserts the mark screen
  renders outlines; screenshots per state under `docs/testing/screens/`.
- **Live, free:** Ikea end to end with no key; expect all eight fields
  pre-filled from JSON-LD and 8 of 8 on the proof sheet; record time per page.

## 7. Order of work

1. Box map and proof-page ready check (`@robot/browser`, `@robot/scraper`).
2. Marks on the binding, `suggestMarks`, `transferMarks`, the certify candidate
   (`@robot/scraper`, `@robot/api`).
3. Catalogue and step 1.
4. Step 2 with background captures.
5. Step 3, the mark screen.
6. Proof-sheet controls, arrivals, smoke run, live check.

Each phase ships on its own; after 2 the marks work through the API before any
screen exists.

## 8. Not in this design

- Any model in the stepper (see §1).
- Marking on listing pages.
- A second-layout discovery without a customer (the TypeSafe note).
- Speeding up the listing check and "Find pages" captures (handoff follow-up 9).
