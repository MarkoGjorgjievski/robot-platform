# MVP flow and workspace: projects, project-level fields, the verification workspace, and the visual system

Date: 2026-09-08. Status: design, approved in conversation, awaiting review of this document.
Builds on `2026-09-04-customer-schema-verification-design.md` (the verifier, the certification rule,
the data model it introduced). Nothing in that spec's verifier or cache sections changes here.

## 1. Why

The verification flow is built and offline-proven, and the first live use surfaced that the
product around it is not finished: a new website lands in a project called Scratch with a name
made from a URL, the schema wizard is the landing page, the field list is retyped per website,
"Find product pages" has no explanation, the grid gives no feedback while verifying, results push
the layout around, and the operator screens sit in the customer's navigation. This spec fixes the
product shell once, in a shape that does not move again when auth arrives.

## 2. Decisions

Recorded so they are not relitigated.

| Decision | Ruling |
|---|---|
| Home | `/projects`. `/` redirects there now; after auth `/` becomes the landing and sign-in page. Nothing under `/projects` ever moves. |
| Route prefix | `/p/:project` becomes `/projects/:project`. Old paths stay as redirects. |
| Noun for a website | Stays `source` in URLs and code. The interface says "website". |
| Naming | Nothing is auto-named without being editable. Project name is typed at creation. Website name is prefilled from the hostname and editable. Scratch becomes an ordinary project. |
| Where the schema lives | Field name and type are project-wide, on the project's dataset. Location hint, the three proof pages, expected values and certification are per website, on the source. |
| Where the field list is edited | On the project home only. The website's Schema tab shows name and type read-only with a link to the project. |
| Schema tab layout | The table is the page. The three product URLs are the column headers. Listing URLs, probe, confirm and extract live on the Extract tab. |
| Nothing disappears | A section that has been passed locks and offers Edit. A section not yet reached is rendered, dimmed, with its reason. Content is never replaced by different content on the same screen. |
| Listings | A website extracts from a list of listing pages, or from a list of product URLs. The sample walks the first listing only. The full run walks all. |
| Limits | Two dropdowns, products and pages, each "all" or "custom". Both default to all. The engine's 5,000 products per run ceiling stays and is stated on screen. |
| Visual system | Direction B with A's status rail: Fraunces for the names of things, Public Sans for interface text, IBM Plex Mono for values, warm-grey paper, moss accent, status as a 3px left rail plus faint tint. |

## 3. Information architecture

### 3.1 Routes

```
/                                   → redirect /projects
/projects                           projects list, New project
/projects/:project                  project home: fields, websites, output
/projects/:project/sources/:source  website workspace (layout route)
   /                                Schema tab (default)
   /extract                         Extract tab
   /runs                            run list
   /runs/:run                       run detail (own breadcrumbs, no tabs)
   /settings                        was config
/projects/:project/output           the merged table for the project's dataset(s)
/ops/domains, /ops/domains/:domain  operator cache views (was /domains)
```

Redirects, kept indefinitely: `/p/:project/*` → `/projects/:project/*`; `/domains/*` → `/ops/domains/*`;
`/p/:project/sources/:source/setup` → `.../sources/:source`; `/p/:project/sources/:source/config` →
`.../settings`. The datasets list, inputs list and inputs detail routes are removed from the customer
navigation. Dataset detail becomes `/projects/:project/output`; when a project has more than one
dataset the page lists them. Input set screens stay stubs and are unrouted until they have content.

### 3.2 Navigation

Top bar: Projects. An Ops link appears on the right, visually quiet, for the operator views. The
website workspace has four tabs: Schema, Extract, Runs, Settings. Breadcrumb on every project page:
Projects / project name / website name.

### 3.3 After auth

Auth adds a landing page at `/`, scopes `/projects` to the signed-in org, and hides `/ops` behind a
staff role. No route under `/projects` changes. This is the only future-proofing this spec claims.

## 4. Domain model

Three layers, three existing tables. Naming used throughout this spec:

| Layer | Meaning | Table |
|---|---|---|
| Contract | Field name and type, the columns of the output | `datasets.schema` |
| Binding | For one website: location hint, three proof pages, expected values, certification | `sources.schema_definition`, `sources.verification_set`, `source_verifications` |
| Knowledge | What the platform knows about a domain, by concept, across customers | `domain_intelligence.field_paths` |

### 4.1 Contract on the dataset

`datasets.schema` is an array. Each field gains a stable `key`. Shape from now on:

