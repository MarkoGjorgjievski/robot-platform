# MVP Simplification — Declared Sources and the Probe-Confirm Flow

**Date:** 2026-08-26
**Status:** Approved direction (Marko, chat) — pending spec review
**Origin:** three front-door failures (2026-08-25/26: category-as-detail, block-page-as-detail,
listing-as-detail) traced to one architectural cause: the system GUESSES what a pasted URL is.
Marko's ruling: delete the guessing; the user declares intent. Supersedes the just-drafted
page-classifier design (only its blocked-page piece, already shipped, and a soft validator
survive). Implements the roadmap's "progressive confidence" item in its MVP shape.

## 1. The one mental model

**Everything is a Source, and the user says what it is.** The home page IS the new-source flow:

- **Listing pages** — paste ONE OR MANY listing URLs (IKEA sofas + chairs + tables; sneakers +
  shoes). Creates a Source with `listing_mode: 'listing_to_detail'` and an InputSet holding one
  row per listing URL. These listings yield detail URLs, which the crawler fetches.
- **Product pages** — paste one or many detail URLs directly (when they didn't come from a
  listing). Creates a Source with `listing_mode: 'detail'` and an InputSet row per URL.

The Source lands in a default project (**"Scratch"** — the renamed, now-ordinary seeded project)
and is immediately a normal Source: editable, deletable, movable to another project by plain
edit.

