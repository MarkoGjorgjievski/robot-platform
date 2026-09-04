# Customer-Defined Schema with Ground-Truth Verification

**Date:** 2026-09-04
**Status:** Approved direction (Marko, chat) — pending spec review
**Origin:** Marko's ruling after the 2026-09-02 corpus measurement (~65% verifiable accuracy
over 7 of 8 domains): the MVP is not precise enough to compete, and precision cannot come from
discovering everything on the page. The customer must define what they need, in detail, and
we must prove we can get it before extracting at scale. Competitors with customer-defined
schemas sit at 80–98%; the gap to beat is that their schemas are description-only. Ours adds
ground truth. Supersedes the customer-facing half of
`2026-08-26-mvp-simplification-design.md` (declared-URL home flow, discovered-field table,
add-fields). The probe-confirm gate for listings survives behind the new first step.

## 1. The one mental model

**A schema is a test suite.** The customer fills a spreadsheet-like grid: one row per field,
with a name, a type, a description of where the value lives on the page, and the exact value
they expect on each of three product URLs from one website. We capture those three pages, find
each expected value mechanically, and certify only paths that produce the right value on all
three. Extraction at scale runs certified paths and nothing else. An empty cell in an export
means "no proven path found it", never "a model's best guess".

Decisions Marko made in the design conversation, recorded so nobody relitigates them:

| Decision | Ruling |
|---|---|
| Who fills the grid | The customer, self-serve. No auth in this MVP; auth and sessions are a later, orthogonal layer. The form is designed for a customer, not an operator. |
| Ground truth required | Every cell. Three URLs, every field, every expected value typed by the customer. A blank is a validation error. |
| Schema scope | Per website (one Source). A customer with five retailers fills five grids. Each field carries a stable key and a concept so merging into a dataset later is a rename, not a rebuild. |
| Verification failure | Blocks. Extract is disabled until every cell passes. The customer fixes the description or the value, or deletes the row. |
| Listings | Optional and separate. The grid verifies against product pages; a listing URL, when given, goes through the existing probe-confirm gate after the grid is green. |
| AI assistance in the grid | None for now. No suggested rows, no pre-filled values. Later stage. |
| Old home flow | Replaced. Discovery stays as an internal tool; it leaves the customer path. |
| Extraction at scale | Certified paths only. A miss leaves the cell empty and is counted; no fallback to the old chain. |
| Certification rule | A path must produce the expected value on all three URLs. No two-of-three tolerance. |
| Extra discovered data | Internal only. Never shown in the customer's grid or export, never spent on in this flow. |

## 2. The screen

One route replaces the landing page and the Source workspace: the schema grid for a website.
Creating a Source and filling its grid are the same act.

### 2.1 Site and URLs

Three product URLs, required, pasted one per line. They must share a hostname, which becomes the
Source's domain; a mismatch is rejected inline. Below them an optional listing URL, same hostname
rule (§6). Editing a URL after a verify invalidates that column's results.

### 2.2 The grid

Rows are fields. Fixed columns left to right: **field name**, **type**, **description**, then
one **expected-value column per URL**, headed by a shortened form of the URL (path only, middle
truncated). Behaviour:

- Spreadsheet editing: Tab/Shift-Tab and arrow keys move between cells; Enter commits a cell
  and moves down; a paste of tab-separated text fills a rectangular block starting at the
  focused cell, adding rows as needed; add-row button at the bottom; per-row delete.
- File upload (CSV or XLSX) fills the same grid. Column mapping is by header name with a
  one-step mapping dialog when headers don't match. The customer always sees the grid before
  verifying; upload never verifies directly.
- Field name: any non-empty string, unique within the grid, shown as typed in exports.
- Type: one of `text`, `number`, `money`, `boolean`, `date`, `url`, `image`, `text_list`.
- Description: free text, required. Placeholder copy asks for location and appearance
  ("green number next to Add to cart, not the crossed-out one").