```ts
type DatasetField = {
  key: string;            // minted once at creation, never changes
  name: string;           // customer label, editable
  type: CustomerFieldType; // 'text' | 'number' | 'money' | 'boolean' | 'date' | 'url' | 'image' | 'text_list'
  concept: string;        // cache bridge, derived at creation, operator-editable later
  // legacy, optional, untouched by this spec: description, required, origin, input_column, candidate
};
```

A project created through the new flow gets one dataset, created with the project, named after
it. The dataset is not shown as a separate object; the project home calls it "Fields" and
"Output". Projects that already have several datasets keep them and the Output page lists them.

### 4.2 Binding on the source

`sources.schema_definition` keeps its shape (`key, name, type, description, concept`), but `name`
and `type` are copies of the dataset field with the same `key`, refreshed whenever the dataset
changes. The source owns only `description`. This keeps `definitionHash`, `effectiveSchema`,
export headers and the verifier unchanged. A source's field list is exactly its dataset's field
list; the source cannot add or remove fields.

### 4.3 Propagation rules

- Add a field to the dataset: every source in it gets the field with an empty description and
  empty expected values. Their existing certifications for other fields stay current (see 4.4).
- Rename: free. Copies to every source. No hash change, because `definitionHash` is computed
  over `key, type, description, concept` from now on, not `name`.
- Change type: allowed only while no source has a current certification for that field. Otherwise
  the control is locked with the reason. A locked type is changed by deleting and re-adding.
- Delete: a confirm dialog lists the websites that lose a column and how many rows already hold
  it. On confirm the field is removed from the dataset and from every source's binding and
  verification set.
- Concept: derived as today, never shown to the customer.

### 4.4 Certification is current per field

Today one hash covers the whole definition and a whole-source `all_passed` unlocks Extract. That
grain is wrong once the contract is shared. New rule:

