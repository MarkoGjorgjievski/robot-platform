---
name: Session handoff — state, decisions, and what to do next
description: Where the project stands as of 2026-08-19 and how to pick it up. Read this before starting work.
type: project
---

# Handoff — 2026-08-19

## Read this first

The last two days were spent on **measurement and correctness**, not features. That work is finished and should not be continued. The project's actual gap is that **a customer cannot receive data**: there is no export, no pagination, no listing→detail crawl, and no batch runs. Extraction quality does not matter until data can leave the system.

**Do not start another fix-and-dogfood cycle.** It converged on the corpus rather than on reality, each round cost real money, and half the remaining defects are design decisions rather than bugs (see *Open decisions* below). The next work is **feature implementation against the roadmap**.

## Process to use

Follow the project's own workflow rather than improvising:

1. `superpowers:brainstorming` — before any implementation. Classify the work (spike / bounded / architectural), agree a design, get approval.
2. `superpowers:writing-plans` — for architectural work, write the spec to `docs/superpowers/specs/` and the plan to `docs/superpowers/plans/`, as v1.5, testing-strategy and variants all did.
3. `superpowers:test-driven-development` and `superpowers:verification-before-completion` while implementing.

## Current state

- **Tests:** 316 passing, 15 opt-in (live/paid). `pnpm -r test` is the free green gate and needs Postgres running.
- **Repo:** clean, everything committed. 35 commits over 18–19 Aug.
- **Database:** Docker container `robot-platform-db` (see `.env.example`). Start it with `docker start robot-platform-db` before running tests.
- **Quality:** 73% of *verifiable* fields correct across the three measured domains (22 of 30). 44% of all requested fields, the difference being values a screenshot cannot check.
- **Cost:** ~$0.47 per cold URL, ~$0.20 warm, pipeline only. The Tier 2 judge adds ~$0.14 per URL and is not a product cost.

### Corpus: 8 domains, 3 measured

`newegg`, `target`, `barnesandnoble` are measured. `bhphoto`, `abebooks`, `zalando`, `currys`, `uniqlo` were added on 19 Aug and **have never been run**. Only `newegg` has a Tier 1 fixture; the other two fixtures (`ikea`, `nike`) cover domains that are not in the live corpus.

## What NOT to redo

- **The API-side entity filter.** Tried and reverted (`c606a54`). It compares identifiers across API namespaces that have no reason to overlap and dropped 8 of 10 Nike responses. The failure is documented on `filterRequestsForPage` in `entity-match.ts` and captured as a test. A safe version needs evidence comparable by construction — a self-referential URL under a canonical key, not a bare numeric token.
- **Chasing the price/rating "wrong" verdicts as bugs.** Four of the eight remaining wrong verdicts are cases where the extractor returned a real value and nothing said which of several valid values was wanted. They need the labelling design, not a fix.

## Open decisions (need Marko, not code)

1. **Candidate labelling** (`docs/ideas.md` → "Label every candidate instead of picking one"). Premise confirmed: one Newegg page carries four simultaneously valid prices and the *displayed* price matches none of the API fields. Marko's direction — label all candidates, let the customer choose, per-domain catalogue and per-dataset selection — is recorded and deserves its own spec.
2. **Export vs v2 first.** Export is small and immediately makes the system deliver something; v2 is the real unlock if customer orders are inherently multi-page.
3. **Proxy budget.** Anti-bot is the dominant schedule risk. Stealth (now on by default) unblocked B&H and Wayfair on first contact but degrades under repeated access from one IP. Four of eleven probed sites remain hard-blocked. Proxies are a spend decision, not an engineering one.

## Suggested next work

From `docs/roadmap.md`, in the order that makes the product real:

1. **Data export** (v3 backlog, but do it first) — CSV/JSON from a run. Small, and it is the difference between a demo and a deliverable.
2. **v2 pagination + listing→detail crawler.** The data model landed in v1.5 Phase 0 (`input_sets`, `listing_mode`, `budget`) and **nothing reads it**. The extraction chain was lifted out of the tRPC router into `@robot/scraper`'s `runExtraction` precisely so the crawler can reuse it instead of duplicating it.
3. **Batch runs with per-input status**, so an order of 500 URLs is something you can start and watch.

Quality work resumes afterwards with a purpose: fix what breaks at scale, not what a judge dislikes on three URLs.

## Cheap things worth doing whenever convenient

- Measure the five unmeasured domains once (~$4). New sites are where new bug classes come from — adding Barnes & Noble alone exposed a navigation bug that had been silently affecting every site ever captured.
- Capture Tier 1 fixtures for the corpus so the commit-time gate covers more than one eighth of it.
- `star_distribution` arrives as an object and is rejected as "not array".
- Target's `availability` returns a delivery date from a poisoned cached XPath; the pin machinery to fix it already exists.

## Commands worth knowing

| Command | What it does |
|---|---|
| `pnpm -r test` | Free green gate. Needs Postgres. |
| `pnpm typecheck` | All packages, including the two that have no build step. |
| `pnpm dogfood -- newegg` | **Single site**, ~$0.35. Full corpus is ~$4. |
| `pnpm test:judge` | Calibrates both judges against known answers (live, paid). |
| `pnpm test:liveness` | Do the fixtures still match the pages they claim? (live, free) |
| `pnpm test:ui` | Dashboard route smoke tests; needs `pnpm dev:all`. |
