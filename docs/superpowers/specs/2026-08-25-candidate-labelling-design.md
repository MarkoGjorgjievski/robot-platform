# Candidate Labelling (v2.5) — Design

**Date:** 2026-08-25
**Status:** Approved by Marko (chat, 2026-08-25) — pending final spec review
**Origin:** `docs/ideas.md` → "Label every candidate instead of picking one"; `docs/vision.md` Pillar 1; Open decision 1 in `docs/handoff.md`; cache-conflict triage 2026-08-25.

## 1. Problem

One page carries several simultaneously valid values for the same concept, and the
extraction chain is forced to pick one with no way of knowing which one the customer
means. The evidence, all recorded:

- Newegg (2026-08-19, seven fixed-path captures): four price-shaped values at once —
  and **the displayed price ($389.99) matched none of the API fields**. `FinalPrice`
  (399.99) sounds authoritative and is not what a shopper pays. A plausible wrong
  answer defeats every existing guard: shape validation, corroboration, and the
  conflict detector all see well-formed, internally consistent data.
- Target: `rating.count` (5) vs `review_count` (3) — two different true metrics.
- Barnes & Noble: site JSON-LD ratings vs Yotpo ratings — two whole review systems on
  one page (3.5/31 vs 3.75/176).
- The 2026-08-25 triage classified "multiple simultaneously valid values" as the
  largest conflict bucket in the live cache, across all three measured domains —
  so this is a platform feature, not a marketplace quirk (question 1 of the ideas
  entry, now answered).

Picking harder cannot fix this. The ambiguity is a customer preference, not a fact
about the page, so it must be resolved once per customer — not per extraction.

## 2. Goals

1. **Catalogue** — per domain, discover and label every candidate a concept yields
   ("Newegg offers six price-ish values"), cached like all domain intelligence.
2. **Displayed verification** — mark, with a vision check, which candidate the page
   actually shows a shopper; it is the label most customers mean.
3. **Selection** — per dataset, let a customer point a schema field at a specific
   candidate; two customers may select different prices from the same domain.
4. **Default that changes nothing** — with no selection, serving prefers the
   `displayed` candidate, then today's ranking. Export shape is unchanged until a
   customer opts in by adding fields.
5. **Conflict detection narrowed** — differently-labelled candidates are catalogue
   entries, not conflicts; the warning keeps firing only for same-candidate
   disagreement (poison/staleness).

### Non-goals (recorded, deliberate)