- `source_verifications.results[fieldKey]` gains `fieldHash`: a hash of that field's `key, type,
  description, concept` plus the three URLs and that field's three expected values.
- A field's certification is current when the latest completed verification has a passing result
  for it whose `fieldHash` matches the source's present definition of that field.
- Extract unlocks when every field in the contract is current and passing. The "every cell
  green" product rule is unchanged; only the bookkeeping is per field.
- `loadCurrentCertification` returns the set of current fields and their paths.
  `requireCertification` demands all fields.
- Re-verify covers exactly the fields that are not current, and is free when their captures are
  under a day old and the mechanical search suffices. The button says so.

The whole-definition `definitionHash` column stays for history and as the fast path when
nothing changed.

### 4.5 Migration

One-off script, run once per environment:

1. Every project without a dataset gets one named after the project.
2. For every source with a `schema_definition`, its `name, type, concept` per key are lifted into
   its dataset's `schema`. If two sources in one dataset disagree on type for the same key, the
   dataset takes the first and the second source's field is flagged in the log for hand review.
   Same-key different-name is resolved in favour of the first.
3. Scratch is left as a project named "Scratch" with description "the old sandbox".

No table drops. No migration of `source_verifications` history; old rows simply have no
`fieldHash` and count as not current, which forces one free re-verify per existing source.

## 5. Screens

### 5.1 Projects list (`/projects`)

Table rows: project name and purpose, websites verified as "n of m verified" with a status dot,
field count, last extraction as relative time plus row count. "New project" top right. Empty
state: one sentence and the button.

### 5.2 New project

Dialog. Name, required. Purpose, optional. Hint: "Fields and websites come next, on the project
page." Creates the project and its dataset, opens the project home.

### 5.3 Project home (`/projects/:project`)

Two columns. Left, Fields: an inline-editable table with name, type, and "verified on n of m
websites", the last with a link to the website that needs attention when n < m. Ghost row at the
bottom, paste of a column adds several. Notes under the table state the rules from 4.3 in one
sentence each. Right, Websites: one row per source with name, hostname, verification state, row
count, and "Add website". Below, Output: one line per dataset with columns, rows, website count
and an Open link. Rename via a pencil next to the title. Download CSV top right when there are rows.

### 5.4 Add website

Dialog. "Any page on the website", required, http(s) only. Name, prefilled from the hostname
once the address parses, editable. Hint: "Next you'll pick three product pages and fill in the
expected values." Creates the source in the project's dataset with the contract's fields and empty
bindings, and opens its Schema tab.

### 5.5 Website workspace header

Breadcrumb, then the website name with a rename pencil, the hostname in mono on the right, then
the tabs. The verification summary is not in the header; it lives in each tab's status strip.

### 5.6 Schema tab

The table is the page. Columns: Field (read-only), Type (read-only), "Where it is on this
website" (editable), then one column per proof page. Field and Type link to the project with a
note "Field names and types come from the project."

Column headers carry the shortened URL path, a page number, and a pencil. The pencil opens a
popover with the full URL input and "Don't have product pages yet? Find some from a listing
page", which takes a listing URL and returns up to ten candidates with a "Use as page n" action.
A URL edit marks that column's cells stale, never deletes results.

Status strip above the table, fixed height, always present. It carries the summary on the left,
the stage on the right of that, and the Verify and Extract buttons on the far right. States:

| State | Strip | Table | Buttons |
|---|---|---|---|
| Editing | "Not verified yet · n fields · 3 pages" | editable | Verify with upper bound, Extract off with tooltip "Unlocks when every cell is green" |
| Verifying | "Verifying", progress bar, stage text, rough time (**deferred to phase 5** — not implemented) | inputs read-only, values legible, add/paste/import faded; each column header shows captured / capturing / queued; expected cells shimmer | both off, lock note in the strip |
| Results | "n of m fields verified · k need attention · j changed since" | cells coloured by rail and tint; second line reserved on every expected cell | Re-verify with count and "free" or cost, Extract on when all green |
| Stalled | amber note in the strip, "Run it again" | editable | Verify on |
| Capture failed | column header shows "not captured" with the reason; screenshot on hover | that column's cells amber | Verify on |

Implemented as two spans, summary and detail, so section 6's single-separator rule holds per
span rather than across the concatenated strip text (phase 3/4).

Cell second line, always reserved so nothing shifts: green shows "from json-ld / api / meta /
page", and "page shows X" when the found value differs in formatting; red shows the reason and
the fix; grey shows "changed since verified". Red reasons are the four from the verifier with
these customer-facing sentences:

- not found, and the expected value parses as a URL while the type is text: "Not found as text.
  It looks like a link: set type to url." with a one-click chip on the row that changes the type
  at the project level if no other website has certified it, or explains why not.
- not found otherwise: "Not found on this page. Check the value, or say where it is."
- different value: "This page shows X. Is your value right, or does the page show it differently?"
- ambiguous: "Several places match. Add what makes yours different to the description."
- type mismatch: "Found X, which is not a valid <type>."

Re-verify label rule: "Re-verify n fields · free" when the stored captures are fresh and no field
needs AI on the estimate; otherwise "Re-verify n fields · up to $x".

Ghost row is gone from this tab; fields are added on the project. Paste and import remain, mapped
by field name onto existing rows, filling description and expected values only. Implemented
(phase 3): rows map by field name, falling back to position when a pasted row's name doesn't
match any field.

### 5.7 Extract tab

A stepper with three sections that are always rendered. The strip at the top shows the three
steps with their state; the current one is outlined.

Section 1, Pages. A segmented control: "Listing pages" or "Product URLs".

- Listing pages: a small table, one row per listing URL, with a Check column and remove. A row is
  checked automatically when added: one page load, no AI, nothing saved until Sample or Extract.
  Correction (implemented in phase 4): the section has an explicit "Save pages" / "Save URLs"
  button instead — checking is still free and nothing is written by the check itself, but the
  input set is written when the customer saves, not as a side effect of sampling or extracting.
  Check reports "n product links · pager found" green, "n product links · no pager seen" amber,
  or an error. The check is the existing link harvest, extended to return the count and whether a
  pagination control was seen.
- Product URLs: a textarea and CSV import with a url column. Inline count: total, how many are
  the proof pages, how many are off-host and will be skipped.

Section 2, Sample. Listing mode only. Button "Sample 3 products" with the sentence "walks the
first listing for up to 3 pages, extracts 3 products with the verified paths. No AI. Free."
After it runs: four facts (pages walked, product links found, pagination detected, sample rows
complete) and the sample rows in the contract's columns, empty cells highlighted with the
sentence "X was empty on n of m sampled pages. Extraction leaves such cells empty and counts
them; it never guesses." Section 1 locks with "Edit pages"; editing marks the sample stale in
place. Product-URL mode shows one line: "No sample needed, the pages are known."

Section 3, Run. One line: Run [all ▾] products across [all ▾] pages. Each dropdown offers all
and custom; custom reveals a number box after it. Both default to all. Below: "n listings ·
safety stop at 5,000 products per listing". Button: Extract. On start, the section shows the run's
progress line and a link; it does not change into something else. Unlock rule: listing mode
after a sample exists; product-URL mode as soon as the schema is fully green.

Correction (phase 4 review): the 5,000-product ceiling is **per listing input**, not per run —
`planRun` measures every input's budget against that input's own gain, never a running total
across the run, so n listing pages at all/all can plan up to n × 5,000. The sentence says "per
listing" for that reason. Product-URL mode has one input row per URL and no walk, so it reads
"safety stop at 5,000 products" with no qualifier.

Locked tab: when the schema is not fully green, every section is dimmed and the strip says
"Extraction is locked · n of m fields verified · fix <field> on the Schema tab" with a link.

### 5.8 Runs and Settings

Runs: the existing list, restyled. Run detail unchanged in structure, restyled. Settings: the
existing config screen, restyled, plus rename and delete for the website.

## 6. Copy rules

- Names by what the customer understands: project, website, field, page, product, extraction.
  "Source", "dataset", "input set" do not appear in customer-facing text. A run is called an
  "extraction" in sentences; the tab label is "Runs" because it is short and the run detail
  page already uses the word.
- Every button says what happens: "Create project", "Add website", "Verify", "Sample 3 products",
  "Extract". The verb stays the same through the flow.
- Every disabled control has a visible reason within one line of it.
- Empty states are one sentence and an action.
- Sentence case everywhere. No uppercase tracked labels. No middle-dot chains in prose; the
  strip may use a single separator between two facts.

## 7. Visual system

Replaces the current tokens in `packages/dashboard/src/styles.css`. Light mode only.

- Type. Fraunces 500 and 600 for the names of things: project name, website name, page titles.
  Public Sans 400, 500, 600 for all interface text. IBM Plex Mono 400 and 500 for every value,
  URL, key, and number in a table. Scale: 24/1.2 title, 18/1.25 section, 14/1.5 body, 13/1.45
  table, 12/1.4 secondary, 11/1.35 cell second line. Tabular numerals in tables.
- Palette. Paper `#f3f4f1`, surface `#fbfbf9`, ink `#1c1f1a`, ink-soft `#5f665c`, rule
  `#d5d9d1`, rule-soft `#e1e4de`, accent `#1f5e4a` with hover `#174a3a` and tint `#e8f2ea`.
  Status: pass `#1f7a4d` on tint `#eaf4ee`, fail `#a13a2a` on tint `#f6e6e3`, warn `#8a5a12` on
  tint `#f5ecdc`, changed `#7a8077` on tint `#ebece8`.