- Expected value: validated against the type as typed (a `money` cell cannot hold "call for
  price"). Type validation errors show inline and block Verify.

### 2.3 Verify

One button. Enabled only when the URLs are valid, every row has a name, type, and description,
and every expected-value cell is filled and type-valid. The button shows an upper-bound cost
(number of fields × the per-field AI price) because we cannot know in advance which fields
resolve mechanically. Clicking captures the three pages and runs the verifier (§4). Progress
shows the stage (capturing 1/3 … searching … asking AI for N fields). Target wall clock is under
two minutes, dominated by capture.

Results paint each expected-value cell green or red. A green cell shows the value we found
beside the customer's value (they may differ in formatting — see normalization, §4.2) and, on
hover, the path source (API, JSON-LD, meta, page). A red cell shows a reason from a fixed list
(§4.6) and a hint. The header reports "N of M fields verified".

### 2.4 Fixing red cells

The customer edits the description or the expected value on a red row and clicks Verify again.
Re-verify reruns only red fields and reuses the stored captures if they are under a day old,
so it is fast and cheap. Deleting the row is the other exit. A green row whose description or
expected value is edited turns grey ("changed since verified") and must be re-verified.

### 2.5 Extract

Enabled only when every cell is green. Detail mode: the customer pastes the URLs to extract
(the existing InputSet-of-URLs flow) and the run proceeds under §5. Listing mode (a listing URL
was given): the existing probe-confirm gate runs (§6).

## 3. Data model

All on the Source unless noted. No table drops; consistent with the deferred-drops decision.

### 3.1 `sources.schema_definition` (jsonb)

```ts
type SchemaField = {
  key: string;          // stable slug, derived once from the first name, never changed
  name: string;         // customer's label, editable, appears in exports
  type: 'text' | 'number' | 'money' | 'boolean' | 'date' | 'url' | 'image' | 'text_list';
  description: string;
  concept: string;      // domain-level name, e.g. 'price'; bridge to the cache (§5.1)
};
```

`key` is what `run_items.target_fields`, `absent_fields`, coverage, export columns, and
`source_verifications` use. `name` is presentation only. Renaming never orphans anything.
`concept` is derived at creation from type and name (a small alias table: `price`, `cost`,
`unit_price` → `price`; `title`, `name`, `product_name` → `product_name`; otherwise the key)
and editable on an operator surface later, not in the customer grid.

### 3.2 `sources.verification_set` (jsonb)

```ts
type VerificationSet = {
  urls: [string, string, string];
  expected: Record<string /* field key */, Record<string /* url */, string>>;  // as typed
  listing_url?: string;
};
```

Stored exactly as typed, before normalization, so the customer sees what they wrote.

### 3.3 `source_verifications` (new table)

One row per Verify click.

| column | type | notes |
|---|---|---|
| `id` | uuid | |
| `source_id` | uuid FK | |
| `started_at`, `completed_at` | timestamptz | `completed_at` is the terminal marker, as elsewhere |
| `captures` | jsonb | `{ [url]: { captureId, capturedAt, blockedReason? } }` |
| `results` | jsonb | `Record<fieldKey, Record<url, CellResult>>` (below) |
| `all_passed` | boolean | derived at completion; what unlocks Extract |
| `cost_usd` | numeric | AI spend, from the agent's usage accounting |
| `ai_calls` | integer | |

```ts
type CellResult =
  | { status: 'pass'; found: string; path: CertifiedPath }
  | { status: 'fail'; reason: FailReason; found?: string; nearMisses?: string[] }
  | { status: 'not_captured' };

type CertifiedPath = {
  source: 'api' | 'json-ld' | 'meta' | 'xpath';
  path: string;                 // dot-path or XPath
  transform?: Transform;        // §4.3
};
```

History is kept. The latest completed verification with `all_passed = true` and an unchanged
`schema_definition`/`verification_set` (compared by a content hash stored on the verification
row) is the Source's *current certification*. `sources.confirmed_at` is no longer read for
detail sources; it stays for the listing gate (§6).

### 3.4 What is replaced

`sources.requested_fields`, `sources.selectors_json.fields` as the customer-visible schema, and
the customer-facing use of `confirmed_at` for detail sources. `datasets.schema` stays (the
Scratch project's dataset is what a new Source attaches to) but is not read on this path;
`effectiveSchema` for a Source with a `schema_definition` returns that definition mapped to
`OriginField` with `origin: 'detail'`, `name = key`, and the display name carried alongside
for export headers. The old fallback to `selectors_json` remains for legacy Sources.

## 4. The verifier

A new module in `@robot/scraper` (`packages/scraper/src/verify/`), beside the extraction chain,
not inside it. Exposed through a new `sources.verify` tRPC procedure in `@robot/api` that runs
the work outside the HTTP request, like `crawl.execute`, and is polled by the dashboard.

### 4.1 Capture

The three URLs are captured with the existing `capture` path (DOM, screenshot, intercepted
JSON, JSON-LD, meta). Captures are persisted and their ids stored on the verification row. A
capture that returns `blockedReason` or lands on a page whose canonical URL differs in path
from the requested one marks that column `not_captured` (§7).

### 4.2 Normalization

Matching compares normalized forms per type. Rules, fixed and unit-tested:

| type | normalization |
|---|---|
| `text` | trim, collapse whitespace, case-insensitive, Unicode NFKC |
| `number` | parse digits with either decimal separator, ignore thousands separators; equal within 1e-9 relative |
| `money` | as `number`, additionally strip currency symbols/codes; equal within one cent; record the expected currency if present |
| `boolean` | synonym sets: yes/true/in stock/available → true; no/false/out of stock/unavailable → false |
| `date` | parse to a calendar day (ISO, common locales); equal by day |
| `url`, `image` | resolve relative to the page URL, drop fragment, compare case-insensitive on host, exact on path |
| `text_list` | split on newline, comma, or semicolon; trim items; compare as a set with `text` rules |

The customer's typed form also defines the **output format**: the transform recorded with a
certified path is what converts the raw page value into the customer's form, so exports show
`129.99` when the customer typed `129.99`, even if the page said `$129.99`.

### 4.3 Search

For each field and each capture, search all four sources for the normalized expected value:

- **JSON bodies, JSON-LD, meta:** walk every leaf. A leaf whose normalized form equals the
  expected value yields a dot-path plus the transform that maps raw to expected (`strip_currency`,
  `cents_to_units`, `first_of_list`, `map_boolean`, `date_to_day`, `identity`, …). Transforms are
  a closed enum; the walker only proposes ones from it.
- **DOM:** find text nodes (and `@href`/`@src`/`@content` attributes for `url`/`image`) whose
  normalized text equals the expected value. For each, build a structural XPath from the nearest
  ancestor carrying an `id`, a `data-*` attribute, or a class, walking down by tag and class.
  **Rule:** an XPath whose string contains the expected value is rejected. This closes the
  "reverse-search overfits to the literal value" defect in `docs/ideas.md`.

Every hit is a *candidate path* for that field on that capture. Hits are collected per field
across the three captures.

### 4.4 Certification

A candidate path is **certified** for a field only if executing it on all three captures yields
the field's expected value on each, after its transform. Certified paths are ranked by the
existing source-authority order (API > JSON-LD > meta > XPath), then by path length. The top one
is primary; the rest are fallbacks, capped at five, matching the cache's per-field cap.

A field whose three expected values are identical is certified as usual but flagged
`weak_evidence` on the result (three identical answers cannot distinguish paths). Shown as a
grey note on a green cell, not a failure.

### 4.5 AI fallback

For each field with no certified path: one call to the agent through a tool contract
(`propose_path`), with the description, the field type, the three expected values, each
capture's evidence (API bodies serialized per body, JSON-LD, meta, a DOM slice around the
near-misses), and the near-misses found in §4.3. The tool returns one or more `{ source, path,
transform }` proposals. Every proposal goes through §4.4 like any other candidate; a proposal
that does not certify is discarded and its best per-capture result becomes the `found` value on
the red cell. `callWithTool` throws on `stop_reason: max_tokens`, per the existing rule.

At most one call per field per Verify. No second attempt without a customer edit.

### 4.6 Result and reasons

Per cell, `CellResult` (§3.3). `FailReason` is a closed list and drives the customer hint:

| reason | meaning | hint |
|---|---|---|
| `not_found` | value not present in any source of this capture | "We couldn't find this value on this page. Check the value, or open the page and copy it exactly." |
| `different_value` | the paths that certify on the other pages return something else here | "On this page we found *X*. Is the expected value right, or does this product show it differently?" |
| `ambiguous` | several paths certify but disagree on this page | "Several places on the page match. Add to the description what distinguishes the one you want." |
| `type_mismatch` | found but the raw value cannot be transformed to the type | "Found *X*, which is not a valid <type>." |

`all_passed` is true when every cell is `pass`.

### 4.7 Cost

Fields that resolve mechanically cost nothing beyond capture. A stubborn field costs one call,
on the order of five cents. A fifteen-field site with five stubborn fields verifies for well
under a dollar. Re-verify of red cells reruns §4.3–§4.6 on stored captures. Verification is the
only place a customer-created Source ever spends on AI.

## 5. Cache and extraction at scale

### 5.1 Certified paths in the domain cache

On `all_passed`, every certified path is written to `domain_intelligence.field_paths` under the
field's **concept** (not the customer's name or key), with a new `PathSource` value `verified`,
its transform, hit/miss counters at zero, `lastValue`, and `lastUrl`. Rules:

