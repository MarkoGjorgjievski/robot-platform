---
name: Product vision — state-of-the-art AI web scraping
description: The north star, the five pillars, non-goals, and the post-MVP roadmap ordering. Written 2026-08-25.
type: project
---

# Vision — what state-of-the-art looks like for this project

**The one-sentence vision:** a platform where an AI agent configures a self-testing extractor
once, sampled judges keep confidence scores on every field, drift heals itself, ambiguity is
labeled instead of guessed, and the domain cache makes every next customer cheaper.

This document is direction, not a work list. The work list is `docs/roadmap.md`; the ordering
section at the bottom of this file says how the remaining roadmap items line up behind the
pillars, and it is the tiebreak when the backlog is ambiguous.

## The bet this project already made — and must keep

**AI is a compiler, not a runtime.** AI configures an extractor once (~$0.50 cold), deterministic
replay runs it for free forever, and the domain intelligence cache compounds across customers.
This is the same convergence point the serious players (Zyte, Diffbot) arrived at, and it is the
opposite of the "LLM call per page" shape most AI-scraper startups burn money on. Every pillar
below is an elaboration of this bet; any feature that moves AI into the per-page hot path is
fighting it and needs an extraordinary justification.

What separates the current system from state-of-the-art is **not intelligence — it is
reliability loops**. The extraction chain, the cache, the judge, the fixtures, and the liveness
check are the skeleton of every piece below. What is missing is closing the loops.

## Pillar 1 — Label candidates, don't pick winners

The recurring "AI is indecisive / cache conflicts" symptom is not an AI weakness; it is the wrong
question. One Newegg page carries **four simultaneously valid prices**, and the displayed one
matches none of the API fields (proven; see `docs/handoff.md` → Open decision 1). "Which price"
is a *customer preference*, not a fact about the page — no smarter model resolves it.

The state-of-the-art move: extract **all candidates with provenance labels**
(`price.displayed`, `price.api.listPrice`, `price.jsonld`, …), keep a per-domain candidate
catalogue, and let the dataset schema pin the choice once per customer. Cross-validation stops
being "majority wins" and becomes "here is the candidate catalogue, confidence-scored."
Indecision disappears because there is nothing left to be indecisive about.

This is Marko's recorded direction in Open decision 1 and it deserves its own spec cycle.

## Pillar 2 — Compiled, tested, self-healing extractors

Today the cache stores individual XPaths and dot-paths per field. The end state: AI synthesizes
a whole **extractor artifact** per domain — a small typed program with its own fixture test,
versioned, with a changelog. On generation it is immediately re-run against the capture it was
derived from (a free self-test). On drift, the old and new versions are diffed and a judge
validates the regeneration before it ships.

The loop to close: **drift detection → auto-resynthesis → judge validation → human sees a
changelog, not a fire.** The parts all exist separately (Tier 1 fixtures, Tier 2 judge,
`test:liveness`, degradation flagging); nothing connects them yet. Self-healing extractors are
the single most state-of-the-art property a scraping platform can have, and nobody does it well.

## Pillar 3 — Verification as a product surface

Agents evaluate data — but as **sampled QA, not per-row**. Judge a small sample of rows per run,
compute per-field confidence, escalate anomalies (null-rate spikes, value-distribution shifts)
to full judgment. Every field in every export carries a confidence score and a provenance trail.

This is cheap (pennies per thousand rows) and it is what customers actually pay for: trust, not
cleverness. It is also what makes the dashboard *look* like an AI product — confidence and
provenance surfaced in the UI, not just values in a table.

## Pillar 4 — The agentic last rung: scrape once, compile itself away

When every rung of the extraction chain fails, a **browser-use agent** drives the page like a
human — clicks, scrolls, reads — and extracts the data. Expensive (~$1–2/page). The futuristic
part: its *trajectory gets compiled* — the selectors it touched, the requests it triggered —
into a replayable script that enters the cache like any other path. The agent is the teacher;
deterministic replay is the student. **No page is ever unscrapeable, and no page is expensive
twice.**

The same principle already proved itself in miniature with `api-param`: the page is a rendering
of an API. An agent that reverse-engineers a site's data layer once (JSON endpoints, GraphQL,
mobile APIs) turns scraping into data engineering — the most durable extraction there is.

Caution carried over from the dom-scroll cycle: an agent's answer is an **unverified answer
entering the cache tier** — the exact failure class this project has been burned by twice (the
AbeBooks `ds` template, the api-param fabricated URLs). The compilation step needs its own
verification gate before anything it produces is cached.

## Pillar 5 — Access is bought, not built