- Status treatment. A 3px rail on the left edge of the cell in the status colour, the cell
  background in the status tint, the value in ink, the second line in the status colour for
  fail and warn and in ink-soft otherwise. No glyphs in cells; the rail is the glyph.
- Tables. Surface background, a 2px ink rule on top, 1px rule-soft between rows, header row in
  Public Sans 600 12px ink-soft, URL headers in Plex Mono with the page number under them.
  Row height 36px on the schema grid, 32px elsewhere.
- Status strip. 38px, paper-dark `#e9ebe5`, radius 8px, progress bar in accent.
- Buttons. Primary: accent background, white text, radius 6px. Quiet: transparent, 1px rule
  border, ink text. Disabled: 45% opacity, reason nearby.
- Cards are used only for dialogs and the websites list. Everything else sits on the paper
  with rules, not boxes.
- Motion. The shimmer on verifying cells and the progress bar are the only non-user-triggered
  motion. Respect `prefers-reduced-motion`.
- Focus ring: 2px accent, 2px offset. Contrast of every text token on its tint is at least 4.5:1.

Fonts load from Google Fonts as today, with system fallbacks.

## 8. API changes

New or changed procedures in `@robot/api`. Existing ones not listed are untouched.

- `projects.create` takes `name, description?` and also creates the project's dataset.
- `projects.rename`, `sources.rename`: name only.
- `datasets.addField`, `datasets.renameField`, `datasets.retypeField`, `datasets.deleteField`:
  enforce 4.3, propagate to every source in the dataset, return the affected source ids.
  `retypeField` refuses when any source has a current certification for the key.
- `sources.createInProject` replaces `createWithSchema`: `projectSlug, name, anyUrl`. Creates the
  source in the project's dataset with the contract's fields, an empty binding, and no input set.
  `createWithSchema` and `quickCreate` are removed with their tests; the smoke test that used
  them moves to the new procedure.
- `sources.updateBinding` replaces `updateSchema`: `sourceId, descriptions: Record<key,string>,
  urls: [3], expected: Record<key, Record<url,string>>`. Same in-flight refusal.