- `verified` sits above every existing source in `sourceAuthority`; human pins keep supremacy
  above it.
- The automatic prune never removes a `verified` path. Degradation is flagged (§5.3).
- The next customer verifying the same concept on the same domain gets the cached `verified`
  paths executed first in §4.3, before any search. If they certify against that customer's
  three pages, no search and no AI run for that field.

The `findConcept` string heuristic in `domain-cache.ts` is replaced by the explicit `concept`
on each field for Sources with a `schema_definition`; legacy Sources keep the heuristic.

### 5.2 Extraction runs certified paths only

`extract-item` for a Source with a current certification passes each field's certified paths
(primary then fallbacks, with transforms) to a new `runVerifiedExtraction` in `@robot/scraper`.
It executes those paths against the page's capture in order and takes the first that yields a
type-valid value. It does not consult the mechanical tier, other cached paths, candidate
serving, or any AI rung. A field whose paths all miss is left empty and the miss is recorded per
path through the existing per-path hit/miss accounting in `domain-cache.ts` (the same ledger
the 2026-09-02 cache-reputation fix made real), and a hit likewise.

The pre-existing chain (`runExtraction`) stays for legacy Sources and operator tools.

### 5.3 Drift

When a field's miss rate across a run's items crosses `DRIFT_MISS_SHARE` (0.2), the run still
finishes; the field is flagged `drifted` on the run and on the Source. The remedy is a
re-verify on the stored verification set: free if the three pages still carry the same values,
otherwise the customer updates values. Because the verification set is a fixture, a scheduled
per-source re-verify (no customer present) is the drift check the vision doc's Pillar 2 asks
for; scheduling itself is out of scope here, the procedure it would call is not.