- **Full scope columns.** A candidate's scope (seller, review system, region) rides
  in its metadata and label — no new column machinery. Own cycle if customer need
  shows. (Marko's ruling, 2026-08-25.)
- **Auto-selection heuristics** beyond preferring `displayed`.
- **Catalogue refresh scheduling** — refresh is operator-triggered or drift-triggered
  only.
- **Fan-out of all candidates into every export** — rejected in favour of default +
  explicit override (Marko's ruling, 2026-08-25).

## 3. Data model

### 3.1 The catalogue (`domain_intelligence.candidate_catalogue`, new jsonb column)

```ts
/** What one domain can yield for one concept. Discovered once, cached, refreshed on demand. */
type CandidateCatalogue = Record<ConceptName, Candidate[]>;

/** Semantic family, snake_case singular: "price", "rating", "review_count", "image". */
type ConceptName = string;

type Candidate = {
  /** Short distinctive label within the concept: "displayed", "list", "range_min", "yotpo". */
  label: string;
  /** Same vocabulary as FieldPath.source: json-ld | meta | xpath | api | api-ai | ai-vision | human. */
  source: string;
  /** Dot-path or XPath — the same path language field_paths already speaks. */
  path: string;
  /** The value observed when the catalogue was built; display/debug only, never served. */
  sampleValue: unknown;
  /** Scope facts that make the value interpretable; label-only in v2.5. */
  scope?: Record<string, string>;   // e.g. { seller: "MobileMonster" }, { system: "yotpo" }
  /** Set by the displayed-verification pass; at most one true per concept. */
  displayed?: boolean;
  /** When displayed-verification last ran for this concept (ISO). */
  verifiedAt?: string;
};
```

Rules:

- **Max 8 candidates per concept**, kept in source-authority order (`sourceAuthority`
  in `domain-cache.ts`). Observed real counts are 2–6; the cap is a backstop against
  candidate explosion (question 3 of the ideas entry), and hitting it is a warning,
  not silent truncation.
- Labels are unique within a concept. The labelling pass is instructed to name the
  *meaning* (`list`, `range_min`, `promo`), never the path.
- At most one `displayed: true` per concept; "none is displayed" is a valid,
  recorded outcome (`verifiedAt` set, no flag).
- The catalogue never serves values. Serving stays in `field_paths`; the catalogue
  is the map from meaning to path.

One additive Drizzle migration: `candidate_catalogue jsonb default '{}'` on
`domain_intelligence`. No back-fill; domains build catalogues on their next
successful extraction.

### 3.2 Selection (`datasets.schema` field extension, no migration)

A dataset schema field gains an optional reference:

```ts
type SchemaFieldCandidateRef = {
  concept: ConceptName;
  label: string;
};
// SchemaField gains: candidate?: SchemaFieldCandidateRef
```

`datasets.schema` is already jsonb; fields without `candidate` behave exactly as
today. A dangling ref (catalogue refreshed, label gone) degrades to the no-selection
path and surfaces a warning naming the missing label — it must never fail the field.

### 3.3 Path bookkeeping additions (`FieldPath` in `domain-cache.ts`)

- `lastUrl?: string` — set wherever `lastValue` is set. Used by conflict detection
  (§6) so only same-page observations are compared.
- Stable identity for AI-description paths: `ai-discovered-variants` (and any source whose
  "path" is prose) writes under a fixed synthetic path per field (`ai:<field>`),
  updating in place instead of appending a new near-duplicate per run. Kills the
  5-near-duplicates churn found in the triage.

## 4. Catalogue discovery — the one AI pass per domain

**Trigger:** after a successful extraction on a domain+pageType whose
`candidate_catalogue` is empty (or on operator request from the domain page).
Never in the per-page hot path; it reuses evidence already in hand.

**Input:** the entity-scoped API blob(s) (`findEntitySubtree` output), JSON-LD
blocks, meta tags, and the run's extracted values with their winning paths.

**Output:** a `CandidateCatalogue` — the AI groups value-bearing paths into concepts
and labels each candidate distinctively. Prompt contract mirrors the existing AI-API
analysis tool (structured tool output, paths must exist in the provided evidence —
a fabricated path is rejected mechanically before the catalogue is written, the same
"never cache an unverified answer" rule the pagination work established).

**Cost:** ~$0.05 per domain, once; cached indefinitely. Refresh is manual
(button on the domain page) or drift-flagged, never automatic per run.

## 5. Displayed verification

For each concept with ≥2 candidates: one vision check per domain compares the
candidates' current values against the page screenshot and answers "which of these,
if any, is what the page shows a shopper?" — implemented as a judge-family function
(`judgeDisplayedCandidate(screenshot, concept, candidates) → label | null`) in
`@robot/agent`, gated live/paid alongside the existing judge, with calibration
entries added to `judge-calibration.test.ts` (known answer: Newegg price →
the `price-current` candidate, not `FinalPrice`).

Outcome writes `displayed: true` on at most one candidate and `verifiedAt` on the
concept's candidates. Failure or "none visible" records `verifiedAt` only.

## 6. Serving order and conflict detection

### 6.1 Serving (in `resolveFromCache` / extraction orchestration)

Priority for a schema field:

1. **Customer selection** — field carries `candidate`; the catalogue maps it to a
   path, which is tried first. Selection outranks pins: a pin is the operator's
   per-domain statement, a selection is this customer's own. (Pins keep winning for
   fields without a selection.)
2. **Displayed default** — no selection: if the field's concept has a
   `displayed: true` candidate, its path is tried first.
3. **Today's ranking** — `comparePaths` order, unchanged.

A selected path that misses on the live page falls through to the rest of the chain
exactly as any first-ranked path does today; the miss is recorded on that path's
stats, never silently swapped to a different candidate's value. Concept inference
for a schema field: explicit `candidate.concept` when selected; otherwise the
field's name is matched against concept names (exact, then singular/plural) — no AI
call.

### 6.2 Conflict detection (`detectPathConflicts`)

- Two paths mapping to **different labelled candidates** of the same concept are
  excluded from conflict reporting — that disagreement is the catalogue's job.
- Remaining conflicts (same candidate, or unlabelled paths) additionally require
  `lastUrl` equality — values observed on different pages are staleness, not
  conflict (triage class 4).
- `valuesMatch` numeric normalization: **already implemented** — plan-phase
  investigation (2026-08-25) found `valuesMatch` (domain-cache.ts:767) strips
  formatting and compares numerically with 5% tolerance, so `"$299.00"` vs
  `299` never reached the real conflict detector (the triage's SQL counted raw
  distinct strings and overcounted this class). The plan carries a
  regression-lock test instead of a change.

## 7. Dashboard

- **Dataset schema editor** (`dataset-detail.tsx`): fields whose source-domain
  catalogue holds ≥2 candidates for the field's concept get a candidate picker —
  grouped by concept, displayed-first, each candidate showing label, source badge,
  sample value, and scope facts. Default selection: "displayed". Saving writes
  `candidate` onto the dataset schema field.
- **Domain detail** (`domain-detail.tsx`): read-only catalogue section per page
  type (concept → candidates, displayed badge, verifiedAt), plus the
  refresh-catalogue action. The conflicts panel inherits §6.2's narrowing and
  should visibly shrink.
- **Results table**: the provenance tooltip names the serving candidate
  (`price ← displayed (xpath)`), reusing the existing sources map.

## 8. Exports

Unchanged by default — same columns, same headers (§2 goal 4). A customer who wants
a second candidate adds a schema field named their way (`price_list`) carrying
`candidate: {concept: "price", label: "list"}`; it then flows through results,
CSV and JSON as an ordinary field. No fan-out, no renamed columns.

## 9. Testing

- **Tier 1 (fixture replay, free):** catalogue-aware serving — a fixture dataset
  schema with a selection resolves the selected path first (Newegg fixture already
  carries the multi-price blob); narrowed conflict detector unit tests covering all
  five triage classes (poison still fires; labelled-different, format-only,
  cross-page, and churn no longer do); dangling-selection degradation; the
  fabricated-path rejection in catalogue discovery.
- **Judge calibration (live, paid, gated):** displayed-verification known answers
  added to `pnpm test:judge`.
- **Dogfood (live, paid, budgeted):** one labelling pass per measured domain
  (Newegg, Target, B&N ≈ $0.15 total) with the catalogue reviewed by hand in the
  domain UI before serving is enabled anywhere else.

## 10. Rollout

1. Schema migration + types + catalogue read/write plumbing (serving unchanged).
2. Discovery pass + fabricated-path guard, behind the empty-catalogue trigger.
3. Conflict narrowing + `lastUrl` + `valuesMatch` normalization + AI path identity
   (independent of 1–2; pure improvement).
4. Serving order (selection > displayed > today) with Tier 1 gates.
5. Displayed verification + calibration.
6. Dashboard (picker, catalogue view, tooltip).
7. Dogfood on the three measured domains; hand-review; then done.

Each step lands green on `pnpm -r test` plus the cache-hygiene gate; no step
requires a step after it to leave the system consistent.

## 11. Risks

- **Labelling quality.** A wrong label misleads selection. Mitigations: sample
  values shown in the picker; labels never invent paths (mechanical rejection);
  hand review in the dogfood step before anything customer-facing depends on it.
- **Catalogue staleness.** Paths rot like all cached paths. The catalogue maps to
  `field_paths` entries whose hit/miss stats keep accruing; a selected path that
  starts missing shows up in existing degradation flagging. Refresh stays manual.
- **Concept mismatch.** A schema field named `cost` won't match concept `price`
  by name. Acceptable in v2.5: the picker is offered on the domain's concepts, and
  an unmatched field simply behaves as today. Embedding-based matching is out of
  scope (already in `docs/ideas.md`).
- **variant_array overlap.** Variants already carry their
  own extraction path and are not re-modelled here; the catalogue may hold a
  `variant` concept for visibility, but `variant_array` serving is untouched.

## 12. Interactions with existing systems

- **Pins** (`pinFieldPath`): unchanged; outranked only by an explicit per-dataset
  selection. Pins remain the poison-path tool; selections are preference.
- **Prune** (`prunePaths`): paths referenced by any catalogue candidate are NOT
  protected — if a candidate's path dies statistically, the dangling-ref
  degradation (§3.2) handles it and the warning names it. Protecting them would
  let a dead catalogue pin the cache's size cap.
- **Graduation / sandbox:** sandbox sources have no dataset schema selections;
  they get the displayed-default path only. Selection is a Project-tier feature.
- **v2 crawler:** listing-phase extraction is untouched; selections apply to
  detail-page fields exactly as to single-page extractions.