- `sources.setListingPages`: `sourceId, urls: string[]`, writes the input set rows and
  `listing_mode`. `sources.setProductUrls`: same for detail mode. Both replace the wizard's
  single `listingUrl`. Both also set `parameters.inputMode` (`'listing'` / `'detail'`) the first
  time they save pages for a Source. This marker has two effects, implemented (phase 4): (1) a
  binding save no longer overwrites the input set's remembered listing URL once the marker is
  set, so the Schema tab's "find pages from a listing" popover can't clobber the Extract tab's
  saved input; (2) the old flow's automatic 40/3 starter budget
  (`{max_items:40,max_pages:3,mode:'first_n'}`) is treated as "unset" (and reseeded to all/all) by
  `budgetIsUnchosen` only while the marker is absent — once it exists, any stored budget, starter
  value included, is a real choice and is never silently reseeded.
- `sources.inputRows`: `{ sourceId } → { urls: string[], updatedAt: Date | null }`, implemented
  (phase 4) as a new public procedure reading the input set directly rather than
  `sources.updated_at` (which is bumped by unrelated saves — rename, budget, schema, confirm).
- `sources.checkListingPage`: `listingUrl` → `{ productLinks: number, pagerSeen: boolean,
  sample: string[] }` where `sample` is up to ten of the product links found, for display.
  Extends `findProductPages`, which stays for the Schema tab popover.
- `sources.verificationStatus` returns per-field currency per 4.4.
- `crawl.probeAndSample`, `crawl.plan`, `sources.confirm`: unchanged signatures. `sources.update`
  accepts the budget shape below.

Budget shape on `sources.budget`: `{ max_items: number | 'all', max_pages: number | 'all',
mode }`. `resolveBudget` maps `'all'` items to the existing all mode. **Implemented differently
from the paragraph above (phase 4):** `'all'` pages resolves to `PAGES_ALL_CEILING` (10), the
walk's existing single-burst anti-bot cap, not to `maxPages: Infinity`. An unbounded value would
be dishonest — the walk already refuses to burst past ten pages in one go — so the tab's copy
says "up to 10 pages per listing" rather than promising an unlimited walk. The existing per-run
item ceiling and the existing api-walk batch cap still apply. The budget applies per listing
input, as it does today.

## 9. Engine changes in `@robot/scraper`

- `definitionHash` excludes `name`. A per-field hash function `fieldHash` is added next to it and
  written into every result.
- `runVerification` accepts `onlyKeys` as today and copies forward results whose `fieldHash` is
  unchanged.
- `resolveBudget` and the walks accept `'all'` pages per section 8 — resolved to
  `PAGES_ALL_CEILING` (10, the existing single-burst api-walk cap), not unbounded. Section 8's own
  wording was corrected the same way; this bullet said "unbounded" and was stale.
- The link harvest behind `findProductPages` also returns the count of same-template links and
  whether a pagination control exists, reusing the pager detection the walk already has.

## 10. Testing

- Unit: `fieldHash` stability and sensitivity; propagation rules in 4.3 as table-driven tests
  against a test database; `resolveBudget` with `'all'`; migration script against a fixture
  database with a two-source dataset that disagrees on type.
- Tier 1 fixtures: the existing `shop-example` triple gains a case where a field is added to the
  contract after a passing verification and the other fields stay current.
- Dashboard: `pnpm test:ui` covers every route in section 3.1 plus each redirect; the grid state
  helpers get unit tests for the new column-header URL editing and for the paste-by-name merge.
- Visual: one screenshot per screen state in section 5 is captured by the smoke test into
  `docs/testing/screens/` for hand review; not asserted.

## 11. Out of scope

Auth and org scoping. Templates for contracts. Operator editing of concepts. A job queue.
Multiple contracts per project in the interface beyond listing them on the Output page. Dark
mode. Any change to the verifier's search, normalisation or certification rule.

## 12. Sequencing

Five phases, each shippable on its own, in this order because each constrains the next:

1. Routes and shell: `/projects` prefix, redirects, nav, ops area, rename procedures, Scratch as a
   normal project, New project and Add website dialogs, naming rule.
2. Contract on the dataset: field shape with key, the field procedures, propagation, migration,
   `sources.createInProject`, per-field certification currency.
3. Schema tab: header URLs, status strip and states, cell second line, copy, project-linked
   Field and Type columns, paste-by-name.
4. Extract tab: stepper, listing pages table with Check, sample section, run sentence, budget
   `'all'` in the engine. Landed 2026-09-10.
5. Visual system: tokens, fonts, table and strip styling, restyle of Runs, run detail, Settings,
   ops screens. Phases 1 to 4 are built with the new tokens from the start where a screen is
   new; phase 5 finishes the rest.