### 5.4 Extra data

The verifier only searches for what the customer asked for; nothing else is discovered and
nothing is spent on it. Candidate-catalogue discovery remains an operator tool; its output never
appears in the customer grid or export.

## 6. Listings and pagination

- The optional listing URL lives on the grid screen, same hostname as the product URLs. It does
  not participate in verification.
- After the grid is green, Extract on a Source with a listing URL runs the existing
  `crawl.probeAndSample`: walk up to three pages, enumerate detail URLs, extract
  `PROBE_SAMPLE_LIMIT` items **using certified paths only** (§5.2). The gate shows row count,
  pagination strategy, sample rows, sample detail URLs; `sources.confirm` starts the full
  crawl and sets `confirmed_at` as today.
- "Find product pages": a customer with only a listing URL can run the listing half of the
  probe (enumeration only, no item extraction, no AI) and gets the first ten detail URLs found,
  to copy into the grid.
- Pagination proofing stays count-based through the existing walk-verification gate. No
  customer-supplied page counts.
- Listing-only fields (rank, position) are out of scope for the grid; every field is verified
  on product pages.

## 7. Failure modes

- **Capture failed** (blocked, timeout, redirected to a different path): the column is
  `not_captured` with the screenshot and reason; nothing in it is judged; Verify is incomplete.
  The customer swaps the URL or retries. Anti-bot surfaces at step one on three known pages
  rather than mid-crawl.
