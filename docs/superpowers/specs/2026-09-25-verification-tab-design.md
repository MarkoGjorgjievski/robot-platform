# The Verification tab — design

**Date:** 2026-09-25. **Status:** agreed in conversation with Marko, spec for review.
**Supersedes** §2 (the flow: Fields → Pages → Mark → proof sheet), §4's screen
rows and §6's dashboard testing of
`2026-09-18-schema-stepper-with-marks-design.md`. Its engine — §3 (capture and
readiness, the box map, `suggestMarks`, `transferMarks`, marks in the binding
and in certification) and §5's engine edge cases — stands and is what this
builds on. In `2026-09-21-app-redesign-design.md` it replaces the §5 row for
`/projects/:project/sites/:site` ("the stepper") and is §7's plan 5. The
unexecuted plan `docs/superpowers/plans/2026-09-25-app-redesign-plan5-stepper.md`
is superseded by a plan written from this spec.

## 1. Why

The stepper put a website's setup behind four views — fields, pages, mark,
proof sheet — and asked the customer to pick a field before pointing at it.
The customer thinks the other way round: here are some products, this is the
price, this is the title. So the tab becomes one screen built around the
products themselves: find them from a listing, look at each one, point at a
value and name it. Fields already have their own page on the project; this tab
only teaches one website where they are and proves it.

## 2. The screen

The website's first tab is renamed **Verification** (it stays at the website's
root URL, so existing links hold; breadcrumb, site tabs and the command palette
say Verification). One screen, no steps:

```
┌──────────────────────────────────────────────────────────┬──────────────────┐
│ [ Paste a listing page — a category or search results ] [Find products] │ Fields     │
│ No listing? Paste product pages instead                  │                  │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌ + ┐                   │ Title  ▮▮▮ ✓verified│
│ │ photo  │ │ photo  │ │ photo  │ │add│                   │ Price  ▮▮▯       │
│ │ title  │ │ title  │ │ title  │ └───┘                   │ Brand  ▮▯▯       │
│ │ ready  │ │ ready  │ │ taking…│                         │ …                │
│ └────────┘ └────────┘ └────────┘                         │                  │
│ ┌──────────────────────────────────────────────────────┐ │ [Verify 8 · free]│
│ │ the selected product's screenshot, scrolling          │ │ reason / saved   │
│ │   [Price ✓]  ← green labelled rectangle               │ │ [Go to Extract]  │
│ │   [Title ? ✓ ×] ← orange suggestion                   │ │                  │
│ └──────────────────────────────────────────────────────┘ │                  │
└──────────────────────────────────────────────────────────┴──────────────────┘
```

### 2.1 The listing

- One wide input, "Paste a listing page — a category or search results", and
  **Find products**. `sources.checkListingPage` loads the page once and answers
  the product links with each link's title and image (§4). The first three
  fill the grid; the rest are kept as the queue that **×** and **+** draw from.