**The sandbox concept is deleted**: both sandbox routes, the sandbox router, the Graduate
form/flow, and all `is_sandbox` special-casing. The column stays (deprecated; dropped with the
v3 auth remodel's table-drop bucket). The paste-and-go wizard UI is reborn as the Source
workspace (schema editor + extract + results on the Source detail page), not a parallel world.
Existing sandbox test sources are deleted.

## 2. Declared type drives everything (the deletion)

`runAnalysis` gains a REQUIRED `pageType` input, taken from `source.listing_mode`. Consequences:

- Cache lookup is `(domain, declared type)` — full stop. **Deleted:** the dual-cache lookup, the
  cache-size arbitration, and the live-vote patch (`analyzeFromCache`'s multi-cache walk). The
  entire "which page type is this URL" question ceases to exist in code.
- Cache-first instant answers stay, now safe: the type is the user's, not a guess.
- Blocked-page detection stays exactly as shipped (analyze degrades with `blockedReason`;
  extraction refuses with the reason).
- Example provenance stays and sharpens: each example value is marked **live** (resolved on this
  page) or **cached** (from an earlier run); cached examples render dimmed with an
  "earlier run" badge. `liveExamples` remains the aggregate flag.

### Listing analyze (new, honest, mostly reuse)

For a listing Source, analyze stops borrowing the detail flow: capture → listing-mode extraction
(the crawler's own phase-1 machinery scoped to one page) → report:

> **N product rows found · pagination: url-pattern · listing fields: detail_url, name, price…**
> plus a sample of enumerated detail URLs.

Zero rows or no pagination is therefore self-evident in the result — no classifier needed.

### Soft validator (warning-only, never a decision)

- Declared listing, ≤2 rows, no pagination → "This doesn't look like a listing — it may be a
  hub/featured page; the real listing is often behind a 'shop all' link."
- Declared detail, ItemList/CollectionPage markup or high product-link density → "This looks
  like a listing page."
- Wording always suggests; routing never changes.

## 3. The probe-confirm flow (progressive confidence, MVP shape)

A customer arrives with several listing URLs. We do NOT crawl them all and hope:

1. **Probe** (automatic on first Extract of an unconfirmed listing Source): plan **only the
   first input row** with a probe budget — `{max_pages: 3, max_items: 30}` — walking 2–3 listing
   pages through the full pagination ladder, then **extract 2–3 sample detail pages** from the
   enumerated URLs. One run, small and bounded.
2. **Confirm gate:** the run presents its evidence — pages walked, pagination strategy, detail
   URLs found (with the listing values carried down), and the sample rows with real extracted
   data — and asks: *"Is this the desirable path?"*
   - **Yes** → `sources.confirmed_at` is set. The full plan runs across ALL input rows at the
     Source's real budget; scale is the existing crawl machinery (cancel/resume included).
     Confirmed Sources skip probing on later runs.
   - **No** → the **diagnosis panel** (below), plus the three honest actions: edit the URL(s),
     switch the Source to detail mode, or delete. No auto-retry, no entry-point magic (that is
     the recorded `docs/ideas.md` follow-up).
3. **Diagnosis panel:** assembles the machine evidence the pipeline already produces into one
   human explanation, in priority order:
   - blocked (`blockedReason` / per-item block failures) → "The site blocked our requests —
     verify-you-are-human page. Wait and retry; long-term this needs the proxy line item."
   - 0 rows found → "No product rows on this page — is it really a listing? It may be a detail
     page or a hub."
   - rows but no pagination → "Found N products but no way to reach more pages — hub page, or a
     single-page listing."
   - thin walk ("pages 2+ re-serving page 1") → "Pagination looks broken on this site — pages
     repeat."
   - 404/error page-health reasons → "The link appears dead (404/exact reason)."
   - sample extraction failures → per-item reasons, verbatim.

New schema: **one column**, `sources.confirmed_at timestamptz null`. Probe runs are ordinary
runs (flagged in run metadata for display), so run history, work lists, cancel/resume, and
exports all apply unchanged.

## 4. What does NOT change

Extraction chain, domain cache, candidate catalogues/selection, displayed verification, the
two-phase crawler, pagination strategies and their verification gate, budgets and their
ceilings, exports, the domains UI. This initiative is deletion plus re-fronting live-proven
machinery.

## 5. Deletions (the scrub)

| Deleted | Where |
|---|---|
| Sandbox routes (index + detail) and their tests | `packages/dashboard/src/routes/sandbox-*` |
| Graduate form + flow | `packages/dashboard/src/components/graduate-form.tsx`, sandbox router mutations |
| Sandbox tRPC router | `packages/api/src/routers/sandbox.ts` (its analyze/extract orchestration moves to source-scoped procedures) |
| Dual-cache arbitration + live-vote in analyze | `packages/scraper/src/analysis-orchestrator.ts` |
| `is_sandbox` special-casing (not the column) | api routers + dashboard filters |
| The page-classifier design | superseded before build; blocked-page detection + soft validator survive |

## 6. UI surfaces

- **Home:** the two-choice new-source flow (Listing pages / Product pages), URL textarea
  (multi-line for both), project preselected to Scratch, one submit.
- **Source workspace** (absorbs the old wizard): declared-mode chip (no guessing language),
  schema editor with per-field live/cached example badges, candidate pickers (unchanged),
  Extract button whose meaning is mode-aware: probe → confirm → full crawl for listings;
  per-row extraction for details.
- **Confirm screen:** the probe run's detail page gains the evidence summary, the sample-row
  table, the Yes/No gate, and the diagnosis panel on No (and automatically when the probe
  itself failed).

## 7. Testing

- Tier 1: listing analyze against the real listing fixtures (newegg-gpu-listing,
  abebooks-search-listing) asserting rows/pagination/fields; detail analyze regression against
  detail fixtures; validator warnings both directions; probe planning scoped to first input
  (plan-run fixtures); confirm gating (unconfirmed → probe budget, confirmed → full budget).
- The two incident pages (Newegg `/p/pl` block, Target notebooks listing) become fixtures where
  capturable; the diagnosis mapping is unit-tested per warning class.
- Existing sandbox tests are deleted with the feature; source-workspace tests replace them.

## 8. Rollout

1. Schema: `sources.confirmed_at` (additive migration) + Scratch rename/seed adjustments.
2. `runAnalysis` declared-type refactor + listing analyze + validator + provenance badges
   (deletion of arbitration happens here).
3. Probe planning (first-input scoping + probe budget + sample extraction) and confirm/full
   plumbing in the crawl API.
4. Home flow + Source workspace UI; sandbox/graduate deletion.
5. Diagnosis panel.
6. End-to-end proof on a real multi-listing source (budget-approved live run).

Each step lands green independently; the deletion step is its own commit so the scrub is
visible and revertible.

## 9. Risks / open notes

- Listing analyze on a COLD domain costs one AI schema discovery (as detail analyze does
  today); cache-first covers warm domains.
- The probe's sample extraction spends (~$0.15–0.50 cold) — bounded, user-triggered, and the
  point of the flow.
- Multi-listing inputs whose listings live on different domains work (per-input domain locks
  exist) but the probe confirms only the FIRST domain's path; the confirm copy says so.
- The `is_sandbox` column and any lingering sandbox-named seed data remain until the v3 drop
  bucket; renaming the seeded project is data, not schema.