- **Duplicate or near-duplicate URLs**: two URLs resolving to the same canonical page are
  rejected inline. Three identical expected values on a field produce `weak_evidence`, not a
  block (§4.4).
- **Stale captures**: a capture older than 24 hours is not reused; re-verify recaptures.
- **AI budget**: every AI call traces to the Verify click; the button shows the upper bound;
  nothing on this path calls the API without it. `ANTHROPIC_API_KEY` absent → mechanical-only
  verification with an honest "AI unavailable" note on fields that would have needed it.
- **Mid-verify crash**: the verification row has no `completed_at`; the dashboard shows it as
  stalled after a timeout and offers re-run; captures already stored are reused.

## 8. Testing

- **Unit:** normalizers per type; JSON/JSON-LD/meta walkers; DOM search and structural XPath
  construction including the no-literal-value rejection; transform application and its closed
  enum; certification over three captures (all-three rule, ranking, cap, `weak_evidence`);
  `FailReason` derivation; concept derivation; `effectiveSchema` mapping of a
  `schema_definition`.
- **Tier 1 fixtures (offline):** (a) a Newegg grid over three captured product pages expected
  to certify every field mechanically with zero AI calls; (b) a grid where one field needs the
  AI rung, with the agent stubbed to return one good and one bad proposal, proving the bad one
  is discarded by certification and the good one certifies; (c) `runVerifiedExtraction` over a
  fourth captured page, proving certified-only behaviour and that a missing field stays empty
  and records a miss.
- **Dashboard:** grid paste of a tab-separated block, type validation, Verify/Extract enabled
  states, red-cell reason rendering, in the existing `pnpm test:ui` smoke suite.
- **Cache hygiene:** the existing post-test gate query gains any new fake hostnames.
- **One paid live proof,** with Marko's explicit go, on a corpus domain not blocked at the
  time: fill a real grid, verify, extract ten items, hand-check every cell. Recorded under
  `docs/testing/`.

## 9. What is removed

Customer-facing: the landing page's paste-and-pick flow (`landing.tsx`), the Source
workspace's discovered-fields table and `AddFieldsControl`, and the customer path through
`sources.quickCreate`, `sources.analyze`, `sources.requestFields`, `sources.setFieldEnabled`.
The procedures may survive as operator tools if a caller remains; otherwise they are deleted
with their tests. Existing Sources without a `schema_definition` stay readable and runnable
from the operator run pages but cannot be verified until a grid is filled for them. No columns
or tables are dropped.

## 10. Out of scope

AI-suggested rows or values in the grid (later stage). Auth, sessions, per-customer scoping.
Dataset-level schemas spanning sites. Listing-only fields. Scheduled re-verification (the
procedure exists; the scheduler does not). Two-of-three certification tolerance. The vision
agent as a last rung. Operator surface for editing `concept`.
