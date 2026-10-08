# Ikea: first extraction, certified paths only (2026-10-08)

The owner's org "Markodjordjievski" has one real website, Ikea (project "Acne"), verified 8/8
fields on 2026-09-21 for $0.00 (mechanical paths — JSON intercepts, JSON-LD, two XPaths). It had
never had an extraction run. This is that run, through the repo's CLIs, with the api-server (:4000)
and app (:3000) already running and untouched.

## What was run

Source: `ikea` (id `b4648622-bfa9-4d90-91b4-5a88ed288cd9`), listing mode `listing_to_detail`,
input strategy `direct`, listing URL `https://www.ikea.com/my/en/cat/sofas-fu003/`. Its stored
budget was already `{"mode":"first_n","max_items":40,"max_pages":3}` — no database edit was
needed to bind the run at 40 items.

```
pnpm --filter @robot/api exec tsx src/crawl-plan.ts b4648622-bfa9-4d90-91b4-5a88ed288cd9
pnpm --filter @robot/api exec tsx src/crawl-execute.ts 01af1eb0-bdee-4a99-b07c-af8e750493cd
```

Before executing, the planned run (`01af1eb0-bdee-4a99-b07c-af8e750493cd`) was read back
read-only: status `planned`, `cost_usd 0.0000`, 40 pending detail items across 2 listing pages.
The plan log showed no AI involvement — pagination resolved mechanically (`[cache] pagination
for www.ikea.com: url-pattern`) and the listing's product-link selector replayed from the cached
row-plan (`Row-plan replay resolved 23 row(s) for detail_url — AI selector generation skipped`).
The certification check (`requireCertification`) passed cleanly: the source's `schema_definition`
has 8 fields, its `verification_set` has 3 proof URLs, and the one `source_verifications` row
(2026-09-21) shows all 8 fields `status: "pass"`, every one `aiCalled: false`, `cost_usd 0.0000`.
The project's dataset has `variant_mode = ignore`, so the variant gate did not apply. On that
basis crawl-execute was run once.

## Results

- Run id: `01af1eb0-bdee-4a99-b07c-af8e750493cd`, final status `completed`.
- Items: 40/40 done, 0 failed (`run_items`: 40 detail rows + 2 listing rows, all `done`).
- Cost: **$0.0000** for the whole run (`runs.cost_usd`), planning and execution together. No
  Claude/Ollama call happened anywhere in the run — confirmed both from the console log (no
  AI-tier log lines; every item logged "8/8 fields" straight from mechanical/cached paths) and
  from the stored cost.
- Per-field hit rate (40 `extractions` rows, one per item): **8/8 fields at 100% (40/40)** —
  `price`, `title`, `subtitle`, `product_id`, `total_reviews`, `average_rating`,
  `price_currency`, `product_details`. Every extraction's `confidence` was 100.
- Timing: planning took 27.9s (its own console-reported elapsed time) for the 2 listing pages and
  40-item work list. Execution (`run_items.started_at`/`completed_at` over the 40 detail rows)
  ran from 10:06:17.19 to 10:13:00.81 UTC — 403.6s for 40 items, **≈10.1s/item**. The console's
  own per-page timings were steady: each detail page's capture was 7.1–10.1s (mostly navigation,
  2.0–4.2s), plus the engine's ~1.4–1.7s politeness delay per host between items — consistent
  with the ~2s/host politeness rule in the campaign plan, run serially (one website at a time,
  as this is a single source).

## Oddities

- None of the campaign's known Ikea anti-bot concern showed up here: every one of the 40 pages
  captured cleanly with 8/8 fields, and none of the extracted titles degraded to the generic
  "Products - IKEA" the liveness check flagged as a possible live-title regression. All 40
  `title` values were real product names (GLOSTAD, KIVIK, HYLTARP, VIMLE, MANNARP, etc.).
- Phase 1 (`crawl-plan`) logged one benign warning: api-param pagination did not apply ("no
  intercepted JSON response carried page 1's detail URLs") — pagination still resolved for free
  via the mechanical/cached tier one step down, so this cost nothing and changed nothing.
- The listing yielded far more than 40 sofas; the run stopped exactly at the 40-item budget
  ("budget reached: 40 items") after consuming 2 of the allowed 3 listing pages — the budget
  bound correctly.