- A listing with no product links says so ("No product links found on this
  page") and turns the cards into URL inputs, as does **No listing? Paste
  product pages instead**. The listing URL is kept either way.
- The listing URL is saved with the website and reaches the Extract tab
  through `updateBinding`'s existing input-set sync (which already leaves the
  Extract tab's pages alone once that tab owns them — `parameters.inputMode`).
  `sources.setListingPages` is not called from here: it would hand the input
  to the Extract tab for good.

### 2.2 The product grid

- Three cards by default: photo, title, short URL (mono, full URL on hover).
  The number of cards is the number of products the customer marks and
  verifies on — the proof pages — three to six.
- Each card's state line: "taking screenshot…" (skeleton), "ready", or the
  failure reason with **Try again**. Captures start the moment the listing
  answers, for all cards, at most three at once (§4).
- **×** drops a product; the next unused product from the listing takes its
  place (or the card becomes a URL input when the queue is empty). Dropping a
  product drops its answers.
- **+ Add product** after the third card, up to six: the next product from the
  listing, or a pasted URL. At six it is disabled with "Six products is the
  most a website is checked on".
- A URL on another website is refused under its card: "All products must be
  on the same website".
- The selected card wears a text-colour border; clicking a card shows its
  screenshot below. A card whose capture has not landed shows its state in
  place of the screenshot.

### 2.3 Marking on the screenshot

- The selected product's screenshot, full width of the main column, scrolling
  in its own frame at its captured width scaled to fit; "Page cut at N px"
  below it when the page was longer than the capture.
- Hovering outlines the innermost element under the pointer; **Alt** widens to
  its parent.
- **A click opens a popover at the element**: the value it read, a field
  dropdown and a tick. Fields whose type fits the value (a money-looking value →
  money fields; an image → image fields; a link → URL fields) are listed first;
  fields already green on this product are dimmed. The value rule is the
  engine's: image fields take `src`, URL fields `href`, others the element's own
  text; the wrong kind of element says why ("This element is not an image") and
  offers nothing to tick.
- **Tick** → a green labelled rectangle stays on the element; the field's
  segment for this product turns green (§2.4); the answer is saved (§3).
- **Suggestions** are orange labelled rectangles with their own tick and ×.
  Tick → green. × → removed; the field is grey on this product again.
- Clicking any rectangle reopens its popover: change the field, or remove it.
- One element can answer one field; one field has one answer per product.
  Ticking a field that already has an answer on this product replaces it.

**Where suggestions come from** (both free, offline, no model):

- **Page data**, on every product as its capture lands: `suggestMarks` over the
  capture (JSON-LD, meta, API bodies matched to the box map). One visible match
  is an orange rectangle; several are all outlined with "found in n places —
  click the right one" on the field's row; a value with no visible element
  ("page data") is offered on the field's row, not on the screenshot.
- **Another product's answer**: the moment a field is ticked green on one
  product, `transferMarks` carries it to every other product whose capture has
  landed, as orange, for that field only.

A suggestion never overwrites a green or typed answer. Suggestions are not
saved; they are recomputed on load for every cell without an answer, so a
stale suggestion can never become a saved answer.

### 2.4 The fields sidebar

Always on the right (below the screenshot on narrow screens). One row per
project field, in the project's order:

- **Name, the battery, the verification badge.**
- **The battery**: one segment per product card, in card order —
  - grey outline: nothing on this product;
  - orange: suggested, waiting for a tick;
  - green: the customer's answer — a ticked element or a typed value;
  - red: the last Verify found this product's value does not hold (only after
    a Verify; cleared when the customer changes that answer).
  Clicking a segment selects that product and, when the field is marked there,
  outlines its rectangle.
- **The badge**, the engine's verdict, distinct from the customer's green:
  - **verified** — text colour with a check-shield icon;
  - **fails on product n** — fail colour;
  - **changed since verified** — muted, when an answer moved after the last
    Verify (the current `fieldHash` rule);
  - **checking…** while a Verify runs;
  - nothing before the first Verify.