Anti-bot is the binding constraint, proven repeatedly: 3 of 6 corpus candidates blocked at
probe time (P3b), Uniqlo rate-limited after ~10 runs, Target blocks every request. State-of-the-art
extraction intelligence is worth nothing behind an Akamai wall. Proxies, fingerprinting, and
CAPTCHA solving are a commodity arms race with well-funded incumbents — **buy them (Bright Data,
Oxylabs, or similar), budget them as COGS.** The open "proxy budget" decision resolves to: it is
not a decision, it is a line item.

## Non-goals

- **More AI at runtime.** Parallel LLM scrapers, per-page model calls — fights the core bet.
- **Page segmentation as a headline feature.** Entity-subtree scoping already does it where it
  matters; generalize only when a real failure demands it.
- **Multi-LLM routing as a differentiator.** It is a cost optimization for later (v3), not a
  product property.
- **Building anti-bot infrastructure in-house.** See Pillar 5.

## Roadmap ordering

### Now — MVP close-out

The three MVP complaints, plus the two evidence-backed correctness bugs already at the top of
`docs/handoff.md` → "Suggested next work":

1. **`[object Object]` in the dashboard** — `results-table.tsx` (and sibling views) render every
   cell with `String(value)`; objects and arrays need JSON rendering. The CSV export already does
   this right. Small, bounded. *(Early symptom of Pillar 3: values without provenance display.)*
2. **Dashboard design pass** — internal-polish bar: typography, spacing, color system, tables,
   empty/loading states, keeping current routes and structure. *(The full "confidence and
   provenance as UI" work is Pillar 3 and comes later; this pass just makes the tool look
   finished.)*
3. **Cache-conflict symptom triage** — pin which mechanism produces the conflicts actually being
   seen (multiple-valid-values vs. poisoned cached selector vs. cross-validation flip-flop) from
   a concrete run, and wire the existing pin machinery for the poisoned-selector case (the
   Target `availability` delivery-date bug is the known instance). *(The full fix is Pillar 1
   and is deliberately post-MVP.)*
4. **Strengthen the pagination-config verification gate** (`plan-run.ts`) — budget-aware refusal,
   not the bare ratio; the constraint analysis is already in `docs/handoff.md`.
5. **Fix `deriveTemplate`'s page-parameter selection** (`@robot/browser`) — needs its own design
   pass (choosing among plausible query params), per the standing ruling: not a drive-by patch.

MVP ends there. Load-more live proof and the api-param live proof stay open but are
**opportunistic** — both are blocked on finding suitable corpus sites, which is an access
problem (Pillar 5), not a code problem.

### v2.5 — Candidate labelling (Pillar 1)

Open decision 1 becomes a spec: per-domain candidate catalogue, provenance-labelled extraction,
per-dataset selection. Dissolves the conflict/indecision class for good. Touches the extraction
chain, the cache schema, and the dashboard (candidate picker in the Dataset schema editor).

### v2.6 — Self-healing loop (Pillar 2)

Connect drift detection → resynthesis → judge validation → changelog. Concretely: promote the
cache from per-field paths to versioned per-domain extractor artifacts with self-tests; wire
`test:liveness`-style drift signals to trigger regeneration; judge validates before the new
version ships; the dashboard shows a changelog instead of a degradation flag.

### v2.7 — Confidence and provenance as a product surface (Pillar 3)

Sampled per-run judging, per-field confidence scores, anomaly escalation, provenance trails in
exports and in the UI. Subsumes the existing "progressive confidence (1 → 5 → 20 → 1000 URLs)"
roadmap item — same idea, generalized.

### v3a — Access layer (Pillar 5)

Buy proxy/stealth/CAPTCHA capacity; integrate as config, not as a subsystem. This *precedes*
the agentic rung because it unblocks everything else too: corpus growth (P3b's finding),
the api-param and load-more live proofs, and quality measurement on the five unmeasured domains.

### v3b — Agentic last rung (Pillar 4)

Browser-use agent as rung 8 of the chain, with trajectory compilation into the cache behind a
real verification gate. Also the home of "reverse-engineer the data layer once per domain."

### Deferred to scale, unchanged from roadmap.md

Real job queue (with the `domain-lock.ts` waiter fix as its prerequisite), multi-LLM routing and
failover, scheduling UI, multi-tenant auth shell.

## How the three MVP complaints map to the pillars

| Complaint | MVP-level fix | Root cause pillar |
|---|---|---|
| `[object Object]` in data | JSON-render objects in dashboard cells | Pillar 3 — values shown without structure or provenance |
| Cache conflicts, AI indecisive | Triage the mechanism; wire pin machinery for poisoned selectors | Pillar 1 — the system picks winners instead of labelling candidates |
| Dashboard looks rudimentary | Internal-polish design pass | Pillar 3 — the product surface doesn't yet show the intelligence underneath |

The pattern worth noticing: all three complaints are early symptoms of missing pillars, not
random defects. The MVP fixes treat the symptom cheaply; the pillar work removes the cause.