- **Expanding a row** shows, for the selected product, **Type it** (for a value
  that cannot be clicked — it counts as green, labelled "typed") and the
  **descriptor**: the existing per-website hint ("where it is on this
  website"), pre-filled from the catalogue description and editable.
- The row of the field under the selected rectangle is highlighted.

Below the rows: **Verify**, its price on the button as today (`Verify 8 fields ·
free` / `· up to $X`, from `sources.verifyEstimate`), with its reason within
one line when disabled; a quiet "saved" / "saving…" line; **Go to Extract**,
live once every field reads verified.

### 2.5 The Verify gate and the run

- **Verify is enabled when every field is green on products 1 to 3.** On
  products 4 to 6 a field may stay grey ("not checked on this product") but not
  orange. The reason names the first gap: "Price still needs product 2",
  "Title has a suggestion to confirm on product 4".
- While it runs: the rectangles, cards and inputs lock; each badge reads
  "checking…"; the stage line shows where the run is.
- When it lands: each badge settles; a failing product's segment turns red;
  clicking it opens that product with the field's rectangle selected.
- A verification in flight when the tab opens is shown the same way; the
  existing stall rule applies.

### 2.6 Empty and arrival states

- **No fields on the project**: the tab shows "This project has no fields yet"
  with a link to the project's Fields page, and nothing else.
- **Add website** lands on this tab.
- **Arrival from a run** (`?addPage=<url>&field=<key>`, the run's "use as proof
  page"): the product becomes a card when there is room (otherwise "This
  website already checks six products — drop one to add this page"), is
  selected, its capture starts, and the field's row is highlighted with "Mark
  {field} on this product". The run page's link must send the field's **key**.

### 2.7 What leaves

The proof-sheet grid (`SchemaGrid`, `PageHeaderCell` and its pencil popover,
`StatusStrip`'s Save/Verify pair), the Fields step and `StepperStrip`, Import
values (CSV/XLSX/paste — marking and Type it cover it; it can return as a
sidebar action if a customer with a spreadsheet asks), and the view logic only
they used. `@robot/dashboard` is untouched.

## 3. Saving

- **Every answer saves.** A tick, ×, typed value, descriptor edit or card
  change autosaves (debounced ~600 ms, one save in flight at a time, the latest
  state wins) through `sources.updateBinding({ …, draft: true })`. A reload,
  another device or a teammate sees the same answers.
- **What is saved**: the proof-page URLs (the cards, in order), the listing
  URL, per field per product the value and its mark (green answers) or the
  value alone (typed), the descriptors, and the cards' `{ url, title, image }`
  so the grid reappears without reloading the listing. Suggestions are never
  saved.
- **`draft: true`** keeps the URL rules (same website, different pages,
  three to six) and "a mark carries its value", and skips the per-cell
  completeness rules. `updateBinding` without `draft` is unchanged.
- **Verify re-checks completeness itself**: before starting it runs the full
  `bindingProblems` over the stored record and refuses with those problems
  (`PRECONDITION_FAILED`). Today it relies on `updateBinding` having refused an
  incomplete save, which `draft` ends.
- A draft save makes changed fields not current exactly as any save does
  (`fieldHash` covers pages, values and marks — not the cards, which it never
  reads), so the badges move to "changed since verified" on their own.

## 4. Engine and API

All additive; extraction is untouched.

| Change | Purpose |
|---|---|
| `checkListingPage` → `products: Array<{ url, title, image }>` beside `productLinks`/`pagerSeen`/`sample`, from the same in-page script (the link's text or `title`/`aria-label`, and the nearest `img` inside or around the anchor — `currentSrc`/`src`, made absolute) | the cards from one page load |
| `updateBinding` `draft?: boolean`; `cards?: Array<{ url, title, image }>` stored on the verification set as `cards` | autosave from the first tick; the grid survives a reload |
| `verify` runs `bindingProblems` on the stored record first | §3 |
| `sources.proofPageCaptures({ sourceId, urls })` → newest proof-page capture per URL `{ captureId, status, error? } \| null` (null when none or older than `CAPTURE_REUSE_MAX_AGE_MS`) | a reload resumes captures instead of redoing them |
| `transferMarks` `from?: Record<key, { value, mark? }>` (the answer on screen, overriding the stored one) and `fieldKeys?` | a suggestion follows every tick, one field at a time |
| `proofPageCapture`, `suggestMarks` guarded by a capture → website → organisation check (`captureInOrg`) | ledgered to plan 5 since plan 3 |
| Proof-page captures run concurrently, at most three at a time per api-server | three cards ready in roughly one capture's time |

`bindingProblems`' same-website rule, `prepareBinding`'s dropping of a mark
whose text no longer equals its value, and `fieldHash` are unchanged.

## 5. Edge cases

- **A capture fails or is blocked**: the card shows the reason, **Try again**
  and **×**; Verify's reason names the product.
- **A product dropped after answers were given**: its answers go with it; the
  batteries lose a segment.
- **The listing changes between visits**: saved cards are shown as saved; the
  queue for × and + is only the last loaded listing's, and is empty after a
  reload until **Find products** is pressed again (the cards still work).
- **A transfer reads a different element than the customer means**: it is only
  orange; the customer clicks the right element and ticks it.
- **A value split over child elements** (no single box): Type it.
- **Two teammates editing at once**: the last save wins, as with every other
  save in this app.

## 6. Testing

- **Unit, no browser**: battery segment state per field per product; the
  Verify gate and its reason; card state; suggestion merging (never over an
  answer; stale capture ids ignored); `draft` save rules and `verify`'s
  completeness refusal (API); the listing script's title and image on fixture
  HTML (real Chromium, `setContentEvaluate`).
- **App smoke** (`pnpm test:ui:app`, free, no outside network): a local fixture
  server serves a listing and three product pages with JSON-LD. The run pastes
  the listing, sees three cards with their titles, waits for the screenshots,
  ticks one page-data suggestion, clicks one element, picks its field from the
  dropdown and ticks it, sees that field turn orange on the other two products
  and ticks them, reloads and finds everything still green. It never clicks
  Verify. Screenshots per state in both themes.
- **Live, free**: Ikea end to end as a throwaway identity against the keyless
  api-server on :4100, Verify included (mechanical only there, so free — the
  check asserts the button says "free" before clicking). Record capture time
  per product, fields suggested from page data, fields carried by transfer,
  and the verified count.

## 7. Not in this design

- Suggestions from the domain cache of websites already crawled (Marko's
  "later"): the engine for it exists in the extraction chain, the screen does
  not.
- Marking on the listing page itself.
- Any model on this screen.
- Invitations, per-project permissions, the Extract tab's own redesign.
