---
name: Session handoff — state, decisions, and what to do next
description: Where the project stands as of 2026-09-02 and how to pick it up. Read this before starting.
type: project
---

# Handoff — 2026-09-02

## Read this first

**State on 2026-10-07: everything below is merged into `main`** (variants plans 1–3 and 2b, drift repair Part B, the cut-over, staff access). Where a section below says "on branch …, not merged", that was true when it was written and is no longer. `main` is not pushed.

**The next work, in order (2026-10-07; supersedes the 2026-09-11 list further down):**

1. **Backups that all come from one source.** A field's certified paths can all be sibling keys of one API response (Ikea's price: five paths, one response), so they fail together and aren't real backups. Ops only *shows* it ("All backups read the same response — if it changes, they fail together"). The fix changes certification — at most one or two paths per source, so backups come from different sources — and needs a short design first (spec → plan), like drift repair. Marko's pick for next, 2026-10-07.
2. **Proof-page coverage of a site's variations — done, 2026-10-10.** See "Proof-page coverage and 'not on this product' (2026-10-10)" below: after a passing Verify, a free background check samples twenty listing products with the certified paths and tells the customer per field where they came back empty, with "Use as proof page"; live-checked again on Lookfantastic and Decathlon (both left needing a re-Verify after live rating drift — see that section). Article's `/furniture-bundles/…` pages, the third live case in the old item, were not checked.
3. **Correctness on the run page — done, 2026-10-13.** See "Shown on the page (2026-10-12)" below: a run flags every certified value the product's page does not show, free, at extraction time; the run page and the Sample panel count and name them; at Verify a Title that is not the page's heading never reads agreed, and a typed value the page does not show warns.
4. **Sitemap-first product discovery.** "Find products" and the listing walk both depend on a listing page's own links; a site's sitemap (where one exists and is reachable) would find products without needing a listing page at all, and would not be subject to a listing-level bot wall the way the current walk is.
5. **Variant and drift loose ends**, each small:
   - the repair sweep reads only a product's first row (`data[0]`), so missing values on variant rows 1..n are never repaired;
   - the export has no column for each variant page's own URL;
   - drift: an old episode can show when the automatic check fails to start (M7);
   - empty `offers` (`[]`/`{}`) counted as variant entries;
   - `gtin8`/`gtin12`/`gtin14` missing from the SKU vocabulary;
   - a self-plus-one link pair counted in the variants summary (N2);
   - `packages/scraper/src/verify/transfer-marks.test.ts`'s JSON-LD image-array case is flaky (it fails now and then in a full scraper run and passes alone): its boxes carry an external `<img>` on `x.example`. Fix idea: route `x.example` to a local pixel in `boxesOf`.
6. **Clean up test projects in Marko's own org** (e.g. "Site marks-from" at test-marks-from.example.com, left by earlier test runs). List them first; delete only what Marko approves; `pg_dump` before.
7. **Staff-access polish** (from its final review, all fine to defer): the log shows internal field types ("Changed field Price to money"); the ops Staff activity pager flashes a skeleton (no `keepPreviousData`); "Back to ops" briefly refetches the customer page before leaving; `BlockedTooltip` lives in `shell/staff-banner.tsx`; a deduplicated probe/backfill still logs as a new action; "Verified Nike" is logged when Verify starts, not when it passes (ask Marko before rewording).
8. **Run speed, soon but not now** (Marko, 2026-10-07; after items 1–4): `docs/superpowers/specs/2026-10-07-run-speed-and-language-note.md`. Two levers decided: (a) the lean-capture **second increment** as already designed in the 2026-09-11 note — skip the popup/expand/screenshot/markdown steps and the second render on certified runs, fall back to the full capture on a miss; (b) **websites in parallel** — a run scheduler with a cap on open pages, designed together with the roadmap's job queue (short spec first). Together they take a certified product from the measured 10.5 s to ~4 s and a 1,000-page run from ~3 h to ~10 min, with no change to what is extracted. Skipping Chromium for structured-only sources is written up with its caveats but **deferred** until the fetchable share of the corpus is measured. The note also records the decision **not** to rewrite anything in Go or Rust: a certified run spends under 0.1 s of its 10.5 s in our own code.
9. **The campaign-2 product defects** (from the credit campaign's batch A notes, `docs/testing/results/campaign-2026-10-11/`): the variant chosen in the URL is ignored — addressed 2026-10-14, see the section; screenshots that never show the product on wide pages; Verify fails silently after "Not on this product" on products 1–3 (likely fixed 2026-10-13 by the defaults branch (gate passes `absent`); confirm); marked values that do not verify; the Extract button shows no estimate; Sample is labelled free but charged.
10. **A website's default values — merged 2026-10-13; route smoke re-run and the Gymshark live check done 2026-10-14 (Brand by default only, a 10-product run at $0 with "default on 10").** (The first smoke on `main` passed 23 of 24, the one failure a stale key lookup in the test itself, fixed in `42df0e2`; the re-run from Marko's terminal wrote every screenshot, the default-cell ones included, `90ca60b`.) See "A website's default values (2026-10-13)" below: a binding default per field fills every cell its certified paths leave empty, free, counted and marked everywhere a value shows.
11. **Jev at Verify, in shadow — implemented 2026-10-16, see the section.** After ~20 websites have been verified with readings, read the agreement (`pnpm --filter @robot/api exec tsx src/jev-agreement.ts`) and decide spec §9 — whether Jev's pick becomes the row's suggestion for ambiguous fields, and the variant pick becomes `[page]`'s fallback.

**Jev variants, measured (2026-10-15, `docs/testing/results/2026-10-15-jev-variants/report.md`, $0.0147):** asked which variant each screenshot shows as selected, Jev was right on 28 of 28 scorable pages across Ruggable, Kith, Skullcandy, Glossier, Burrow and Puma; our `[page]` code was right on 17. Where they differed Jev was right every time. Our misses: a default selection the address does not name is never read (Ruggable, Skullcandy); Glossier's capture carries no variant list; Burrow's two-pair addresses match two entries on one pair; and a selection-script bug turned every letter "s" into a space (fixed, `fix(scraper): the selection script keeps the letter s`). "Does the page show the address's variant" 16/18; parameter mapping 21/21; no answer flipped on repeats. Per-element crops fixed only 2 of 28 description false alarms: the rest sit in hidden or folded sections, so a crop cannot show them — open collapsed sections first, or skip descriptions in a visual check.

**Jev with images, measured (2026-10-15, `docs/testing/results/2026-10-15-jev-images/report.md`, $0.0463):** Jev 1.14 read the hard cases from screenshots — Ruggable's 6'x9' sale price out of 20–26 candidates (3/3, p 1.00), "Gymshark" over the tagline (3/3), Colourpop's heading over the shade name (9/9), Skullcandy's out-of-stock colour (3/3), batch C's real errors (10/10); 33 of 38 cases right every time, no answer flipped across three asks. On 295 ordinary values it agreed with the judge 81%, caught 8 of 8 real errors still on the page, and called 44 of 255 correct values wrong (28 of them descriptions outside the crop). Billing: an image placed once in `state` is billed once per call (~3,787 tokens for 1440×1000, ≈$0.00016) and each extra question adds ~45 tokens; referencing the image in each question bills a copy per reference. ~0.6 s per call. CLI `packages/api/src/jev-images-run.ts` (`@typesafe-ai/sdk` is a dev dependency of `@robot/api`; run `pnpm install` before using it on `main`). Next: a spec for an ambiguity step at Verify (one Choice per ambiguous field, screenshot in state) and a revised per-row check that sees the field's own crop.

**Newest: [Tenant isolation (2026-10-24)](#tenant-isolation-2026-10-24).** Every api procedure and file route is proven, as tests, to refuse another organisation; customers receive no money amounts; sign-in, the heavy work and the address checks are rate limited. Merged 2026-10-24.

**Before it: [Email (2026-10-24)](#email-2026-10-24).** Owners and admins get an email when a website needs attention or a run fails; account messages go out when staff enter, a role changes or someone is removed. Merged 2026-10-24.

**Before that: [Recurring extraction (2026-10-24)](#recurring-extraction-2026-10-24).** A website can run on a weekly schedule and post a signed webhook with download links when a run finishes. Merged 2026-10-24.

**Before it: [Run speed (2026-10-23)](#run-speed-2026-10-23).** Certified runs capture lean with today's capture as the fallback; page starts per host 2 s apart; several websites at once when `WORKER_RUNS` is raised. Measured 1.6× faster per 1,000 pages one website at a time, 8.1× at six, with the same values. Merged 2026-10-24.

**Before it: [The whole stack in Docker Compose (2026-10-23)](#the-whole-stack-in-docker-compose-2026-10-23).** `docker compose up -d --build` runs Postgres, migrations, api, worker, app and a nightly backup as project `robot-stack` on :3200/:4200/:5442, keyless; a restore test proves a dump comes back whole.

**Earlier: [Capture worker and job queue (2026-10-23)](#capture-worker-and-job-queue-2026-10-23).** All page loads run in a separate worker fed by a Postgres job queue, with leases, retries and one browser kept for interactive work; the api-server never starts a browser. Merged 2026-10-23 after the full gate.

**Before it: [Websites change (2026-10-21)](#websites-change-keep-running-re-check-tell-the-customer-2026-10-21).** A website whose pages changed keeps running on its last good paths, by-nature values refresh themselves, and the customer is told what needs them. Merged 2026-10-21 after the full gate.

**Before it: [HTML backups capped too (2026-10-21)](#html-backups-capped-too-2026-10-21).** XPath backups count as one source under the two-per-source cap; multi-layout covers are left alone. Merged 2026-10-21.

**Before it: [Customer copy: capture failures and run limits (2026-10-21)](#customer-copy-capture-failures-and-run-limits-2026-10-21).** Customers no longer read a host, an HTTP code or "budget": capture failures are reworded on screen, staff keep the detail. Merged 2026-10-21 after the full gate.

**Before it: [Backups from more than one source (2026-10-20)](#backups-from-more-than-one-source-2026-10-20).** Verify keeps at most two paths per source and fills the rest from other sources, so a field's backups no longer all fail with one API response; ops shows each API path's response. Merged 2026-10-20 after the full gate.

**Before it: [The finder reads product links (2026-10-20)](#the-finder-reads-product-links-2026-10-20).** "Find products" and the coverage check now offer products — no menus, tiles, policy pages or colour copies — and a page with no grid says so; live-checked on the 13 campaign listings. Merged 2026-10-20 after the full gate.

**Before it: [Verify never fails silently (2026-10-20)](#verify-never-fails-silently-2026-10-20).** Every refused, failed or stalled Verify and every failed screenshot now ends with one customer sentence in view, a failed run keeps the last results on screen, and one field's AI failure no longer fails the run. Merged 2026-10-20 after the full gate on the branch (route smoke 27 of 27).

**Before it: [Verify dead ends (2026-10-17)](#verify-dead-ends-2026-10-17).** Seven dead ends from campaign 2 that stopped an honest customer at Verify are fixed: a field the website lacks entirely now passes as "not on this website"; a default stops a products-four-to-six suggestion from blocking; a shop's name can certify as the brand; a page found in a different place on each product reads green, not "Several places match"; a mark reads the way the page shows it, label stripped; a rounded number matches more precise page data; the cost estimate is per proof page and staff-only, and a customer sees no money anywhere in the app. Eight tasks implemented and reviewed on `feat/verify-dead-ends`, fix rounds on Tasks 3, 6, 7 and 8; the whole-branch review found one Critical and two Important problems, fixed in one wave; merged into `main` 2026-10-19 (fast-forward). Route smoke on `main`: 26 of 26 (`762a763`), run against an isolated keyless pair with Jev off, since shadow is on in `.env`.

**Before it: [Jev at Verify, in shadow (2026-10-16)](#jev-at-verify-in-shadow-2026-10-16).** After a proof-page capture, a background Jev reading now picks among our own candidates for each ambiguous text/money/number field and reads which variant the page shows — stored, shown where it differs, never applied. Six tasks implemented and reviewed on `feat/jev-at-verify`, fix rounds on Tasks 1, 3 and 5; the whole-branch review, the merge, the route smoke and the live check are still to come — see the plan's status.

**Before it: [The variant the address names (2026-10-14)](#the-variant-the-address-names-2026-10-14).** A row's values now follow the variant the page's own address names, through a new `[page]` form a certified path can use instead of a fixed index, and a page that does not show the variant its address names fails its capture instead of silently extracting the wrong one. Six tasks implemented and reviewed on `feat/variant-from-address`, one fix round each on Tasks 1 and 2; the whole-branch review, the merge, the route smoke on `main` and the live check are still to come — see the section.

**Before it: [A website's default values (2026-10-13)](#a-websites-default-values-2026-10-13).** A website's binding now carries a default per field — a typed value a run writes into every cell its certified paths leave empty, so the customer can say "on this website, unless the page says otherwise, the Brand is Gymshark" instead of typing the tagline as a workaround. A path still wins where it reads a value; a field whose proof pages are all default cells and whose candidates all fail certifies by default only, free, no AI call. Defaulted values are counted and marked on the run page, read as empty by drift and the coverage check, shown in ops, and judged like any other value. Merged into `main` 2026-10-13 (fast-forward, 16 commits) after a whole-branch review on the most capable model (0 critical, 3 important, fixed in one wave, re-review clean). The route smoke on `main` passed 23 of 24 on its first run (the failure was the test's own stale key lookup, fixed in `42df0e2`); the re-run from Marko's own terminal (the memory watchdog had stopped mine) wrote every screenshot, the two default-cell ones included (`90ca60b`, `docs/testing/screens/app-site-verification-default-*.png`). The live check on the campaign's Gymshark website: see the section's "Live check" paragraph.

**Before it: [Shown on the page (2026-10-12)](#shown-on-the-page-2026-10-12).** A run now flags every certified value the product's page does not show — free, at extraction time — and the run page and the Sample panel count and name them; separately, at Verify, a Title that is not the page's main heading never reads "agreed", and a typed expected value the page does not show warns without blocking. Merged into `main` 2026-10-13 after a whole-branch review (one fix wave, re-review clean) and the route smoke (23 of 23); live-checked the same day on the credit campaign's Gymshark and Colourpop websites.

**Before it: [Known-gap fixes (2026-10-11)](#known-gap-fixes-2026-10-11).** Five small fixes from the two October plans: a CAPTCHA-only thin page is a human check; a drift check says "could not be checked" instead of "page gone" for a page the site would not let us read; a superseded coverage check stops reading; the Status column stays in view; a card added by its address takes the page title. Merged into `main` 2026-10-11 (fast-forward) after the route smoke passed 22 of 22.

**Before it: [Proof-page coverage and "not on this product" (2026-10-10)](#proof-page-coverage-and-not-on-this-product-2026-10-10).** After a passing Verify, a free background check samples twenty products from the website's listing with its certified paths, and the Verification tab now tells the customer, per field, where they came back empty — "Empty on 14 of 20 sampled products · all 14 list their sizes as variants in the page data" — with a one-click "Use as proof page" to add that product as a fourth (through sixth) card. Separately, a cell can be marked **"Not on this product"**: that page becomes a checked page whose correct answer is nothing, so a path that writes any value there (like Decathlon's old `stats.averageRating` fallback, which wrote `0` for products with no rating) can never certify. On branch `feat/proof-page-coverage`, merged into `main` 2026-10-11 (fast-forward).

**Before it: [Honest page verdicts (2026-10-09)](#honest-page-verdicts-2026-10-09).** Every page capture now carries one honest verdict (ok / refused / challenge / not-found / redirected / blank), and every consumer — the listing bar, a proof card, a run — shows its one sentence instead of "No product links found", a green "ready", or a "Done" with 0 rows. Merged into `main` 2026-10-09 (fast-forward, `feat/honest-verdicts`); live-checked against the credit campaign's real websites 2026-10-09, then fixed after the branch's final review (fix wave, same day).

**Before it: [Verification table, spreadsheet behaviour (2026-10-08)](#verification-table-spreadsheet-behaviour-2026-10-08).** A click on a cell selects it; a detail bar above the table shows the full value with Copy, Fix / Mark, Type it and a read-only crop of the screenshot around the element; arrow keys, Home/End, Ctrl/⌘+C, Enter/F and Escape work; right-click gives Copy value / Open product page / Fix on screenshot / Type it; after a Verify each row shows "n/m" after its badge. Only Fix (the button, the menu item, Enter/F, the crop) or a column head opens the screenshot. Spec `docs/superpowers/specs/2026-10-07-verification-table-spreadsheet-design.md`; the streaming-rows / silent pass-rate half of the original brief is deferred (the spec's second section says why). Merged into `main` 2026-10-08 (fast-forward, `feat/table-spreadsheet`).

**Before it: [Staff access (2026-10-07)](#staff-access-2026-10-07).** An operator can work inside a customer's organisation from ops ("Work on this website"), for at most 8 hours, under a banner; deleting things and managing the organisation are blocked, and every change is logged and shown to the customer in their Settings ("Robot staff activity") and to staff in ops ("Staff activity"). Merged (`1c6aede`). **To use it yourself:** add your address to `OPS_EMAILS` in `.env` and restart your api-server.

**Before it: [Cut-over (plan 6, 2026-10-07)](#cut-over-plan-6-2026-10-07).** `@robot/dashboard` is deleted — `@robot/app` is the only customer UI now. Staff get a read-only ops mode (`/ops`): one row per customer website across every org, problems first, and a website page showing its certified paths in customer words with real run hit rates. On branch `feat/cut-over`.

**Before it: [Drift repair, Part B (2026-10-05)](#drift-repair-part-b-2026-10-05).** When a run flags a field as drifted, a free check re-captures the website's proof pages and says what happened: `other-layout` (its own certified path still reads every expected value), `moved` (found mechanically at a new element), `changed` (reads a valid new value), or `lost`, with `page-gone` per proof page that no longer loads — never a model call, never a write outside its own `drift_checks` row and the proof-page `captures` it takes. The customer sees it on the website ("n fields stopped extracting"), the Verification tab's banner, and a repair line under the drifted row ("Accept new location" / "Accept new values" / "Mark it again" / "Replace product n"); accepting touches only that field's cells through the normal autosave and still needs a Verify. Proven end to end on a local site whose layout changes (real Chromium, zero AI) and live-smoked against the running app with a seeded check. On branch `feat/drift-repair`, not merged.

**Before it: [Variants plan 3 (2026-10-02)](#variants-plan-3-2026-10-02).** Extraction, export and reporting catch up with plan 1/2's setup and verification: a run now writes one row per variant (list method: one page load; links method: one load per variant page, counted against the budget), `_product_key`/`_variant_key`, drift and backfill repair each row by its own key, and the project's CSV/JSON/XLSX exports carry the axis and key columns in the project's chosen shape. The run page shows the variant counts, the axis/key columns in its results sheet, and a Download Excel link next to CSV/JSON; two wording leftovers from the plan 2b live check (N1, N3) are fixed. On branch `feat/variants-extraction`, not merged; the controller's live free extraction (CSV/JSON/XLSX against a real Everlane/Nike budget-3 run on keyless :4100) is still to run.

**Before it: [Variants plan 2b (2026-10-02)](#variants-plan-2b-2026-10-02).** Four fixes from a live check on Allbirds, Everlane and Nike (eight defects found): stub list entries ("Variant 1…" placeholders with no SKU, price or axis value) no longer count as variants; an axis column can never be confirmed "From the product page", on save or on screen; a variant link group drops an off-pattern link (Nike's "Design your own") instead of failing, and a locale path prefix compares two segments; and the on-screen wording is plain — `variantNoun` is "variants" unless exactly one column is mapped, the picker-only line shows only its twelve known words (no more "swatchs"/"defaultcolornames"), and a list with no detected column says so plainly instead of "Nothing of this kind…". The live check re-run is next. On branch `fix/variants-live-check`, not merged.

**Before it: [Variants plan 2 (2026-10-01)](#variants-plan-2-2026-10-01).** Verify now checks a website's variants too, free: the Verification table has a **Variants** row — each product's count ("2 colours", orange until its ✓), "No variants on this product", and, expanded, one variant checked per product (accept its suggested Price, SKU and Colour, type a value, or take a field "From the product page"). The button reads "Verify 5 fields and variants · …" or "Verify variants · free", and Go to Extract stays locked until the variants pass. Nothing is extracted per variant yet (plan 3). On branch `feat/variants-verification`, not merged.

**Before it: [Variants plan 1 (2026-10-01)](#variants-plan-1-2026-10-01).** A project can turn variants on (Fields page: No variants / One row per variant / One row per product, variants listed inside), each field says whether it differs per variant, and a website's Verification tab has a Variants step that reads the proof pages' screenshots — free — says how the site shows its variants ("Listed in the page data: 2 colours on every product") and records the method and its columns. Nothing is verified or extracted per variant yet: plan 2 verifies, plan 3 extracts. On branch `feat/variants-contract`, not merged.

**Before it: [Certification picks the right path (2026-09-29)](#certification-picks-the-right-path-2026-09-29).** A yes/no field, or one whose proof pages share a value, now certifies only on a path the customer confirmed, an element they marked, or a structured path named for it — Ikea's In stock stands on `offers.availability`, no longer on `priority`. Images match on host and path. On Ikea: **7 clicks** to Verify (was 24), 8 of 8 verified, free. The read-only audit flags one existing website for the customer to re-verify (Competitor prices / Ikea — In stock); nothing is re-certified automatically. Next: variants, a design of their own.

**Earlier: [Table-first verification (2026-09-28)](#table-first-verification-2026-09-28).** The Verification tab is one table — a row per field, a column per product, Accept all agreed above it, a cell click opens the screenshot. On Ikea it took 24 clicks to Verify (plan 5: 43) and verified 8 of 8, free; three defects the live check found are fixed. Next: Part B of the same spec, drift repair. The Jev shadow-checks design is parked, not scheduled.

**Before that: [App redesign, plan 5 — the Verification tab (2026-09-25)](#app-redesign-plan-5-the-verification-tab-2026-09-25).** A website's first tab is now Verification (find products from a listing, point at values, tick suggestions, verify); the grid and the stepper are gone from `@robot/app`. Ikea — its six stored fields plus SKU and Brand — verifies 8 of 8 through it, live and free. Plans 1–4 of the app redesign follow it below; the state paragraph under this one is older.

**State on 2026-09-11.** `main` holds the whole MVP flow: routes and shell (phase 1), the contract on the dataset (phase 2), the Schema tab as the proof sheet (phase 3), the Extract tab stepper (phase 4) and the visual system (phase 5), all merged fast-forward from `feat/schema-verification` at `b025fbf`. Spec: `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md`; one plan per phase under `docs/superpowers/plans/2026-09-*-mvp-flow-phase*`; one section per phase below. `main` is not pushed: `origin/main` is at `941cac3`, far behind.

**Every phase was gated the same way:** a review per task, a whole-branch review on the most capable model, one fix wave, one scoped re-review, then the full per-package test gate (`pnpm --filter <pkg> test -- --maxWorkers=1`; `pnpm -r test` gets killed for memory on this machine) and `RUN_UI_SMOKE=1` against `pnpm dev:all`. All green on `b025fbf`.

**What a customer can do today, live and free:** create a project, name its fields, add a website with three product pages and expected values, verify (Ikea reads 8 of 8 fields verified; a re-verify of certified paths costs nothing), set listing pages on the Extract tab (each checked for product links and a pager), sample three products (the probe, no AI), and see the run sentence with both dropdowns on all. Screenshots of every state: `docs/testing/screens/` (its README says which is which).

**The next work as of 2026-09-11 (superseded by the 2026-10-07 list at the top; kept for history):**

1. **Click Extract once, on a real website, for free.** The plan-then-execute path from the Extract tab has never run live (phase 4 stopped short of it on purpose). Ikea's eight fields are all mechanical, so a full Extract there spends nothing; "custom 5 products across custom 1 page" is the cheapest proof. Watch the run page's results sheet (it now falls back to the contract's columns) and the Runs tab.
2. **A second website through the whole flow**, one whose fields need AI, under the budget rule: never click a Verify or Extract that shows a dollar amount without Marko's say-so. This is also the only way to capture the Verifying strip's rough time (no current screenshot; see the README's "no current capture" note).
3. **Engine follow-ups the phases surfaced** (details in the phase 4 and 5 sections): the listing check and the probe walk count product links differently on the same page (7 vs 28 on Ikea); the 5,000-product ceiling is per listing input, not per run; spec 5.3's row counts on the Output page were never built.
4. Then the older roadmap items below (pagination live proofs, the job queue). None of them blocks a customer.

**Two design notes written 2026-09-11, decision pending (Marko picks which goes first):**
`docs/superpowers/specs/2026-09-11-lean-capture-for-certified-runs-design.md` (measured 2026-09-15: a certified run
spent ~70 s per product on Ikea, 60 s of it the networkidle timeout. **First increment landed 2026-09-15:** the certified path now waits for its own values (`CaptureOptions.ready`) and takes the domain lock; measured 10.5 s per product on the same website, 8 of 8 fields on every row. Still to do there: the capture built for the AI chain — screenshots, markdown, click
rounds, a second render — when the certified paths need under a second; also records that the
certified path bypasses the 2 s politeness lock) and
`docs/superpowers/specs/2026-09-11-second-layout-learning-design.md` (a listing whose product
pages differ in layout leaves cells empty on a verified website with no way to certify the second
layout; the cheap increment is a grouped miss list with "use as proof page"). Both are drafts,
not approved designs. Marko's testing of the MVP flow on 2026-09-11 came back happy; a few
non-urgent UX tweaks are still to be named. A third note, `docs/superpowers/specs/2026-09-17-typesafe-evaluation-note.md`, records TypeSafe (small typed-judgment models, ~100x cheaper than Claude per call) as a possible later improvement for second-layout discovery and per-row checks: assessed, not a priority, nothing built.

**Do not** start another fix-and-dogfood cycle on extraction quality (see *What NOT to redo*), reintroduce uppercase labels or cards outside dialogs and the websites list, or run parallel implementer agents in this checkout without explicit-path commits (the shared index bit twice in phase 5).

## Tenant isolation (2026-10-24)

Spec `docs/superpowers/specs/2026-10-24-tenant-isolation-design.md`, plan
`docs/superpowers/plans/2026-10-24-tenant-isolation.md`.

**What changed.**
- *The classification and the procedure sweep.* Every tRPC procedure has one row in
  `packages/api/src/isolation/procedure-classes.ts` — scoped (takes an id of an org's row), org-wide, self,
  membership, ops, public or stateless — and the table must equal `appRouter`'s procedures, so a new one fails the
  sweep until it is classified. `procedure-sweep.test.ts` builds two throwaway organisations (`two-orgs.ts`, one of
  everything a customer owns) and calls every procedure as A with B's ids: a scoped call answers `NOT_FOUND` in the
  same words as for ids nobody has, B's rows are unchanged (snapshot before and after), the test queue's job count is
  unchanged (`runAndWait`/`awaitJob` are mocked to throw), and B's own owner reaches the same rows with the same input;
  org-wide calls name nothing of B; membership calls refuse B's members; ops calls are `FORBIDDEN` to customers; no
  session answers `UNAUTHORIZED`.
- *The file-route sweep.* `packages/api-server/src/isolation-routes.test.ts` calls `/captures/*`,
  `/export/runs/*` (live and snapshot) and `/export/projects/*` across the two orgs: 401 without a session, 404 for
  B's files, 400 for traversal, and every wrong signed link (tampered, expired, another run's, another org's secret,
  made before rotation) the byte-identical 404 of a missing run.
- *No money for a customer.* Six procedures leave their amount keys out for a customer and keep them for an operator
  and a staff session — `runs.listByOrg` (`costUsd`), `sources.verificationStatus` (`costUsd` and the AI-call count
  `aiCalls`), `sources.verifyEstimate` (`upperBoundUsd`, `perFieldUsd`), `crawl.backfillPreview` (`estCostUsd`),
  `usage.byProject` (`spendUsd`) and `orgs.staffActivity` (`run.costUsd`; the run link stays) — through
  `moneyFields(viewerSeesMoney(ctx), …)`, which spreads `{}` so the key's name never reaches the browser. A
  customer's Usage is ordered by pages captured, then name (spend order would rank it). `money-sweep.test.ts` calls
  every customer query and the org-wide and self mutations and flags any money-named key or `$<digit>` in text, except
  at anchored paths that carry the customer's own data. The app's optional types compile and every screen still gates
  on `showsMoney`.
- *Rate limits.* `packages/api/src/isolation/rate-limit.ts`, one middleware on `publicProcedure`: sign-in 10 a minute
  per email (trimmed, lower-cased) and 30 per client address; heavy work 30 a minute per org (Verify, confirm,
  proof-page captures, planning, probe-and-sample, runs, backfill, variant detection, transfer marks, a manual drift
  check, changing or removing a member); the address checks 60 per org; everything else 1,200 per session. Staff count
  on `staff:<userId>`. Counting is all or nothing; a refusal is logged once per key per window and names no email or
  address. `RATE_LIMITS=off` turns it off (every vitest config does); `TRUST_PROXY=on` takes the last
  `X-Forwarded-For` entry. A refusal answers `TOO_MANY_REQUESTS` with "Too many requests. Wait a minute and try
  again.", shown on the sign-in form and on every button through `mutationErrorText`; React Query never retries.
- *The holes fixed.* `projects.list` read every org's websites (certifying each) and every org's runs — the answer was
  filtered by project, so nothing leaked; now scoped, with a test. `runInOrg` / `captureInOrg` refused another org's
  run or capture in words that confirmed it and named its website id (11 procedures); now the words of a missing one.

**How it was proven.** The procedure sweep: 85 procedures (scoped 56, org-wide 8, self 8, membership 3, ops 5, public
3, stateless 2), 252 tests; the file-route sweep, 9; the money sweep, 50 (30 customer queries, 9 mutations, staff
still read amounts); the limiter, 17. Full runs on the final head (`84413343`): api 2,005, api-server 88, app 1,107,
worker 18; tsc clean. The route smoke on the isolated pair with the limits on: 28 of 28, no `[rate-limit]` line in the
api-server log; the customer's Usage screenshots show "Pages captured in October 2026" as the headline and a Project /
Pages captured table with no spend column, the Runs screens and a run page show no cost, both themes intact. Reviews:
per task with fix rounds, and a whole-branch review (0 Critical; its 2 Importants — the drift check outside the heavy
group, and the final fix wave — fixed on the branch).

**After pulling.** Nothing to install or migrate. Restart `pnpm dev:all` to get the limits; until then the running
servers keep the old code. A customer's Usage and Runs show no money as before — now because the api sends none.

**What NOT to redo.** Never add a procedure without its row in `procedure-classes.ts` (and, if it starts work, in the
heavy or network group); never send money to a customer and hide it in the app — leave the key out with
`moneyFields(viewerSeesMoney(ctx), …)`; never turn `TRUST_PROXY` on without a proxy that writes `X-Forwarded-For`;
never let a sweep reach the worker — keep the `runAndWait`/`awaitJob` mocks; the tests run with `RATE_LIMITS=off`.

**Open.**
- Spec §6: distributed limits for several api-servers (one limiter per process today), per-role money, billing, abuse
  detection beyond fixed windows, real authentication — sign-in still accepts any password.
- Per-org limits can be dodged by minting orgs: any email signs in and gets its own personal org, each with its own
  heavy and network budget (closes with real sign-in). The per-email key also lets anyone who knows an address slow
  that user's sign-in (10 a minute) — inherent to per-email limits.
- Client address behind Docker or a proxy: the Compose stack's published port reaches the api from the gateway's
  address, so every browser shares one sign-in and one anonymous-session key (harmless while only the host connects);
  behind a real proxy set `TRUST_PROXY=on`, or anyone's 30 bad sign-ins a minute lock everyone out. The app's SSR
  session read with a stale cookie counts under the app container's address. IPv6 is keyed per address, not per /64.
- The file routes (`/export/*`, `/captures/*`) are not rate limited; a large run's xlsx is costly to build.
- Sweep coverage: the money sweep does not call scoped mutations or the `works` queries, or scan error messages; the
  scoped sweep feeds an all-B input, so a future procedure taking A's id plus an unchecked secondary id would pass (the
  four current multi-id cases are covered by hand); the B snapshot leaves out the legacy `extractors`,
  `extractor_inputs` and `credentials` tables (no procedure touches them, the fixture has no rows there).
- The money sweep's exclusions for sources.get cover verificationSet.expected/defaults but not
  verificationSet.variants.<url>.spot.expected (a customer's own typed values) — add that path if a money-named field
  ever appears there.
- `sources.verifyEstimate` still sends `aiFields` / `aiAvailable` to a customer (not counts; the Verify label reads
  them) — ruled to stay.
- `sources.get` hands the webhook secret to every member, by design for the Settings tab.
- A query refused by the limits shows the screen's own error line, not the sentence — only buttons and sign-in word it.
- The worker's bench (`worker/src/bench/seed.ts`) runs the api in-process with the limits on (far under them).

## Email (2026-10-24)

Spec `docs/superpowers/specs/2026-10-24-email-design.md`, plan `docs/superpowers/plans/2026-10-24-email.md`, live check
`docs/testing/results/2026-10-24-email/live-email.md`.

**What changed.**
- *The five messages.* "<website> needs your attention" and "A run of <website> failed" go to the org's owners and
  admins (members get neither); "Our team is working in your organisation" goes to owners and admins when staff enter
  (never to the operator); "Your role in <org> changed" to that person; "You were removed from <org>" to the former
  member. `partial`, `cancelled` and sample runs send nothing.
- *Once per event.* A website's turn to "Needs attention" is stored in `sources.attention_since`; `syncAttention`
  claims it `WHERE attention_since IS NULL` under the website's row lock, after every Verify, finished check,
  `updateBinding` and field edit (a check that started a refresh's re-verify leaves it to that re-verify), and resets
  it when attention clears. Every message has a unique dedupe key and every insert is `ON CONFLICT DO NOTHING`.
- *Queueing and the job.* One `email_messages` row per recipient and one `email` job each (background lane, priority
  25, five attempts). The worker sends with nodemailer over `SMTP_URL` (15 s limits); with mail off the row is
  `skipped`. At send time it checks the recipient may still get it (role, membership, the Account switch); otherwise
  `skipped` with the reason. Callers use never-throwing wrappers (`queueEmailsSafely`, `syncAttentionSafely`,
  `notifyRunFailed`): queueing never fails what caused it.
- *The Account panel.* "Email" between Profile and Appearance: "When a website needs attention" and "When a run fails",
  both on by default, saved on change; "Account messages are always sent."
- *The catcher.* Locally a Mailpit container (one-liner in `CLAUDE.md` and `.env.example`); the Compose stack has
  its own Mailpit (UI http://127.0.0.1:8225, SMTP not published; messages in a file inside the container). A provider is
  `SMTP_URL` + a verified `MAIL_FROM`, over `smtps://…:465` or `smtp://…:587?requireTLS=true`, never
  `tls.rejectUnauthorized=false`.

**How it was proven.** The live check (its own Mailpit, a throwaway database, the fixture shop, an in-process worker),
re-run on the final head: eight messages, each to the right person once, with its link in text and HTML; every repeat
sent nothing; nothing to the operator or an outsider; no shop host in any body; all eight rows `sent`
(`live-email.json`). Tests: db 33, scraper 1,314, api 1,680, worker 18, app 1,096, api-server 74, tsc clean. The route
smoke on the isolated pair (28 of 28); its Account screenshots show the Email panel in both themes. Reviews: per task
and a whole-branch review (0 Critical, 0 Important; four Minors fixed — read-only in-flight check, send-time recheck,
one-line queueing log, role read under lock).

**After pulling.** `pnpm install` (nodemailer is new); `pnpm db:migrate` (migration 0022); restart `pnpm dev:all`.
Mail stays off until `SMTP_URL` is set — run the Mailpit one-liner to see it. Any other worker or api-server on the
dev database (the isolated smoke pair) sets `SMTP_URL=`.

**What NOT to redo.** Never queue inside the transaction whose rows `syncAttention` reads — call it after the commit;
never sync at the end of a check that started a refresh's re-verify; never resend a row that is not `queued`; a
removal is queued before its delete; every caller uses the never-throwing wrappers; tests keep `SMTP_URL` empty; the
sync never writes a Verify row.

**Open.** Spec §8 (sign-in links, digests, per-website recipients, staff emails and an ops view of email, unsubscribe by
link, bounces, a "back to normal" email). A website that already needed attention when this shipped sends one email at
its next sync (only with `SMTP_URL` set). Links name `PUBLIC_APP_URL`, which must be where customers open the app.
Links carry no organisation: someone in two orgs whose session is in the other one lands there (follow-up: an
org-switching link). A job that dies on its fifth attempt without an answer leaves its row `queued`. Emails wait
behind queued background work (priority 25). The dev-database CLIs (`packages/worker/src/live-check.ts`,
`packages/api/src/crawl-execute.ts`, `packages/api/src/scripts/reverify-one-source.ts`) start job runners that send
email through `.env`'s `SMTP_URL` — safe only while `.env` has none or names a local Mailpit. A failed run's stored
sentence can be raw error text the copy filter misses; the email carries it as the run page shows it. The route smoke
leaves one `skipped` attention row in its throwaway org (mail is off on the pair).

## Recurring extraction (2026-10-24)

Spec `docs/superpowers/specs/2026-10-24-recurring-extraction-design.md`, plan
`docs/superpowers/plans/2026-10-24-recurring-extraction.md`, live check `docs/testing/results/2026-10-24-recurring/live-recurring.md`.

**What changed.**
- *The schedule.* A website's Settings tab has a "Schedule" row: Off / Every day / Weekdays / Choose days, a time and a
  time zone. `sources.schedule` and `next_run_at` hold it; `nextRunAt` (Intl only) runs a DST gap's time at the end
  of the gap and an overlap's once.
- *The sweep.* The worker sweeps every minute (`RECURRING_RUNS`, on unless `off`), claims due websites with
  `FOR UPDATE SKIP LOCKED`, moves `next_run_at` on from now, and starts a `scheduled-run` job — unless the website
  is paused, uncertified, an unconfirmed listing, or still running; `schedule_last` records why, and Settings says it.
- *The run's file.* A settled run of a website with a schedule or a webhook (finalised, or closed by the job layer with
  rows) gets a `run-delivery` job: CSV, JSON and XLSX snapshots in `run_files`, downloadable with the session
  (`?snapshot=1`) or by a signed link (`?expires=&sig=`, 7 days, HMAC with the website's secret).
- *The webhook.* One `run.finished` POST, signed (`X-Robot-Signature: sha256=…`), the same `X-Robot-Delivery` id
  on every retry (receivers dedupe on it), five attempts. Never to a private or loopback address — checked at save and
  on every resolved address at send, no redirects, 10 s, 64 KB — unless `WEBHOOK_ALLOW_PRIVATE=on`.
- *What a customer sees.* Settings: Schedule (next run, last outcome) and Webhook (URL, masked secret with Show / Copy,
  "Replace secret" behind a confirm). Runs: "· scheduled". Run page: "Webhook delivered …" / "not delivered yet —
  trying again" / "could not be delivered"; staff also see the code and error.

**How it was proven.** The live check (fixture shop, throwaway database, local receiver, real export route): a website
scheduled a minute ahead started itself 20 s after its time, completed in 10 s with 3 rows, wrote three files; one
signed POST arrived 0.4 s later, its signature verified, its three links returned the stored bytes; a tampered link
answered 404. Tests: api 1,599, app 1,092, worker, api-server and db suites, tsc clean; the route smoke on the
isolated pair. Reviews: per task (security review of the address check), and a whole-branch review (2 Important —
runs closed by the job layer did not deliver; the isolated pair and Docker settings — both fixed and re-reviewed).

**After pulling.** `pnpm db:migrate` (migration 0021), then restart `pnpm dev:all` so the worker starts the sweep.
Nothing runs until a customer saves a schedule. Any other worker on the dev database (the isolated smoke pair) must
set `RECURRING_RUNS=off`.

**What NOT to redo.** Never follow a webhook redirect; check every resolved address, not just the first; keep the
snapshot separate from the live download; a backfill re-delivers its parent; a sample never delivers; tests sweep with
a `now` in the future, never the real clock.

**Open.** Spec §6 (email, monthly/cron schedules, other destinations, other events). `projects.default_schedule` /
`output_destination` / `notification_channel` stay unused. The secret is stored in plain text. `run_files` is never
pruned (Needs Marko). Links name `PUBLIC_API_URL`, which must be reachable from the customer's endpoint. The backfill
re-delivery compares the Node clock with the database's (fine on one host; stamping `completed_at` with `now()` would
remove it).

## Run speed (2026-10-23)

Spec `docs/superpowers/specs/2026-10-23-run-speed-design.md` (with its Deviations note), plan
`docs/superpowers/plans/2026-10-23-run-speed.md`, measured in `docs/testing/results/2026-10-23-run-speed/report.md`.

**What changed.**
- *Lean capture with a fallback.* A certified run's item is captured lean: interception, the readiness wait, the expand
  pass, the navigated-away check, structured data, variant selection and the verdict — but no popup rounds, no
  pictures, no markdown, and the certified XPaths read in the live tab. Today's full capture of the same page is taken
  only on a missing field, a value not shown, a non-wall bad verdict, or the run's first two (check) items; a walled
  page is never loaded twice. Everything written on a fallback (values and path stats) comes from the full capture.
- *The run learns.* A disagreement on a check item, or three rescues in a row, switch the run to full. A field whose
  misses the full capture confirmed three times stops falling back on misses; not-shown confirmations count
  separately. A failed live probe always falls back. Websites with a variant plan always take the full capture.
- *Politeness start to start.* One page at a time per host, page starts at least 2 s apart (it used to add ~1.7 s
  after each page).
- *The gate.* With three or more browsers, runs hold at most all but two, so interactive work and a Verify always get
  one. Defaults stay `WORKER_BROWSERS=3` / `WORKER_RUNS=1` (memory; raising them is Marko's call).
- *Kill switch.* `RUN_CAPTURE=full` turns lean off. Each capture row's `metadata.lean` says which mode and why; a run
  ends with one `[lean]` summary line.

**How it was proven.** Fixture benchmark (throwaway database, own queue): per 1,000 pages 124.2 min → 76.5 min at one
run (1.62×), 19.5 min at four (6.37×), 15.3 min at six (8.13×); 16,800 cells, 0 mismatches; before vs after, 0
differences. Real pages (IKEA, Gymshark, Skullcandy; read-only session), run twice: 15 pages, 0 value and 0 shown
differences; Gymshark lean on every page (5.3 s vs 10.4 s), IKEA and Skullcandy fall back until their not-shown fields
are confirmed (about the 3rd–5th item). Tests: browser 308, scraper 1,311, api 1,318, worker 16; tsc clean; route
smoke 28 of 28 on the isolated pair; overlay self-test clean. Reviews: per task, plus a whole-branch review (2
Important — variant websites, one shared confirmation count — both fixed and re-reviewed).

**After pulling.** `pnpm install`, then restart `pnpm dev:all` so the worker runs the new code. To run several websites
at once set `WORKER_RUNS` and `WORKER_BROWSERS` (= runs + 2) in `.env` — about 1 GB free memory per run on real pages.

**What NOT to redo.** Keep the expand pass in lean (without it "Read more" texts differ); never write a lean read on a
check item; never load a walled page twice; stats only from the capture written.

**Open.** 8.1× at six runs, not 10×: one item in ten pays both captures, and websites start in whole waves. Two pages
at a time per website would roughly halve a big website's run (a politeness call, Needs Marko). The links-method
collector still renders twice; `waitUntil: 'domcontentloaded'` for lean is unmeasured; the domain lock is per worker
process; variant websites get no speed-up yet.

## The whole stack in Docker Compose (2026-10-23)

Spec `docs/superpowers/specs/2026-10-23-docker-compose-design.md`, plan
`docs/superpowers/plans/2026-10-23-docker-compose.md`. Queue item 1, under the standing approval.

**What changed.** A root `Dockerfile` (targets `api`, `worker`, `app`) and `docker-compose.yml` (project
`robot-stack`): Postgres 16 with a healthcheck, a one-shot `migrate` (drizzle-kit), the api-server and the
worker under tsx as in dev, the app built by Vite and served by `packages/app/serve.mjs`, and a `backup`
service that `pg_dump`s nightly into `./backups`. App :3200, api :4200, Postgres :5442, loopback only; own
volumes (`robot-stack_pgdata`, `robot-stack_captures`, the latter shared by api and worker). Keyless unless
`./stack.env` supplies keys; no image contains `.env`. One code change: the app's SSR session lookup uses
`API_INTERNAL_URL` when set (in the stack `http://api:4000`); dev is unchanged. Scripts:
`docker/backup/{backup,restore,restore-test}.sh`; smoke: `docker/smoke/{e2e,ui}.mjs` against a busybox
fixture page (profile `test`).

**Worth knowing.** The worker image is Playwright **1.62.1**, not 1.58.2: `@robot/browser` declares
`playwright` ^1.52 (resolved 1.58.2) but launches through `playwright-extra`, whose `playwright-core` peer
resolves to 1.62.1 in the lockfile, so dev launches 1.62.1's Chromium too.
Aligning the declared versions is a small follow-up. Ports are published on 127.0.0.1 only and the stack is
used as http://127.0.0.1:3200 — on `localhost` its session cookie would collide with `pnpm dev:all`'s.

**How it was proven** (`docs/testing/results/2026-10-23-docker-compose/`): from nothing,
`docker compose up -d --build` → all services up, 21 of 21 migrations applied, `/login` 200, `/healthz` ok;
the worker claimed a proof-page capture of the fixture page (done in 3.6 s), the api served its screenshot
(401 without a session); a real browser signed in through `/login` and stayed signed in after a reload (SSR
over `API_INTERNAL_URL`); `restore-test.sh` PASS (27 tables, every row count and content hash equal), a
stale dump FAIL (exit 1), `restore.sh` into a new database and `--replace` both worked, the nightly loop
dumped at its set minute and pruned to `BACKUP_KEEP`. Memory: worker ~350 MB after a capture, api ~140 MB,
app ~55 MB. `down -v` left nothing.

**For Marko.** `docker compose up -d --build` (first build pulls ~3.5 GB for the Playwright base; images
~5 GB together). It runs beside `pnpm dev:all` without touching it. Not production hosting: no TLS, no
offsite copy of `./backups`.

## Capture worker and job queue (2026-10-23)

Spec `docs/superpowers/specs/2026-10-23-capture-worker-design.md`, plan
`docs/superpowers/plans/2026-10-23-capture-worker.md`. First of the ten local pre-launch items.

**What changed.** Every page load now happens in a new `@robot/worker` process, never in the
api-server. The api-server adds a job to the `jobs` table (Verify, proof-page screenshots, drift,
coverage and scheduled checks, runs, planning, and the reads a request waits on); the worker claims
it with a lease, renews it while it runs, retries after a crash and closes the job's rows with the
existing customer sentences if it cannot finish. One place caps browsers (`WORKER_BROWSERS`, 3) and
waits for free memory; one browser is always kept for interactive work, so a run never holds up a
Verify or a screenshot. Two new customer sentences: "This run stopped before it finished. Extract
again to pick up where it left off." and "Finding the products stopped before it finished. Try
again."

**How it was proven.** Ten reviewed tasks, a foundation review and a whole-branch review, two fix
waves (incl. a claim query that could take two jobs at once — the real cause of flaky tests). Gate:
api 1310 tests in three serial runs, all green; route smoke 28 of 28 with the isolated pair's own
worker; crash recovery across real processes tested; no Chromium left running.

**For Marko.** `pnpm dev:all` now starts the worker too. After this merge: stop `dev:all`, run
`pnpm install` (new package), start it again. With 3 browsers, long jobs share 2; set
`WORKER_BROWSERS=4` for more throughput if memory allows.

## Websites change: keep running, re-check, tell the customer (2026-10-21)

Spec `docs/superpowers/specs/2026-10-21-websites-change-design.md`, plan
`docs/superpowers/plans/2026-10-21-websites-change.md`. Marko asked for it after the 2026-10-21 re-verify
stopped ten websites whose live pages had changed.

**What changed.**
- A failed re-verify no longer stops a website whose last good paths still read the proof pages: the
  field is held and runs go on with what was verified. Only the customer's own edit, or a passing
  Verify, ends a hold.
- Price, rating, review count and stock refresh their expected values by themselves when the same
  certified path reads a valid, shown, in-range value on two or more pages; a free re-verify follows.
  Title, brand, SKU and description always wait for the customer.
- A free check reads the pages after a failed Verify, and every few days when `WEBSITE_CHECKS=on`
  (off by default; `WEBSITE_CHECK_DAYS`, default 3).
- The customer sees "Needs attention", one sentence naming what needs them, "Updated automatically on
  {date}" under refreshed fields, and Extract stays unlocked while the website can run. Staff see
  holds, automatic updates and why a value was not taken in ops.

**How it was proven.** Reviews caught: holds without evidence, a Verify racing a refresh (now one row
lock), a refresh's re-verify revoking variants, and the after-Verify check misreading held fields — all
fixed. Gate: api 1161, app 1074, scraper 1271 tests; route smoke 28 of 28. A read-only replay of the
ten websites: all ten runnable again.

**Rollback.** Migration 0019 only adds tables and columns; a code rollback ignores holds (held websites
stop again) and keeps refreshed values (they are accurate). See spec §10.

## HTML backups capped too (2026-10-21)

Spec `docs/superpowers/specs/2026-10-21-xpath-cap-design.md`. Queue item, approved by Marko 2026-10-21.
The page's HTML now counts as one source under the two-per-source cap, like an API response, the
JSON-LD or the meta tags: an XPath-only field keeps two XPath paths, and ops warns "All backups read
the same response" on it. A field certified across several page layouts (each path proven on
different pages) is a cover, not a set of backups: it is never capped, never warned on and never
searched again for it (fixed after review). Nothing changes for a website until its next Verify.
Gate: scraper 1254, app 1056 tests, tsc clean; route smoke 27 of 27.

## Customer copy: capture failures and run limits (2026-10-21)

Spec `docs/superpowers/specs/2026-10-21-customer-copy-design.md`, plan
`docs/superpowers/plans/2026-10-21-customer-copy.md`. Queue items 1 and 2, approved by Marko 2026-10-21.

**What a customer reads now.** A page we could not read is described in plain words, never with its
host or an HTTP code: "This website turned us away, so we can't read it yet.", "This website asked
for a human check. Wait a few minutes and try again…", "This website took too long to answer. Try
again.", and so on; anything unrecognised reads "We couldn't read this page. Try again." Settings'
"Budget" row is "Run limits"; the run page says "skipped for the page limit". Staff still see the
stored detail everywhere.

**How it works.** The stored sentences are unchanged (drift and the run diagnosis read them); the app
rewords them on screen (`captureWords`), and failed buttons go through `mutationErrorText`. A sweep
test fails on "budget", "HTTP <digit>", "refused the browser" or "CAPTCHA" in shipped customer copy.

**How it was proven.** The whole-branch review found the Extract tab showing a walled listing's
planning error raw, and library errors slipping through — both fixed. Gate: app 1056, api 1059
tests, tsc clean; route smoke 27 of 27.

## Backups from more than one source (2026-10-20)

Spec `docs/superpowers/specs/2026-10-20-one-source-backups-design.md`, plan
`docs/superpowers/plans/2026-10-20-one-source-backups.md`. Queue item 3, run under the standing approval.

**What changed.** A field's certified paths used to be the five best, which on Ikea meant five
sibling keys of one API response that fail together. Verify now keeps at most two paths per source
(one API response, the JSON-LD, the meta tags) and fills the rest from other sources; XPath paths
are exempt. Each certified API path records the response it reads (`container`), and ops shows
"from {host}{path}" under it. Ops warns "All backups read the same response" only when every path
still reads one source. A Verify whose cached result reads one source searches again (free, no AI).
Nothing changes for a website until its next Verify; what certifies a field and its first path are
decided as before.

**How it was proven.** Reviews: Tasks 1–3 approved; the whole-branch review found the domain store
dropping the new JSON-LD backup (every Verify would have searched again) — fixed. Gate: scraper 1251,
api 1058, app 972 tests, tsc clean; route smoke 27 of 27. A read-only check on the stored captures:
20 flagged fields spread at their next Verify, 21 stay single-source because the page offers one.

**For Marko.** At their next Verify, two fields change their first path: Competitor prices / Ikea
"In stock" (API → HTML) and Lookfantastic SKU. Ikea's Price stays one source (its pages have no
second source for the price). Whether to re-verify the one-source websites, and whether to cap
XPath backups too, are in `docs/queue.md`, Needs Marko.

## The finder reads product links (2026-10-20)

Spec `docs/superpowers/specs/2026-10-20-finder-links-design.md`, plan
`docs/superpowers/plans/2026-10-20-finder-links.md`, evidence and live check
`docs/testing/results/2026-10-20-finder-links/`. Queue item 2, run under the standing approval.

**What a customer gets.** "Find products" offers products, not menus, category tiles, policy pages,
a language link or one product in several colours. A listing with no product grid says "No products
found on this page." The finder loads more of a lazy listing, bounded. The coverage check samples
only products, never a proof page under any query, says when a listing has none, and stops
re-offering "Use as proof page" for a field a same-shape proof page already answered.

**Why it was wrong.** One rule grouped a page's links by URL shape and took the biggest group. It
split one product shape into many small groups (ordinary slug words stayed literal), counted every
`?color=` copy as a product, and never said "none". The new rule (`findProductGroup`): a product
link sits on a card with an image and a price; one product is one path; shapes are per segment; a
JSON-LD ItemList counts. The walk keeps its own row selector; the rule is its cross-check.

**How it was proven.** Live check on the 13 campaign listings (`live-check.md`, old vs new): all 11
real listings offer their products (bombas 27 on cards, burrow 25, lacoste 13, notonthehighstreet
60, ruggable 47, skullcandy 41, thomann and puma more than before because loading reaches further),
ikea's blog and ridge offer none, and no menu or policy link anywhere. Reviews: Task 2 had its own
(query-id shops collapsed to one product; a merge could pull in a menu; currency codes matched
"Try 2 colours"); the whole-branch review found two Important (script paths like
`product_info.php?products_id=N` still collapsed; a quadratic walk took 26 s on a big listing) — all
fixed and re-reviewed. Gate: browser 302, scraper 1210, api 1058, app 960 tests, tsc clean; route
smoke 27 of 27.

**Known limits.** The "already answered" rule is per shape, and most shops have one product shape.
A price-less grid whose images load late can read as no products. Colours that are separate product
pages (gymshark) stay separate. The route smoke's first sign-in test runs close to its 5 s limit
(passed alone in 4.3 s) — a timing flake to widen.

## Verify never fails silently (2026-10-20)

Spec `docs/superpowers/specs/2026-10-20-verify-silent-failures-design.md`, plan
`docs/superpowers/plans/2026-10-20-verify-silent-failures.md`. The first item run under the standing
approval (`CLAUDE.md`, "Autonomous runs"; queue `docs/queue.md`).

**What a customer gets.** Every refused, failed or stalled Verify, and every failed proof-page
screenshot, ends with one sentence in view: in the Verify bar beside the button, or on the card,
cell or row it concerns. The old bottom-of-page error block is gone.
- A refusal names the field and the product number: "Rating on product 3 needs a value, or "Not on
  this product". Nothing was checked." Never an address, a field key or the server's own text.
- One field's AI failure fails that field only: "We couldn't finish checking Brand this time. Verify
  again — nothing else changed." Every other field, capture and cost stays (skullcandy's case).
- A run that stops says "Verify stopped before it finished. Your last results are kept — try again.",
  and the table keeps the last completed run's verdicts instead of going blank.
- A value found in another place on one product reads `elsewhere` with its own hint, not "not found"
  (ridge's description); the selected-cell bar now shows the cell's hint.
- A page Verify could not capture says why on its card, cells and badge; a failed field never has a
  blank Status; cards never say "stalled" or show a raw error, and never sit on "taking screenshot…".

**How it was proven.** Seven tasks; Task 3 (the api error shape) had its own review, the rest were
read by the controller, and a whole-branch review on the most capable model covered all of them. It
found one Important problem — a redirected proof page showed its full address — fixed in `d865300`.
Gate on the branch: app 956, api 1044, scraper 1135 tests, tsc clean; route smoke 27 of 27 on an
isolated keyless pair, including the new test (a failed run, an `elsewhere` cell and a refusal each
show one sentence, and the table keeps its verdicts).

**Left open (review Minors).** Refusals the app cannot name still read "Verify could not start. Try
again…" (an invalid value the app's own gate normally catches first); a refusal because a staff
session ended reads the same (the staff banner still updates); a card's "Not checked on product n"
stays until the next Verify even after a fresh screenshot; the capture-verdict sentences still name a
host and an HTTP code (in `docs/queue.md`, Needs Marko).

## Captures without overlays (2026-10-19)

Spec `docs/superpowers/specs/2026-10-19-capture-overlays-design.md`, plan
`docs/superpowers/plans/2026-10-19-capture-overlays.md`, evidence
`docs/testing/results/2026-10-19-capture-overlays/findings.md`. Branch `feat/capture-overlays`
from `main` at `ed3cf41`. Campaign 2, group 2 (`docs/testing/2026-10-11-campaign-2.md`).

**What a customer gets.** Nothing new on any screen. A proof page's screenshot shows the product
where it used to show a zoom lightbox, a size-guide drawer, a video modal, a cookie preference
centre or a geo popup, so marking works where it did not, and the judge and Jev read the product.
Captures already stored are not redone; a re-capture gets the clean screenshot.

**What changed** (all in `packages/browser`; the rules and the page code are in `src/overlays.ts`):

1. **One overlay definition** (§3.1): a visible dialog (`role=dialog/alertdialog`, `aria-modal`,
   an open `<dialog>`), a fixed or absolute box named modal/drawer/lightbox/popup/dialog covering a
   quarter of the window, or any fixed box covering a quarter that is not a header or footer and
   sits on top of page content (it covers the window's centre, or page content lies under its own
   centre, a wrapper of the whole page such as `#page`/`#root` not counting — a buy box in a
   column the page reserves is not an overlay) — never `<html>`, `<body>`
   or a box holding the page's `main` or first `h1`.
2. **The expand pass never leaves an overlay** (§3.2): it skips `aria-haspopup` layer triggers,
   controls whose `aria-controls` target is dialog-like, and anything inside an overlay; it clicks
   each control once (one already expanded counts as clicked); an overlay that appears during a
   round is closed (Escape, then removed — or hidden, when it is not fixed, so an inline dialog's
   text stays in the HTML — scroll lock lifted). The tabs step has the same rules and never follows a
   link elsewhere or to a file, and it is **off by default** (below).
3. **Dismissal** (§3.3): whole names, not substrings ("Cookie settings", "look", "Rosy Outlook" are
   not "OK"); never a variant control, a settings/preferences/manage/options control or a link
   away; a click counts only if the element or its layer went away, and a dead one is never
   retried; each round first closes the topmost layer by its own close word (Close, Schließen, ×,
   …); then a removal pass hides every overlay (its text stays in the HTML) and removes today's
   selectors; at most four rounds and six clicks per pass. Consent banners in open shadow roots are
   still reached.
4. **One more pass just before the screenshot** (§3.4), the navigated-away check again, then the
   page scrolls to the top. Outside an overlay, dismissal never clicks what the expand pass opened
   (a control it clicked or found expanded in main/article, anything inside a panel or `<details>`
   it revealed), and the final pass offers today's page-wide steps only inside an overlay or a
   consent-like layer — so a panel's own "Close" never shuts it again. An overlay still at the
   centre is one warning line:
   `[browser] <url>: an overlay still covers the middle of the page after dismissal: div#x "…"`.
   No new field on the capture result.

**Found on the way.** The old tabs step never ran under `pnpm dev:all`: tsx (esbuild `keepNames`)
serialised its inner `function clickTab` with `__name(…)`, the page has no `__name`, and the
step's `catch` hid the error — tabs were clicked only under vitest. All page code now goes through
`pageScript()` with an `__name` shim, so the tabs step now *can* run in a real capture.
**The tabs step stays off by default** (final review I3, controller ruling): turning it on would
change the DOM every certified source reads, with no drift measurement. `CaptureOptions.expandTabs`
(default false) turns it on; nothing in the product does yet; `crawl()` never does. It stays off
until a free replay of certified sources shows no drift.

**Known limits** (accepted for this plan, not bugs): a close button in the page's normal flow
below the fold is no longer clicked; a page with no `main`/`h1` outside its dialogs is not
protected from being mistaken for one; a type-less button inside a form still submits it
(`returnIfNavigatedAway` recovers — pre-existing, not new here); a role-less popup that contains
an `h1` and comes before the product's `h1` in the document holds "the page's first h1", so it is
not treated as an overlay (a role=dialog one is: dialogs use the most-of-the-text rule instead); a
late consent banner in the final pass is reached only inside an overlay or a layer whose id/class
says cookie/consent/banner/popup/modal (or a dialog role), not a bare page-level "Close".

**Tests** (each file alone: `cd packages/browser && npx vitest run src/<file>`): `overlays.test.ts`
(pure rules), `overlays-page.test.ts` (the definition in Chromium), `capture-expand-overlays.test.ts`,
`capture-dismiss.test.ts`, `capture-final-pass.test.ts`; `dismiss-navigation.test.ts` unchanged;
`packages/scraper/src/__fixtures__/capture-no-scroll.test.ts` still green.

**Live check — runs on `main` after merge.** Free, keyless, one browser:
`cd packages/browser && npx tsx ../../docs/testing/capture-overlays-check.mts` (`--self-test` first:
a local page, no network). It re-captures the findings' proof pages with `captureProofPage`'s
options (load, interception, the proof-page ready check, the selection script, six tiles, the box
map) and writes `<site>-<n>-after.png` and `after.md` beside the before screenshots. Expected: no
overlay at the centre on each page; the §5.3 accordions still open (tabs are off by default); the
variant at load equals the variant after the capture; the h1 and the JSON-LD price in the box map.

**Open.** Thomann's `waitUntil: 'load'` timing out at 45 s in the judge and Jev scripts (§7);
choosing a shop's country (§7); a customer message for "the product is covered" if the live check
shows it is still common (§8.3). A fixed buy box covering a quarter of the window *over the page's
content* is hidden from the screenshot (its text stays in the HTML; one in a reserved column is not
hidden) — watch for it in the live check. Turning the tabs step on, after a free replay of certified
sources shows no drift.

**Review and merge (2026-10-19).** Five tasks, each reviewed, with fix rounds on Tasks 1 (two), 2
(three) and 3. The whole-branch review found three Important problems: the final pass closed panels
the expand pass had opened; a fixed buy box was hidden from the box map and the variant read; and
turning tabs on would change every certified source. All fixed (tabs stay off), re-reviewed, merged
into `main` (fast-forward, `8b30c4d`).

**Live check, first run (2026-10-19, `after.md` and `*-after.png` in the results folder).** The
table says "no overlay at the centre" on all 16 pages captured, but the screenshots disagree on three
sites. Clean: Skullcandy (the geo modal is gone), Mejuri, Ikea (no cookie centre), Thomann (no
videos or drawer), Lacoste. Still covered: Puma DE's "Standort wählen" popup over the swatches (smaller
than a quarter of the window, so not an overlay); a Colourpop cookie banner ("Preferences" / "Accept";
bare "Accept" is not a listed name); a grey scrim over Kith's first screen. The check only looks at
the centre, so it missed all three. Fixed the same day, below. Two
variant reads changed during capture (Lacoste read a gallery label "Image 1 of 6" as a colour at load;
Puma's picker had no selection at load), neither shown to be one of our clicks.

**Live fixes, merged (2026-10-19, `fix/capture-overlays-live`, head `b5dfe7b`).** Three general
rules, no site names: a smaller popup (8–25 % of the window) counts as an overlay when it sits over
page content, has a close control and a heading or layer name (Puma's "Standort wählen"); consent
accept names grew (bare "Accept", "Allow cookies", and the same in German, French, Spanish, Italian,
Dutch, Portuguese and Swedish), but single-word names count only inside an overlay, a consent host
or a fixed box, and a form-submitting button outside one is never clicked; when a modal has no close
control Escape is pressed first (Kith's welcome modal and its `body::before` scrim close the page's
own way), and a translucent full-window html/body scrim is hidden only in a capture that closed
something. The mouse is parked at the top-left before the screenshot (Puma's size 41 showed a hover
border where a cookie click had landed — no size was selected). The live check now lists every
fixed layer and scrim, not just the centre. Reviewed (two Important, fixed, re-checked live).

**Live check, final (`after-2.md`, `after-3.md`).** Every page captured is free of modals, drawers,
cookie banners and scrims: Puma DE, Colourpop, Kith, Skullcandy, Mejuri, Ikea, Thomann, Lacoste. Left
on purpose: small promo teasers under 8 % of the window (Skullcandy's "GET 15% OFF ×", Puma's "NEU
HIER? -15% ×") and sticky add-to-bag bars along the window's edge (Lacoste) — spec §7. Mejuri's
single-open accordion still ends on "Shipping", not "Materials", as before this work.

## Verify dead ends (2026-10-17)

Spec `docs/superpowers/specs/2026-10-17-verify-dead-ends-design.md`, plan
`docs/superpowers/plans/2026-10-17-verify-dead-ends.md`. Branch `feat/verify-dead-ends` from
`main` at `8860875`. Eight tasks (subagent-driven); Task 9 (UX polish) deferred until Marko
describes it; Task 10 is this entry. Fix rounds on Tasks 3 (two rounds), 6, 7 and 8. Whole-branch
review (the most capable model): one Critical, two Important, three Minor, fixed in one wave
(six commits) and re-reviewed clean; one further Minor (the box map can store up to 2,000
characters per box) watched, not fixed. Merged into `main` 2026-10-19 (fast-forward, no merge
commit).

**Route smoke on `main` (2026-10-19): 26 of 26** (`762a763`). It ran against an isolated pair, a
keyless api-server on :4100 with `JEV_SHADOW` empty and the app on :3100, because shadow is on in
`.env` and the dev servers would have made paid readings. Its first run found two things the
branch had broken: the address warning's text and its new button shared one element, so the warning
no longer read as its own text; and an old check still expected a price on the variants Verify
label. Both fixed in `77f5f3f`. A later run failed early because that api-server's browser
wedged; a restart fixed it. The customer screens show no amount and no price word.

**What a customer gets.** The seven dead ends campaign 2 found at Verify (group 3,
`docs/testing/2026-10-11-campaign-2.md`) are fixed:

1. **A project field the website does not have** (kith Rating, glossier SKU, puma DE Rating) now
   passes. Marking every proof page "not on this product" certifies the field **not on this
   website** — no path, no AI, left empty on every product (§2).
2. **A suggestion on products four to six** on a field with a default no longer blocks Verify. A
   blank cell there is a default cell too, the same as on products one to three (§3).
3. **A shop's name** (`og:site_name`, the offer's seller) can now certify as the brand, ranked
   after every product-level path — Gymshark's and Sigmabeauty's honest brand is a candidate now
   (§4).
4. **A page where the value was found reads green**, even while another page fails elsewhere.
   Only a page covered solely by a path that reads just that one page reads **ambiguous**
   instead, with new copy: "Found on this product, but not in the same place as on the others.
   Mark it on the screenshot." (§5).
5. **A mark now reads the way the page shows it:** whole text up to 2,000 characters (not 500),
   an image's `src` attribute (not its rendered `currentSrc`), a link's `href`. A marked
   sku/brand/availability/rating/review_count/currency line stores its value with the label
   stripped ("Style: 398846_01" stores "398846_01"); retyping the same value keeps the mark (§6).
6. **A number shown rounded** (4.8) now matches more precise page data (4.7610064), symmetric,
   never for a whole number or for money; the run still stores the page's precise value (§7).
7. **Verify's cost estimate** is now per AI-reachable field per proof page ($0.06), which covers
   the campaign's largest real call. **The address warning** (a certified path reading a fixed
   variant index, not the one the page's own address names) now carries a **Re-verify this
   field** button, free, no AI call (§8).

**A customer sees no money anywhere in the app** (§8a, Marko's decision 2026-10-17: "once we
have paying customers we don't want to show any price to the customer. We will have a different
payment plan, to be decided later."). One pure helper, `showsMoney(session)`, decides it —
`session.isOperator || !!session.staff`. It gates the Verify button's price, the address
warning's "· free", the repair preview's dollar estimate, Extract's sample sentence ("No AI.
Free." is staff-only), the Usage page's spend and Spend column, and the robot-staff activity
log's cost. Staff see every amount exactly as before.

**The whole-branch review's own fixes**, beyond the plan: a field covered only by one-page paths
used to read every cell green although nothing certified — those cells now read `ambiguous`
too; a run's coverage, misses, dead fields, backfill preview and the Sample panel's empty-cell
note now leave out a field that is not on this website, instead of counting it missing
(`notOnWebsiteKeys`, exported from `current-certification.ts`); "not on this website" with one
proof page not captured now reads incomplete, not verified; `afterLabel` collapses whitespace
and line breaks before matching a label; a typed "5.0" now counts as one decimal, so it
rounds-matches 4.96 but not 4.94 (a typed "4.80" counts two decimals, so it no longer
rounds-matches 4.76); the route smoke's no-money check now catches a bare, case-insensitive
"free".

**Deviations** (also on the spec's status line): a suggestion carried to another product used to
keep its label ("Style: 398846_01"); Task 3's second fix round made transfer-marks strip it, the
same as a typed value, through `after_label`. The address warning's re-verify could still reach
AI when a proof page had changed since its capture, or when another field had an unsaved edit;
Task 7's fix round gave `sources.verify` a new `free` flag that forces the whole run's agent to
`null`. Beyond the plan: the re-extract label and the repair strategies name no AI and no cost to
a customer (`reExtractLabel`, `backfill-preview`); staff copy is unchanged. Task 2's
plan-mandated duplicate `ambiguous`-hint test was dropped as redundant with Task 1's.

**What was left out** (§11, for later): running the AI fallback when every cell is
`no_fitting_path` — the gymshark case is removed by item 3 above, since its brand is now a
candidate; the rule against guessing a weak field otherwise stays. The silent failures: skims'
HTTP 412, skullcandy's time-out, ridge's typed description with no reason. Typed style codes the
DOM search finds behind a label (marking works now; typing still does not). Captures that open
overlays over the place to mark. Storing a rating rounded to the customer's own typed precision.
Removing money from the API's own answers to a customer session — the app hides it, but
`verifyEstimate`, `usage` and `runs.listByOrg` still send it, so a customer could read it in
their browser's developer tools; it belongs with the payment plan. The UX polish Marko has not yet described.

**Open from the reviews:** "budget" on the run page and in Settings means a page limit, but a
customer may read it as money (Marko to decide the word). With a default and one valued product,
the `ambiguous` hint says "Mark it on the screenshot", but a mark cannot help: the field needs a
value on a second product. Older than this branch: the number reader drops letters, so a rating
shown as "5.0 out of 5" reads 5.05.

**Found during review, not planned exclusions:** whether "budget" (a page limit, in the run page
and Settings) reads as a money word to a customer — for Marko to decide. The `ambiguous` hint's
copy still says "mark it" for a field with a default and exactly one valued page, where the
honest fix is a second product, not a mark. Pre-existing: `numberText` drops letters, so a typed
"5.0 out of 5" reads as "5.05". The box map stores up to 2,000 characters per box — worth
watching on payload size.

**Decisions Marko took** (§12, 2026-10-17): the per-page cost estimate ($0.06, staff only) over a
flat per-field one, even though an eight-field, three-page first Verify reads "up to $1.44"
worst case (real first Verifies in the campaign cost $0.00–$0.33) — an upper bound never
exceeded beats one exceeded three times over. The shop's name ranks last among brand candidates.
A label is stripped for six concepts only, not more widely, so a title or a description is never
shortened. A rounded rating stores the page's precise value. "Not on this website" needs three
matching cell answers, with no row-level "mark every product" button in this spec — left for the
UX polish task if he wants one.

## Jev at Verify, in shadow (2026-10-16)

Spec `docs/superpowers/specs/2026-10-16-jev-at-verify-shadow-design.md`, plan
`docs/superpowers/plans/2026-10-16-jev-at-verify-shadow.md`. Branch `feat/jev-at-verify` from
`main`, six tasks (subagent-driven), each reviewed — fix rounds on Tasks 1, 3 and 5, Tasks 2 and 4
clean on first review. The whole-branch review, the merge, the route smoke on `main` and the live
check: see the plan's status.

**What a customer sees** (spec §6): after a proof page's capture is stored, a Jev reading runs in
the background — one call, the screenshot once in state — and picks among our own candidates for
every ambiguous text/money/number field, plus which variant the page shows when its data carries a
list. Nothing it says changes an answer, a suggestion, a certification or a run. Where its pick
differs from the row's own suggestion or the customer's answer (p ≥ 0.6), the row's status column
shows one muted line, "Jev reads 374.25 as the Price on product 1"; the cell detail bar shows
`Jev: 374.25 (0.98)` for the selected cell, read-only. Every reading is recorded against what the
customer finally verifies (`verify_agreement` on the verification row), so the agreement can be
read later without touching anything live.

**How it was proven, so far:** unit tests per package — `jevCandidates` on fixtures copied from the
two Jev experiments (Ruggable price, Gymshark brand, Colourpop title), `buildJevRequest` and
`runJevReading` against a fake TypeSafe client (done, failed, timeout, the switch and the daily
budget), `jevNote`/`jevDetailText`/`jevPollMs` pure over fixture boards; a route smoke addition
seeding one `done` reading on the smoke website's product 1 and reading the row note and the
detail-bar text, with no reading on the rest of the table showing no note. **Still to come — see
the plan's status:** the whole-branch review, the merge, the route smoke run on `main`, and the
live check (re-capture the proof pages of Ruggable, Gymshark, Colourpop and Kith in the campaign
project with `JEV_SHADOW=1`, read the notes and the detail-bar text, check the stored rows; expected
total ≈ $0.01).

**Deviations from the spec:** no re-read when a field is added to the contract — a re-capture
covers it (planner deviation, accepted up front). A separate polled `sources.jevReadings` query
feeds the tab instead of folding readings into `suggestMarks` (`suggestMarks` is merged once per
page, not polled). The variant note shows under the fields that read a variant list, never on the
Variants row itself — deferred. The stored tile is 1280×1536, not the spec's 1440×1000 (within the
size budget; the live check confirms it reads the same). App polling caps at 40 fetches, and
`sources.jevReadings` reports a `running` row older than two minutes as `failed` at read time (no
write), so a reading stuck running after an api-server restart never polls forever. The variant
question's certified `[page]` entry is not recorded in the agreement — no resolver exists for it
today.

**Known gaps / next:** a reading that lands more than ~6 seconds after its capture shows only after
a reload (the tab's polling window closes first). With Jev off (no key, or `JEV_SHADOW` unset) the
tab still asks `sources.jevReadings` three times per capture set before giving up — free, but three
round trips nothing answers. Booleans, images and descriptions are not asked (the images experiment
showed hidden/collapsed sections defeat a crop); no store-JSON variant fallback for a page like
Glossier's with no JSON-LD variant list. **How to turn it on:** set `JEV_SHADOW=1` and
`TYPESAFE_API_KEY` (and, optionally, `JEV_DAILY_READINGS`) in `.env` and restart the api-server.
Keep `JEV_SHADOW` unset for `pnpm test:ui:app` and `pnpm test:ui:staff` runs, or the servers send real,
paid readings for the captures the smokes trigger. A drift check's re-captures never start a reading.
**How to read the numbers:** `pnpm --filter @robot/api exec tsx src/jev-agreement.ts`. **Next (spec
§9):** after ~20 websites, read the agreement and decide whether Jev's pick becomes the row's
suggestion for ambiguous fields and the variant pick becomes `[page]`'s fallback.

**The "wide layout" was our stealth plugin (2026-10-16, `e59a2ed`, `docs/testing/results/2026-10-16-wide-layout-stealth.md`):** Ruggable, Ridge and Mejuri rendered 4,000 px wide because two stealth evasions together (`iframe.contentWindow` + `user-agent-override`) make their layout scripts write `width:4000px` onto `<body>`. `iframe.contentWindow` is now left off (`STEALTH_EVASIONS_OFF`). Before/after on 16 proof pages: no new walls, every page 1,280 px wide with its heading on screen; Ruggable's Sierra page now gives Jev the 6'x9' sale price, the title and the selected variant. This closes campaign 2's "product column off a 1,280 px screenshot" group (Ridge, Ruggable, Mejuri) — re-mark or re-verify those websites to use it. A capture now warns when a page is laid out far wider than its window.

**Staff-only (2026-10-16, Marko: "customer is not technical, doesn't know what Jev is"):** readings reach only operators and staff sessions — the api returns nothing to a customer and the tab neither polls nor renders. The route smoke now asserts a customer never sees a Jev line or the word Jev; the note's wording stays covered by `jev-view` unit tests. Shadow is ON in Marko's `.env` since 2026-10-16: every proof-page capture now starts a reading (≈ $0.0003/page).

**Merged and live-checked (2026-10-16):** merged into `main` (fast-forward, 16 commits) after six reviewed tasks (fix rounds on Tasks 1, 3, 5), a whole-branch review (0 critical, 1 important: drift checks started readings — fixed) and a fix wave (re-review clean). Route smoke on `main`: 26 of 26 with shadow off. Live (`docs/testing/results/2026-10-16-jev-at-verify-live-check.md`, $0.0046, 14 readings): Gymshark 15/16 and Kith Brand/Title 6/6 agree with the verified values; Colourpop's "Mega Palette" disagreement is the page having changed; Ruggable's screenshot is nearly blank (wide layout off the 1280 px capture), so Jev honestly answers "none". Follow-ups: wide-layout captures; drop `og:title` long forms as Title candidates; trim variant labels to option values.

## The variant the address names (2026-10-14)

Spec `docs/superpowers/specs/2026-10-14-variant-from-the-address-design.md`, plan
`docs/superpowers/plans/2026-10-14-variant-from-the-address.md`. Branch `feat/variant-from-address`
from `main`, six tasks (subagent-driven), each reviewed — one fix round each on Tasks 1 and 2,
Tasks 3–5 clean on first review. The whole-branch review, the merge, the route smoke on `main` and
the live check: see the plan's status.

**What a customer gets** (spec §2): a row's values are the values of the variant the address
names, or the one the page shows selected when the address names none. Every capture computes a
page variant; a certified path can read an array by it with `[page]` (`offers[page].price`,
`hasVariant[page].sku`), which resolves to the one matching entry and to nothing otherwise, never
entry 0. Verify proposes `[page]` whenever the typed value sits in the matching entry and ranks it
above the fixed index, so Ruggable's three proof pages certify one path though the 6x9 entry sits
at a different index on each. A proof page whose address names a variant the certified path
ignores reads "reads the first variant, not the one the address names on product n" in its row. A
page that does not show the variant its address names fails its capture: "The page did not show
the variant the address names (swatch=16)." — a failed item with one sentence, no row, no backoff.

**How it was proven, so far:** a review per task, with a fix round each on Task 1 (the merged-set
false negative on multi-axis pages, the `6' x 9'` label gap) and Task 2 (the exact-label list
over-matching `?size=5`); unit tests on entry shapes copied from the campaign's stored captures
(Skullcandy's one-block-per-colour JSON-LD and Shopify `variants[].id`, Ruggable's
`hasVariant[].sku …-06x09` and `size "6'x9'"`, Kith's `offers[]` with a selected size, Burrow's
option pairs against entry names); Chromium tests for the selection script and the wrong-variant
verdict; a route smoke addition for the certified `[page]` path and the row warning. **Still to
come — see the plan's status:** the whole-branch review, the merge, the route smoke run on
`main`, and the live check (Verify on Ruggable, Skullcandy, Kith and Glossier, a small Extract on
each; Puma is expected to fail its capture with the new sentence).

**Deviations from the spec:** wrong-variant (§7) fires only when every comparable kind disagrees,
not some, and a label alone never decides; a query pair counts only when the page shows a pair of
the same name, and an id only from a variant-style key (`variant`, `variant_id`, `variantId`,
`sku`) — tracking and affiliate keys are ignored (Task 1 ruling). The label rule (§5) keeps
`6' x 9' ≡ 6x9 ≡ 06x09` but narrows the exact-label keys to size/color/colour, option1–3,
`selectedOptions`/`options`/`additionalProperty` values, `variesBy` and known axis keys, plus the
sku's suffix; `name`/`title` match by containing every page label (≥3 characters), and a rule-2
contradiction ends the match before rule 3 runs (Task 2 ruling). Matching also excludes any key
containing price, availab, stock, inventory, quantity or offers, not just the two named in §5. The
ready check (§4) knows only the address half of a page variant, so a `[page]` path on a
picker-only site waits out the ready timeout — values right, slower. The row warning (§6) checks
each cell's own proving path for a fixed index in a structured path (xpath excluded), not whether
a `[page]` path exists elsewhere in the certified list. `toEntry` (§9) keeps a variant entry's ids
but not its `selectedOptions`, text values only. Outside the brief, the capture file now persists
`pageVariant`, which it did not before. Fragments (§12) are kept only when every `&`-part is
`key=value`; text fragments and hash routes are stripped. Final-review fix wave: a named value
agrees when its tokens are a subset of the shown value's (`6x9` in `6' x 9' $499`), the picker's
selected `value`/`data-value` count as alternate spellings for the wrong-variant check only, never
in the page variant `[page]` matches against (`?color=031`), a decimal stays one token (`?size=10`
is not `10.5`), page-data ids count only
when id-shaped; the row warning fires only for an index on a variant-list key (`offers`,
`hasVariant`, `variants`, …), never `@graph[n]`/`image[n]`; on a named or selected page an index
path whose `[page]` twin is certified is skipped, so a `[page]` miss is an empty cell, not another
variant's value.

**Known gaps / next:** `transfer-marks.test.ts`'s JSON-LD image-array case flaked more during
review on this branch (2 of 10 vs 11 of 11 before, the code path provably untouched) — still the
pre-existing environmental flake, an external `<img>` on `x.example`. A bare label still compares
against every axis key's value rather than only the axis it names (`width`/`height`/`length` of
`5` vs `?size=5`); twins beyond variant index 25 are not covered; the AI prompt names the page
variant only when the address names one (silent on picker-only pages); the nested-control filter
drops an outer control's own pickers (inherited from `buildVariantPickerScript`); a single-entry
`offers[0]` proving path on a `?variant=` proof page still shows the row warning — the app cannot
see the entries, so it cannot tell one entry from many. Next: fold
`?variant=` siblings under one product key and pick the row the address names in
one-row-per-variant mode — entries now keep their ids for it.

**Merged and proven so far (2026-10-14):** merged into `main` (fast-forward, 14 commits, `33424b9`) after six reviewed tasks, a whole-branch review (0 critical, 3 important) and a two-round fix wave (re-reviews clean). Route smoke on `main`: 25 of 25 after a dev-server restart (`902a53e`; the new test reads "verified 3/3 reads the first variant, not the one the address names on product 1"). Live check, free (`docs/testing/results/2026-10-14-variant-from-the-address-live-check.md`): the address warning appeared on exactly the predicted rows (Ruggable: Main image `hasVariant[0].image` and In stock; Glossier: Price `product.variants[0].prices[0].unit_price`); Skullcandy extracted 10 rows at $0 with sampled values matching the page, but its planned addresses carried no `?variant=`, so wrong-variant had nothing to test. **No `[page]` path has certified live yet:** Ruggable's Re-verify read "up to $0.05", Glossier's "up to $0.10", Kith's Verify "up to $0.40" and blocked ("Rating needs a value on at least two products") — none clicked without Marko. Skullcandy's proof page 2 (SLYR Pro) now returns 404.
**Part 2 (2026-10-15, Marko approved the clicks):** Ruggable Re-verify ("up to $0.05") cost $0.1152 and Glossier ("up to $0.10") $0.2451 — both failed, neither certified `[page]`. Diagnosis: Ruggable's page variant matched the right entry (the 6'x9' `hasVariant`, index 9, 374.25); the typed 499.00 is the struck-through list price, the page data holds the sale price — the customer types the sale price or marks it, then re-verifies. Defects surfaced: (1) the Verify estimate undercounts (≈2.4×); (2) a Re-verify re-checks only failed fields, so the address warning on a passed field has no action that clears it — the warning should offer "Re-verify this field" or mark the field for the next Verify.

## A website's default values (2026-10-13)

Spec `docs/superpowers/specs/2026-10-13-website-defaults-design.md`, plan
`docs/superpowers/plans/2026-10-13-website-defaults.md`. Branch `feat/website-defaults` from
`main`, seven tasks (subagent-driven). Tasks 1–6 each reviewed (one fix round each on Tasks 2, 3
and 5); whole-branch review 2026-10-13 (0 critical, 3 important — a one-page path certifying
under a default, the confidence denominator, the untested Verify-gate fix — plus two bundled
minors; one fix wave, re-review clean); merged into `main` the same day (fast-forward, 16
commits, `8008afa`). Route smoke on `main`: 23 of 24 on the first run (the failure was the test's
stale `keyOf`, fixed in `42df0e2`); the re-run, from Marko's own terminal after the memory
watchdog stopped mine, wrote every screenshot including the default-cell pair (`90ca60b`). The
live check: see "Live check" at the end of this section.

**What a customer gets**, in the spec's own words (§2): a website's binding gains a **default**
per field — a typed value, in the field's type, that a run writes into every cell its certified
paths leave empty. A default and the paths are not alternatives: where a path reads a value, the
path wins (a collab product whose page data says "Gymshark x Whitney Simmons" keeps it); where
every path misses, the default stands. This closes the workaround the credit campaign's worker
used on Gymshark — typing the site's tagline, "Gymshark | We Do Gym", as the Brand on three proof
pages so a Verify that kept failing on the literal "Gymshark" would pass (campaign 2, batch A).
Now the customer can just say it: **on this website, unless the page says otherwise, the Brand is
Gymshark.**

**The two rules at Verify** (§2/§4/§6): a cell left blank on a field with a default is a *default
cell* — the path may read the default there or read nothing, and both are correct, so the row
never asks "missing on product n" for it, and "Not on this product" is hidden on the field's
cells. A field whose proof pages are all default cells and whose candidates all fail certifies
**by default only**, free, with no path and no AI call — the row word reads "default only · no
path reads it on this website". A typed value that differs from the default anywhere still fails
that cell and keeps the field off default only, as today.

**The run page, the coverage check, drift, ops and the judge** (§7) all show a defaulted value as
such — a default is the customer's own guess about the website, and the product has to show them
where it was used. The run page's column head gets a third badge ("default on 60") beside "n not
shown", a defaulted cell carries a muted left rail titled "this website's default", and the
summary line gains "… · 60 values from the website's defaults" (the Sample panel states the same
fact; the unshown panel never flags a defaulted value — it was never read from the page in the
first place). The coverage check reads a defaulted field as empty on a sampled page, same as a
path miss, and does not sample a default-only field (it has no path). Drift reads the
default-filled share rather than the row's raw emptiness, so a path that stops hitting on a
defaulted field is not hidden by the default. Ops shows "Default: Gymshark" on a field's row, and
"no path — every product gets the default" in place of the path list on a default-only field,
current like any passed field. The judge judges a defaulted value like any other value — that is
how a wrong default would be found — and its report's `shown` column reads "default" for it, left
out of the confusion table.

**Files:** `packages/scraper/src/verify/defaults.ts` (new: `applyDefaults`, `renderDefault`),
`verify/certify.ts`, `verify/run-verification.ts`, `verify/verified-extraction.ts`,
`crawl/extract-item.ts`; on the api side `verify/binding-input.ts`,
`verify/current-certification.ts`, `crawl/extract-item.ts`, `crawl/drift.ts`,
`crawl/run-coverage-check.ts`, `crawl/coverage.ts`, `crawl/load-run-coverage.ts`,
`routers/sources.ts`, `routers/ops.ts`, `judge-run.ts`, `judge-run-report.ts`; on the app side
`components/verification/field-details.tsx`, `components/verification/verification-table.tsx`,
`lib/site/verification-model.ts`, `components/runs/results-table.tsx`, `lib/site/coverage-view.ts`,
`lib/site/run-screen-view.ts`; the route smoke `routes-smoke.test.ts` (its
`test-helpers/seed-unshown-run.ts` needed no change — `ValidationResult.defaulted` already
covered it, added with the field itself in Task 3).

**How it was proven, so far:** a per-task review on every task, with one fix round each on Tasks
2, 3 and 5; the whole-branch review (above) and the first route smoke run (23 of 24: the run
page's "default on 2" badge, both cell rails, the summary line, and the Verification tab's default
input, cell text, title and warning all passed; the seeded-run screenshot `app-site-run-defaults.png`
is committed, the two `app-site-verification-default-*` screenshots await the re-run). Per-package tests
throughout: scraper 1,026 passed, 5 skipped (one pre-existing flaky test, unrelated —
`transfer-marks.test.ts`'s JSON-LD image-array case, already a known gap), api 965 passed, app
842 passed, 25 skipped (the route smoke and the staff smoke, `RUN_UI_SMOKE` unset) — `tsc` clean
in all three. Task 7 (this entry) added two assertions to the route smoke, not yet run: the
Verification tab's default input, its cell text, title and warning, and the saved binding, in the
existing coverage walk; and a new test seeding a run whose `validationResult.defaulted` names
Brand, reading the column head's "default on 2", the cell rail, the summary line, and the absence
of the unshown panel. It needs `pnpm dev:all`, which serves `main`, not this branch — it runs
after the merge, same as the branch's live check.

**Deviations from the spec** (recorded on the spec's status line, repeated here): `Certification.defaults` normalises at fill time (`applyDefaults`/`renderDefault`), not at load; a default cell whose path read the default is not drawn differently from one whose path read nothing (the table draws no cell's `found` today); an unaccepted suggestion on products 1–3 no longer blocks Verify once the field has a default; an invalid default names its field at the Verify gate (`{Field} default: {error}`, added in review); `FieldCoverage.defaulted` is a required count, not optional; the Verify gate (`sources.verify`) now passes the absent marks (and the defaults) to `bindingProblems` — on `main` it passed neither, so a "Not on this product" cell on products 1–3 was refused as "Expected value is required". That is the likely fix for campaign defect 9 (next-work item 9), to be confirmed on the campaign website after the merge.

**Known gaps / next:** a path readable on one proof page only, with the other pages default cells, used to not certify and read "ambiguous" with a misleading hint on three proof pages — fixed 2026-10-17, see "Verify dead ends (2026-10-17)" §5 below: such a page now reads "Found on this product, but not in the same place as on the others. Mark it on the screenshot." A product whose every field is default-only reads 0% confidence (nothing for the paths to produce; "n/a" would read better) — still open. With a default, an unconfirmed page-data suggestion on products four to six used to still block Verify ("Brand has a suggestion to confirm on product 4"; Marko hit it on Gymshark 2026-10-14 — the deviation exempted products one to three only) — fixed 2026-10-17, see that section's §3: a suggestion there is a default cell too, same as on products one to three. **Live check (2026-10-13, `docs/testing/results/2026-10-13-website-defaults-live-check.md`, 10 screenshots, $0):** on the campaign's Gymshark website the default saved as `Gymshark`; typing `Gymshark` showed no warning and typing the tagline showed "not on any proof page"; the cleared Brand cells read `Gymshark` in muted text with the right title. It stopped at Re-verify, whose button read "Re-verify 1 field · up to $0.05" — never clicked under the no-dollar rule — so no run and no `default on` count was seen, and no website with no brand in its data was found for default only (Colourpop and Oliver Bonas both read a JSON-LD `brand.name`). Two findings: (1) Gymshark's JSON-LD `brand.name` IS the tagline, so its real defect is a wrong brand in the data, not a missing one; by the spec's rules a Re-verify would reject that path (it reads the tagline on every default cell, which is wrong there) and certify Brand by default only, free — the button's estimate is a worst case computed before Verify runs, so the expected cost is $0, but confirming that needs Marko's say-so on the click; (2) on reload, the cleared cells come back as page-data suggestions of the tagline, so a person must leave them unaccepted — the parked deviation (an unaccepted suggestion on products 1–3 does not block Verify) is what makes that possible. **Second half, 2026-10-14:** Marko rejected the page-data suggestion on product 4 (the gate gap below) and clicked Re-verify: all passed, Brand certified by **default only**, 0 AI calls, $0.0000 (`source_verifications` 07:22Z). Then an Extract of 10 products across 1 page (button read plain "Extract"): run `2a5f215d` completed, 10 rows, `cost_usd` 0.0000; the Brand column head reads **default on 10** with no "not shown" badge, the summary line reads "10 rows · 100% confidence · 10 values from the website's defaults", `validation_result->'defaulted' = ["brand"]` and `shown.brand = null` on all 10 rows, every row's Brand is `Gymshark`. The tagline never reached a row: the path that reads it contradicts the default on every default cell, so certification rejected it. (The checking script timed out before the plan phase ended and the run sat at `planned`; the run page's own "Extract 10 pending" resume control finished it — a script-timing slip, not a product defect.) Out of scope by design
(§11): computed values ("true unless an out-of-stock trigger is seen", "this element's presence
means No"); a project-level default every website inherits; a per-product override; a default on
a variant axis column; a default and "not on this product" on the same field; showing a default in
the export as anything but the value.

## Shown on the page (2026-10-12)

Spec `docs/superpowers/specs/2026-10-12-shown-on-the-page-design.md`, plan
`docs/superpowers/plans/2026-10-12-shown-on-the-page.md`. Branch `feat/shown-on-the-page` from
`main`, seven tasks (subagent-driven), merged fast-forward into `main` 2026-10-13.

**Part A — a run flags a value the page does not show.** The credit campaign's judge runs found
that a resolved certified value is not always a correct one: Allbirds' JSON-LD description the
page never showed, Decathlon's rating fallback writing `0` where there was no rating, Made In's
site name as a Title, Nike's other-colour title. A free, pure check (`shownOnPage`) now runs
inside every certified extraction, type-aware (`text`/`number`/`money` compared against the
capture's visible page text; `xpath` always counts as shown; `url`/`image`/`boolean`/`date` are
never checked), and is stored per field beside the row (`extractions.validation_result`, no
migration — the column already existed, unused). The run page's results sheet gets a per-field
"not shown" badge in the column head, a warning rail on the flagged cells (the value stays), a
"Values not shown on their page" panel naming the field, the count and the certified path, with
"Use as proof page" on sample products, and the summary line gains a suffix ("… · 12 values not
shown on their page"). The Sample panel shows the same count. Nothing is dropped, re-extracted or
re-certified automatically — the flag only informs.

**Part B — two rules at Verify**, added the same day after campaign 2 batch A found two patterns
Part A cannot reach (the wrong value is itself on the page, or was typed by a person): (B1) a
Title suggestion is never "agreed" unless its value is the proof page's main heading (the first
`h1`, or the largest heading box with none) — Colourpop had been storing the shade name ("Drift")
over the page's own heading ("Super Shock Shadow") on about a ninth of its catalogue because the
suggestion "agreed" on three palette proof pages where name and heading happened to coincide; a
suggestion that is on the page but not the heading now reads `needs-you`, reason "not the page's
heading on product n", and can still be accepted cell by cell. (B2) a typed expected value the
proof page does not show now warns ("not on this page") without blocking Verify — Gymshark's
worker had typed the site's tagline ("Gymshark | We Do Gym") as Brand on all three proof pages to
get past a Verify that kept failing on the literal "Gymshark"; the warning is the free, in-product
version of what the paid judge caught 60 times downstream.

**Files:** `packages/scraper/src/verify/shown-on-page.ts` (new), `verify/verified-extraction.ts`,
`crawl/extract-item.ts`, `crawl/load-run-coverage.ts`, `verify/merge-backfill.ts`, `judge-run.ts`,
`judge-run-report.ts`, `judge-local.ts`, `routers/sources.ts` (`suggestMarks` gains `headingText`
and `pageText`); on the app side `lib/site/shown.ts`, `lib/site/coverage-view.ts`,
`lib/site/run-screen-view.ts`, `lib/site/extract-view.ts`, `lib/site/verification-model.ts`,
`components/runs/unshown-panel.tsx`, `components/runs/results-table.tsx`,
`components/extract/extract-sample.tsx`, `components/verification/verification-table.tsx`; the
route smoke's `test-helpers/seed-unshown-run.ts`.

**How it was proven:** a per-task review on every task, plus a whole-branch review (on the most
capable model) that found 5 important issues, fixed in one wave, then a scoped re-review that
came back clean. Per-package tests throughout (scraper 1003, api 948, app 825 at the branch's
end, `tsc` clean in all three). The route smoke (`pnpm test:ui:app`) passed 23 of 23 on `main`
after the merge, including the seeded unshown run (the fill-table badge, the panel, the cell
rail, the summary suffix) and the fifth-product heading rule. Live-checked 2026-10-12/13 on the
credit campaign's real Gymshark and Colourpop websites:
`docs/testing/results/2026-10-12-shown-on-the-page-live-check.md` — a fresh 10-product Extract on
Gymshark showed exactly the expected `Brand 10 not shown` badge, panel row and summary suffix,
cost $0.0000; the Verification tab showed card 1's typed Brand tagline flagged "not on this
page"; Colourpop's Title row was already accepted (and its proof pages are palettes where name
and heading coincide), so B1 had nothing live to show — recorded honestly rather than forced.

**What NOT to redo:** never drop, re-extract or re-certify a value because the flag caught it —
the flag only informs; the Verify rules (B1/B2) shape what a row offers or warns, never block a
Verify or change what certifies; the judge keeps its own, stricter number matcher rather than
reusing the free check's looser one — a value the judge calls locally correct must never become
a false "shown" claim or vice versa.

**Known gaps / next:** M6 — "Accept all agreed" ignores the B1 heading rule (it accepts
everything agreed, heading or not; only the per-cell path respects it). M7 — the Sample panel's
own coverage query does not refresh in lockstep with its sibling queries. A value with a
boilerplate prefix the page also happens to carry still reads "shown" (the check cannot tell the
two apart). A stored `0` beside the field's own concept word on the page still counts as shown,
by design (spec §3), which is coarser than a human reading of context would be.

### Judge changes (2026-10-12)

Merged into `main` the same day, on branch `feat/judge-changes` (ahead of `feat/shown-on-the-page`,
which rebased onto it). The judge-run report now shows the captured page's own text beside each
value's screenshot tile, so a disagreement can be read without opening the capture separately.
The judge's **local** (free, no AI call) pass — previously only exact string equality — now also
passes a number when it matches with surrounding context (a unit, a decimal-mark variant) and a
long text value when it is a verbatim substring of the page text; it is never used for money,
which still always goes to the model. The report's per-value "how" (`local` vs the model) is
saved on the row, and the summary's per-field line now says how many of its values resolved
locally versus how many needed a call. The per-call cost estimate (`$0.0086/tile`) was not
re-measured against these changes; it is carried over from before.

## Known-gap fixes (2026-10-11)

Plan `docs/superpowers/plans/2026-10-11-known-gaps-fixes.md` (no spec: five gaps the two October
sections below recorded). Branch `fix/known-gaps`, eight commits, each task reviewed, a
whole-branch review with one fix wave, re-review clean.

**What changed, one line each:**

- `@robot/browser` `detectWall`: a page that would otherwise read blank (under 100 characters of
  visible text) whose only wall sign is a CAPTCHA iframe reads `challenge`; a `size=invisible`
  reCAPTCHA badge never counts; a page with content is never a wall because of an iframe.
- The drift check: a proof page the site would not let us read (refused, challenge, blank,
  timeout, unreachable, crashed, a backoff answer, or a capture row left `capturing`) is
  **not checked** — the row reads "Product n could not be checked — <sentence>" with no Replace
  button, the field is decided on the pages that were read, and a field with no readable page
  ends `not-checked` (the banner: "… could not be checked now — the website did not let us read
  its pages"; the ops notice says the same). `not-found`, `redirected` and a same-host
  "redirected to …" failure stay page gone. `outcomeOfFailedCapture` in
  `packages/api/src/verify/run-drift-check.ts` is the mapping.
- The coverage check's page loop re-reads its row each page and stops when the row is no longer
  `running` (superseded or stalled); a transient read error is logged and the loop goes on.
- The Verification table's Status column, and the variants row's, is sticky on the right, like
  the field-name column on the left.
- A proof-page capture carries the page's `<title>` (`ProofPageMeta.title`), and a card whose
  title is still its address (`shortUrl`) takes it (`titleFromCapture` in
  `lib/site/verification-model.ts`); a title the listing or a person gave is never overwritten;
  the effect never autosaves while a Verify locks the board.

**How it was proven:** per-package tests (browser 137, scraper 979, api 885, app 789), typecheck
clean; the route smoke passed 22 of 22 in 173 s before the merge.

**Follow-ups left open:** a failure with no verdict shows its raw stored error as the reason
("— stalled"); arrow-key focus can land under a sticky column (`scroll-padding-inline`);
`captureProblem` could carry a `redirected` verdict for a same-host path change instead of its
wording; the Verification tab's own capture rows and the drift line read the same stored error
text, so they stay consistent by construction only.

## Proof-page coverage and "not on this product" (2026-10-10)

**What changed.** The credit campaign (2026-10-08) found two websites that verified 8/8 with zero
model calls yet were wrong at scale: Lookfantastic's proof pages were all single-size products, so
the certified Price/In stock paths came back empty on 58% of the listing (multi-size pages publish
no top-level `offers`); Decathlon's certified Rating carried an api fallback
(`stats.averageRating`) that wrote `0` for the 5-of-40 rows with no rating, because the one proof
page with no rating had simply never been checked there. Two different gaps, one shape: a proof
page says nothing about shapes it never showed. Now, after every passing Verify, a free
fire-and-forget background check samples twenty products from the website's listing, runs the
certified paths on each (no model, no cache write), and the Verification tab shows the result per
field under its row — "Empty on 14 of 20 sampled products · all 14 list their sizes as variants in
the page data" — with "Use as proof page" to add that product as the website's next card (same
add-card flow the run page already offers). Separately, a cell can now be marked **"Not on this
product"**: that page joins the field's checked pages, and any certified path that produces a
value there — like Decathlon's `stats.averageRating` fallback — is unsafe and can never certify,
whatever it gets right elsewhere. The check only informs; it never blocks Extract, never runs
except right after a passing Verify, and never touches a proof page or the domain cache itself.

**Files.** `packages/db/src/schema.ts` (`coverageChecks`), `packages/db/drizzle/0017_coverage_checks.sql`;
`packages/scraper/src/verify/types.ts` (`VerificationSet.absent`, `FailReason` + `found_unexpected`),
`verify/certify.ts` (`checkedPages` with absent; the absent evaluation; the cover's two-page rule,
`provenOn` and `thinEvidence` count pages with a value only), `verify/shape.ts` (new — the page's
shape signature; a rating counts only with a value above zero); `packages/api/src/verify/coverage-sampler.ts` (new), `verify/run-coverage-check.ts`
(new, modelled on `run-drift-check.ts`), `verify/coverage-summary.ts` (new), `verify/binding-input.ts`
(absent rules), `verify/run-source-verification.ts` (starts the check on a pass), `routers/sources.ts`
(the `coverage` query; `absent` on the binding input), `test-helpers/seed-coverage-check.ts` (new, for
the smoke); `packages/app/src/lib/site/verification-model.ts` (absent cell state),
`lib/site/proof-coverage-view.ts` (new — the stage-line and row-line copy; distinct from the
run page's own, unrelated `coverage-view.ts`), `components/verification/verification-table.tsx`
(the row line), `cell-detail-bar.tsx` and the cell context menu (the "Not on this product"
action), the site route (`coverage` query, the stage line composed via `coverageStage` and handed
to the unchanged verify bar, the add-card flow reused),
and `routes-smoke.test.ts` (the fixture shop's second-shape product, the new coverage test).

**How it was proven.** Unit tests per package: the sampler's spread-and-exclude rule, the check's
own breaker/backoff/stall behaviour against a fake capture function, the summary's copy and
explanation-vocabulary thresholds, `certify.ts`'s absent-page evaluation (a candidate that resolves
to anything on an absent page is never certified), `bindingProblems`'s absent rules, and the app's
row-line/stage-line copy and cell-state transitions as pure functions — all free. The route smoke
(`pnpm test:ui:app`) gained a fourth, second-shape product (`/p/9`, a `ProductGroup` with
`hasVariant` and no top-level `offers`) in its fixture shop's listing, and a dedicated test that
seeds a passing verification and runs the real coverage job in the smoke's own process (never
clicking Verify, so the smoke spends nothing and depends on no live network): the Price row shows
"Empty on 1 of 1 sampled product · …", "Use as proof page" adds a 4th card, and a cell marked "Not
on this product" on it reads so and saves. The smoke never verifies after that. The final review's
fix wave added: three one-page XPaths plus an absent page do not certify (the KIVIK/GLOSTAD/
HEMLINGBY case); a path wrong elsewhere does not turn an absent cell red; a new Verify supersedes a
running check; a check that read nothing says "none could be read". Finally, a live check against the credit campaign's real,
already-set-up websites (`credit-campaign@example.com`'s org, project "Credit campaign 2026-10"),
api-server and app already running this branch:
`docs/testing/results/2026-10-10-proof-page-coverage-live-check.md`, screenshots in
`docs/testing/results/screens-2026-10-10-coverage/`. On Lookfantastic a fresh Verify's coverage
check came back within 3.8 minutes showing Price, In stock, SKU and Rating all empty on a
multi-size slice of the sample with the "variants in the page data" explanation; "Use as proof
page" → type the price → Verify certified Price 4/4 on one new path that reads both shapes. On
Decathlon, marking Rating "Not on this product" on the marketplace proof page and verifying was
watched catching the api fallback live — it resolved to `0` on that page and was rejected
(`found_unexpected`) — and a read-only SQL check confirmed `stats.averageRating` is no longer
anywhere in Rating's certified paths. **Both websites were left with their last Verify not
passing.** Decathlon's Rating has no certified path at all (`certified: []`): product 1 (Kiprun)
drifted live from 4.39 to 4.38, which made the JSON-LD path unsafe, and product 3 (Jogflow) then
read `ambiguous` as a knock-on; the red `found_unexpected` on the absent page was misleading there
(the api fallback was wrong on Kiprun too), which the fix wave corrected. Lookfantastic's Rating
failed on product 2 (Medik8), whose rating drifted too. Each needs the drifted value retyped and a
re-Verify before Extract has a current certification.

**What NOT to redo.** The coverage check only reads with the certified paths and writes its own
`coverage_checks` row — never a proof page, never a `captures` row, never the domain cache, never
path hit/miss stats, and it never gates Extract (Go to Extract stays available regardless of what
it finds). An absent cell is a *checked* page whose correct answer is nothing, never a blank —
don't let "absent" collapse back into "not checked" (B1's cover rule still requires an expected
value on at least two pages). Don't put the Verify click back into the route smoke's coverage test
— it seeds the verified baseline and runs the job directly on purpose, so the smoke stays free and
offline.

**Known gaps / next:** the explanation vocabulary is four shape features plus the address pattern
— a real gap the sampler doesn't recognise reads as a bare count with no explanation; the check
only ever runs right after a passing Verify, so an already-certified, unchanged website (both
campaign sites, going into this live check) has no coverage data until its next real Verify; a
card added from the coverage line keeps the sampled URL as its title (fixed 2026-10-11, Known-gap
fixes); the Status column is cut off at four products at 1440 px width (fixed 2026-10-11, sticky
Status column). On
Lookfantastic's 4th card only Title had a working inline accept; the other suggested fields had
none and were confirmed by typing each suggested value back from the detail bar (the live-check
doc's "Defects found" 3, pre-existing). Ruled and left by the final review: (1) the tab can miss
the new check right after a Verify — the verification's `completedAt` is written before the
coverage row is inserted, and the route's one refetch can land in that gap and stop polling until
a reload; (2) the ten-minute stall rule assumes a fast site — twenty slow pages plus slot and lock
waits can pass it, and the finished results are then discarded; (3) removing a field leaves its
`absent` marks, so re-adding a field with the same name brings them back; (4) the AI fallback is
not told about absent pages, so it can propose paths `certify` then rejects there (correct, but
spent for nothing); (5) the sampler compares addresses with their query string, so a proof page
stored with `?variation=…` and a bare listing link to the same product (or the reverse) are not
recognised as one page and the proof page can be sampled — the coverage line now says "already a proof page" when its representative is one of the cards. A superseded
check keeps reading pages to the end before its guarded final write lands nowhere.

## Honest page verdicts (2026-10-09)

**What changed.** A page capture now carries exactly one verdict — `ok`, `refused`, `challenge`,
`not-found`, `redirected` or `blank` — decided once, in `packages/browser`, from the response
status, a wall/challenge scan of the body and headers, and (last, only for a 200 that showed
nothing) a near-empty-body check; `capture()` itself only rejects when there is truly no
document (a crash, a timeout, an unreachable host). One `verdictSentence(verdict, url)` renders
the customer-facing sentence everywhere a capture is shown: the listing bar's result (`role="alert"`,
e.g. "scan.co.uk refused the browser (HTTP 403, Cloudflare). We can't read this website from here
yet."), a proof card ("otto.de sent an empty page. Try again."), a verification row's reason
("screenshot refused on product n" / "human check on product n"), the reachability line under a
brand-new website's empty Verification tab, a run's own message when its listing capture is what
failed (exactly the sentence, nothing in front of it; a capture with no document at all reads its
own sentence too, e.g. "{host} did not answer in time."), and a run item's error in the Pages table.
A walled product page in a certified run is a failed item with its sentence, never a done row of
empty cells, and it never counts as a miss on a certified path; a run whose every item failed
takes the first item's sentence as its message, and three walls in a row stop the run (every
pending item is failed "Not tried: {sentence}"). A `challenge` or `refused` verdict also puts
that host into backoff (2 minutes, doubling to a cap of 8, cleared by the next `ok`). Background
work (a run's items) waits the backoff out; interactive paths — Find products, a run's planning, a
proof-page capture, the reachability line — answer from it at once, without a browser: the wall's
own sentence plus "Waiting n min before trying again." Separately,
the Verification table's agreement rule no longer treats a structured value with **zero** pointable
boxes on the page as "one place" — it needs a person ("only in the page data on product n"),
closing the hole that let Allbirds' JSON-LD description (shown on only one of three product pages)
and similar cases through "Accept all agreed".

**Files.** `packages/browser/src/types.ts`, `playwright-browser.ts`, `page-health.ts`, `verdict.ts`,
new `verdict-copy.ts` and `root-domain.ts`; `packages/scraper/src/verify/capture-check.ts`, `domain-lock.ts` (backoff),
`crawl/plan-run.ts`, `verify/verified-extraction.ts` (a walled product page throws), `analysis-orchestrator.ts`, `extraction-orchestrator.ts`, `pipeline.ts`;
`packages/api/src/routers/sources.ts` (`checkListingPage`, new `reachability`),
`verify/find-product-pages.ts`, `verify/proof-page-capture.ts`, `crawl/plan-source.ts`,
`crawl/roll-up-run.ts`, `crawl/execute-guard.ts` and `routers/crawl.ts` (`execute` refuses a failed
run), `crawl/execute-run.ts` (the wall breaker), `crawl/start-execution.ts`, `crawl/record-outcome.ts`, `judge-run.ts`;
`packages/app/src/components/verification/listing-bar.tsx`, `product-card.tsx`,
`lib/site/use-proof-captures.ts`, `lib/site/verification-model.ts` (the agreement-rule fix, B1),
`lib/site/extract-view.ts`, the site route and `routes/…/runs/$run.tsx` (reachability line, run
message). Specs amended: `2026-09-28-table-first-and-drift-repair-design.md` §A2 (drops "or page
data with no box"); `2026-09-29-certification-picks-the-right-path-design.md` §A5 (names the
zero-box case). Design: `docs/superpowers/specs/2026-10-09-honest-page-verdicts-design.md`.

**How it was proven.** Unit tests per package (the verdict classifier and its copy in
`@robot/browser`; backoff in `domain-lock.test.ts`; the consumers in `@robot/scraper` and
`@robot/api`; `verification-model.test.ts`'s B1 cases, e.g.
`{ kind: 'needs-you', reason: 'only in the page data on product 2' }`). The route smoke
(`pnpm test:ui:app`) carries a dedicated wall test, run last on purpose (a wall puts its host on
backoff): a 403 Cloudflare page on the Verification tab reads the refused sentence as `role="alert"`
within its poll window, never "No product links found"; Find products on another page of the same
host then answers from the backoff in that wall's words plus "Waiting 2 min before trying again."
(a 200 CAPTCHA page reading `challenge` is pinned by `@robot/browser`'s real-browser
`capture-verdict.test.ts`). A free live check against the credit
campaign's real, already-set-up websites (`credit-campaign@example.com`'s org, project "Credit
campaign 2026-10"), api-server and app already running this branch:
`docs/testing/results/2026-10-09-honest-verdicts-live-check.md`,
screenshots in `docs/testing/results/screens-2026-10-09-verdicts/`. scan.co.uk and hobbycraft.co.uk
both read their refused sentence (HTTP 403, Cloudflare) within ~0.6 s, no count. otto.de's listing
itself is not walled (only its product pages are, HTTP 400 blank) — a never-before-captured product
page added live read "otto.de sent an empty page. Try again." (the `blank` verdict); after the fix
wave HTTP 400, like every 4xx but 404/410, reads `refused`. Article's Extract (fully certified,
$0.00) completed "Done", 3 of 3 extracted, with every field empty on all 3 rows, and the 3 pages it
picked were independently confirmed walled (HTTP 405, AWS WAF) minutes later — the live finding the
fix wave closed (C1 below); see the live-check doc's "Defects found".

**What NOT to redo.** Don't add a per-consumer health check again — every consumer reads
`capture.verdict`, decided once in `@robot/browser`. Don't put "or page data with no box" back
into the agreement rule (table-first-and-drift-repair design §A2) — a value is only "agreed" when
some element on *that* product's page points to it.

**Fixed by the fix wave after the final review (2026-10-09).** C1: a walled product page in a
certified run became a done row of empty cells (Article) — now a failed item with its sentence,
and a failed run reads its first item's sentence. C2: a walled run slept up to 8 minutes per
remaining item — now three walls in a row stop it. I1: thin legitimate pages read as walls (a
Cloudflare header or a cdnjs script, a reCAPTCHA review form, a thin Cloudflare 404) — a wall is now
what the page's title or visible text says (or a vendor's challenge-only markup), a vendor alone
only names it, and 404/410 come first. I2: the verdict read `page.goto`'s first response, so a
Cloudflare JS challenge that reloaded to the real page read `refused` — now the last main-frame
document response. Also: sentences are the same on the run page, proof card and Pages table (I3);
interactive paths answer from the backoff instead of sleeping in a request (I4); `redirected`
only for another registrable domain (I5); every 4xx but 404/410 is `refused` (I6). Report:
`.superpowers/sdd/2026-10-09-honest-page-verdicts/fix-wave-report.md`.

**Known gaps, for the next work list above.** (1) A page with under 100 characters of visible text
(scripts and styles not counted) is classified `blank`, so a tiny-but-legitimate page would read
as blank too (2026-10-11: a thin page whose only sign is a CAPTCHA iframe now reads `challenge`). (2) Not built from spec §A3: the proof card's "waiting for {host}…" line and a
run-log line per backoff wait (interactive paths answer from the backoff instead; a run's wait is
only in the api-server's console). (3) A Stop pressed during a run's backoff sleep lands only when
the sleep ends (up to 8 minutes; the wall breaker makes long sleeps rare).

## Credit campaign and two listing fixes (2026-10-08)

**The campaign.** $100 of API credit, expiring ~2026-10-16, is being spent on many real websites through Verify and Extract, in the dedicated org "Credit campaign 2026-10" (Marko is an owner of it): plan, rules, site list and the tracking table in `docs/testing/2026-10-08-credit-campaign.md`; one note per site under `docs/testing/results/campaign-2026-10/`. First batch (Ikea, Allbirds, Nike, Barnes & Noble, Everlane, Otto): every reachable site verified with **zero model calls** (JSON-LD/APIs cover the brands), extraction at scale runs end to end at 10–15 s per item, and the biggest finding is B&N's: certified *positional* JSON-LD paths fill every cell with another format's price/ISBN at "100% confidence" — hit rate is not correctness. So the campaign judges extracted rows with the LLM judge (`judge-run`, see Commands) and biases the fresh list toward sites without structured data.

**Two fixes it forced, both merged 2026-10-08.** (1) `packages/scraper/src/crawl/product-link-group.ts` (shared by "Find products" and the listing walk; `find-product-pages.ts` re-exports it): links inside page-level navigation (`nav`, `aside`, roles navigation/banner/contentinfo/complementary, page-level `header`/`footer`) are left out before grouping, with a fallback to all links when fewer than 3 remain — Everlane's finder went from 93 menu links to its 52 products. (2) After page 1 the listing walk compares its row selector's rows with the page's product-link group and plans from the group when the selector missed links and the group is confirmed (by an extracted row's URL shape, or on a *direct* listing by a proof page's) — Allbirds' Sample went from 1 link to 40 of 40 without AI; search/template inputs with zero rows still plan nothing.

**Where it ended (2026-10-08 evening).** 16 websites in one day: 9 verified 8/8 with zero model calls, 8 extracted at scale (10–23 s per item, $0 AI), 6 walled by anti-bot (plus 26 of 28 pre-screened candidates), 1 CAPTCHA-rate-limited. Eight judge runs on seven sites (~$30 of the $100; ~$66 left): where the judge could see the value, Title, Price, Brand, Description and In stock were right everywhere except B&N's multi-format pages and one "Coming Soon" stock status; the judge's own limits (star glyphs, "appears anywhere", field-name vocabulary) are recorded. The campaign doc's last section ("What the campaign answered") holds the grouped findings and the suggested order of the next work: report refused pages as refused (**done**, 2026-10-09 — see "Honest page verdicts" above); proof pages that cover variations (**done**, 2026-10-10 — see "Proof-page coverage and 'not on this product'" below; live-checked again against the same Lookfantastic and Decathlon cases); the "agreed" rule must not agree on values the page does not show for that product (**done**, same plan); per-process run cost; the judge changes. A memory-pressure kill on the dev machine (three Chromiums + dev servers) ended two judge runs mid-way; they were re-run one at a time.

**Follow-ups, not done:** the 1-row selector the AI wrote is still cached as verified and pages 2+ reuse it; with an AI key the Sample still pays for a new selector before the free check runs (run the check before the AI fallback; mark a rescued page's selector degraded). A run's `cost_usd` is the delta of a process-wide usage counter, so parallel paid work is mis-attributed (Nike's run and a concurrent B&N Sample both recorded $0.1611) — the Usage page's org total is right, per-run figures are not. A blank, refused capture (otto.de answers 400 to headless Chromium) used to still read `ready`; fixed by "Honest page verdicts" (2026-10-09) for any capture taken from that point on — the three product-page captures otto.de already had from this campaign predate the fix and still read `ready` until they are retaken. Positional JSON-LD paths (B&N) are the next design question, together with the "backups from one source" item at the top of this file.

## Verification table, spreadsheet behaviour (2026-10-08)

**What it is.** The Verification table reads like a spreadsheet and fixes explicitly (spec `docs/superpowers/specs/2026-10-07-verification-table-spreadsheet-design.md`, plan `docs/superpowers/plans/2026-10-07-verification-table-spreadsheet.md`). A cell click selects the cell and nothing else; the selection is route state, while `?product`/`?field` keep meaning "the screenshot panel is open". A detail bar above the table shows the selected cell's field, product, state word ("nothing found" / "suggested" / "accepted" / "fails on this product"), the full value in mono (wrapping, scrolling past six lines), Copy (reads "Copied" for 1.5 s), Fix (or Mark on an empty cell), Type it, and — while the panel is closed — a 240×160 read-only crop of the product's screenshot around the field's element; clicking the crop is Fix. Each cell has a Fix/Mark button on hover and when selected, always on a red cell; a right-click menu offers Copy value, Open product page, Fix on screenshot, Type it. Keyboard on a focused cell: arrows and Home/End move the selection (clamped, never wrapping; modified keys are left to the browser), Ctrl/⌘+C copies the cell, Enter or F fixes, Escape closes the panel if open, else clears the selection; only the selected cell's Fix/Mark and Accept buttons are tab stops. After a Verify, a row's status shows "n/m" (proof pages the field held on, over the proof pages it was checked on — those with a result for it) after its badge. The column head still opens the screenshot (a new website has nothing to select yet). "Type it" and the expanded row's hint follow the selected cell's product. Certification, autosave, Verify, the engine and the API are untouched; nothing spends.

**Files.** `components/verification/verification-table.tsx` (selection, Fix button, context menu, roving tabindex and keys, count), new `cell-detail-bar.tsx`, `screenshot-crop.tsx`, `components/ui/context-menu.tsx` (Radix, shadcn style), `field-details.tsx` (`focusTyped`), `lib/site/table-selection.ts` and `screenshot-crop-view.ts` (pure, tested), and the site route (`routes/_app/projects/$project/sites/$site/index.tsx`: selection state, `fixCell`, `copyCell`, `typeIt`, `elementFor`, the bar).

**How it was proven.** 20 unit tests on the two pure modules (selection moves and clamps, header count, crop geometry at every edge). The route smoke (`pnpm test:ui:app`, 20 of 20 green on 2026-10-08, 187 s) now clicks a cell and asserts no screenshot opens and the address stays clean, moves with arrows/Home/End, copies with Ctrl+C and from the menu, opens the screenshot with Enter and with the cell's Mark button, checks the menu's four items, Type it's focus, that the details follow the selected cell when another product's head is clicked, and the two-step Escape. Rendered check in real Chromium with a throwaway user: `docs/testing/results/2026-10-07-spreadsheet-rendered-check.md` and `screens-2026-10-07-spreadsheet/`. Screenshots `docs/testing/screens/app-site-verification-selected-{dark,light}.png`.

**Found and fixed on the way.** Radix's context menu returns focus to its trigger when it closes, which undid "Type it"'s focus; the cell menu skips that return only for Type it and the Type input focuses on the next frame. The smoke's `/settings` members-row count had been stale since staff access added the "Robot staff activity" table (its empty state is one row); it is scoped to the members table now. The final review found: Ctrl/⌘+C deferred to native copy whenever the page held a text selection, and Chromium keeps a selection made earlier (say, in the detail bar) when a cell is clicked, so the stale fragment was copied instead of the cell — Ctrl/⌘+C on a cell now always copies the cell; each cell's Fix/Mark button and Accept tick were ordinary tab stops, so Tab walked through every one — they are tab stops only on the selected cell now; the header count's denominator counted every card with a URL, including cards with no result for the field — it counts only proof pages the field was checked on. Also: the bar's Copy says "Copied" only once the clipboard accepted the value; a page-data suggestion's accept moves `?field` only when the open screenshot is the selected cell's product; a card with no URL shows no crop instead of "Taking screenshot…" for ever.

**What NOT to redo.** Don't put the selection back in the URL — `?product`/`?field` mean the screenshot is open; a selected cell is route state on purpose (spec §1, decision 1). Don't make a cell click open the screenshot again, and don't make double-click edit anything.

**The rendered check found two things.** The table moved ~99 px when the selection was cleared, because the crop left the bar (spec said the bar's height is stable) — the bar reserves the crop's height on screens 640 px and wider, so the table never moves (the route smoke now measures the table's top with a cell selected and after Escape clears it, and asserts they match). And text inside a cell cannot be drag-selected: cells are `<button>`s, which Chromium never lets you select text in; the detail bar's value is ordinary text and is the place to drag-select and copy a fragment. Accepted as is, not a defect.

**Left for later** (all small, none blocking): the count's `aria-label` sits on a plain span; Tab reaches the first cell but arrows do nothing until it is selected by click or Space.

## Staff access (2026-10-07)

Spec: `docs/superpowers/specs/2026-10-07-staff-access-design.md`. Plan:
`docs/superpowers/plans/2026-10-07-staff-access.md` (seven tasks, all done).

**What shipped.** On an ops website page, **Work on this website** asks "Work on {website} as
staff?" and, on **Start working**, `ops.enterOrg` moves the operator's own session into the
customer's org (`sessions.staff_org_id` / `staff_entered_at`) — no membership is ever
created, and the role inside is `member`. The app shows "Working as Robot staff in {customer}"
above the top bar with **Back to ops** (`ops.leaveOrg`); the org switcher is replaced by the
customer's name. A staff session counts only while the email is still in `OPS_EMAILS` (checked
on every request) and for at most 8 hours; after that the next request is served in the
operator's own org and the app says "Your staff session in {customer} ended after 8 hours."
Expiry is noticed on the next navigation or the next refused change ("Your staff session
ended"), and either way the app reloads into ops, toasts and leaves. The deny-list (`packages/api/src/auth/staff-guard.ts`: org rename/delete/create, member role and
removal, `auth.switchOrg`, project/website delete, field and variant-column delete) answers
FORBIDDEN "Not available while working as staff", and the app disables those controls with
the same sentence beside them. Every successful staff-mode mutation, plus enter, leave,
sign-out and expiry, writes one plain-English row to the append-only `staff_actions` table;
queries are never logged. The customer reads it in Settings ("Robot staff activity", 20 per
page); staff read it in ops ("Staff activity", 50 per page, filterable, and the latest 10 on
each ops website page). `ops.enterOrg` and `ops.leaveOrg` are the only `ops.*` mutations.

**Rulings made while planning (Marko can overturn).**
- **R1 — Verification autosave is coalesced.** `sources.updateBinding` logs "Edited the
  Verification answers on {website}" at most once per staff member per website per 10
  minutes. Verify itself is always logged.
- **R2 — No "Accepted a new location" entry.** A field-scoped re-verify logs "Re-verified
  {field} on {website}"; a full verify logs "Verified {website}".
- **R3 — A failed log write does not fail the mutation.** The change has already happened;
  the error is `console.error`ed with the path and org.
- **R4 — CORS origin is configurable.** `APP_ORIGINS` (comma-separated, default
  `http://localhost:3000`), so an isolated :3100 → :4100 pair runs beside the dev servers.
- **R5 — Expired-session mutations are refused** (final review; departs from spec §2.1 for
  mutations only). Past the 8 hours every mutation but `ops.leaveOrg`/`ops.enterOrg`,
  `auth.signOut`, `auth.setTheme` and `auth.updateName` gets FORBIDDEN "Your staff session
  ended", so a customer page left open never changes the operator's own org. Queries are still
  served in the operator's own org, as the spec says.

**Proof.** `pnpm test:ui:staff` runs the whole flow in a real browser against an isolated
pair — never :4000/:3000 — with a throwaway operator and customer (both deleted afterwards):
enter, banner, rename on the website's Settings tab, Delete website disabled with its reason,
Back to ops, then the customer's Settings listing "Started working as staff", "Renamed website
Smoke shop to Smoke shop EU" and "Stopped working as staff". Screenshots:
`docs/testing/screens/staff-*.png`. Start the pair as the top of
`packages/app/src/staff-smoke.test.ts` says.

**To use it yourself:** add your address to `OPS_EMAILS` in `.env` (e.g.
`OPS_EMAILS=markodjordjievski@gmail.com`) and restart your api-server — it reads `.env` once
at startup. Then sign in, open a website in ops and choose Work on this website.

## Cut-over (plan 6, 2026-10-07)

Plan: `docs/superpowers/plans/2026-10-06-cut-over.md`. Five tasks: project rename (Task 1),
operators by email allowlist (Task 2), the ops overview (Task 3), the ops website page
(Task 4), and this one — deleting `@robot/dashboard` and everything that existed only for it
(Task 5). All five are done; this section is the "what changed" summary the plan asked for.

**Operators.** `OPS_EMAILS` in `.env` is a comma-separated allowlist, matched
case-insensitively and trimmed; empty or unset means nobody is an operator. To make yourself
one: add your email to `OPS_EMAILS`, restart `pnpm dev:all` (the api-server reads it once at
startup, via `@robot/db`'s `.env` load — it is not re-read per request), then sign in normally.
An operator lands on `/ops` instead of `/projects` after sign-in (and `/` redirects there too);
the sidebar becomes the ops shell ("Robot ops" / "Staff", one nav item, "All websites"); a
non-operator who hits `/ops*` is redirected to `/projects`. Every `ops.*` procedure (`ops.me`
excepted) throws FORBIDDEN for a signed-in non-operator and UNAUTHORIZED signed-out. Ops is
read-only — no mutation exists in `ops.*` — and an operator's own org memberships never filter
what `/ops` shows: it lists every org's customer-schema websites, theirs included.

**The ops pages.** `/ops` is one row per website across every org — customer, project,
website, "Verified: {c} of {n} fields" (or "Not verified"), the drift count ("Stopped
extracting") or "—", the last run's status and relative time (or "No runs"), and spend this
month from the same source `usage.byProject` uses — ordered drift first, then a failed last
run, then not verified, then by recent activity. Its row links to `/ops/websites/{sourceId}`:
header (customer, project, website, host, and an "Open in the app" link, disabled with a title
when the operator isn't a member of that org), one section per contract field named in the
customer's own words, each field's certified paths in try order (kind, the path itself, which
proof pages it's proven on, and "{hits} of {uses} ({pct} %)" from real run stats — "Not needed
yet" rather than "0 %" for a path with no uses), a one-source warning when every path for a
field reads the same API response or JSON-LD block, and the latest drift check. No "cache"
anywhere on these pages — the store is called "approved paths".

**Deleted with `@robot/dashboard`:** the whole package (95 files); the dashboard-only
procedures `domains.*` (the whole router), `datasets.listByProject` / `getBySlug` /
`getContract` / `updateSchema`, `projects.getBySlug` / `getWithStats`, and
`sources.listByProject` / `findProductPages`; the already-dead `scraper.analyze` / `extract` /
`setRowSelector` (the whole router, now empty) — `pnpm --filter @robot/api dogfood` was the one
real caller the scraper procedures had left, and now drives `@robot/scraper`'s
`runAnalysis`/`runExtraction` directly instead of going through the deleted router; root
`package.json`'s `dev` alias and `test:ui`; the `:3456` CORS origin; and the two stale
`docs/testing/ui-check-schema-*.mts` scripts. `projects.rename` stayed — the app's project
Settings page (Task 1) calls it.

**The shim is gone (final review C1, fix wave A).** Every customer procedure — `projects.*`,
`sources.*`, `datasets.*` (except the static `catalogue`), `crawl.*`, `runs.*` — is a
`protectedProcedure`: no session is UNAUTHORIZED, and the org is always the session's.
`resolveOrg(ctx)` reads the session only and takes no `orgSlug`; no input names an org any more
(`orgSlug` left `projects.list/get/output/create/rename/delete` and `sources.get`), and every
`'default'` fallback and `DEFAULT_ORG_SLUG` in `@robot/api` is gone. `auth/scope.ts`'s
`sourceInOrg`/`runInOrg`/`captureInOrg` are UNAUTHORIZED without a session instead of passing
the caller through. The five dead, unguarded procedures (`projects.listByOrg`,
`sources.listByDataset`, `sources.getBySlug`, `sources.create`, `datasets.create`) are deleted.
`auth.signIn` and `ops.me` stay public. The `crawl-plan`/`crawl-execute` CLIs call the crawl
functions directly against the database instead of a session-less router caller. Tests sign in as
a throwaway identity (`signIn`/`signedInCaller` in `test-helpers/identity.ts`) and delete its
org afterwards; none creates or reads data in the seeded `default` org. `pnpm db:adopt-default`
(making a real account the owner of `default`) is untouched and still the way an existing
checkout's seeded projects become visible after a first sign-in.

**Dropped, not built:** the field-origin/candidate editor (Marko, 2026-10-06 — the "open
decision for cut-over" below is now decided: it doesn't come back); ops actions (re-verify,
re-run, impersonate — ops stays read-only); the project domain pages and the old domain-cache
screens (`/projects/$project/domains`, `/domains/$domain` and the `/ops/domains` screens the
dashboard had — replaced by the ops overview and website page, Tasks 2–4). The certification
change behind the one-source warning (at most one or two paths per source) and the unauthenticated
project/run export routes (noted below, still open) are unchanged by this plan — each needs its
own design.

## Drift repair, Part B (2026-10-05)

Spec: `docs/superpowers/specs/2026-09-28-table-first-and-drift-repair-design.md`, Part B (B1–B5)
and decision D3 ("the repair check runs automatically when a run flags drift"); Part A is
Table-first verification, below. Plan: `docs/superpowers/plans/2026-10-05-drift-repair.md`.
Branch `feat/drift-repair`, base `9f3fc79`. A Source with a verified schema already
flags drift at run time (`flagDrift`, existing, unchanged); what this plan adds is the free check
that says *what happened* to a flagged field, and the way to repair it.

**What landed** (`git log --oneline 9f3fc79..HEAD`; `8472d52`, a `run_items.variant_of` db test missed in variants plan 3, is on the branch too but is not part of this plan):

| Commit | What |
|---|---|
| `887fbc6`, `836190f` | `drift_checks` (migration 0015) and `classifyDrift` (`packages/scraper/src/verify/drift-classify.ts`): `other-layout` → `moved` → `changed` → `lost`, in that order, reusing certification's own `gatherCandidates`/`certify`/`resolveStructured` — never the AI fallback (Task 1) |
| `130789c`, `cba4fa0`, `ff0c03e` | `runDriftCheck`/`startDriftCheck` (`packages/api/src/verify/run-drift-check.ts`) and `sources.checkDrift`/`driftCheck`: the same stall rule Verify uses, a real default capture function, a drifted text field never reads a schema.org URL as its "changed" value from the concept search, and the check's proof-page captures share the Verification tab's own three-browser limiter rather than adding three more (Task 2) |
| `c0cf190` | the website's badge ("n fields stopped extracting") and the Verification tab's banner ("{Fields} stopped extracting in the run of {date} ({pct} % of products empty)") — `packages/app/src/lib/site/drift-view.ts`'s `driftBadge`/`driftBanner`, `drift-banner.tsx` — exact wording and dates from the Global Constraints (Task 3) |
| `32212bf` | the drift row's own line and action under a drifted field — "Moved on the page — Accept new location", "Page now shows X (was Y) — Accept new values", "Not found on the page — Mark it again", "Product n no longer loads — Replace product n" — `acceptMoved`/`acceptChanged` in `drift-view.ts`, wired into `verification-table.tsx`'s `DriftLines` and the Verification route; accepting touches only that field's cells (another field's pending edit survives) and still needs a Verify — nothing is auto-accepted (Task 4) |
| `288b8cb`, `7519b23` | end to end on a local site whose layout changes, the app smoke, these docs (Task 5) |
| `bb97f09`, `e99c13b`, `f8cd6a9`, `186fc7a` and this docs commit | the final review's fix wave: a page-gone proof page no longer blocks `moved` (the moved search runs on the captured pages only), `changed` needs a value that differs somewhere and marks each page `changed` with the expected value it was compared against (`was`), a money key named for cents reads through `cents_to_units`; `sources.driftCheck` closes a `running` check older than 10 minutes as `failed`/`stalled` on read; the check reads its captures back by id; a `changed` row lists and accepts only the products that changed and keeps the stored "was"; a `moved` row with no marks offers no "Accept new location"; the banner is `role="status"` and "Replace product n" is labelled with its field. M7 (rows from an older drift episode) is deferred |

**Proven free, with no AI call:**

- **End to end** (`packages/api/src/verify/drift-end-to-end.test.ts`): real Chromium against
  `packages/api/src/test-helpers/drift-site.ts`'s own `127.0.0.1` server — three product pages,
  layout A (price in the JSON-LD and in a `.price` element) switched live to layout B (no JSON-LD
  price; price in `.amount`). A customer-schema source is seeded with a clean, current
  certification directly (the `hashOf` pattern `sources-verify.test.ts` and
  `require-certification-variants.test.ts` use — `runVerification` is never called, so nothing
  here can reach a model even with a key in `.env`) and `driftedFields: ['price', 'title']`.
  A first check under layout A finds both fields `other-layout`; after the switch to layout B a
  second check, with its real default capture function, finds price `moved` to an XPath under
  `.amount` (with a mark on every page) and title `other-layout` (its own JSON-LD path is
  untouched by the layout change). Neither touches the `sources` row or `source_verifications` —
  only their own `drift_checks` rows and the proof-page `captures` they took (three each).
- **The live smoke** (`packages/app/src/routes-smoke.test.ts`, `pnpm test:ui:app`, 18 tests,
  green in both themes): a real drift check needs a browser and a real Verify is off-limits on
  this server, so this case seeds its state directly — `packages/api/src/test-helpers/seed-drift-check.ts`
  writes one finished, `moved` drift check for Price plus the "verified" baseline it is about,
  on the smoke's own throwaway website, after every screenshot of it was already taken (so this
  case never changes what the earlier theme walks photographed). It asserts the project home's
  "1 field stopped extracting", the Verification tab's "Price stopped extracting" banner, and
  that clicking "Accept new location" keeps the value, attaches the new mark, autosaves, and the
  row's badge flips from "verified" to "changed since verified" — a Verify is never clicked.

**Gate:** after the fix wave, the full suites are green under `--maxWorkers=2`: `@robot/scraper`
921, `@robot/api` 729, `@robot/app` 682, `@robot/db` 21. (Before it, two `sources-marks.test.ts`
tests had timed out under contention with the real-browser end-to-end test; they passed in
isolation and did not recur in the fix wave's run.) `tsc` is clean in `@robot/api`, `@robot/app`,
`@robot/scraper` and `@robot/db`.

**How to check it:** `pnpm --filter @robot/api exec vitest run src/verify/drift-end-to-end.test.ts`
(free, no servers needed) and, with `pnpm dev:all` running, `RUN_UI_SMOKE=1 pnpm --filter @robot/app exec vitest run src/routes-smoke.test.ts` (free, live).

**Not in this plan:** drift for variant entry paths and links collectors (fields only); email
alerts and auto-accepting a repair (spec C); Jev (parked); coverage repair of variant rows other
than the first (deferred from variants plan 3).

**Next:** merge `feat/drift-repair`; decide whether spec C (alerts / auto-accept) is worth
building, or whether the next work is elsewhere (variants plan 3's live controller check is still
outstanding, below).

## Variants plan 3 (2026-10-02)

Plan: `docs/superpowers/plans/2026-10-02-variants-plan3-extraction-export-reporting.md`. Branch
`feat/variants-extraction`, on `main` at `05f18d8` (the plan commit); `git log --oneline main..HEAD`
is the record. Seven tasks; this entry covers all of them. Plan 1 set up a website's variants,
plan 2 verified them, plan 2b fixed what the live check found — this is the plan that finally
extracts, exports and reports them.

**What landed:**

- **DB + scraper (Task 1, `0632b1e`, `d342036`).** `run_items.variant_of` and `runs.variant_summary`
  (jsonb). `buildVariantRows`/`variantKeyOf`/`groupKeyOf` (`packages/scraper/src/verify/variant-rows.ts`):
  a certified product row turns into one row per variant, keyed by SKU, else GTIN, else (links
  method) the variant's own URL, else its axis values joined " · "; a variant row starts from the
  full product row so provenance keys (`_url`, etc.) survive.
- **Scraper + API plumbing (Task 2, `639bc91`).** `verified-extraction.ts` returns the capture;
  `extract-item.ts`/`start-execution.ts` read the run's `VariantRunPlan` (`loadVariantRunPlan`) at
  start; `variant-collector.ts`'s `buildXPathLinksScript` reads link hrefs with their labels.
- **List method (Task 3, `9a42634`).** A list-method product's one page load becomes one
  extraction holding every variant's row, cross-validated like any other field.
- **Links method + budget (Task 4, `177fb45`, `fad3c60`, `36a71fa`).** A links-method product
  queues its variant pages as one group (`queueVariantGroup`) within the run's budget; a group that
  would not fit is not queued at all (never half-queued), and the skip is tallied once per product
  (`skippedByProduct` on `runs.variant_summary`, merged — never reset — across finalises).
  `finaliseRun` computes `variants`/`products`/`withoutVariants`/`partial` in one SQL aggregate over
  `jsonb_array_elements`, never by pulling a run's rows into Node; a parity test runs the same
  aggregate against `@robot/scraper`'s `summariseVariantRows` over the same seeded rows so the two
  can never silently drift apart.
- **Backfill and drift (Task 5, `96532fc`, `df9868f`).** A repair fills each variant row by its own
  `_variant_key`, never row 0's value copied onto every row; a repeated repair always re-reads the
  key fields and never appends a second copy of a row it already has.
- **Export (Task 6, `40b963d`, `bbd4c0a`, `f65f0df`, `5c63855`).** A run's CSV/JSON/XLSX export
  (`build-run-export.ts`'s `shapeRows`) picks `flat` / `row_per_variant` / `nested` by whether the
  run produced variant rows and the project's `variantMode`; `row_per_variant` adds the axis columns
  and `product_key`/`variant_key`; `nested` is lossy in CSV/XLSX ("; "-joined per product) but keeps
  the true per-variant `variants: []` array in JSON, including an empty array for a product with no
  variants (never dropped). Column-name collisions never lose data — a later name gets " (2)", " (3)"
  — and the project's whole-export route now serves `.xlsx` too, with its own types map (the fix
  round that made a numeric cell an actual number, not a string, in the sheet).
- **Run page, wording, smoke, this entry (Task 7).** `run-screen-view.ts`'s `variantCountLines`: the
  four count lines under the run facts, in the plan's exact wording, the skipped line only above
  zero, empty for a non-variants run. `runs.getWithDetails` also returns `variantSummary`, the
  project's `variantMode` and its mapped, deduped axis columns. The results sheet adds the axis
  columns and a Variant key column after the product fields, only for a run whose own rows carry
  `_product_key` — not merely a project with variants turned on. A Download Excel link sits beside
  CSV and JSON (`exportUrl` takes `'xlsx'`). Two wording leftovers from the plan 2b live check: **N1**
  — an axis column's "isn't in the list" message no longer suggests marking it from the product page
  (it never can be); **N3** — a links group whose detected axis word is generic (`option`, `variant`,
  `swatch`, `style`) proposes "Colour" as its new column, not the word itself (Nike's colourway
  picker). The route smoke (`routes-smoke.test.ts`) opens a run page it seeds directly
  (`seedCompletedVariantsRun`, `@robot/api`'s own test-helper pattern) rather than through Verify or
  Extract — both are categorically off the table on a server with an Anthropic key — and checks the
  count lines, the Colour/Variant key columns and all three download links.

**How to check it, free.** `pnpm -r test` (api, app, scraper all green — 692 + 644 + 907 tests) and
`tsc --noEmit` in all three. `pnpm test:ui:app` with `pnpm dev:all` up walks the whole app shell,
including the new run-page test; it never clicks Verify or Extract.

**What's left — the live run (controller, not this task):** the plan's "After the plan" step —
Everlane (list) and Nike (links) through tRPC on a keyless :4100, verify, a real budget-3 run, then
download CSV/JSON/XLSX and record rows per product, keys, the counts and the time per product in a
new dated results file under `docs/testing/results/`. Not started as of this entry.

## Variants plan 2b (2026-10-02)

Plan: `docs/superpowers/plans/2026-10-02-variants-plan2b-live-check-fixes.md`, written after a live
check on Allbirds, Everlane and Nike found eight defects
(`docs/testing/results/2026-10-02-variants-live-check.md`). Branch `fix/variants-live-check`,
base `main` at `60920c7` (the plan commit); `git log --oneline main..HEAD` is the record. Four tasks, all
landed:

1. **Scraper — stub entries are not variants** (`e8944ee`). A placeholder entry ("Variant 1…", no SKU, price or axis value beyond a stub) no longer counts toward detection (`isVariantEntry`, shared by `buildList`/`qualifiesAsApiVariantArray`) or certification; the real SKU concept is suggested before a raw barcode-looking key.
2. **API/App — a column is never "From the product page"** (`2fcd007`, `bc2238e`, `a63fc45`, `c2dc0bc`; `2fcd007` is the scraper side — a list certifies only when values are read from it). An axis column (it differs per variant by definition) can't be confirmed via from-product, on save or on screen; a stale answer from a website verified under the old rules now reads `needs-you` for that row, and the Verify bar agrees.
3. **Scraper — link-group shape rules** (`014dceb`, `796dd43`). A variant link must stay under the product page's own path — an off-pattern link (Nike's "Design your own", `/u/…`) drops out of the group instead of failing it — and a locale path prefix (`/en-us/…`) compares two segments, not one.
4. **Wording — the noun, picker words, a list without columns** (`a522343`, fix round 1 `2829e4b`). `variantNoun` (api `variant-fields.ts`, app `variants-row-view.ts`) is "variants" unless exactly one column is mapped, not just the first one found — the app side reads `columnNames(setup, axes)` (new, dedupes by `axisKey`: two detected names mapped to the same column, e.g. "color"/"colour", count as the one column, not two). The picker-only line (`variants-view.ts`) only ever shows the twelve known words (colours, sizes, lengths, widths, heights, materials, patterns, styles, capacities, flavours, scents, finishes), read from a fixed singular→plural table rather than a mechanical "+s" ("capacity"/"finish" were reading "capacitys"/"finishs" until the fix round) — no "swatchs"/"defaultcolornames"/"unstyleds" either, and the line disappears once no known word is left. A found list whose every page's list has no detected column (Everlane: the colour is only inside each entry's `name`) now carries `noColumns: true`, and the step says "These variants have no colour or size in the page data — they will be told apart by their SKU" instead of "Nothing of this kind…".

**Next.** Re-run `docs/testing/ui-check-app-variants.mts` on Allbirds, Everlane and Nike (free, keyless
:4100) and record the result in a new dated file. Expected (plan's "After the plan" section):
Allbirds' real variant checked with Size/Colour unable to be from-product; Everlane's SKU certifies;
Nike shows one colour group, without "Design your own" or help links.

## Variants plan 2 (2026-10-01)

Spec: `docs/superpowers/specs/2026-10-01-variants-design.md` §4. Plan:
`docs/superpowers/plans/2026-10-01-variants-plan2-verification-and-certification.md`. Branch
`feat/variants-verification`, on top of plan 1; `git log --oneline main..HEAD` is the record.

**What landed:**

- **Engine (`@robot/scraper`, Tasks 1–2).** List certification (`certifyVariantList`: the confirmed list resolves on every proof page, the count matches what the customer confirmed, every entry field reads on every entry, no two entries read the same) and the link collector (`certifyVariantLinks`, links near a marked element). Failures use the plan's fixed sentences ("found 2 of 3 colours on product 1", "two colours on product 1 read the same: Black", …).
- **API (Tasks 3–4).** Migration `0013_variant_results.sql` (`source_verifications.variant_results`). `sources.saveVariantAnswer` (row-locked, so a fields autosave never drops it, and refused for a page that is not a proof page), `sources.variantList` (a confirmed list's labels and per-entry suggestions), `sources.variantLinksNear`. Every Verify run checks the variants when the project wants them (`onlyKeys: []` runs the variants alone, free); `verificationStatus.variants` says required / current / passed; Extract is refused with "Set up this website's variants before extracting" or until the variant check is current and passed. Turning the project back to No variants unlocks Extract without re-verifying.
- **App (Tasks 5–6).** `lib/site/variants-row-view.ts` (cell states, the one-tick confirm, spot-check rows, `variantsNeed`, `extractEnabled`) and `verifyButton`'s `variants`. `components/verification/variants-row.tsx`: the **Variants** row after the fields, only while the project wants variants and the website's method is "Listed in the page data" or "Linked as separate pages". A cell per product: orange count with ✓ ("Confirm the variants of product n"), grey "No variants" with ✓, green once confirmed, red with the product's message after a failed Verify. Expanded: the labels (first 8, "and k more"), **Not right?** (another list the page carries, or "No variants on this product"; for linked pages, "Mark the colour buttons on the screenshot", which opens that product's screenshot and searches near the click), and the checked variant — for a list, a sub-row per variant-level field and column (✓ the suggestion, type it, or "From the product page"; "Check this one" picks another variant); for linked pages, "Checking the Red page" with that page's screenshot state and Try again. Answers save 300 ms after the last change, newest wins; each save refreshes `sources.get` and `verificationStatus`. The detection query is shared with the Variants step (one key, looked at once).

**How to check it, free.** `pnpm test:ui:app` with `pnpm dev:all` up. The smoke's shop now
serves products 1 and 2 with 2 and 3 colours (each with SKU and price) and product 3 with none.
After the plan 1 walk it adds SKU and In stock, accepts them, sees "2 colours" / "3 colours"
orange and "No variants" grey, ticks all three, expands, accepts Price, SKU and Colour of the first
variant on both, marks In stock "From the product page", checks the answers on the server, and
reads the button ("… and variants · …") — never clicks it. Screens:
`docs/testing/screens/app-site-verification-variants-row-{light,dark}.png` (and
`…-variants-found-*`, now reading "2 colours on product 1, 3 on product 2, none on product 3").
The live Verify (a keyless api-server on :4100, button asserted "· free", row turns green, Go to
Extract unlocks) is the controller's step; its result goes here when run.

**What plan 3 adds** (spec §5): a row per variant at extraction (list method: one page load;
links method: one load per variant page, counted against the budget), `variant_key`, the budget
and the export shapes. Picker-only variants stay out (spec §6).

## Variants plan 1 (2026-10-01)

Spec: `docs/superpowers/specs/2026-10-01-variants-design.md` (§2 the contract, §3 the website's
Variants step). Plan: `docs/superpowers/plans/2026-10-01-variants-plan1-contract-and-detection.md`
(spec §8 item 1). Branch `feat/variants-contract`, base `main` at `e59c884`; `git log --oneline
e59c884..HEAD` is the record. Why: a product page often stands for several products (colours,
sizes), and until now the engine collected one row per page whatever it showed.

**What landed:**

| Commits | What |
|---|---|
| `e315bbf`, `bb88a02`, `c5a430c` | Migration `0012_variants.sql`: `datasets.variant_mode` (default `ignore`, so every existing project is unchanged) and `sources.variant_setup` (null). A field's level (`product` / `variant`, defaulting by concept — price, SKU, stock, image… are variant), and axis columns (`kind: 'axis'` entries on the dataset schema, never returned by `contractFields`, so nothing that verifies fields sees them). `datasets.variants / setVariantMode / setFieldLevel / addAxis / renameAxis / deleteAxis`; deleting a column a website maps to is refused naming the website ("Nike uses Colour"); turning variants off deletes nothing. |
| `30e360b`, `50c0233` | `@robot/scraper` `detectVariantLists`: variants listed in a capture's page data — JSON-LD `hasVariant`, a `Product.offers[]` list with a SKU or price per entry (also inside `@graph` and `AggregateOffer`), an API body's `variants[]`-like array. Pure, no browser. |
| `f50f436`, `e3a601b`, `2d68a01` | In-page scripts: groups of variant links (same-site links near a swatch/option control) and pickers (select, radio group, button group), with exclusion words for filters, sorts, related products. |
| `574b2ee`, `74d08e7` | `sources.detectVariants` (reads the proof pages' stored captures — no page load, no model, free) and `sources.setVariantSetup` (the method plus each detected axis mapped to an existing column or a new one, minted under the same locks as `deleteAxis`); `sources.get` returns `variantSetup`. |
| `401912c` | `@robot/app`: the Fields page's **Variants** panel (No variants / One row per variant / One row per product, variants listed inside; the variant columns, renamed in place or deleted) and, while variants are on, a **Variants** column in the field list ("Same for every variant" / "Differs per variant", marked *default* until changed). The Verification tab's **Variants** step under the table: "Find products first" / "Wait for the screenshots", then what the captures show ("Listed in the page data: 2 colours on every product", "Linked as separate pages: 4 colour links per product", "Only in a picker on the page: sizes — not collected in this version"), the method preselected to the suggestion, each detected axis → "becomes column" (an existing column or New column 'Colour'), **Confirm**; once set, one line ("Variants: listed in the page data · Colour") with **Change**. View logic: `lib/site/variants-view.ts`, `lib/fields-view.ts`. |

**What it does not do yet.** Nothing is verified, certified or extracted per variant, and the step
never holds Verify or Extract back. **Plan 2** (spec §4): verifying and certifying the variant
paths on the proof pages, and keeping Extract locked until the variant certification passes. **Plan 3** (spec §5): extraction
at scale — a row per variant (list method: one page load; links method: one per variant page,
counted against the budget), `product_key` / `variant_key`, and the export shapes.

**How to see it, free.** `pnpm test:ui:app` with `pnpm dev:all` up: the smoke's local shop now
serves each product with a two-colour `hasVariant` block; after the Verification walk it turns
variants on in the throwaway project, sees the levels, confirms the website's step with a new
Colour column, reloads to the set line, and has the column's delete refused with the website
named. It never clicks Verify. Screens: `docs/testing/screens/app-project-fields-variants-*.png`,
`app-site-verification-variants-found-*.png`, `app-site-verification-variants-set-*.png`. By hand:
turn variants on for a project of your own on its Fields page, open a website whose screenshots
have landed, and read the Variants step under the table — the detection itself is free.

**Wording.** The screen never says "axis": the Fields panel calls axes **Variant columns** (the
plan said "Axes"; the constraints forbid the word on screen).

## Certification picks the right path (2026-09-29)

Spec: `docs/superpowers/specs/2026-09-29-certification-picks-the-right-path-design.md`. Plan:
`docs/superpowers/plans/2026-09-29-certification-picks-the-right-path.md`; the per-task briefs,
reports and ledger were scratch; `git log` is the record. Branch `feat/certification-right-path`,
base `main` at `594d93d`. Why: Marko's own Ikea run (2026-09-28) certified **In stock on
`api → priority`** — a yes/no value matches any field that is 1 on every proof page, and API
outranks JSON-LD — so at scale an out-of-stock product would have read "in stock", silently. Main
image failed on all three products (a `?f=s` size parameter), and a JSON-LD `ImageObject` was stored
as `[object Object]`. **API stays the first-ranked source** (Marko): the rules decide which paths
may compete, not the order among them.

**What landed** (`git log --oneline 594d93d..HEAD`):

| Commit | What |
|---|---|
| `2d4f4fd` | C1/C2: `field-fit.ts` (`isWeakField`, `pathFitsConcept`, `CONCEPT_PATHS`); a weak field — yes/no, or one value on every checked proof page — certifies only a path the customer confirmed, the XPath of an element they marked, or a structured path named for its concept (`qualifiesForWeak`, one rule for certify and the carry); nothing fitting → cell reason `no_fitting_path` and no paid AI fallback; confirmed paths go first; `VerificationSet.paths` (Task 1) |
| `be410c4`, `42b84e5` | C3/C4: an image is the same image when host + path match (query and fragment ignored; `url` stays exact); a structured object is read (`url` / `contentUrl` / `@id`, `structured-value.ts`'s one reader), never stringified; the carry follows C2 (Task 2 and its fix round) |
| `e5b11e4` | an answer keeps the path it was accepted from: `paths` round-trips through `updateBinding`, is dropped with a changed value, moves `fieldHash`; `fieldHash` / `definitionHash` are byte-identical for a set without `paths`, so existing websites stay current (Task 3) |
| `8a1f428`, `699fd39` | the model: answers keep their path; A4 majority rows ("different place on product n — check it", Accept takes the majority only, the odd product is left for a person — also when every value matches); A5 one structured value in several places is one place; A6 yes/no reads "In stock / Out of stock" (availability) or "Yes / No", the saved value untouched (Task 4 and its fix round) |
| `c0329c9` | the tab: A1 a carry never replaces a page-data suggestion; the majority status and Accept; A7 a per-cell ✓ ("Accept {field} on product {n}") for a suggestion with exactly one place; the `no_fitting_path` hint "We can't tell which value on this page is this field. Mark it on the screenshot." (Task 5) |
| `473e7e2` | found by the live run: a bare fragment (`#0058a3`) or a lone dot (`.`) resolves to the page itself, so it certified as Product URL; `normalize` now refuses it as a URL (Task 6) |
| this task | `packages/api/src/scripts/audit-certified-paths{,-core}.ts` (+ test), the live check updated for the new rows, the live note, this section (Task 6) |
| `89709b0`, `837e99c`, `b486a96`, `b7902b0`, `0d108e4`, `445e404`, `f54f8cf`, `194969e` | the final fix wave: `:` separates meta-key segments and the currency / availability / brand vocabularies are wider; the in-page search compares images on host + path and refuses a fragment or lone dot as a URL; the carry sends the answer's path (`from[key].via`) and tries it first; no one-click ✓ on an odd product, also after the majority is accepted (`cellAcceptable`); the expanded row counts places as the status does; the `no_fitting_path` hint names the field (new app and old dashboard) |

**No implementer signed in as `markodjordjievski@gmail.com` or wrote to org `default` or `mar`.**
The audit read every organisation's websites, select queries only. Verify was clicked only by the
live check, on the keyless :4100 api-server, after it asserted "· free" — three times, $0.00.

**Rulings this plan made:**

- One weak-candidate rule, `qualifiesForWeak(field, c, { confirmed, markXPaths })` in `certify.ts`,
  used by certification, the carry and the audit.
- Dedupe confirmed extras on the full path id (source + path + transform), so the identity reading
  of a confirmed path is tried even when the cache holds another transform.
- A weak field whose every cell ends `no_fitting_path` skips the paid AI fallback: its XPath
  proposals cannot qualify; the remedy is a mark. Cost if wrong: a rare field whose fitting path
  needs a transform only the AI finds needs a mark instead.
- C4 applies wherever a raw structured value becomes text (transfer value, certify's `found`).
- A majority row whose values all match still keeps its odd product for a person (A4 binding):
  same-everywhere carries `{ odd, via }` and "Accept anyway" takes `via` only.
- The one-click ✓ is hidden on an odd product (strict A4): `cellAcceptable` refuses a cell whose
  path differs from one two or more other products share, counting their suggestions and their
  answers, so it stays hidden after the majority is accepted (the live run, before this, used it once).

**The live run** (`docs/testing/2026-09-29-certification-live.md`; Ikea MY Cabinets; the listing's
first three are now BAGGEBO and two BILLY / OXBERG combinations, so the odd product is product 1):
before any click **5 rows agreed, 2 agreed but for one product** (Price, In stock), 1 same
everywhere (Brand), none need you; **7 clicks to an enabled Verify** (was 24; plan 5: 43): Find
products, Accept all agreed (7), Accept Brand anyway, Price's ✓ on product 1, and three for In
stock on product 1 (its value has no element on the screenshot, so no ✓). A free Verify in 6.2 s,
**8 of 8 verified**. **In stock certified `json-ld offers.offers[0].availability |
json-ld offers.availability`** (nothing from the API); **Main image verified on all three**
(`meta og:image`, backups `api mainImage.url`, `json-ld image[0].contentUrl`); SKU, 7 clicks last
time, is agreed (A5).

**The audit** (`pnpm --filter @robot/api exec tsx src/scripts/audit-certified-paths.ts`, read-only;
full output in the live note; re-run after the final fix wave): 2 websites with a verification set,
13 certified fields, **1 on paths that no longer qualify**:

| Website | Field | Certified on | Why |
|---|---|---|---|
| mar / Competitor prices / Ikea | In stock | `api priority`, `api [0..3].cashAndCarry` | yes/no field on paths that do not name it |

(Acne / Ikea's Price currency, flagged by the first run, now qualifies: `currencyPrefix` /
`currencySymbol` are currency tails.) **The customer re-verifies that field from the tab** (free:
mechanical paths). Nothing is re-certified automatically; it stays "current" until then, because its hash did not change.
Competitor prices / Ikea's Product URL also still holds the junk backups `473e7e2` stops
(`revampPrice.separator`, theme colours); they can no longer read as a URL, and a re-verify drops
them.

**Seen, not fixed:**

- A page-data value with no element on the screenshot gets no ✓ (A7 needs exactly one place):
  3 clicks instead of 1 for In stock on the odd product.
- After "Confirm … from the page data", the expanded row's "Type it" box shows the raw
  `https://schema.org/InStock` (the answer has no mark, so it reads as typed).
- Verify on a throwaway Ikea website again enriched the shared domain cache (plan 5's open
  decision stands).

**Deferred minors** (task reviews): no dedicated test for omitting `found` when unreadable; the pass
cells' `displayValue(raw) ?? String(raw)` fallback; `majorityOf` counts products 4–6 too, and a tie
reads "comes from different places"; `cellAccept`'s guards are covered by the smoke only; the Verify
reason says "Accept {field} first" when the gap is the odd product itself; the ✓ is invisible on
touch (the cell click still works); `imageKey` treats two images differing only by a query id as
one (accepted in the spec).

**Left from the final re-review (rare, deferred):** the one-click ✓ can come back on the odd product after a majority whose shared path is a page element (an XPath carried from a marked element) is accepted — answers keep only structured paths, so the check has nothing to count. It needs four or more products and two carries sharing one XPath. Fix when it matters: keep the carried XPath on the answer for this check only.

**Next: variants**, a design of its own (spec §6). Decided up front: the customer chooses variant
handling at setup — usually one row per variant — and a run never stops to ask. Until then A4 leaves
a combination or variant product (Ikea's BILLY / OXBERG) to a person. Then Part B of the 2026-09-28
spec, drift repair, and plan 6, the cut-over. *(Both done — see [Cut-over (plan 6)](#cut-over-plan-6-2026-10-07) above.)*

## Table-first verification (2026-09-28)

Spec: `docs/superpowers/specs/2026-09-28-table-first-and-drift-repair-design.md`, Part A
(Part B, drift repair, is next and has its own plan to write). Plan:
`docs/superpowers/plans/2026-09-28-table-first-verification.md`; the per-task briefs, reports
and ledger were scratch; `git log` is the record. Branch `feat/app-table-first`, base `main` at
`bdd02be`. The Verification tab is now **one table**: a row per field, a column per product
(the product cards are the column heads), a cell per field and product with its value and a
2 px state rail, and a last column that says what the row needs — "agreed · Accept", "same on
every product — check it · Accept anyway", the first reason it needs you, or the verdict after
a Verify. **Accept all agreed (n)** sits above it beside Verify. Clicking a cell opens that
product's screenshot under the table with the field's element outlined; × or Escape closes it.
The fields sidebar and the battery are gone.

**What landed** (`git log --oneline bdd02be..HEAD`):

| Commit | What |
|---|---|
| `212a149` | the model (`lib/site/verification-model.ts`): a suggestion keeps the page-data path it came from (`via`); `rowStatus` (accepted / agreed / same-everywhere / needs-you with its first reason), `acceptRow`, `acceptAllAgreed`; 13 tests (Task 1) |
| `bba801f` | the components: `VerificationTable`, `VerifyBar` (Accept all agreed, Verify and its reason, the save line, Go to Extract), `FieldDetails` (the expanded row: hint, Type it, descriptor), compact product cards as column heads (Task 2) |
| `8c733b9` | the route becomes the table; the screenshot panel opens exactly while `?product` is set; `fields-sidebar.tsx`, `field-row.tsx`, `battery.tsx` deleted; "Accept {field} anyway" label; the row header left-aligned (Task 3) |
| `8816244`, `1c4d7af` | a cell or column-head click brings the screenshot and the field's element into view, and on a product switch only once the new screenshot is measured (Task 4, found by the live check) |
| `e526d4b` | an element off the top or left of the screenshot is never pointable and never a mark: one such mark made every autosave fail (Task 4, found by the live check) |
| this task | the smoke's table walk, the live check rewritten for the table, the look-only check edited, these docs (Task 4) |

**No implementer signed in as `markodjordjievski@gmail.com` or touched org `default`, org
`mar`, or Acne / Scratch / Competitor prices.** Every browser check used a throwaway
`smoke-*@` / `check-*@example.com` and deleted its project. Verify was clicked only by the live
check, only on the keyless :4100 api-server, after it asserted the label ends "· free" — four
times in all, $0.00.

**Rulings this plan made:**

- Each implementer's commits carry its own model's `Co-Authored-By` line.
- Task 2's two transitional findings (the hint only inside an expanded row; a dead "Accept all
  agreed (0)" on the old sidebar) were parked, not fixed: both lived only in the sidebar Task 3
  deleted on this unmerged branch.
- Suggestions carried from another product are not saved (spec: suggestions never are), so
  after a reload a row can go from "agreed" back to "comes from different places". The smoke
  asserts that accepted cells survive a reload, never that "agreed" does.
- The smoke adds a third field, **Rating**: nothing in the fixture shop's page data names a
  rating, so it is the honest "needs you" row the walk marks on a screenshot.
- The spec's "≤ 5 clicks to Verify" is recorded as a measurement (met / missed), not a pass mark
  in the live check: how many rows need a person is the website's.
- The live check accepts a same-everywhere row ("IKEA" as Brand) with its Accept anyway, as a
  person would, and for a row that needs you ticks the product its reason names, else the first
  suggested cell; for several places it takes the first rectangle and says so.

**What the checks found.** The smoke (`pnpm test:ui:app`, 14 tests) is green in both themes and
walks the table on the local shop: three column heads ready → Title and Price "agreed · Accept",
Rating "missing on product 1", every Title/Price cell "suggested", "Accept all agreed (2)" → one
click and all six cells "accepted", Rating untouched, "Accept all agreed (0)" disabled with
"Nothing agreed to accept" → Rating's cell opens "Widget A — screenshot" with `?product=1&field=rating`
**and the frame on screen** → the rating marked on the screenshot → the carried row "agreed" →
Accept Rating → × closes the panel and clears the address → "saved" → reload → all nine cells
still "accepted", Verify enabled and priced, **not clicked** → `sources.get` has Rating's mark on
product 1 and the cards' titles. The live check on Ikea (`docs/testing/2026-09-28-table-first-live.md`),
same listing and products as plan 5: listing in 12.4 s, three screenshots together 12.3 s after
it, 8 of 8 fields suggested on every product; before any click **4 rows agreed, 1 same
everywhere (Brand), 3 need you**; **24 clicks to an enabled Verify (plan 5: 43)** — three of them
cover five rows; a free Verify in 6.2 s; **8 of 8 verified**; no page errors. The ≤ 5 target is
missed on this listing, for reasons that are real: Price and In stock come from two JSON-LD
shapes (product 3 is a combination with an AggregateOffer, `offers.offers[0].price`), and SKU
is shown in two or three places. A second listing (Ikea's `chairs-fu002`, not a record run):
15 clicks, 8 of 8. Fixed on the way, each in its own commit:

1. `8816244` — a cell click opened the screenshot below the fold, with the element further
   down a frame that starts at the page top: the click outlined something nobody could see.
   The smoke's new "frame on screen" assertion fails without it.
2. `1c4d7af` — on a product switch that reveal fired against the old screenshot's width.
3. `e526d4b` — Accept all agreed took Product URL from a link Ikea's box map measured at
   y = −1066; the server refuses a negative rect in a mark, so every autosave after it failed
   ("Not saved: Number must be greater than or equal to 0"). Two unit tests.

**Seen, not fixed:**

- **"comes from different places" names no product.** On Ikea the odd one is product 3; a
  person, like the check, ticks product 1 first. Naming it ("…on product 3") would have made
  the run 18 clicks, not 24. A spec wording change (A2), so Marko's call.
- Yes/no cells show the raw page-data value (`https://schema.org/InStock`); after the run
  product 3's In stock read `1`. A carried Price reads "RM399" where the tick read "99" (Task 3).
  Both verify; both read oddly in an "agreed" row.
- The box map measures some Ikea elements at negative y (the price module) — `@robot/browser`'s
  question; harmless on this tab now.
- Verify on a throwaway Ikea website again enriched the shared domain cache (plan 5's open
  decision stands).
- Ikea MY's `chairs-fu002` listing yields a table, a lamp and a vase, titled by the whole card
  text, with no photos, in 42 s — listing quality, not this tab.

**Deferred minors** (from the task reviews): the panel's Escape may close it when meant for an
open menu; a "found in n places" row outlines the first place only; the add head's
`min-h-[136px]` is a measured number; `ProductGrid` is exported but unused; after a reload a
carried suggestion is not re-run for rows whose first product is answered; accepted rows show
nothing in the status column until a Verify; the status column's 220 px leaves a gap on wide
screens. From the final review, not fixed yet: focus after Accept and in the panel (M3);
truncated values — thumbnails, path-only URLs (M5); the status column can scroll off on laptops
(M9); and two spec calls for Marko — name the odd product for "comes from different places",
and whether a same-value structured "found in n places" counts as one place.

Escape with a mark popover open closes the popover only (Radix's DismissableLayer handles it in
the capture phase and prevents the default, which the route's window listener respects); a
second Escape closes the panel. The smoke asserts both.

**Final review fixes** (2026-09-28): a lone suggestion agrees only when it was carried from a
ticked product — otherwise the row says "check product n"; an answer that is not valid for its
type needs you; a failed screenshot says "screenshot failed on product n"; a cell's accessible
name carries its value; a Verify gap on an agreed row reads "Accept {field} first" (or "Accept
all agreed first"); Accept and Accept all agreed say "Locked while this verification runs".

**How to run.** `pnpm test:ui:app` with `pnpm dev:all` up (free; never clicks Verify). The live
check needs its own keyless stack (:4100 api-server, :3100 app) — see the live note; never
point it at :4000. `docs/testing/ui-check-app-site.mts` (the look-only walk of Acne / Ikea) had
its Verification stop edited for the table (a row per field, every cell "accepted", "verified"
in the status column) and **has not been run** — it is the controller's, against Marko's
account. Screens: `docs/testing/screens/README.md` (`app-site-verification-table-*`,
`app-site-verification-ikea-{agreed,verified}-*`; the plan 5 `marking` / `ready` state shots
are deleted with the sidebar they showed).

**Parked, not scheduled:** `docs/superpowers/specs/2026-09-28-jev-shadow-checks-design.md` — Jev
(TypeSafe) shadow checks on agreed rows and a Choice for "found in n places", calibrated on the
customers' own accepted answers (research: `2026-09-28-jev-research-update.md`). Spec §C keeps it
out until the table-first rule is measured; this run is that first measurement.

**Next.** Part B of the same spec, **drift repair**: a verified website that stops extracting a
field is flagged today (`sources.driftedFields`) but nothing shows it or proposes the fix. Then
plan 6, the cut-over (deleting `@robot/dashboard`). *(Done — see [Cut-over (plan 6)](#cut-over-plan-6-2026-10-07) above.)*

## App redesign, plan 5: the Verification tab (2026-09-25)

Spec: `docs/superpowers/specs/2026-09-25-verification-tab-design.md` (supersedes
the stepper's flow in `2026-09-18-schema-stepper-with-marks-design.md`; its
engine stands). Plan: `docs/superpowers/plans/2026-09-25-app-redesign-plan5-verification-tab.md`;
the per-task briefs, reports and ledger were scratch and are deleted; `git log` is the record.
Branch `feat/app-verification-tab`, base `main` at `a420222`. A website's first
tab is now **Verification**, at the website's root URL: paste a listing, get
three product cards, look at each product's screenshot, point at a value and
name its field, tick what page data and the other products suggest, and
Verify. The proof-sheet grid, the Fields step, the stepper and Import values
are gone from `@robot/app` (`@robot/dashboard` is untouched).

**What landed** (`git log --oneline a420222..HEAD`; later shas in a row are that task's fix rounds):

| Commit | What |
|---|---|
| `ca4c491` | API: `proofPageCapture` / `suggestMarks` scoped through capture → website → organisation (`captureInOrg`); `proofPageCaptures` (newest capture per url, so a reload resumes); captures three at a time per api-server; `transferMarks` takes the answer on screen (`from`) and `fieldKeys` (Task 1) |
| `f935289` | API: `updateBinding({ draft: true, cards })` — autosave from the first tick, the cards stored on the verification set; `verify` runs `bindingProblems` on the stored record first (Task 2) |
| `b66eee2` | API: `checkListingPage` answers `products: [{ url, title, image }]` from the same page load (Task 3) |
| `89611f1`, `e3586ac`, `400c37d` | the tab's model (`lib/site/verification-model.ts`: board, answers, suggestions, battery segment, badge, Verify gate) and its autosave (`lib/site/saver.ts`), then two saver fixes — a rejected save no longer loses the value, and a failed save is retried on the next edit or Verify, not in a loop (Task 4) |
| `17f9fe7` | the listing bar and the product grid, each product captured in the background (`lib/site/use-proof-captures.ts`) (Task 5) |
| `0607dc1`, `d9bb253` | the screenshot viewer — hover, Alt widens, click to mark, labelled rectangles, the field popover (Task 6) |
| `55a1230`, `b8cc5d6` | the fields sidebar — a battery per field, the badge, Type it, the descriptor, Verify, "saved", Go to Extract (a typed router `Link`) (Task 7) |
| `fe32d77`, `cbee154`, `764363e` | the route that joins them, and two fixes its browser walk found: every product's capture id is recorded when three start at once; a click inside a labelled rectangle opens that rectangle (Task 8) |
| `927252b`, `9938f5a`, `6d0a538` | Task 8's fix round: `verificationStatus.unchangedKeys` so a failure shows red ("fails on product n") until the answer changes; the row hints ("page data: <value>" with ✓/×, "found in n places — click the right one"); the run's "use as proof page" link sends the field's key |
| `973f554` | the grid, the stepper and Import are deleted; runs and Add website land on Verification (Task 9) |
| `caf7d70`, `c7831ac`, `5803280` | three fixes the live checks found (below) (Task 10) |
| this task | the smoke's Verification walk, the live check on Ikea, these docs (Task 10) |

**No implementer signed in as `markodjordjievski@gmail.com` or touched org
`default`, org `mar`, or Acne / Scratch / Competitor prices**, beyond Task 10's
one read-only SQL query (Ikea's stored field names and listing URL). Every
browser check used a throwaway `smoke-*@` / `check-*@example.com` and deleted
its own project. Verify was clicked once per live run, only on the keyless
:4100 api-server, after the check asserted "mechanical only" (the label now
reads "free"; see the fix wave below).

**Rulings this plan made:**

- `validateValue` / `shortUrl` were copied into the model (not moved) until the
  grid was deleted, so the build held through Tasks 5–8; `FieldType` is the one
  in `lib/fields-view.ts`.
- The saver's plan-given code could resolve `flush()` without having saved, so
  Verify could check a stale record: fixed despite the brief (spec §3 — the
  latest state wins, and Verify needs the saved record).
- Task 7's `extract={{ enabled, href }}` became `{ enabled, project, site }` and a
  typed `<Link>` — a raw href was a full page reload.
- **The plan's "failed only for a current key" was wrong** (current = passing
  and unchanged, so red could never show). `verificationStatus` now also
  returns `unchangedKeys` (latest result's `fieldHash` matches, pass or fail);
  red segments and "fails on product n" read it.
- Spec §2.3's row-level suggestions landed in Task 8's fix round, not later.
- Task 10: a suggestion on an element smaller than 4 px on a side is offered on
  the row, not drawn (`pointable`); the app's yes/no words now include
  schema.org's availability URLs, as the engine's do.

**Deviations from the spec:**

- A page-data value ticked from the row is saved as a typed answer (value, no
  mark), as Type it is; the engine certifies it from the page data.
- The smoke's website is named "0": that is what the Add website dialog derives
  from `http://127.0.0.1:<port>/`, and the smoke keeps the customer's gesture.

**What the checks found.** The smoke (`pnpm test:ui:app`, 14 tests) is green in
both themes and now walks the whole tab on a local shop: listing → three cards
("Widget A/B/C") → three screenshots → tick the Title suggestion → reject the
Price suggestion and click `$129.99` on the screenshot, pick Price, tick →
"Price: 1 of 3 confirmed, 2 suggested" → tick products 2 and 3 → "saved" →
reload → every segment green, Verify enabled and priced, **not clicked** →
`sources.get` has Price's mark on product 1 and the three cards' titles. The
live check on Ikea (`docs/testing/2026-09-25-verification-live.md`): listing
in 12–16 s ("35 products found · a pager too"), three screenshots together in
12–22 s, **every one of eight fields suggested by page data on every
product**, nothing left to mark by hand, 43 clicks, a mechanical Verify in
21 s, **8 of 8 verified**, $0.00. Four of the eight (Title, Description, Main
image, Brand) came only as "page data: …" row lines — the path had never been
seen live and is the commonest on Ikea. Fixed on the way, each with a test:

1. `caf7d70` — a rectangle at the top of the screenshot (a page's heading)
   lost its label to the frame; it now goes under the top edge.
2. `c7831ac` — Product URL was suggested on a 1×1 anchor: a label with nothing
   to click, and Verify stuck on "Product URL still needs product 1".
3. `5803280` — In stock, suggested as `https://schema.org/InStock`, could be
   ticked and was then refused by the Verify gate as "Not yes/no"; the app's
   words now match the engine's.

**Seen, not fixed:**

- The capture paints Ikea's cookie banner and sticky header into later tiles;
  one of SKU's two places sat under the banner (`@robot/browser`, not this tab).
- A Verify on a throwaway Ikea website wrote verified paths to the shared
  domain cache (`[cache] verified paths for www.ikea.com/detail: 8 concept(s)`)
  — the cache is per domain, not per organisation. Harmless here (Ikea's real
  paths, enrich-only), but a live check that verifies a domain Marko also uses
  touches his cache.
- "found in n places" gives no hint which place is right (SKU on Ikea).
- Engine/listing quality from Task 8's walk: books.toscrape's sidebar
  categories read as products; `suggestMarks` offered a breadcrumb as a second
  Title place.
- The Ikea marking/verified screenshots and the smoke's state shots are
  honest, but the tab keeps the document scrolled ~90 px after a click on the
  screenshot, which is why the smoke's three state pairs are viewport shots.

**Deferred minors:** `dispose()` / `push` after
dispose in the saver; `verifyGate` does not check `canSave`, and `canSave` does
not cap at six; the badge shows nothing for a field that failed with only
`not_captured` cells; `toBindingInput` trims urls but not the cards'; Try again
/ Use this page are not disabled while their own call runs; the checking badge
announces twice to screen readers; `targetAt` allocates a box list per pointer
move; `read-excel-file` is now unused in `@robot/app`; `cellStatusFor` /
`CellStatus` are dead outside their test.

**How to run.** `pnpm test:ui:app` with `pnpm dev:all` up (free; never clicks
Verify). The live check needs its own keyless stack — see the live note; never
point it at :4000. `docs/testing/ui-check-app-site.mts` (the look-only walk of
Acne / Ikea) has its Schema and step 1 stops replaced by one Verification stop;
it now allows `sources.captureProofPage` by name (opening the tab takes a free
screenshot of any proof page with none fresh) and **has not been run** — it is
the controller's, against Marko's account. The screenshot set and what each
shows: `docs/testing/screens/README.md`.

**The final review's fix wave:**

- The Verify label follows spec §2.4: `Verify 8 fields · free` /
  `Verify 8 fields · up to $X`, `Re-verify n fields · free | up to $X`; "free"
  whenever there is no AI or the upper bound is $0 ("mechanical only" is gone;
  the smoke and the live check match "free").
- The Verify gate asks for a missing descriptor first ("Say where SKU is on
  this website") and opens that field's row — a custom field with no
  catalogue description used to leave Verify enabled and always refused.
- A listing on another website than the products is refused under the listing
  input (the server counts its host even for an autosave, so every save used
  to fail silently); `canSave` / `productsProblem` count it too.
- A tick is not lost to leaving the page: the autosave flushes on `pagehide`
  and when the page is hidden, and asks before unloading while a save is
  waiting or running. A page-wide board store (`lib/site/board-store.ts`)
  keeps the latest pushed board and the save in flight, so leaving the tab and
  coming straight back waits for that save and never seeds from a stale cache;
  a landed save writes its record into `sources.get`'s cache.
- A refused save names the server's reason in the sidebar's save line.
- A suggestion is tickable by its own value, and keeps the element as its mark
  only when the element shows that value by the engine's comparison
  (`@robot/scraper/normalize`, a new browser-safe export).
- Product cards keep their screenshots while the capture lookup refetches.
- A product-page capture's stall clock starts when it gets a browser slot, and
  a capture still queued in this process is never reported stalled.

**Left from the final re-review (real, narrow, deferred):**

- An unconfirmed board-store entry never expires: after a save the server
  refused, every return to that website in the same page session seeds the
  local board and saves it again, over a teammate's newer save fetched
  meanwhile. Fix: compare the entry's push time with the server's
  `updatedAt`, or clear it when a refusal is final.
- The stall resolver reads a capture row before checking whether its job is
  still queued; a capture that waited over three minutes and takes its slot in
  between can be written `failed` / `stalled` (its own `captured` write puts
  it right, but the card may have stopped polling). Fix: a conditional update
  on the old `startedAt`.
- `beforeunload` does not prompt while the saver is in its error state; an
  incomplete re-verify reads a bare "Re-verify" with no count or price.

**Open decisions:**

- The `pagehide` flush is an ordinary request (tRPC has no `keepalive`); a
  browser may cancel it on a closed tab. The `beforeunload` prompt covers a
  close or reload while a save is pending; a `keepalive` path would cover the
  rest.
- Whether live checks may verify a domain Marko also has, given the shared
  domain cache.

**Next.** Plan 6: cut-over (delete `@robot/dashboard` once `@robot/app` has
parity). *(Done — see [Cut-over (plan 6)](#cut-over-plan-6-2026-10-07) above.)*

## App redesign, plan 4: the organisation (2026-09-24)

Spec: `docs/superpowers/specs/2026-09-21-app-redesign-design.md` §5, the
organisation-wide screens, and §6 for the two new procedures. Plan and task
briefs: `.superpowers/sdd/2026-09-24-app-redesign-plan4-org/` (one report per
task). Branch `feat/app-redesign-org`, base `main` at `50bc08a`. The
organisation now has four screens of its own in `@robot/app` — Runs, Usage,
Settings, Account — reachable from the sidebar beside a project's own.

**What landed, one line per task** (`git log --oneline 50bc08a..HEAD`; the
second sha of a pair is that task's fix round):

| Commit | What |
|---|---|
| `caa4158` | a run records what its model calls cost — `runs.cost_usd`, migration `0011_run_cost`, `addRunCost`/`costSince` in `packages/api/src/crawl/record-run-cost.ts`, wired into `plan-source.ts` and `start-execution.ts` (Task 1) |
| `2583b14` | `runs.listByOrg`, `usage.byProject`, `auth.updateName`; `orgs.delete` now returns `{ ok, nextOrg }` after moving the caller's session to their personal org (Task 2) |
| `576db38` | the organisation's Runs page (Task 3) |
| `13a2ed2`, `11229ac` | the Usage page, then its fix — `usageScreenState` keeps loading/empty/error/table mutually exclusive (Task 4) |
| `6389a33`, `3b519d5` | the Settings page, then its fix — `refusalMessage(e, fallback)` in `lib/org-settings-view.ts`; the name draft's `dirty` flag cleared only after `router.invalidate()` (Task 5) |
| `f71e67e` | the Account page — `lib/apply-theme.ts` shared with the user menu; `ComingLater` deleted (Task 6) |
| this task | the organisation screens' real assertions in the smoke, the look-only check against a real organisation, the screenshot set, these docs (Task 7) |

**No implementer signed in as `markodjordjievski@gmail.com` or touched org
`default`, org `mar`, or the projects Acne / Scratch / Competitor prices.**
Every browser check in this plan — the smoke's throwaway `smoke-*@example.com`
and the look-only check's throwaway `check-*@example.com` — created and
changed only its own throwaway organisation and account. The look-only check
is run against Marko's real organisation by the controller, after this task,
the same way plan 3's Acne / Ikea pass was.

**API changes.** `runs.listByOrg` (session-only — every run in the caller's
organisation, newest first, joined back to its project and website) and
`usage.byProject({ month })` (per-project spend and pages captured for a UTC
month, spend being `source_verifications.cost_usd` plus the new
`runs.cost_usd`, a quiet `$0.00` row for every project with nothing spent).
`auth.updateName` for the account's own name. `orgs.delete` returns
`{ ok, nextOrg }`, having already moved the caller's session to their
personal org, so a customer who deletes the organisation they are looking at
is never left pointed at a session with nowhere to go. `runs.cost_usd` is
written in two places — planning and execution — as an increment
(`addRunCost`), because a resumed run is paid for more than once and neither
phase may clobber the other's figure.

**Rulings this plan made, all deliberate:**

- **The four screens' browser checks touched only throwaway organisations and
  accounts.** Nothing in this task's own runs read or wrote Marko's real
  data; the real-account pass is the controller's, after the fact.
- **Usage's loading / empty / error / table exclusivity beat the plan's own
  step code.** `usageScreenState` (Task 4) is stricter than what the plan
  brief spelled out, and it is what shipped: one state on screen at a time,
  never a confident `$0.00` next to an error banner.
- **A failed mutation shows the API's own words only for its deliberate
  refusals** — `FORBIDDEN`, `PRECONDITION_FAILED`, `NOT_FOUND` — and a generic
  sentence for everything else, so an `INTERNAL_SERVER_ERROR` or a raw network
  failure never reaches the customer as if it were an explained refusal.
- **`MembersTable` keeps its `Member[]` cast.** `memberships.role` is a
  `varchar`, not a pgEnum, so tRPC infers `string` for `orgs.members.list`
  rather than the three-value `Role` union the API in fact only ever writes.
  The durable fix is `$type<Role>()` on the column; a follow-up, not done
  here.
- **A run's cost is measured with the same process-global usage counter a
  verification's cost is** (`snapshotUsage()` / `diffUsage()` in
  `@robot/agent`), which carries the same limitation the verification figure
  already has: two paid things in flight on the same process at once would
  blur into each other's totals. Acceptable for now — nothing in this
  codebase runs two paid things concurrently on purpose — but not a design
  that scales past one worker.

**Still shim-only or unscoped, unchanged from plan 3's list:**
`sources.getBySlug / listByDataset / create`; `datasets.listByProject /
getBySlug / create / updateSchema`; all of `domains.*`; all of `scraper.*`.
`sources.findProductPages` and `sources.checkListingPage` are addressed by a
URL and name no website, so there is nothing to scope; `sources.proofPageCapture`
and `sources.suggestMarks` are addressed by a `captureId` and need a capture →
source → org hop, still ledgered to plan 5 with the mark screen; `crawl.plan`'s
`probe: true` branch is org-scoped but deliberately not certification-gated.

**Deferred minors worth doing cheaply, not done here:** `usage-total`'s
secondary line has no loading skeleton; **a run's cost is recorded
(`runs.cost_usd`) but not yet shown on the run page** — the run facts panel
could carry it, a one-line follow-up. From the final review of this plan
(`.superpowers/sdd/2026-09-24-app-redesign-plan4-org/final-review.md`):
one shared `screenState` for `/runs` and `/usage` that keeps rows on screen
through a failed refetch and adds the error banner alongside them, instead of
`runs.tsx`'s own stale-rows-beside-the-banner gap — the missing
`isError && rowCount > 0` test lands with it; `costSince` should warn on
`unpricedModels`, and `run-source-verification.ts` should call it instead of
inlining the expression; `runs.listByOrg` caps at 100 with no note on screen;
`refusalMessage` belongs in `lib/refusal.ts`, not `org-settings-view`; the
members table's actions column `w-[104px]` squeezes the owner's "cannot be
removed" reason to three lines; the org-wide runs table has never been
rendered with a row in a browser — the throwaway has no runs and the real
organisation's check SKIPs — a component test asserting the row shape, or a
look-check once a run exists, would close that gap.

**The screenshot set** (`docs/testing/screens/`, 1440×900, full page):
`app-{runs,usage,settings,account}-{dark,light}.png` from the smoke run — a
throwaway personal organisation with one project, no run, no spend, one
member (the throwaway itself) — and `app-org-{runs,usage,settings,account}-
{dark,light}.png` from the look-only check, run against Marko's real
organisation by the controller after this task, which is the set worth
reviewing.

**How to run.** `pnpm test:ui:app` now also asserts the four organisation
screens and round-trips a rename on `/account` and `/settings` (needs
`pnpm dev:all`). The look-only check is
`cp docs/testing/ui-check-app-org.mts packages/browser/src/__ui-check.mts && cd packages/browser && pnpm exec tsx src/__ui-check.mts --email <address>`
— run it only against a throwaway address unless you are the controller
checking Marko's own organisation.

**Open decision for the design review:** a members table with no way to add a
member — an "add an existing user by email" row is ~20 lines when wanted;
invitations by email remain outside the design (spec §9).

**Next.** Plan 5: the stepper's steps 2–3. Then plan 6: cut-over. *(Both done — see [Cut-over (plan 6)](#cut-over-plan-6-2026-10-07) above.)*

## App redesign, plan 3: the website (2026-09-22)

Spec: `docs/superpowers/specs/2026-09-21-app-redesign-design.md` §5 rows 6 to 9.
Plan and task briefs: `.superpowers/sdd/2026-09-22-app-redesign-plan3-website/`
(one report per task, with the deviations, the rulings and the browser
evidence). Branch `feat/app-redesign-website`, base `main` at `9d974cf`. A
website now has its own page in `@robot/app` with four tabs — Schema, Extract,
Runs, Settings — and a run of its own has a page under Runs.

**What landed, one line per task** (`git log --oneline 9d974cf..HEAD`; the second
sha of a pair is that task's fix round):

| Commit | What |
|---|---|
| `d6a870e`, `77dd40e` | `sources.get`, and every per-website and per-run procedure takes the org from the session |
| `a480d4f`, `cc9adfc` | a website has a page, four tabs and a link from everywhere |
| `ff72965` | the Schema and Extract view logic, ported from `@robot/dashboard` with its tests |
| `6dda861`, `38180f5` | the Schema tab — the stepper strip and the grid, restyled |
| `44eb193`, `a0adab2` | the Extract tab — pages, sample, run |
| `5eb586b` | the Runs tab — extraction history, newest first |
| `3edbf42`, `0afafc6` | the run page — header, facts, controls, work list, results |
| `2461038`, `a6ba824` | the run page — empty cells, repair, the sample gate |
| `b4cd6a5`, `c6ad241` | the Settings tab — rename, listing mode, budget, delete |
| this task | the website smoke, the look-only check against Acne / Ikea, the screenshot set, these docs |

**No implementer clicked Verify, Re-verify, Sample, Extract or Check on any
website, at any point in this plan.** Every screen that only exists after a
verification or a run was proven either against a stubbed tRPC response in the
browser (task 4's results grid, tasks 7 and 8's whole run page) or, at the end,
read-only against Acne / Ikea, which was already verified. Nothing was spent.

**API changes.** One new procedure, `sources.get` — the single query the
breadcrumb, the header, all four tabs and the run page share
(`{ id, slug, name, url, hostname, datasetId, listingMode, confirmedAt, isActive,
budget, parameters, schemaDefinition, verificationSet, driftedFields, project,
fields, createdAt }`). It is scoped org → project → dataset → source, so it needs
no guard: a website in another org is unreachable because the project lookup is
already org-scoped. Two new helpers in `packages/api/src/auth/scope.ts`,
`sourceInOrg` and `runInOrg`, are now the **first statement of 25 handlers** —
before any read, any write, any `requireCertification` and any browser or model
call, so a wrong-org caller spends nothing:

- `sources` (13): `rename`, `update`, `setListingPages`, `setProductUrls`,
  `updateBinding`, `inputRows`, `verifyEstimate`, `verify`, `verificationStatus`,
  `confirm`, `delete`, `captureProofPage`, `transferMarks`.
- `runs` (2): `getWithDetails`, `listBySource`.
- `crawl` (10): `plan`, `probeAndSample`, `items`, `status`, `cancel`, `execute`,
  `coverage`, `misses`, `backfillPreview`, `backfill`.

**Still shim-only or unscoped, and why** (each migrates when its screen is
rebuilt): `sources.getBySlug / listByDataset / create`; `datasets.listByProject /
getBySlug / create / updateSchema`; all of `domains.*`; all of `scraper.*`.
Three more are unscoped for a reason rather than an omission:
`sources.findProductPages` and `sources.checkListingPage` are addressed by a URL
and name no website, so there is nothing to scope; `sources.proofPageCapture` and
`sources.suggestMarks` are addressed by a `captureId` and need a capture → source
→ org hop, ledgered to plan 5 with the mark screen. And `crawl.plan`'s
`probe: true` branch is org-scoped but deliberately **not** certification-gated —
the probe is the cheap step that tells you the schema needs verifying.

**Rulings this plan made, all deliberate:**

- **The session-less guards stay unscoped.** The brief's `sourceInOrg` opened with
  `resolveOrg(ctx, 'default')`, pinning a caller with no session to the seeded
  org. These procedures are addressed **by id alone** — unlike `projects.*` or
  `sources.get`, they carry no `orgSlug` to fall back on — so that would have
  locked the old dashboard, the CLIs and seven session-less test files out of
  everything outside `default` (measured: 12 failures in `runs.test.ts` alone).
  The guard returns early when `ctx.session` is null. The early return and the
  `| null` in the return type both go at cut-over, with the old dashboard.
- **Step 1 of the Schema tab is a read-only list plus "Edit fields".** A field
  belongs to the project, not to one of its websites, so the surface that owns it
  is one link away (spec 2026-09-18 §2.1). The website owns only the hints, the
  pages and the expected values.
- **The grid lost its tinted cells for 2 px rails** (spec §4). State is a rail
  beside the value and the colour of the second line, never a wash behind it — a
  grid of tinted cells reads as a website that has gone wrong. One exception the
  spec itself names: "changed since verified" is grey, because a stale result is
  not a problem, and a whole grid of amber sentences after one edit says
  otherwise. The rail still carries the state.
- **A "Save pages and values" button sits beside Verify.** The old screen could
  only save by verifying, which is the one control that costs money. Saving is
  free; its disabled reason is `saveButton`'s, and it invalidates exactly what a
  verify does — a save on a verified website makes the server stop counting the
  edited fields current, and without the same invalidation set the strip would
  have gone on saying "n of n verified" with Go to Extract live on a binding the
  server would refuse.
- **Re-extracting a repair is all-or-none.** The old page selected rows in the
  results sheet and filtered by clicking a column head; the new coverage bar has
  one select-all tick in front of the spender instead, with "Tick the rows first"
  beside the button until it is set. A customer who wants 3 of 12 rows cannot say
  so here. The explicit tick in front of a spend is the better gate; per-row
  selection would mean giving `results-table.tsx` a selection model. Worth a
  second opinion.
- **The Settings Name row is a 13 px row, not a 20 px title.** `InlineRename`
  took an optional `size` (`'title'` default, `'row'` for the settings list) and
  an optional `ariaLabel`, because two controls with the accessible name "Website
  name" on one page is a real defect — a screen reader cannot tell the page title
  from the settings row.
- **`runs/index.tsx`, not `runs.tsx`.** In TanStack's file routing a `runs.tsx`
  beside a `runs/` directory is the *parent* of `runs/$run.tsx`, so the Runs table
  would sit above every run's detail. The URLs and the route literals are
  unchanged.

**What the look-only check found, and what it fixed.** Two things, both caught by
looking at Acne / Ikea rather than by any test:

1. **The Extract tab contradicted itself on every real website.** Section 1
   showed Ikea's listing page labelled *saved*, and two lines below it the strip
   and the Extract button both said "Save your pages first". `pagesAreSaved`
   demanded `parameters.inputMode`, the marker this tab writes the first time it
   saves — and no website on this machine has one, because they all predate the
   tab. What the old flow *did* write is the `listingMode` column, with the rows
   in `inputRows`; together they say the same thing. A new `storedMode` in
   `lib/site/extract-screen-view.ts` (4 tests) reads both, and the segmented
   control's starting position and the gates under it now come from one value
   instead of agreeing by coincidence. Ikea's Extract tab now reads Pages ✓ /
   Sample current / Run "Sample first", which is the truth.
2. **The grid cut its hints and values mid-word with no sign.** "The currency of
   the price (code or symb" read as the sentence somebody wrote. The grid's
   inputs are fixed-width in a `table-fixed` table, and an `<input>` clips at the
   box edge rather than ellipsising unless told to: `overflow-hidden
   text-ellipsis` on the shared field class plus a `title` per input, the same
   idiom the Field cell and the second line already use. Chromium draws the
   ellipsis only while the input is unfocused, which is right — a focused one
   scrolls to the caret.

Both checks also park the pointer in a corner before every screenshot: Playwright
keeps the virtual mouse wherever the last click left it, which after a navigation
is the middle of the grid, and the captures were photographing one arbitrary row
wearing its hover hairlines.

**Everything else the check measured, on Acne / Ikea, both themes:** breadcrumb
"Markodjordjievski / Acne / Ikea"; the strip reading "8 of 8 fields verified";
8 field rows × 3 page columns, and all **24 cells** with a `border-left-color`
equal to the `pass` token resolved in that theme (`rgb(61,220,132)` dark,
`rgb(15,123,61)` light); the second lines the engine actually wrote ("page shows
RM349", "from api", "from json-ld", "from page", one "weak evidence: same value
on every page"); the Verify button reading **"Everything is verified"**, disabled,
and not clicked; Go to Extract as a live link; the Extract tab unlocked with three
strip cells and nothing `inert`; Settings' name, address, listing mode, budget and
lock state each compared against what `sources.get` returns rather than against
the screen itself; body 13 px, title 20 px/600, four tabs, zero uppercased
elements, zero non-inset shadows in dark, on each of the four tabs; no console or
page error anywhere. The check watches every tRPC request the page makes and
fails if a mutation these tabs can fire appears: the only procedures called were
`auth.signIn`, `auth.setTheme` (restored), `projects.get`, `projects.list`,
`runs.listBySource`, `sources.get`, `sources.inputRows`,
`sources.verificationStatus` and `sources.verifyEstimate`.

**The Runs table and the run page have never met real data.** No website in this
database has ever been extracted — `runs.listBySource` answers `[]` for Ikea — so
both the smoke and the Acne check photograph the empty state, and every populated
state of the run page (facts, controls, work list, results sheet, misses, the
repair panel, the sample gate) was proven against client-side fixtures in tasks 7
and 8. The check says SKIP rather than passing a test that proves nothing.
**First Extract run: capture `app-site-runs-acne-*.png` again, and the run page
for the first time.**

**The screenshot set** (`docs/testing/screens/`, 1440×900, full page):
`app-site-{schema,extract,runs,settings}-{dark,light}.png` from the smoke run — a
website that is set up and not yet verified: a filled grid, a locked Extract tab,
an empty Runs tab — and
`app-site-{schema,extract,runs,settings}-acne-{dark,light}.png` from the
look-only check, which is the set worth reviewing. Run order matters, as in plan
2: the smoke first, then `ui-check-app-project.mts` (it retakes
`app-projects-{dark,light}.png`, which every smoke run overwrites with a throwaway
organisation's table), then `ui-check-app-site.mts`. `app-login.png` and the four
placeholder pairs are restored with `git checkout --` when a smoke run has touched
them, which is what this task did.

**How to run.** `pnpm test:ui:app` is the app smoke (needs `pnpm dev:all`), now 13
tests: on top of plan 1 and 2's walk it types three product pages into their
popovers on the Schema tab, fills the hint and one expected value per page, clicks
**Save pages and values** (free — `updateBinding` writes rows and nothing else),
reloads to prove the server kept them, walks the four tabs in both themes and
round-trips a rename on Settings. The look-only check is
`cp docs/testing/ui-check-app-site.mts packages/browser/src/__ui-check.mts && cd packages/browser && pnpm exec tsx src/__ui-check.mts --email <address>`
— `--project <slug>` and `--site <slug>` point it elsewhere; its expectations live
in one `EXPECTED` object at the top.

**Gotchas worth knowing:**

- `shadcn add popover progress checkbox radio-group` did it again, twice: a
  literal `packages/app/~/components/ui/` directory and a bogus `cn` package in
  `dependencies`. Both cleaned by hand each time. Check the diff after any
  `shadcn add` in this repo.
- **`table-fixed` is load-bearing on the schema grid.** A clamped sentence in an
  auto-layout table contributes its whole string as the column's min-content
  width, so one red "This page shows 99.00…" stretched its page column across the
  screen and crushed Field, Type and the hint to three characters each.
- **A sticky table head under `border-collapse` uses an inset box-shadow** as its
  border stand-in, so any "nothing casts a shadow in dark" assertion has to
  exclude `inset`.
- **Four sibling panels keyed by `runId` is one key four times.** React said so on
  every populated run render; each panel carries its own prefix now.
- `updateBinding` is still called without `marks`, which erases them — inherited
  from the old screen (the API's whole-binding-save ruling). It belongs to
  whichever plan builds the mark screen.

**Open decisions for the design review:**

- **The all-or-none repair selection** (above) — the coverage bar's single tick
  versus per-row checkboxes in the results sheet.
- **The paste/import fast path was kept** on the Schema tab: Import CSV or XLSX
  fills rows by field name, and a tab-separated paste into any cell spreads across
  the grid. It is the one thing on these screens that is not obvious from looking,
  and it is worth deciding whether it earns its place or belongs behind the
  import button alone.
- **Six pages on a laptop.** The page column is 210 px, so a six-page website's
  table floors at 1736 px and the panel scrolls sideways from about a 1750 px
  viewport down. Intended (the container scrolls, the document does not), but it
  is a lot of scrolling.
- **The strip shows one reason at a time** — verify's, then save's, then
  Extract's. On a website that is finished it reads "Nothing has changed since the
  last verification" while Save is also off for its own reason. Right, or one line
  per control?
- Still open from plans 1 and 2 and untouched here: the red rail on "Not
  verified", two lit rows in the sidebar, the field-origin / candidate editor's
  future, no scroll affordance on mobile tables, and the `QueryClient` not keyed
  on session identity.

**Next: plan 4** — the org-wide screens `/runs`, `/usage`, `/settings` and
`/account`, which are still `ComingLater` placeholders. **Then plan 5** — the
stepper's steps 2 and 3 and the mark screen, which is also where
`sources.proofPageCapture` and `sources.suggestMarks` get their guard.

## App redesign, plan 2: the project (2026-09-21)

Spec: `docs/superpowers/specs/2026-09-21-app-redesign-design.md` §5 rows 3 to 5.
Plan and task briefs: `.superpowers/sdd/2026-09-21-app-redesign-plan2-project/`
(one report per task, with the deviations and the browser evidence). Branch
`feat/app-redesign-project`, base `main` at `886dc4d`. A project now has its own
three screens in `@robot/app`: the websites it collects from, the fields it
collects, and the output.

**What landed, one line per task** (`git log --oneline 886dc4d..HEAD`):

| Commit | What |
|---|---|
| `9d8f9d3` | `projects.get`; `projects.getBySlug/getWithStats` and `sources.listByProject/createInProject` take the org from the session |
| `4fdcbbb` | the six contract procedures (`datasets.getContract / addField / renameField / retypeField / deleteField / fieldStatus`) take the org from the session |
| `2db81d2` | `projects.output` and `GET /export/projects/<uuid>.<csv\|json>` |
| `3e56fcc` | a customer column named `Website` exports as `Website (field)`, so the merged column never eats it |
| `46b251c` | the project routes: `$project` layout, the org / project breadcrumb, the sidebar's project section, the `/projects` name cell as a link |
| `206a646` | the project home: websites table (name + host, Verified, Last run, Rows) and the Add website dialog |
| `71a4ea2`, `2c1df79` | the Fields screen: the contract edited in place beside the catalogue's chip wall |
| `dffbfad` | the Output screen: every website's latest rows under one header, and the file |
| this task | the project smoke, the look-only check against Acne, the screenshot set, these docs |

**API changes** (all additive, no procedure removed, the old dashboard untouched):
`projects.get` (the one query the breadcrumb, the sidebar section, the home and
Fields share — `{ id, name, slug, datasetId, createdAt, fields[], websites[] }`,
each website carrying `verifiedFields` and its `lastRun`), `projects.output`
(the merged sheet, rows capped at 500 with the true `rowCount`), and
`loadProjectExport` behind `GET /export/projects/:file`. Eleven procedures moved
off the caller's `orgSlug` onto `resolveOrg(ctx, …)`. **Still shim-only** — they
take the org straight from the caller's input and ignore the session, and each
migrates when its screen is rebuilt: `projects.listByOrg`;
`datasets.listByProject / getBySlug / create / updateSchema`; everything in
`sources.*` except `listByProject` and `createInProject`; all of `domains.*`;
all of `runs.*` (neither `runs.ts` nor `domains.ts` calls `resolveOrg` at all
yet). The `orgSlug ?? 'default'` fallback itself goes at cut-over (spec §7,
plan 6), together with `DEFAULT_ORG_SLUG`. One consequence until then: the
app's `useUnauthorizedRedirect` hook (every project screen and `/projects`)
is dormant, because a session-less call falls to `default` and answers
`NOT_FOUND` rather than `UNAUTHORIZED` — an expired session on a project
screen reads "This project does not exist in <org>" with a working way out
("All projects" hits the route gate and lands on `/login`). The wording
corrects itself the day the shim goes.

*(Cut-over Task 5, 2026-10-07: done, but narrower than "Eleven procedures" above.
Global Constraints named only `projects.list/create/rename/delete` — those four
dropped the fallback, so `/projects` (`projects.list`) now gets the real
UNAUTHORIZED on an expired, org-less session. `projects.get`/`output` — what a
project screen itself calls — keep their own `orgSlug ?? 'default'` fallback
unchanged, so a project screen's `useUnauthorizedRedirect` is still dormant the
way this paragraph describes. `datasets.*`, `sources.*` (except the two
dashboard-only procedures, now deleted) and `runs.*` were left exactly as this
paragraph found them — out of Task 5's named scope, each for its own live
reason. `domains.*` is gone entirely, dashboard-only.)*

**What the old Output screen had that was not rebuilt.** `@robot/dashboard`'s
Output page let a customer see, per field, where a value came from and choose
between candidate paths — the field-origin / candidate editor. Plan 2's Output
is the sheet and the file, nothing else. Whether that editor comes back at all
is **an open decision for cut-over**: it is an operator's tool wearing a
customer's clothes, and `/ops/domains` may be its real home.

*(Decided at cut-over, Marko 2026-10-06: dropped. It does not come back, and
`/ops/domains` was never built — the ops overview and website page, Tasks
2–4, replaced that whole idea with per-field certified paths in customer
words.)*

**The export route is unauthenticated by project UUID**, exactly like the run
export it copies. Anyone holding the id can fetch the file without a session.
Recorded, not fixed: plan 6 puts both routes behind the session.

*(Still open — Task 5 did not touch this. Neither export route gained a
session check; both are unauthenticated by id exactly as this paragraph
describes.)*

**What the look-only check found, and what it fixed.** One real defect, on every
locked row of Acne's Fields screen: the type read **"Mon", "Te", "Numb"**. The
tooltip wrapper around a certified field's disabled select was an `inline-block`,
and a shrink-to-fit box cannot measure a `w-fit` flex child whose own max-width
is a percentage — Chromium sized the wrapper 13 px narrower than the trigger
wanted, and the trigger's own `max-w-full` then clamped the value to that wrong
width. Measured with a DOM probe (wrapper 58.19 px vs trigger 71.19 px) and four
candidate fixes tried in the live page before one was written. The wrapper is now
a `block` that fills the cell, so the trigger is free to hug its value as it does
on an unlocked row; the focus ring moves onto the trigger with it, written out as
`outline: 1px solid var(--text)` because the trigger's own `outline-none` has
already set the outline *style* to none and a width alone draws nothing. Nothing
else in either theme needed changing.

**Everything else the check measured, on Acne, both themes:** breadcrumb
"Markodjordjievski / Acne"; the sidebar's project section listing Ikea with its
dot; "All 8 verified" with a rail whose `border-left-color` equals the `pass`
token resolved in that theme (`rgb(61,220,132)` dark, `rgb(15,123,61)` light);
eight field rows, every "Verified on" reading "1 of 1 website" and every type
select disabled; body 13 px, title 20 px/600, zero uppercased elements, zero
shadows in dark, on each of the three screens; no console or page errors
anywhere. The file: `projects.output` puts `Website` first (9 columns), and
`GET /export/projects/<uuid>.csv` answers 200 with
`content-disposition: attachment; filename="acne-2026-09-22.csv"`.

**Output has never been seen with rows in it.** No project on the dev database
has a run: the only two rows in `runs` are completed newegg runs from
2026-08-26 whose `sources` predate datasets (`dataset_id` is null), so they
belong to no project and no Output can show them. An Extract has never been
clicked on a project website, which the plan-1 handoff already lists as the next
work. So Acne's Output shows its empty state,
its two downloads are disabled buttons, and the populated layout has only ever
been checked against a mocked `projects.output` (task 7's report). The check
says so in its own output rather than passing a test that proves nothing, and it
verifies the file through the API instead. **First Extract run: capture
`app-project-output-acne-*.png` again.**

**The screenshot set** (`docs/testing/screens/`, 1440×900, full page):
`app-project-{home,fields,output}-{dark,light}.png` from the smoke run — a brand
new project, one website, one field, no rows — and
`app-project-{home,fields,output}-acne-{dark,light}.png` from the look-only
check, which is the set worth reviewing: a fully verified project is a state no
throwaway project can reach. The check also **retakes `app-projects-{dark,light}.png`**,
because every smoke run overwrites those with a throwaway organisation's empty
table; run it after the smoke, not before. `app-login.png` and the four
placeholder pairs are restored with `git checkout --` when a smoke run has
touched them, which is what this task did.

**How to run.** `pnpm test:ui:app` is the app smoke (needs `pnpm dev:all`): it
signs in as a throwaway `smoke-<timestamp>@example.com`, creates a project, adds
`https://www.example.com/` through the Add website dialog, clicks one catalogue
chip, walks the three project screens in both themes and deletes its project
again (the cascade takes the website and the field). The look-only check is
`cp docs/testing/ui-check-app-project.mts packages/browser/src/__ui-check.mts && cd packages/browser && pnpm exec tsx src/__ui-check.mts --email <address>`
— read-only against a real account, `--project <slug>` for something other than
Acne (its expectations live in one `EXPECTED` object at the top).

**Design deviations tasks 5 to 7 made, and why** (all visible in the captures):

- **The Verified rail is on the label, not on the cell** (task 5). A cell-height
  `border-l-2` in every row stacks into one unbroken vertical line down the
  middle of the table — a column divider that changes colour, which is the
  "state as a wash" §4 forbids. It is now a ~20 px tick beside the label.
- **A missing project is not red** (tasks 5 to 7). "This project does not exist
  in <org>." is a wrong address, not a failure; red stays for things that broke.
  It keeps `role="alert"`.
- **`nameRefusal`** (task 6): a duplicate field name is reported in the
  customer's own words ("There is already a field called price.") for the inline
  rename as well as the dialog. Everything else stays cause-neutral.
- **The locked type select keeps full contrast** (task 6): `disabled:opacity-50`
  over a 13 px label goes under 4.5:1, and the type is data the customer still
  has to read. Only the chevron dims; what goes away is the affordance.
- **The Fields screen reads its contract from `useProject()`**, not from
  `datasets.getContract` (task 6) — one cache key feeds the breadcrumb, the
  sidebar, the home and this screen. `getContract` is never mounted.
- **Output's empty state is one sentence with no summary bar** (task 7): the bar
  above it would have said "No rows yet" a second time.
- **Output's scroll container is capped in height from `md`** (task 7): a
  `sticky` head inside a box that scrolls only sideways does nothing, and a
  page-length horizontal container parks its scrollbar under row 500. The cap is
  a hand-measured `calc(100svh-190px)`; if the header or title row changes
  height, that literal has to follow.

**Gotchas worth knowing:**

- `shadcn add select` wrote to a literal `packages/app/~/components/ui/`
  directory (the `~` alias is not a path) and added a bogus `cn` package to
  `dependencies`. Both were cleaned up by hand. Check the diff after any
  `shadcn add` in this repo — the same family as the existing relative-import note.
- Chromium counts a grid item's `min-width` floor into the *document's* scroll
  area even when the item scrolls internally: the Fields screen scrolled 126 px
  sideways on a phone until the table panel got `overflow-x-clip` (`clip`, not
  `hidden` — `hidden` makes it a scrollport and takes the sticky head with it).
  Any future screen that puts one of these tables in a grid will hit it.
- A `<span tabIndex={0}>` wrapped around a control to carry a tooltip must not
  shrink-wrap it (see the type-select defect above).

**Open decisions for the design review:**

- **The red rail on "Not verified".** A website that has simply not been verified
  yet wears the same `fail` colour as one that went wrong. It is the first thing
  on a new project's home (`app-project-home-dark.png`) and it reads as an error
  on a project that has done nothing wrong. A fourth, quieter state may be right.
- **Two lit rows in the sidebar.** Inside a project, "Projects" stays lit in the
  org-wide nav while "Websites" is lit in the project section — TanStack's prefix
  matching, and arguably right (you *are* in the Projects area). Plan 1's review
  left it; it is more visible now that the project section exists.
- **The field-origin / candidate editor** (above) — rebuilt, moved to `/ops`, or
  dropped.
- Two "Add your own" buttons can be on screen at once on Fields (the title action
  and the Custom tab's). Both are `outline`, so neither competes as a primary,
  but the project home deliberately hides its title action when the empty state
  carries the same button.
- Still open from plan 1 and untouched here: no scroll affordance on mobile
  tables, and the `QueryClient` is not keyed on session identity.

**Next: plan 3 — the website.** Schema step 1, Extract, Runs, the run detail and
Settings. Website rows on the project home and the website lines in the sidebar
become links then; they are deliberately plain text until they have somewhere to
go.

## App redesign, plan 1: the shell (2026-09-21)

Spec: `docs/superpowers/specs/2026-09-21-app-redesign-design.md` (approved in
conversation). Plan and task briefs: `.superpowers/sdd/2026-09-21-app-redesign-plan1-shell/`.
Branch `feat/app-redesign-shell`, base `4a4b0ac`. The warm-paper proof-sheet look
was rejected outright on 2026-09-21; the customer surface is being rebuilt as a
dark, monochrome tech console (AI Studio / Vercel register) in a new package,
with an organisation and user model under it. `@robot/dashboard` keeps running
untouched on :3456 until parity, then goes (spec §7).

**What landed, one line per task** (`git log --oneline 4a4b0ac..HEAD`):

| Commit | What |
|---|---|
| `94f8e8a` | `users`, `memberships`, `sessions`; `orgs.personal` and `orgs.owner_user_id` |
| `ea98f12` | sessions, the `auth` router, and the `orgSlug` shim that keeps the old dashboard working |
| `b16ee4a` | adoption keeps the `default` slug; sign-in picks an org the user still belongs to |
| `ccd5d9a` | `orgs` router with roles; projects live in the session's organisation |
| `2c481e8` | `projects.delete` keeps the session-less default-org fallback |
| `6d915eb` | the `robot_session` cookie in and out of `@robot/api-server`; CORS for :3000 |
| `d187573`, `be8a2d9` | sign-in never adopts `default`; adoption becomes an explicit script (see *the incident*) |
| `6f9791d` | `@robot/app`: TanStack Start, tokens, themes, Geist, the tRPC client, `/login` |
| `c866c33` | `--muted` is never a text colour; the theme-boot hydration warning suppressed |
| `dd81020`, `fa19367` | light `warn` becomes `#a26000`, so every text colour clears 4.5:1 |
| `6ada990` | the shell — sidebar, org switcher, user menu, ⌘K, the projects table, the RunDot |
| `5bcb5e5` | a signed-out account's data never reaches the next one (`queryClient.clear()`) |
| `575f681` | `adopt-default` moves the user's sessions and drops the empty auto-created org |
| this task | the app smoke, the look-only check, the screenshot set, these docs |

**API changes** (all additive, `packages/api/src/routers/`): `auth.signIn / signOut /
me / switchOrg / setTheme`; `orgs.create / rename / delete / members.*`;
`resolveOrg(ctx, fallbackSlug)` in the customer procedures, which takes the org
from `ctx.org` when a session exists and otherwise from the `orgSlug` input. That
fallback — `orgSlug ?? 'default'` in `projects.list / create / delete / rename` — is the
**shim** that keeps `@robot/dashboard` working while both apps run; the cut-over
plan (spec §7, plan 6) deletes it together with `DEFAULT_ORG_SLUG`. Those four
are the only procedures that resolve the org at all so far: `projects.getBySlug /
getWithStats / listByOrg`, `sources.*`, `datasets.*` and `domains.*` still take
the org straight from the caller's input and ignore the session, and each
migrates to `resolveOrg` when its screen is rebuilt in plans 2–4. Migration:
`packages/db/drizzle/0010_identity.sql`.

*(Done, cut-over Task 5, exactly as predicted: `projects.list/create/delete/rename`
dropped `orgSlug ?? 'default'`, and `DEFAULT_ORG_SLUG` is gone with
`@robot/dashboard`, the only place it lived. `projects.getBySlug`/`getWithStats`
are deleted too, dashboard-only. `domains.*` is deleted whole. `sources.*` and
`datasets.*` still resolve the org the way this paragraph describes — unchanged,
each for its own reason, see the note above.)*

**The incident (read before touching the dev database).** While executing an
earlier task of this plan, an implementer signed in ad hoc against the dev
database. Sign-in then *adopted* the seeded `default` org, and the cleanup that
followed deleted **that org** — which cascades to everything under it and so
took **every project with it**. (Deleting the user alone would not have done it:
`orgs.owner_user_id` is `on delete set null`. It was the org row that went.) The
data was rebuilt from the cached certified paths at $0 (nothing paid was lost),
but the rules changed:

- adoption of `default` is never automatic. It is the explicit script
  `pnpm db:adopt-default -- --email <email>` (`packages/db/src/scripts/adopt-default.ts`).
- no implementer runs sign-ins, deletes or cleanup scripts against the dev
  database. Browser sign-ins through `/login` with a throwaway
  `smoke-<timestamp>@example.com` address only; an org is never deleted, and the
  org whose slug is `default` is never touched.
- backups live in `C:\Users\Marko\Documents\projects\robot-platform-backups\`
  (`pg_dump` before any identity work).

**Spec amendments made while executing** (all written into the spec): adoption is
a script, §2; light `warn` is `#a26000`, §4; `--muted` is a divider/placeholder
colour and never a text colour. Two rulings were added to the adopt script on
2026-09-21: after adoption every session of that user is repointed at the adopted
org (so an open browser lands on the projects, not on an empty org), and the
personal org `signIn` auto-created seconds earlier is dropped — but only when it
is provably the empty shell (slug not `default`, personal, owned by that user, no
project, no cached extractors — those are org-scoped and would cascade — and no
other member). Otherwise it is kept and the script says why.

**The first sign-in on the dev database, done 2026-09-21** (the one live proof of
the adoption path):

```
browser, /login, markodjordjievski@gmail.com  -> user created + empty personal
                                                 org "Markodjordjievski"; /projects empty

pnpm db:adopt-default -- --email markodjordjievski@gmail.com
  org "default" (c812f66e…) is now personal, owned by markodjordjievski@gmail.com, named "Markodjordjievski"
  membership: created
  sessions moved to this org: 1
  dropped the empty personal org "markodjordjievski"

select slug, name, personal, owner_user_id from orgs
  default | Markodjordjievski | t | ccf03067-23e7-4557-877b-1d3a231b960b
  (plus the throwaway smoke-* orgs)

browser again: switcher lists exactly one organisation ("Markodjordjievski", Owner);
the projects table lists Acne (1 website, 8 fields) and Scratch;
auth.me -> currentOrg { slug: "default", name: "Markodjordjievski", personal: true, role: "owner" }
```

**How to run.** `pnpm dev:all` now starts **three** servers: api-server :4000,
the old dashboard :3456 and the new app :3000. `pnpm test:ui:app` is the app's
Playwright smoke (needs all three up; signs in through `/login` as a throwaway
address, walks every screen in both themes, creates and deletes one project).
The look-only check is
`cp docs/testing/ui-check-app-shell.mts packages/browser/src/__ui-check.mts && cd packages/browser && pnpm exec tsx src/__ui-check.mts <outDir> [email]`
— with an email it measures that account's data instead of an empty throwaway org.

**The screenshot set for Marko's review** (`docs/testing/screens/`, 1440×900,
full page): `app-login.png`, and `app-projects`, `app-runs`, `app-usage`,
`app-settings`, `app-account` each as `-dark.png` and `-light.png`. The two
`app-projects-*` were retaken against the real database, so they show Acne and
Scratch rather than an empty throwaway org.

**What the look-only check measured, and what it fixed.** Measured on the real
data, dark: sidebar 240 px, body 13 px, page title 20 px/600, tallest table row
37.00 px, uppercase elements 0, shadowed elements 0 (also with the dialog and its
overlay open), running dot `pulse-dot 1.6s` at 8 px. Three things the screenshots
changed: `app-login.png` was a **blank page** because a headless browser starts
the page-load `.rise` animation only on the frame the screenshot itself provokes,
so the capture froze the `opacity: 0` keyframe — every capture now passes
`animations: 'disabled'`; the user menu's **Theme** item sat 18 px left of
*Account* and *Sign out* because it alone had no icon, and now has one; and the
shadow rule is now also asked with the dialog open, since a page with nothing
floating over it has no shadow to find.

**Open decisions for the design review:**

- a signed-out `/login` is always dark, because a visitor has no stored
  preference and the OS one is not read there. Confirm with Marko, or read
  `prefers-color-scheme` on that one screen.
- the `QueryClient` lives in `Providers`, one per browser session, and three
  exits remember to clear it. Keying it on the session identity
  (`<Providers key={session?.user.id}>`) makes that structural — worth doing in
  plan 2, when a screen caches more than one list.
- the org switcher truncates a long organisation name because the "Personal"
  badge and the chevron take fixed width ("Markodjordjiev…"). Spec §3 asks for
  the tag, so it stands until Marko says otherwise.
- a placeholder is `--secondary`, the same grey as its label, because `--muted`
  misses 4.5:1 on every surface. An empty field therefore reads a little like a
  filled one.
- the focus ring is a 1 px outline in `--text` at 2 px offset, not the
  `--border-hover` the plan asked for: `#333333` on `#0a0a0a` is all but
  invisible, and a focus ring that cannot be seen is not one. It is crisp and has
  no glow, so it stays inside the system's register — but it is brighter than the
  plan intended and Marko should look at it.

**Deferred by the final review** (each named for the plan that owns it): plan 2 —
the `QueryClient` keyed on session identity; the org filter on `projects.list`'s
source and run queries (today they scan every org's rows, then keep only the
org's own project ids); a scroll affordance on mobile tables; multiple
`Set-Cookie` in one tRPC batch untested. Plan 4 — sessions are never pruned; a
failed `setTheme` is silent; `data-theme` is frozen at page load, so signing out
of a light account and into a dark one in the same tab keeps light until a full
reload (re-key the freeze on the user id); a second owner can never be demoted
or removed (`orgs.setRole/remove` refuse every owner). Plan 6 —
`@robot/api/test-helpers/identity` is a public export of a test-only module
(it imports vitest); the sign-ins in `orgs.test.ts` and `projects.test.ts` sit
outside their `try`, unlike `auth.test.ts`.

*(Still open — cut-over Task 5 did not touch either: it is test-hygiene
unrelated to deleting `@robot/dashboard`, not in the plan's Global
Constraints or File map.)*

**Next: plan 2** — project home, fields, output (spec §5 rows 3 to 5).

## Schema stepper, engine (2026-09-18)

Spec: `docs/superpowers/specs/2026-09-18-schema-stepper-with-marks-design.md`
(approved). Plan: `docs/superpowers/plans/2026-09-18-schema-stepper-engine.md`
(spec §7 items 1 and 2; the screens, items 3 to 6, are separate plans still to
write). Branch `feat/schema-stepper-engine`, eleven tasks, each reviewed;
whole-branch review at the end. The idea: a customer marks a field by clicking
it on a screenshot of a proof page instead of typing its value; the click gives
the expected value plus the element's XPaths as one more candidate, and
certification is otherwise unchanged. No model anywhere in the stepper
(TypeSafe/Jev was considered and rejected for it, see spec §1).

What landed, one line per task: `CaptureOptions.annotate` (a page script run
once after the expand rounds, its value on `PageCapture.annotation`) and
`maxTiles`; the box map (`box-map.ts`: every visible element with its own text,
plus images and links, with the generator's XPaths and page-pixel rects);
`buildProofPageReadyCheck` (stable text plus one structured source), the shared
`captureProblem`, and `captureProofPage` (six tiles); `Mark` and
`VerificationSet.marks`, folded into `fieldHash`/`definitionHash` (byte-identical
without marks) and into `gatherCandidates` (a marked page takes the mark's
XPaths instead of the DOM search); `suggestMarks` (JSON-LD → meta → API,
shallowest path wins, boxes matched by `valuesEqual`); `transferMarks` (page 1's
candidates tried on the other pages in certification's order, stable first);
`capture-store.ts` and the proof-page capture job on the `captures` table
(`metadata` is the `capturing`/`captured`/`failed` state machine, tiles as PNGs,
`contentHeight` = bottom of the lowest box, NOT the captured height);
verification reuses a fresh proof-page capture; `updateBinding` accepts `marks`
(a mark on a blank cell is refused); the procedures `sources.captureProofPage`,
`proofPageCapture`, `suggestMarks`, `transferMarks`.

Spec amendments made while executing (all written into the spec): the API
keeps requiring a location hint per field (the screens send the catalogue
description or the field name); `proofPageCapture` returns three heights —
`pageHeight` (the document), `capturedHeight` (what the tiles cover; the viewer
says "page cut at N px" when the page is longer) and `contentHeight` (the
lowest box's bottom edge) — and boxes below the captured strip are dropped;
`suggestMarks` and `transferMarks` answer with the `captureId` their box
indices refer to, and a target page with no fresh capture comes back `null`;
a `capturing` row older than three minutes is closed as `failed` / `stalled`;
a mark whose text no longer equals its cell's value is dropped on save.
**`updateBinding` is a whole-binding save**: a client that omits `marks`
erases them, so the stepper and Import values must both round-trip marks.

Known risk, parked with a ruling (whole-branch review, item 5): verification
that reuses a proof-page capture skips its own ready check, which waits for
the typed values; a proof-page capture waited only for stable text plus one
structured source. A field the customer typed rather than marked can be
absent from that capture and read `not_found` where a fresh capture would
pass. Mitigation when it shows up: re-capture only the pages where a field is
`not_found` on a reused capture.

Live check, 2026-09-18, free (keyless api-server on :4100, nothing written to
the Ikea binding): `docs/testing/2026-09-18-proof-page-capture-live.md`.
Captures 14.7 / 16.8 / 16.3 s per page, six tiles, 252 to 288 boxes.
`suggestMarks` on page 1: price, total reviews and rating right with the
element outlined (the price box checked by eye on the tile), title right
after a same-day fix (the BreadcrumbList block's `name` had beaten the
Product's), `price_currency` and `subtitle` wrong for reasons outside this
plan, `product_id` and `product_details` none. `transferMarks` to pages 2 and
3: 8 of 8 and 7 of 8 fields, 8.9 s. Follow-ups in that file: `deriveConcept`
makes `price currency` a `price` and gives `product_id` no alias; the
unknown-concept fallback matches API translation strings; a value spread over
child elements gets no box.

Next: the screens. Plan order per spec §7: catalogue and step 1, step 2 with
background captures, step 3 (the mark screen), then the proof-sheet controls,
arrivals and the smoke run.

## Schema stepper, step 1 (2026-09-19)

Spec: `docs/superpowers/specs/2026-09-18-schema-stepper-with-marks-design.md`
§2.1. Plan: `docs/superpowers/plans/2026-09-19-schema-stepper-step1-fields.md`.
Branch `feat/schema-stepper-step1`, six tasks, each reviewed. The Schema tab is
a stepper now: **1 · Fields** (the catalogue) and **2 · Pages and values**
(today's proof sheet, standing in for spec §2.2 and §2.3 until they land).

What landed, one line per task: `packages/api/src/schema-catalogue.ts` and
`datasets.catalogue` — 24 for Product, 12 to 20 for the others, grouped, each carrying
the engine `concept` so a catalogue field suggests and caches without
`deriveConcept`'s name guessing; `datasets.addField` takes `description` and
`concept`, and the description becomes every website's default location hint;
`src/lib/schema-stepper-view.ts` (`stepOf`, `stepStates`, `sharedNote`,
`addNote`) as pure decisions; `src/components/field-catalogue.tsx` — a schema
type row with a 2px rail, then labelled rows of chips, a chip already in the
contract reading "added" and disabled — wired into `ContractEditor`, so the
project home's field list offers the same catalogue; `src/routes/source-schema.tsx`
as the two-step stepper (`?step=fields|pages`, the grid as interim step 2) with
`reconcileRows` carrying a field added, renamed, retyped or deleted in step 1
down onto the grid's rows without losing typed cells; and this look-only
browser check.

From the whole-branch review, also landed: `datasets.addField`, `renameField`,
`retypeField` and `deleteField` re-read the dataset row `FOR UPDATE` inside
their own transaction and compute the new schema from that (two chips clicked
in a row used to lose one field — both calls appended to the same
pre-transaction copy), with concurrent-add tests; step 1 renders `locked`
("Fields are locked while verifying") for the length of a run, because a field
added mid-run makes the paid run not-current the moment it ends; and a `done`
section is `inert`, so a finished step is read-only until Edit.

Three amendments made while executing, recorded here rather than in the spec
(spec §2.1 still describes the intent, not these details): `datasets.catalogue()` takes
no input and returns every type in one object (the client picks; the list is a
static module, so there is nothing to save by asking per type); the
proof sheet's "Edit fields on the project page" sentence is gone — step 1 sits
directly above the grid, so the errand it sent the customer on no longer exists;
and §2.1's "20 to 30 entries per type" was relaxed to 12 to 20 for every type
but Product — a listing card or an event page simply has fewer fields worth
suggesting, and padding the list to 20 would mean inventing them. A test in
`schema-catalogue.test.ts` enforces both ranges.

The look-only browser check (`docs/testing/ui-check-schema-step1.mts`, five
screenshots in `docs/testing/screens/`, 27 assertions, all green) found two
things unit tests cannot see, both fixed:

- **Adding the first field silently finished step 1.** The step is a search
  param, and with no `?step` at all `stepOf` answers `pages` the moment the
  project has a field — so the customer's own first chip faded the catalogue
  they were still picking from to `done` and made "Next: pages" a no-op.
  `source-schema.tsx` now pins `?step=fields` (replace) the first time the tab
  opens on step 1 by itself; the Add website dialog already pinned it (§2.5).
- **Wrapped chips did not line up.** The group label was the first item of the
  same `flex-wrap` row, so on the project home's narrow left column a second
  line of chips started under the label. The label is its own column now and
  the chips wrap inside theirs.

Left alone, for the redesign of step 2 to settle: the grid's "Where it is on
this website" column is 240px, so the longest catalogue hint ("The product name
as shown in the page heading") is clipped in its input.

Next: **step 2 — pages with background captures** (spec §2.2): a listing URL
that fills three proof-page slots, `sources.captureProofPage` running per slot
in the background with a thumbnail, Swap and Try again, and Next enabled once
every slot has a landed capture.

## Second-layout proof pages (2026-09-17)

Spec: `docs/superpowers/specs/2026-09-17-second-layout-proof-pages-design.md`.
Plan: `docs/superpowers/plans/2026-09-17-second-layout-proof-pages.md`. This is
the cheap increment the 2026-09-11 second-layout-learning note called for.
Landed: a website may carry three to six proof pages instead of exactly three
(Schema tab: an "Add page" column, "Remove this page" on pages four to six,
"not checked" for a blank cell there). A field certifies when a set of at most
five paths together covers every page it is checked on, where a path is safe
only if it is correct or resolves to nothing on every page it touches — a path
wrong on any checked page is never certified, so a second layout can only add
coverage, never launder a bad path. A one-layout website certifies exactly as
before. When more than one layout is needed, each certified path carries
`provenOn` (the pages it was proven on), and the field carries
`thinEvidence: true` if some path is proven on only a single page. `fieldHash`
and stored-result reuse are per field, over the pages that field is checked
on, so adding a page for one field leaves every other field's certification
untouched, and a field with a value on every page keeps its existing hash and
stays current. `crawl.misses({ runId })` groups a run's empty cells by field
and by the listing each missed product came from
(`run_items.input_values.url`); the run page lists them per field with "Use as
proof page", which pre-fills the Schema tab via `?addPage=<url>&field=<key>`
(waiting if the table is locked by a running verification).
`crawl.backfillPreview` reports `certified` with a zero cost estimate for an
already-certified website, and offers no dead-field strategy. Not built:
automatic discovery of a second layout's path without an expected value, using
the other missed pages as unlabelled evidence, a blank on pages one to three
meaning "not on this product," or speeding up verification's own captures. A
real second-layout website has not been run through this flow live yet.

Live check, 2026-09-17, free by construction (a second api-server started with no `ANTHROPIC_API_KEY`, driven over tRPC; Marko's own dev servers untouched): a fourth Ikea product page was added with only `price` typed. On save, 7 of 8 fields stayed current and only `price` went stale; the estimate counted `price` as AI-reachable (`aiFields: 1`, $0 with no key); verifying `price` alone passed on all four pages with no `provenOn` and no thin-evidence flag (Ikea has one layout), and the other seven fields were not re-run. It took 346 s because verification still captures with `networkidle` (four pages at ~70 s on Ikea; the certified-run speed fix does not cover verification). The website was then restored to its three pages (verify 5 s on fresh captures, 8 of 8 current). A look-only browser check of the Schema tab and the run page found and fixed three defects no unit test could see: a cold load of the `?addPage` link applied the page to the placeholder grid before the website's data loaded; the Add page control sat off-screen in the scrolling table (there is now an "Add proof page" button beside the import); and `crawl.misses` counted never-extracted products as empty cells (it now counts only products that produced a row). The look-only browser check is kept at `docs/testing/ui-check-schema-arrival.mts` (its header says how to run it; it is hard-wired to the Acne / Ikea website and never clicks Verify); the UI smoke does not cover the arrival link yet.

A whole-branch review on the most capable model then found two defects sitting between tasks, both fixed (`b88097c`, `7d00089`): the AI fallback was handed pages a field is not checked on, with a blank expected value (never exercised, since every live check ran keyless); and removing page four while a page five exists could write the removed URL onto page five, because the header popover stayed open with a stale draft. The same wave made the run page's missed-products list survive the moment the customer saves a fourth page (`crawl.misses` now reports `proofSheet`; the website is uncertified until that verify passes).

**Follow-ups this work surfaced, in the order I would take them:**

1. **What "resolves to nothing" means.** `certify` treats a path as unsafe if it yields any non-empty value that is not the expected one, including a value that fails the field's type (the price path reading "Out of stock" on the second layout). Extraction skips exactly those values and falls through, so they could safely count as nothing. Today such a page blocks the second layout and uncertifies the website. It fails closed and matches the approved spec wording, so it was left alone: it is a spec decision.
2. **The failure reads badly.** When a path is wrong on page four, pages one to three say "Several places match" (the old three-page wording). A neutral line there would point the customer at page four.
3. **The AI path on more than three pages has never run live**, and `EST_AI_COST_PER_FIELD_USD` is flat per field while the prompt grows with each checked page. Exercise it once under the budget rule and decide whether the estimate scales.
4. ~~Verification captures still wait for `networkidle`.~~ **Done 2026-09-17.** A proof page is now captured with `load` plus a ready check built from the values typed on that page (`buildVerificationReadyCheck` in `packages/scraper/src/verify/verification-ready.ts`): the page is ready once every typed value can be found, by the same DOM search and structured search verification runs afterwards. It polls after the popup and "show more" rounds (`ReadyCheck.when: 'after-expand'`), because some values only exist in the DOM once those have run, and then takes a short grace (no new response for 750 ms, capped at 3 s) so an API response landing just after the value is visible is not missed. Measured on Ikea's three proof pages, no key, nothing written: about 70 s per page before; 8.4 s per page after (16 s for the first, a cold load), ready on the first poll each time, grace 0.8 to 1.1 s, all eight fields pass with no AI, and seven of eight certify exactly the stored paths (the eighth differs only by a build hash in a backup XPath, see 8). A value that never appears costs the bounded 8 s poll plus at most 10 s, not 60 s.
5. Paste of a six-column block onto a four-page grid is ambiguous (name, type, description, three values versus name, description, four values); the file import was made tolerant, the paste path was not.
6. Small UI items: a sticky field-name column (focusing page four scrolls it out of view); `disabled` instead of `pointer-events-none` on the Import and Add proof page buttons while the table is locked; `?addPage` stays in the URL after it is consumed; the look-only browser check for the arrival link (`docs/testing/ui-check-schema-arrival.mts`) is a manual script, not part of the UI smoke.
7. A real website with two layouts has not been through this flow yet.
8. ~~Certified XPaths lean on attributes that change when the site redeploys.~~ **Done 2026-09-17**, and it took four rules, not one, because each fix exposed the next weakness on Ikea's `subtitle` (whose only certified path was anchored on `data-skapa="price-module@11.1.8"`):
   - **`looksVolatile`** (`dom-scripts.ts`): the generator skips ids, data-* values and class tokens that look generated: build hashes (`634a7e0`), version stamps, long numbers, CSS-module and CSS-in-JS names, React `:r1:`, and state values (`true`, `0`). The last was added when, with the version stamp skipped, the generator anchored on `data-online-sellable="true"`.
   - **Several anchors per element.** One page cannot tell a stable anchor from a product-specific one (`data-product-name="KIVIK"`). The generator now offers up to three XPaths per element, nearest anchor first, then the next one up, then the body-rooted path, and the proof pages decide.
   - **Class lists with state in them are matched on their stable base.** Ikea's price module is `… pipcom-price-module--bti` on one sofa and `--none` on the next, so an exact class match gave the same element a different XPath per product. A list with a BEM modifier or a state token is now matched as `contains(concat(" ",normalize-space(@class)," ")," base ")`; a plain list keeps the exact form, so existing XPaths look as they did.
   - **A cover is not made of one-page paths** (amends the 2026-09-17 second-layout spec §3). Before the two rules above, the cover rule had certified `subtitle` with three XPaths anchored on the three proof pages' own product names: each safe, together covering every page, and matching no other product. A cover's strongest path must now be proven on at least two pages.
   Certification also prefers stable paths: `certify` tries the stable candidates alone and falls back to volatile XPaths only when nothing else certifies (a fragile column still beats an empty one), and a re-verify no longer takes the cached shortcut when the cached certification rests on a volatile XPath. Checked on Ikea with no key and nothing written: all eight fields pass, no volatile XPath remains, and the newly generated XPaths for `subtitle`, `title` and `product_details` returned the right value in 45 of 45 checks on five products they were not built from. **Ikea's STORED certification still holds the old paths** until that website is re-verified, and the Schema tab will not offer a re-verify because nothing on it changed; there is no "re-verify everything" control yet.
9. **The other customer-facing captures still wait for `networkidle`** and pay the same 60 s on a site like Ikea: the listing check and "Find pages" (`sources.ts`, two calls) and planning's listing captures (`plan-run.ts`; the Ikea plan took 86 s for two listing pages). They need their own ready check (enough product links found), which is a smaller job than this one was.

## MVP flow phase 1 (2026-09-08): routes and shell landed; phases 2 to 5 follow the spec

Spec: `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md`. Plan for this phase:
`docs/superpowers/plans/2026-09-08-mvp-flow-phase1-routes-and-shell.md`. What changed: `/projects`
is home; every customer route moved from `/p/…` to `/projects/…` with redirects kept
(`packages/dashboard/src/lib/legacy-routes.ts` is the table); operator cache views moved to
`/ops/domains`; the wizard landing page is gone; a project is created by name
(`projects.create` also makes its dataset) and a website by name inside it
(`sources.createInProject`); both are renameable inline; `sources.updateSchema` now keeps the
source's input set in step with the schema (listing URL → one listing row, else the three product
URLs as detail rows). Scratch is an ordinary project. `createWithSchema` and `quickCreate` still
exist and are removed in phase 2 with the project-level field list.

Next: phase 2 (contract on the dataset, per-field certification), then 3 (Schema tab), 4 (Extract
tab), 5 (visual system), each as its own plan.

## MVP flow phase 2 (2026-09-09): contract on the dataset

Spec: `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md` §12 item 2. Plan:
`.superpowers/sdd/2026-09-09-mvp-flow-phase2-contract-on-dataset/`. Field name and type now live
on the project's dataset (the contract), not on the website: `datasets.schema` is an array of
`ContractField` entries — `{ key, name, type, concept }` — with a stable `key` derived once from
the name and never recomputed on rename, so a field keeps its identity across a rename or a
retype. `datasets.addField`, `renameField`, `retypeField`, and `deleteField` mutate that array and
propagate the change to every website in the project; `datasets.fieldStatus` and `getContract`
read back the per-field state (name, type, concept, and "verified on n of m websites") that the
project home's editable field list and the Schema tab both use. `sources.updateBinding` replaced
`sources.updateSchema` and now owns only a website's own state: its location hints (description
per field), its three proof pages, and the expected values typed on them — never the field's name
or type, which the Schema tab now locks and links back to the project page instead of letting you
edit inline. `sources.createInProject` seeds a new website's bindings straight from the project's
current contract, so a website is never created with an empty or divergent field list.
`sources.createWithSchema` and `sources.quickCreate` — phase 1 leftovers that let a website define
its own fields — are removed. Certification is current per field rather than for the source as a
whole: each verification result carries a `fieldHash` (derived from that field's key, type,
description and concept, plus its binding's proof pages and that field's expected cells —
deliberately excluding `name`, since a rename is free per spec §4.3), and
`verificationStatus.currentKeys` is the set of field keys whose stored result's `fieldHash` still
matches the field's current definition. A retype (or a proof-page/expected-value edit) after a
website was verified falls out of `currentKeys` for that website until it is re-verified — free,
since a re-verify replays the same proof pages against the new definition.

`pnpm db:lift-contracts` migrates pre-phase-2 data: it lifts each project's existing per-website
fields into that project's (until-now-empty) dataset, so existing projects get a contract instead
of starting over. **It has been run once on this machine**, during Task 6 of this plan. Its final
run here printed `datasets updated: 0; projects given a dataset: 0` — not because there was
nothing to lift, but because the lift had already happened earlier in the same test run; the
run that actually did the lifting is the one the summary line describes as having found the one
real conflict it flagged for hand review: the dataset for the Scratch project, field `price`,
**kept `money` and ignored `number`** from one Scratch source. That conflict is parked for hand
review, not auto-resolved. Every website that existed before this lift needs **one free re-verify**
to become current again — the lift populates the contract and the bindings, but a stored
verification result's `fieldHash` predates the lift and won't match until the website is
re-verified against its now-contract-derived field definitions.

## MVP flow phase 3 (2026-09-10): the Schema tab is the table

Spec: `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md` §5.6. Plan:
`.superpowers/sdd/2026-09-10-mvp-flow-phase3-schema-tab/`. The Schema tab (`source-schema.tsx` +
`SchemaGrid`) is now the table itself — no separate grid screen and no ghost row; paste and
CSV/XLSX import both match cells to rows by field name only (unchanged from phase 2). Field and
Type are read-only in this table (they live on the project's dataset since phase 2) with a note
pointing back to the project page for edits.

Page URLs moved from the old "Product URL 1/2/3" input row into the table's own column headers
(`PageHeaderCell`): each header shows the shortened path, a per-column capture-state icon
(`idle`/`queued`/`capturing`/`captured`/`not_captured`), and — unless the table is read-only or
locked by an in-flight run — a pencil (`aria-label="Edit page N"`) that opens a popover to retype
the URL directly, or to type a listing-page URL and "Find pages", picking one of the results with
"Use as page N". Editing a page URL there marks the whole grid stale via the existing
`isRowStale`/`reverifyKeys` machinery — a URL change re-verifies *everything*, not just that
column; this is stricter than necessary but deliberately kept (every stored cell result is keyed
to the URL it was proven against, so a moved column has no safe partial reuse). **The listing URL
is no longer edited on this tab at all** — phase 4 gives it a proper home on the Extract tab.
Nothing was dropped to make room for that: the binding's `listing_url` still round-trips
untouched — `GridState.listingUrl` still carries it and `toBindingInput` still sends it
(`{ ...(state.listingUrl.trim() ? { listingUrl: state.listingUrl.trim() } : {}) }`) — the tab
simply has no input for it right now, so it can only change via `findProductPages`'s remembered
value or a future Extract-tab control.

The status strip (`StatusStrip`, fixed 38px tall, `role="status"`) has five states
(`schema-tab-view.ts`'s `stripState`/`stripSummary`): `editing` ("Not verified yet · n fields · k
pages"), `active` ("Verifying", with the progress bar and stage text), `stalled` ("This
verification stalled. Run it again."), `failed` ("The last verification failed"), and `results`
("n of m fields verified" plus " · k need attention" / " · j changed since" when either is
nonzero). Every expected cell reserves a second line (`cellLine`) so cells never resize between
states: pass shows "from <source>" or, when the page's live value differs from what was typed,
"page shows <value>"; fail shows one of the five red hints (`hintFor` — not_found,
different_value, ambiguous, type_mismatch, verbatim per spec); stale shows "changed since
verified"; not_captured shows "page not captured" with a screenshot link when one exists. A
not-found text cell whose typed values are all http(s) URLs gets the type-fix chip (
`typeFixSuggestion`) suggesting a retype to `url` via `retypeField`, which surfaces the
project-dataset "which website" ownership error if the field is shared and locked elsewhere.

Re-verify pricing is now scoped and can be free: `sources.verifyEstimate` takes an optional
`onlyKeys` and returns `capturesFresh` — true when every proof-page URL's last completed
verification captured within `CAPTURE_REUSE_MAX_AGE_MS` (currently one day). The dashboard's
`verifyButton` (`schema-tab-view.ts`) labels the button "Re-verify n fields · free" only when
captures are fresh AND (AI is unavailable OR the scoped upper bound is $0) — otherwise "Re-verify
n fields · up to $X.XX". `verification-view.ts`'s `reverifyKeys` now also takes a `currentKeys`
argument: a field whose last result certified but whose stored `fieldHash` the server no longer
counts as current (phase 2's per-field certification currency, e.g. after
`pnpm db:lift-contracts`) now falls into the re-verify set too, so a pre-phase-2 proof that never
touched this UI can still be re-verified for free once captures are fresh, instead of silently
reading as "everything is verified" against a stale hash.

Unrelated fix folded in here because it's the same button code: `disabled:pointer-events-none`
was added to the `btn-primary`/`btn-quiet` Tailwind utilities (`styles.css`). Without it, a
disabled `<button>` still intercepts the pointer event itself, so a wrapping `<span onClick=...>`
placed around it — used here to show the disabled reason as a tooltip/toast, and already used the
same way by phase 1's dialogs — never received the click. With `pointer-events-none` on the
disabled button, the hit-test falls through to the wrapper, which now fires correctly; this
incidentally fixes a phase 1 dialog bug of the same shape, not just this tab.

Screenshots taken for this task live under `docs/testing/screens/`: `schema-tab-editing.png` (the
Ikea Schema tab as it loads — 8 fields, 3 captured pages, all cells passing) and
`schema-tab-popover.png` (page 1's pencil clicked, showing the URL field and the "find pages from
a listing" control). **The Ikea live re-verify was NOT run**: its button read `Re-verify 8 fields
· up to $0.40` (captures older than a day), which this task's budget rule forbids clicking, so
`schema-tab-verifying.png` and `schema-tab-results.png` do not exist yet. They can be captured
once Marko approves that spend, or once a fresh (same-day) capture makes the button read "free".

**Live proof, same day, free:** after the final fix wave made `verifyEstimate` price only fields that still need AI (a field whose latest result already certified replays stored paths at no cost), the Ikea button read `Re-verify 8 fields · free` and the controller clicked it. The cycle took 9 s: strip `Verifying · starting` then `searching` with the table locked and every header `queued`, then `8 of 8 fields verified` with Extract unlocked. `schema-tab-verifying.png` and `schema-tab-results.png` now exist under `docs/testing/screens/`. The earlier `$0.40` label was the old pricing rule (every field in the set priced), not stale captures.

## MVP flow phase 4 (2026-09-10): the Extract tab is a stepper

Spec: `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md` §5.7. Plan:
`.superpowers/sdd/2026-09-10-mvp-flow-phase4-extract-tab/`. Landed across seven tasks
(`git log --oneline 8671af7..HEAD`): budget accepts `'all'` pages, resolved to the single-burst
ceiling (`da65e0e`); `sources.checkListingPage` reports product links and pager presence
(`49fbbeb`); pure view logic for the stepper (`6211aa9`, `eedd0b5`); listing pages and product
URLs as the source's input, budget on `update`, binding-save input-mode respect (`c4efcbc`); the
stepper shell and its three sections (`a6811f3`); an API fix wave for the input-set lost-update
window and the sandbox-source case (`e027653`); the sample polling from `planning` plus six review
fixes (`803eb74`); the tab itself — `source-extract.tsx` — wired up, with Overview retired from
the tab bar (`6d8b24e`); a fix wave including the switched-mode-is-not-saved-pages blocker
(`2152a66`); and the 40/3-starter-vs-real-choice fix (`38af6e1`). The tab bar is now **Schema /
Extract / Runs / Settings** — `/overview` and `/p/…/overview` both redirect to `/extract`, and
nothing on the Schema tab starts a run any more (its strip button became a navigation, "Go to
Extract").

The tab is three always-rendered sections — **1 · Pages**, **2 · Sample**, **3 · Run** — over one
`Stepper` strip. Nothing disappears: a finished section locks with an `Edit` button, a
not-yet-reachable section stays visible and dimmed with the reason in place of its hint, and only
`inert` removes interactivity. When the website's schema is not fully verified, a `StatusStrip`
reading "Extraction is locked · n of m fields verified · fix `<field>` on the Schema tab" replaces
all three sections with the locked/dimmed state and a link back to Schema — nothing below it
applies until every cell is green.

**API surface added or extended:** `sources.checkListingPage` (product-link count + pager
detection, free, no AI), `sources.setListingPages` / `sources.setProductUrls` (the input set),
`sources.inputRows` (new public procedure — `{ urls, updatedAt }`, keyed off `input_sets.updated_at`
rather than the Source's own `updated_at`, which a rename/budget/schema save/confirm all bump for
unrelated reasons), `sources.update` now taking a `budget`, and `sources.listByProject` now also
selecting `budget` and `parameters` (verified live: Ikea's row returns
`budget: {mode:'first_n',max_items:40,max_pages:3}` and `parameters: {...}`).

**`'all'` pages resolves to `PAGES_ALL_CEILING` (10), not an unbounded walk.** The walk's own
anti-bot rule already caps a single burst at ten pages, so an "all" that tried to mean "no limit"
would silently behave like ten anyway; the tab is honest about that limit up front ("up to 10
pages per listing") instead of promising something the engine can't do in one burst.

**`parameters.inputMode` is the marker that the Extract tab, not the old flow, now owns this
Source's input.** It is set the first time `setListingPages`/`setProductUrls` saves pages, and it
has two effects: (1) a **binding save leaves the input alone** — `toBindingInput`'s remembered
listing URL no longer overwrites what the tab has saved, so re-running "find pages from a listing"
on the Schema tab can't clobber the Extract tab's input set; (2) the old flow's **40/3 automatic
starter budget counts as unset only while the marker is absent**. `budgetIsUnchosen` reads the
Source's *prior* `inputMode` inside the same transaction as the budget it's judging — an empty
budget is always unset, but the exact starter triple `{max_items:40,max_pages:3,mode:'first_n'}`
is unset **only when `priorInputMode === undefined`**. Once the marker exists, any non-empty budget
is treated as a real choice and never silently reseeded to all/all — which matters because
`budgetFromForm(40, 3)` is byte-identical to the starter, so a customer who deliberately picks
40/3 must not have that choice mistaken for the unset default on their next visit.

**The 5,000-product safety stop is per listing input, not per run.** `planRun` measures each
input's item cap and `maxPages` against that input's own gain, never a running total across the
run — invisible before this tab, when a Source had exactly one listing URL from the wizard, and
material now that up to 50 listing pages can be saved (50 × 5,000 at all/all). The Run sentence
says "safety stop at 5,000 products per listing" for that reason; product-URL mode, which has one
input row per URL and no walk, says "safety stop at 5,000 products". Enforcing a genuine run-level
total in `planRun` is the alternative, and is a phase 5 decision.

**The sample-finished rule**, used to unlock step 3: a probe run counts as finished when its
status is `completed`, **or** `partial` with `rows > 0`. `partial` is a terminal status on this
engine (it never becomes `completed`), and the ordinary outcome of a sample walk that finds more
product links than it extracts is exactly `partial` with some rows — so gating step 3 on
`completed` alone would make it unreachable forever for a normal listing. `sampleFinished` lives in
`lib/extract-view.ts` and is the single source of truth `stepStates` calls; the route does not
launder the status.

**Live proof — Ikea, project `acne`, `/projects/acne/sources/ikea/extract`, free throughout (one
listing check, one probe sample, no AI). Extract was never clicked.** The check on the saved
listing page read, verbatim, **`7 product links · pager found`**. The sample that followed walked
**2** pages, found **28** product links, detected pagination as **`mechanical: url-pattern`**, and
finished with sample rows complete **3 of 3**. Instrumenting the network confirmed **0** captures
on page load — the saved row shows `saved` with a manual `Check` button, nothing fires until it's
clicked. For a website going through the tab for the first time, the Run section opens with both
dropdowns on `all`/`all`: "1 listing · up to 10 pages per listing · safety stop at 5,000 products
per listing". Four screenshots recorded the walk-through: `docs/testing/screens/extract-pages.png`,
`extract-checked.png`, `extract-sample.png`, `extract-run.png`. **The plan+execute path — the
Extract button itself, in every branch — was not exercised live**; only the free steps (check,
sample) were clicked.

**Ikea's own Source is a dev-database quirk, not the general case.** Its stored budget is still
the 40/3 starter, because the first live save against it (during this phase's fix-round checks)
happened *before* the `inputMode`-gated reseed rule existed, so the save that set the marker did
not also clear the starter. The two together now read as "a real 40/3 choice" under the current
rule, so **Ikea's Run section opens on custom 40 / custom 3**, not all/all — that is the rule
working correctly on a Source whose history predates it, not a bug. One `sources.update` with
`{max_items:'all',max_pages:'all',mode:'all'}` would clear it if a true all/all screenshot against
Ikea is ever needed; nothing was written to the customer's Source just to make a screenshot match.

**The listing-check and the probe-walk disagree on the same page (7 vs 28 links), and this is
pre-existing, not introduced here.** `describeListingPage` (the free check) groups raw anchors by
path template and reports the largest same-template group; the probe's own walk uses the full
extraction engine and found 23–28 product links on the identical page. The two numbers sit two
sections apart on the same tab and can look contradictory to an operator. Worth a look in phase 5.

**Parked, not forgotten:** detail mode still persists `max_pages` even though a fixed URL list has
nothing to page through; `{saved: true}` checks are seeded for detail-mode URLs but are inert
there (no check ever fires for them); "rough time" in the Verifying strip, the strip's
summary/detail split, and the visual system generally are all deferred to phase 5 (see the spec
corrections below). Two residuals from the fix wave's re-review, both minor: the `crawl.status`
polls in `source-extract.tsx` and `extract-sample.tsx` key on status alone, so a run that ended
at the planning stage (`planned` with `completedAt` set, the 0-item walk) keeps polling every 2 s
while the tab is open — `crawl.status` does not return `completedAt`, which is the one-line fix;
and after an Extract the Run section shows the run line permanently, so a second Extract in the
same visit needs a reload.

## MVP flow phase 5 (2026-09-10): the proof sheet

Spec: `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md` §7. Plan:
`.superpowers/sdd/2026-09-10-mvp-flow-phase5-visual-system/`. Landed across eight tasks
(`git log --oneline 7b66ca2..HEAD`): the tokens and the utilities (`e82f3cc`); the shell —
header, page header, sub-tabs, dialogs, states, strip, status dot (`77579d4`, fix `d5a8c27`);
the ops screens (`54ddf16`); the Schema tab as the sheet, with rough time and the strip's
accessibility (`2c68f3d`, `9c92afc`, `f3bb5d7`); the Extract tab on paper (`cb039fd`,
`d077301`, smoke assertion `af1f8f9`); the customer screens and website delete moved to
Settings (`f9a3f4c`, `079c13e`, `d36550c`); run detail (`11a6464`, `94e3a58`); and this entry
with the smoke run's screenshots. **Nothing about the flow changed.** Every query, mutation,
prop, handler and exported name in phases 1 to 4 survives; this phase is classes, markup and
copy, plus the four defects it tripped over on the way.

**One file restyles everything.** `packages/dashboard/src/styles.css`'s `@theme` block remaps
the *existing* class vocabulary rather than introducing a parallel one: the whole `gray-*` ramp
becomes the warm neutrals (`gray-50` surface `#fbfbf9`, `gray-100` paper `#f3f4f1`, `gray-200`
rule-soft, `gray-300` rule, `gray-600` ink-soft `#5f665c`, `gray-900` ink `#1c1f1a`), `accent-*`
becomes the moss green `#1f5e4a`, the three fonts become Fraunces / Public Sans / IBM Plex Mono,
and `pass`/`fail`/`warn`/`changed` with their tints are added as named colours. `--color-white`
is remapped to surface too — Tailwind 4.3 honours that, so every `bg-white` in the tree landed on
paper without being touched. That is why a phase that repaints eleven screens is mostly a
stylesheet: a component that already said `bg-gray-50 border-gray-200` was already correct.

**The named utilities and what each one means.** `name` — the name of a thing, in Fraunces
(project, website, page title, section heading). `label-soft` — a secondary label in sentence
case, 12px ink-soft; it replaces the retired uppercase `micro-label`, whose alias is now deleted
(zero users left in `src`). `sheet` / `sheet-head` / `sheet-row` — a table on the paper: a 2px
ink rule across the top, 1px rule-soft between rows, surface background, header in Public Sans
600. `strip` — the 38px paper-dark status bar; `strip-wrap` is the same bar for contents that
must wrap onto a second line instead of being clipped. `btn-primary` / `btn-quiet` — the filled
accent button and the 1px-rule outline button, both at 45% opacity when disabled. `cell-rail-*`
— a 3px rail on the left edge of a cell plus its status tint: **the rail is the glyph**, so no
icon ever appears inside a data cell. `line-*` — the 11px second line under a cell's value,
coloured only for fail and warn and ink-soft otherwise. `card` — a rounded box, and per spec 7
it is now used in three places: dialogs (`dialog.tsx`), the websites list on the project home
(`project-home.tsx`), and the proof-page URL popover (`page-header-cell.tsx`), which is a
`role="dialog"` and so is covered by the same rule.
Everything else sits on the paper with rules.

**The contrast floor is mechanical, not a promise.** `packages/dashboard/src/lib/tokens.ts`
holds the palette as data plus a WCAG 2.x `contrastRatio`, and `tokens.test.ts` asserts every
text-token-on-its-tint pairing at ≥ 4.5:1. It caught one: the spec's `changed` `#7a8077` measures
**3.42:1** on its own tint `#ebece8`. The rule was to darken the text token, never to lower the
threshold, so `changed` is **`#666c63`** (4.55:1 — `#676d64`, one step lighter, still misses at
4.48:1). The spec's §7 palette line was corrected to match.

**The content column is `max-w-6xl`.** The schema grid is `min-w-[1100px]` by design (three page
columns plus field, type and location hint), and the old `max-w-5xl` main column gave it 976px —
Page 3 was clipped until the operator scrolled. Widening the column in `layout.tsx` is what makes
the sheet a sheet; it also lets the Extract sample's "mechanical: url-pattern" fact sit on one line.

**Rough time in the Verifying strip**, the last piece parked from phase 3:
`seconds = (capturesFresh ? 0 : 3 × 12) + aiFields × 8`, rendered as "a few seconds" at zero,
"under a minute" below 45s, and "about N min" otherwise — so "Verifying · about 2 min", the one
place the copy rules allow a separator. It is computed from `sources.verifyEstimate`, which the
tab already queries, and **frozen at run start**: a live-recomputed estimate would tick downward
as captures landed and read as a progress bar the number is not.

**Names are Public Sans in tables; keys are mono.** This is the rule that settled the schema
grid's Field column, which had drifted out of step with the contract editor. Fraunces is for the
*name of a thing at title scale* — a project, a website, a page heading. Inside a table a field's
**name** is Public Sans 500 in ink, and its **key**, type, values, URLs and numbers are Plex Mono.
A name is language; a key is a value.

**The stepper's finished rail is ink, not pass.** `pass` (`#1f7a4d`) and `accent` (`#1f5e4a`) are
the same colour to the eye in a 2px rule, so a done step and the current step were
indistinguishable — exactly the one thing the strip exists to say. Done is now `gray-900`, the
sheet's own 2px language; current stays accent; later stays rule-soft.

**What moved.** Deleting a website was a `window.confirm` button buried at the bottom of a run
detail page. It is now a block on the **Settings** tab — "Delete this website", the sentence "Its
runs and results are deleted too. This cannot be undone.", and a fail-coloured quiet button
opening the app's own `Dialog` with "Delete website" / "Keep it". A `sources.delete` refusal (the
`PRECONDITION_FAILED` on a confirmed website) is rendered verbatim under the buttons. Moved, not
duplicated: the block is gone from `source-run-detail.tsx`.

**Four defects the restyle exposed, all pre-existing, all fixed.** (1) *The active nav underline
never rendered.* TanStack Router's `Link` **concatenates** `activeProps.className` onto
`className` rather than replacing it, so `border-transparent` and `border-accent-600` both landed
on the element and the transparent one won on stylesheet order. Fixed the way `SubTabNav` already
did it: compute the active path with `useRouterState` and pick one non-overlapping class string
with a ternary. (2) *Every dialog rendered in the top-left corner.* Tailwind's preflight zeroes
the UA stylesheet's `margin: auto` on `<dialog>`, which is what centres a modal — `m-auto` in
`dialog.tsx` fixes New project, Add website and Delete website at once. Pre-existing since phase 1.
(3) *The run page's results table had zero columns for any verification-era website.* Its columns
came from the legacy `source.selectorsJson.fields`, which is empty once the schema lives on the
project dataset — three rows and no headers. It now falls back to `datasets.getContract` keyed by
contract key exactly as `effective-schema.ts` and the Extract tab do; Ikea's run shows all eight
columns with its three rows. (4) *Settings spoke in enums* — `listing_to_detail` and `direct` are
now "Listing pages, then each product" and "Given URLs", with an unrecognised value shown verbatim
rather than swallowed.

**A pre-flight correction worth keeping.** The plan's file map called
`routes/datasets-list.tsx` and `routes/dataset-detail.tsx` dead and scheduled their deletion.
They are not dead: `routes/project-output.tsx` is a three-line router that renders one or the
other. They are the Output page, and they were restyled instead of deleted.

**Concurrency lesson, for the next multi-agent phase.** Git's index is per-checkout, not per-agent.
Two implementers running `git add <paths>` then `git commit` in the same working copy produced one
commit carrying both agents' files under one agent's message, and an empty commit for the other.
Recovered by hand, then the rule for the rest of the phase: **`git commit -m … -- <paths>` only**,
never `git add` followed by `git commit`, whenever agents share a checkout.

**Screenshots are now part of the smoke run.** With `RUN_UI_SMOKE=1` (i.e. `pnpm test:ui`, servers
up), every `checkRoute` writes a full-page 1280×900 screenshot to `docs/testing/screens/<route with
slashes turned to dashes>.png`. Not asserted — spec 10 asks for one screenshot per screen state
*for hand review*, and a screenshot cannot tell you a page is right. States the smoke run cannot
reach without spending money or clicking something destructive (a verification in flight, a real
sample, the delete dialog) are still captured by hand and keep their older names, so a few routes
have two files. `docs/testing/screens/README.md` says which is which. The throwaway project the
smoke run creates gets screenshotted under a timestamped name and is gitignored.

**Parked, not forgotten.** Spec 5.3's per-website row counts on the Output page — a restyle had no
place to add the query, and `projects.list` still carries no per-field verified count, so the
projects list shows "Fields", not "Fields verified". The 18px mono "figure" size is now scoped to
the probe gate's four evidence facts only (the shared `Stat` was giving header timestamps the same
treatment); it is a size spec 7's scale does not name, and it stays on that one block until it
does. And phase 4's **7-vs-28 listing-link disagreement** — `describeListingPage`'s free check
groups anchors by path template and reports the largest group, while the probe's real walk found
23–28 links on the identical page — is still open, and is engine work, not visual.

## Customer schema verification (2026-09-07): built and offline-proven — NO live site has verified through this flow yet

**What shipped.** Marko's ruling after the 2026-09-02 corpus measurement (~65% verifiable accuracy over 7 of 8 domains) was that discovery-based extraction cannot reach competitive precision, and that the customer must define what they need and we must prove we can get it before spending at scale. `docs/superpowers/specs/2026-09-04-customer-schema-verification-design.md` is the spec; 39 commits across Tasks 1-16 (plus the final whole-branch review's fix wave) of `docs/superpowers/plans/2026-09-04-customer-schema-verification.md` built it: a new `packages/scraper/src/verify/` module (normalization, mechanical structured/DOM search, cross-capture certification, the closed transform set, the AI `propose_path` fallback, `runVerification`, and `runVerifiedExtraction` for certified-only extraction at scale); `@robot/api`'s `sources.createWithSchema`, `sources.updateSchema`, `sources.findProductPages`, `sources.verify`, `sources.verificationStatus`, and `sources.verifyEstimate` procedures plus the `requireCertification` gate wired into `sources.confirm`; and a dashboard schema-grid screen (`packages/dashboard/src/routes/new-source.tsx` / `source-schema.tsx`) that replaces the old landing page and Set-up workspace — one row per field, an expected value typed on each of three product URLs, Verify paints cells green/red, Extract stays locked until every cell is green. See `docs/extraction-architecture.md` → "Verification-first sources" for how the mechanism works and `CLAUDE.md`'s Extraction Chain step 0.

**This is all on `feat/schema-verification`, and that branch is NOT merged to `main`.** Task 16 (this entry, plus the dead-procedure removal above) is the last offline task; Task 17 is the live proof and has not been started.

**What "offline-proven" means here, concretely.** (1) The `shop-example` fixture triple under `packages/scraper/src/__fixtures__/verify/shop-example/` (three captured product-page JSON bodies) drives Tier 1 tests that certify fields mechanically with zero AI calls, exercise the one-AI-call-per-stubborn-field path with a stubbed agent, and prove `runVerifiedExtraction` leaves a field empty and records a miss when no certified path resolves. (2) Real-Chromium tests cover the in-browser DOM search and XPath probe scripts (`packages/scraper/src/verify/dom-scripts.test.ts`) — not mocked, but still no network egress and no spend. (3) A UI smoke run exercised the grid screen (paste, CSV/XLSX import, type validation, Verify/Extract enabled states) under `pnpm test:ui`. None of this has touched a real website through this flow. No dollar has been spent verifying a real customer schema, and no certified path has ever been produced from a live capture.

**Task 17 (live proof) is unstarted and needs Marko's explicit go before any spend** — same rule as every other paid proof in this project: fill a real grid against a corpus domain not currently blocked, verify, extract a handful of items, hand-check every cell, record it under `docs/testing/`.

**Live pre-check 2026-09-07 — found and fixed a `__name` crash, `dev:all:noai` added.** Task 17's free Step 1 pre-check (`docs/testing/2026-09-07-schema-verification-live-precheck.md`) ran a real grid against currys.co.uk and hit a reproducible `ReferenceError: __name is not defined` inside the "searching" (DOM cross-validation) stage before any field could be scored — not a data/config problem. Root cause: `packages/scraper/src/verify/dom-scripts.ts` builds page-injected scripts by interpolating `browserNormalize.toString()` / `browserXPath.toString()`; under the dev runtime (`pnpm dev:all` → `tsx watch`, esbuild with `keepNames: true`), the transformed source wraps nested arrows in esbuild's `__name(...)` helper, and the serialized text references `__name`, which the page never defines. Vitest's esbuild does not `keepNames`, so no offline test caught it. Fixed by prepending a `var __name = (fn) => fn;` shim (exported as `PAGE_SCRIPT_PRELUDE`) as the first statement of both `buildDomSearchScript`'s and `buildXPathProbeScript`'s IIFEs; covered by a unit check (both scripts contain the prelude) and a real-Chromium test proving the shim executes a `__name`-wrapped function. The pre-check also hit a separate environment gotcha, unrelated to the code bug: `turbo`'s default `envMode: "strict"` swallows an ad-hoc `ANTHROPIC_API_KEY=` shell override before it reaches the task process, so `pnpm dev:all` silently keeps using the real key from `.env`. Use `pnpm dev:all:noai` instead (added to root `package.json`: `cross-env ANTHROPIC_API_KEY= turbo dev --env-mode=loose`) to actually run with AI unavailable. The currys source (`currys-co-uk-1dvdva`, sourceId `f1e7ee0b-03cc-4f7f-90cf-1cc53140f5b5`) still exists in Scratch with the crashed rows from the pre-fix runs and, as of run 3, a completed mechanical-only verification: **5 of 8 fields certified with zero AI calls** (json-ld `name`, `offers.price`, `brand.name`, `image` via `first_of_list`, `aggregateRating.ratingValue`); red: `in_stock` (different_value/ambiguous), `product_code` (the visible code differs from the schema.org SKU), `processor` (not found on any page). Paid re-verify upper bound 3 × $0.05 = $0.15 — Step 2 stopped for Marko's go. Run 2 of that re-run found a second, unrelated crash in the same "searching" stage: `setContentEvaluate` (`packages/browser/src/playwright-browser.ts`) claimed to be offline but let Chromium fetch every real subresource in a captured page (trackers, ad tags, remote scripts), and one of those hung long enough to blow `page.setContent`'s 30s `"load"` timeout on a real currys.co.uk capture. It is now offline by construction — a `page.route('**/*', route => route.abort())` before `setContent` blocks every outgoing request, and `waitUntil` moved to `'domcontentloaded'` since `'load'` would otherwise wait forever on requests that are now aborted rather than merely slow.

**Deliberate spec deviation, recorded so it isn't rediscovered as a bug:** spec §4.2 asks the normalizer to "record the expected currency if present" on `money` fields. It doesn't — nothing downstream consumes a stored currency today (normalization strips it and compares magnitude only), so it's dropped rather than carried through as dead data. Ticketed: `docs/ideas.md` → "Store the expected currency on money fields".

**Cache hygiene:** the post-test hostname gate (`docs/handoff.md` → "Commands worth knowing" below) now also checks `shop.example`, home of the verify fixture triple.

**Dead column, deliberately left in place:** `sources.requested_fields` now has **no writer and no reader** anywhere in `packages/*/src` — the repair engine's "ask the customer for fields" loop is gone, replaced by the customer-authored schema grid. The column is not dropped, for the same reason the `chore/legacy-purge` tables weren't: a drop needs a migration and a history decision.

**Security, recorded as an open decision:** `httpUrl` (`packages/api/src/verify/http-url.ts`) blocks non-http(s) schemes only — `file:`, `javascript:`, `data:` and friends. **Private-network targets remain reachable**: `localhost`, RFC1918 addresses and cloud metadata endpoints (169.254.169.254) can still be handed to `sources.findProductPages` and `sources.verify`, which navigate a real browser to them. That matches the platform's pre-existing posture (every other URL-taking procedure has always done the same), so it is not a regression introduced here — but it IS an unresolved SSRF surface, and the decision to leave it open should be made deliberately rather than by omission. Fixing it means resolving the host and rejecting private/link-local ranges before every navigation, in one shared place.

Pointers: spec `docs/superpowers/specs/2026-09-04-customer-schema-verification-design.md`; plan under `.superpowers/sdd/2026-09-04-customer-schema-verification/`; the task-by-task SDD ledger (progress, controller rulings, per-task reports) at `.superpowers/sdd/2026-09-04-customer-schema-verification/progress.md` — git-ignored, this machine only, not something a fresh clone or a different machine will have.

## Pre-spend cleanup + cache-reputation repair (2026-09-02): three branches stacked on `feat/repair-engine`, all free

While API funding stays pending, three review-driven branches landed everything fixable without spend. Stack and merge order: `main` ← `feat/repair-engine` ← `chore/legacy-purge` ← `fix/cache-reputation` ← `chore/pre-spend-fixes`. All merge after `feat/repair-engine`'s paid proof (Task 12 Step 2). Full suite + `pnpm typecheck` green at every tip; **`pnpm typecheck` now covers all seven packages** (the dashboard had never been type-checked — it was clean on first check).

- **`chore/legacy-purge`** (5 commits, −888 LOC + ~15 MB): deleted the pre-Source "extractor" era — seven zero-caller routers (`orgs`/`extractors`/`inputs`/`credentials`/`overrides`/`captures`/`extractions`, which also closes the unauthenticated `orgs.delete`/`extractors.delete` cascade exposure), five dead `runs` procedures, the schema-drifted `migrate-cache.ts` (ran `DROP TABLE domain_intelligence CASCADE` — it was a loaded gun), the executed sandbox one-shot `backfill-transform.ts`, Next-era `cn()`/`slugify` + `clsx`/`tailwind-merge`, tracked `.next/` traces and 25 orphaned dashboard PNGs. Tables/columns were **NOT** dropped (needs a migration + history decision). The no-op `pnpm lint` was removed — wiring a real linter is an open decision.
- **`fix/cache-reputation`** (2 commits): the domain cache's feedback loop actually works now. Replayed paths finally earn hits (`ResolvedField.path`, `'xpath-cached'` mapped back to stored identity); attempted-but-failed cached paths take misses — **this lands the "record replay misses" half of the AbeBooks poisoned-titles RCA** (the corroboration half already existed), so the unchanged conservative prune can finally retire that poison; miss accounting is per-path, not per-run; every cache read-modify-write runs under `SELECT … FOR UPDATE` so a dashboard pin can't be lost mid-crawl (real-Postgres interleaving test proves it); the domain-lock double-waiter wake race is fixed. Policy untouched: never-overwrite, no auto-reset, same prune predicate, pin supremacy.
- **`chore/pre-spend-fixes`** (4 commits): `valuesMatch` compares structured values structurally (conflict detection was blind to objects — every pair stringified to `[object Object]`); xpath identity ignores cosmetic whitespace/quote variants (taxonomy class 5 mitigation; stored strings never rewritten); `apiEndpoints` enriches by union instead of freezing at first write; the dead `resolveFromCache` crawl pass is removed and `extraction-architecture.md`/`CLAUDE.md` now describe the real cross-validation; **`effectiveSchema`'s selectorsJson fallback no longer strips `candidate`/`origin`/`input_column`** (a Scratch source's candidate choice — the v2.5 serving order — used to be silently dropped behind an `as OriginField[]` cast; the casts are deleted); the backfill panel gets its checked-set preview from the server instead of a mirrored client derivation; pins are visible in the domain selector table; dead surface removed (`backfillPreview.itemIds`, `scraper.extract.captureId`, `validationResult`/`screenshotPath` reads, `sources.update`'s 15 legacy fields, `requestedFields[].addedAt`).

**Deferred with reasons, not forgotten:** jsonb `fieldPaths` versioning/Zod validation and persisted review flags (hardening features, not fixes); `lastValue` truncation (changes stored shape — decide with the versioning work); `run_items.parentId` FK (migration + delete-semantics decision); dead table/column drops (same); linter wiring (tooling decision); catalogue-tier reputation accounting (v2.5-adjacent design question — selection/displayed serving carries no hit/miss ledger).

**2026-09-02, later: Marko funded the API ($10) and the repair-engine PAID proof PASSED** — Task 12 Step 2 executed on the stack tip: healthy-trio backfill (run `3f094f9c`, 5/5, url+publisher → 40/40, 4 true ISBN absences confirmed-absent, re-preview $0.00) and repair-then-sweep on `listing_id` (guard 5 refused the run without an explicit `deadFieldStrategy`, then run `c96aa7de` completed 40/40 — `listing_id` 0/40 → 40/40 healthy, real ids). Total spend ≤$2.25 by preview upper bound. The cache-reputation fixes were observed working live: the swept json-ld path accrued 36 hits with 2026-09-02 timestamps. Full record: `docs/testing/2026-09-02-repair-engine-paid-proof.md`. **The stack was merged to `main` the same day** (fast-forward, full suite green post-merge).

**2026-09-02, later still: the whole paid queue was executed on Marko's go.** (1) **v2.5 live dogfood** — extractions on newegg/target/bn corpus URLs; catalogues passed hand review (Target's 5 price candidates cleanly labeled incl. a scoped `protection_plan_price`; Newegg gained 6 variant candidates); displayed-verification judged every 2+-candidate concept. One verdict corrected by hand review: Target `price`→`protection_plan_price` was an artifact of a Qty dropdown occluding the real price in the screenshot — cleared to none-displayed (stamp kept). Defects logged, not chased: B&N `rating_value` grabbed the review count; Newegg price extracted 399.99 vs judge-seen 439.50 (multiple-valid-values). (2) **Probe-confirm No-path demo (Step 3 — the MVP plan's last open box)**: an AbeBooks detail URL declared as listing → probe surfaced 1 item + pagination warning → "Something's wrong" → diagnosis panel offered Switch mode / Delete source, no spend past the probe. Demo source `abebooks-com-o8o14e` (run `f2bf8f8c`) left in Scratch; screenshots delivered to Marko. Finding (ticket, not fix): the panel says "no specific problem found" where "1 item on a listing probe" is a diagnosable wrong-mode signature. (3) **Five-domain measurement** — `docs/testing/results/2026-09-02T13-30-dogfood.md`: bhphoto 18/18 resolved (and B&H was Cloudflare-blocked at the 2026-08 corpus probe — capturable now), abebooks-listing 22/24 (the known title poison visible in the verdicts), zalando 17/18 (all three ai-vision material fields judged correct), currys 15/15, **uniqlo still Akamai-blocked** (site processing failed, $0). Verifiable-field accuracy on the four new sites: **36/59 = 61%** (correct / (correct+wrong+not-on-page)); combined with the 2026-08 baseline's 22/30 that puts the corpus at **~65% verifiable accuracy over 7 of 8 domains, with the 8th blocked**. Pipeline cost $1.44 for the 4 URLs (mostly warm), $2.06 with the judge. Anti-bot remains the binding constraint (uniqlo), and the largest error class is now judge-conservative "not-on-page" (14) rather than outright wrong (9).

## Repair engine (2026-08-28): built, review-clean, free-proven — paid proof parked on API funding

**Coverage + backfill shipped on `feat/repair-engine` (Tasks 1-11 of `docs/superpowers/plans/2026-08-28-repair-engine.md`, all review-gated).** What exists: per-run coverage (fill counts derived from `extractions.data[0]` key presence against `effectiveSchema` — deliberately no per-field status persisted), gap filters + row selection + "Re-extract selected" in the run view, the `backfill` run flavor (`inputLabel:'backfill'`, `parentRunId`, per-item `target_fields` focus through claim→extract, cell-level merge into the parent with the hard invariant that a filled cell is NEVER overwritten and `'done'` MEANS merged — a merge throw fails the item retryably), `absent_fields` marking so a true absence stops costing money (`confirmed-absent` cells are excluded from future derivations; a heal re-rolls-up the parent without ever un-cancelling it), dead-field repair-then-sweep (`<50%` fill → 3 dead-first-ordered samples → evaluate the PARENT's merged rows → sweep on ≥2/3 or an honest `repair_failed` warning; Stop and duplicate-backfill are re-checked before the sweep), persisted requested fields flowing into analyze (`name: hint` lines, earliest-delimiter split), per-field enable toggles, the add-fields control at Set-up and the confirm gate (save is free; re-analyze is always its own labeled costed click), and a checkbox-following cost preview that can only overstate. The final whole-branch review's money-seam audit passed: every Anthropic-reaching route traces to an explicit click, and the emptiness semantics (`== null || === ''`; 0/false/whitespace are FILLED) are byte-identical across coverage, merge, repair-sweep, and the UI. **Free live proof done** against the AbeBooks crawl `6c0a9463` (badges reproduce the known fill table; filter/select/clear verified; title/author/image_url/listing_id classified dead; add-fields round-trips) — record: `docs/testing/2026-08-28-repair-engine-free-proof.md`; final-review findings + fixes: `docs/testing/2026-08-28-repair-engine-final-review.md`. **NOT done: the paid live proof** (plan Task 12 Step 2 — backfill isbn/publisher/url, repair-then-sweep listing_id) — parked until Marko confirms the Anthropic account is funded. Known accepted gaps, ledger-ruled: spec §2.6's guided "field added → backfill history?" chain exists in no form (ticket); backfill runs' own export carries partial audit rows without a caveat (shaping initiative's export work); "Request more fields" is unavailable on a FAILED probe run (matches the plan literally — product call pending).

**Next initiative, approved and queued:** dataset shaping (`docs/superpowers/plans/2026-08-28-dataset-shaping.md`, all AI-free) — starts on a fresh branch after this merges.

## MVP simplification — Task 12 (2026-08-28): probe-confirm live-proven end to end; five defects found and fixed by the proof

**The declared-sources + probe-confirm flow works, live, on real money, with Marko clicking the gate.** Source `abebooks-com-353m8e` (Scratch project, listing mode, two AbeBooks SearchResults inputs) went through the whole lifecycle: quickCreate via the real home flow → explicit Analyze click (30 rows, `url-pattern` pagination, 19 fields with live examples) → probe run `f89905b1` (row plan **replayed from cache with zero AI**, terminal `partial`, 3 sample rows, gate rendered with evidence and no spend-capable controls) → Marko clicked Yes → `confirmed_at` set, full run `6c0a9463` (completed, 40/40 items, JSON+CSV export sane). **The proof was the point: each probe attempt flushed a real defect per-task reviews couldn't see.** Fixed in-branch, all TDD'd: (D1/final-review F1) a limit-stopped run finalised to `'extracting'` forever — now `limitReached` threads to a terminal `'partial'`, and `completed_at` is the one terminal marker; (D1) listing plans required a fresh `generateSelectors` AI call every time and a swallowed failure produced a silent 0-item `'planned'` run — the proven row plan is now persisted in `domain_intelligence.row_selector` (`source:'verified'`, hit/miss counted, human pins never overwritten) and replayed before AI, and 0-item walks warn; (D2) the duplicate-probe guard keyed on a status allowlist and permanently wedged a source whose probe found 0 items — guards now key on `completed_at IS NULL`; (D4) the crawl budget was spent as a source total, silently starving every listing input after the first — now per listing input with cross-input dedupe; (D5/F4 family) the synthetic `detail_url` planning field leaked into detail extraction, the results table, and the export — filtered at `effectiveSchema`, the dashboard table, and `build-run-export`. Residuals, parked with rulings in the ledger: the row-plan merge is positional (R10 — identity-based matching is future work), and **the garbled titles/authors (4/40) are pre-existing cache poisoning, NOT this flow** — AbeBooks' pricing API echoes normalized search keys as `bibliographicDetail`, the mechanical tier cached the echoes, and replay misses are never recorded so the prune can't retire them (full RCA: `docs/testing/2026-08-28-abebooks-poisoned-titles-rca.md`; the fix — corroborate API display-text against visible page text + record replay misses — is the cache-quality initiative). Step 3 of the live proof (the No-path diagnosis demo) is **deliberately unstarted**: the Anthropic API account is not funded as of 2026-08-28 and nothing that might reach the API runs until Marko confirms payment.

**Next work, specced and planned from Marko's post-proof feedback:** `docs/superpowers/specs/2026-08-28-repair-engine-design.md` (coverage reports, backfill runs, repair-then-sweep, schema add-fields — plan: `docs/superpowers/plans/2026-08-28-repair-engine.md`, Tasks 1-11 AI-free, Task 12 gated on funding) and `docs/superpowers/specs/2026-08-28-dataset-shaping-design.md` (non-destructive per-dataset output shaping; plan not yet written). The live crawl's fill-rate table (`title` 4/40, `image_url` 13/40, `listing_id` 0/40, most fields 36-40/40) is the repair engine's acceptance data — see `docs/testing/2026-08-28-probe-confirm-crawl-verification.md`.

## MVP simplification — Task 11 (2026-08-27): the sandbox/graduate world is deleted

`.superpowers/sdd/2026-08-26-mvp-simplification/`. Tasks 9-10 shipped the replacement world:
declared-mode home flow (paste URLs, pick a mode, land on a real Source under the Scratch
project — no more throwaway `/sandbox/{slug}` draft), the Source workspace
(`packages/dashboard/src/routes/source-setup.tsx`) with the ported schema-discovery wizard
(field table, provenance badges, mode-aware Extract), `sources.quickCreate` / `sources.analyze`
/ `sources.confirm`, and the probe-confirm gate (a listing Source runs a small probe, a human
confirms the schema looks right, only then does `confirm` kick off the full crawl). Task 11
(this entry) deleted the world that flow replaced: `packages/dashboard/src/routes/sandbox-index.tsx`,
`sandbox-detail.tsx`, `packages/dashboard/src/components/graduate-form.tsx`, their route
registrations and the header nav link; `packages/api/src/routers/sandbox.ts` + its test and
router-index registration; the `is_sandbox` filters that hid Scratch's sources from ordinary
project/domain views (`projects-list.tsx`'s `p.slug !== 'scratch'` filter, `domains.ts`'s
`isSandbox` where-clauses, `sources.ts`'s `sources.list` filter) — **Scratch is now a visible,
ordinary project**, and its sources appear in every list like any other project's. The
`is_sandbox` column, its migrations, and the CHECK constraint that uses it are untouched — kept
for the schema shape and for tests that still use `isSandbox: true` to satisfy
`sources_non_sandbox_requires_dataset` without a full dataset chain. `packages/db/src/scripts/seed-sandbox.ts`
(which seeds the always-present Scratch project) was renamed to `seed-scratch.ts`
(package.json script `seed:sandbox` → `seed:scratch`, root `db:seed` updated to match) since
the rename was trivial and the old name no longer matched what it does. `pnpm -r test` (all 7 packages),
`pnpm typecheck`, `pnpm --filter @robot/dashboard exec tsc --noEmit`, and the cache-hygiene gate
are all green as of this commit.

## v2.5 candidate labelling — Task 11 (2026-08-26): Tier 1 fixture gate landed; live dogfood run 2026-09-02 (see that entry — catalogues passed hand review)

Tasks 1-10 of `.superpowers/sdd/2026-08-25-candidate-labelling/` are built and merged into
`feat/candidate-labelling` (catalogue types/plumbing, `lastUrl` + narrowed conflicts, AI-native
catalogue discovery, the cold-catalogue trigger, selection/displayed serving through the real
extraction pipeline per ruling R5, the displayed-verification judge + `markDisplayed`, the API
surface, and the dashboard candidate picker). Task 11 Steps 1-3 (this entry) added the Tier 1
proof that selection and the displayed default actually survive the whole chain on a REAL captured
page, not just a hand-built `PageCapture`: `packages/scraper/src/__fixtures__/catalogue-serving.test.ts`
seeds a `DomainCache` whose `fieldPaths` **and** `candidateCatalogue` both carry two genuine XPath
price candidates from the `newegg-gpu-listing` fixture (`//div[@id="item_cell_..."]//li[@class="price-current"]/strong`,
resolving to two different real on-page prices, 1029 and 649) and calls `runExtraction` directly
(not `runFixtureReplay`, which builds its cache with `as DomainCache` and silently drops
`candidateCatalogue` — see the file's header comment) to prove: (a) no selection + a `displayed`
candidate → the displayed value is served; (b) an explicit selection of the other label → that
value overrides the displayed default. Both assertions were confirmed to bite for the right
reason — verified by temporarily stripping the selection from case (b) (fails: 649 received where
1029 was expected) and by temporarily zeroing `candidateCatalogue` entirely on both cases (fails:
falls back to whichever `xpath-cached` path STEP 1.5 ranks first, wrong value AND wrong source
`xpath-cached` instead of `xpath`), then reverting both. `pnpm -r test` (all 7 packages), the
cache-hygiene gate, `pnpm typecheck`, and `pnpm --filter @robot/dashboard exec tsc --noEmit` are
all green as of this commit.

**Step 4 (live dogfood) RAN on 2026-08-26 with Marko's go — twice, because the first run
found a real bug.** The branch was merged to main (`703c769`) first; then:

- **Run 1: all three extractions succeeded (94/92/95% confidence) and discovery wrote NOTHING,
  silently.** Root cause (`e6bc39d`): the `record_catalogue` tool schema declared
  `properties: {}` because a record with dynamic concept keys cannot be named in JSON schema —
  so the model invented its own output shapes and every response sanitized to `{}` with no log
  line. Diagnosed with a gate-instrumentation run plus a standalone discovery probe (which got
  a third shape — a flat `candidates` wrapper). Fixed by prescribing an explicit envelope
  (`{ concepts: [{ concept, candidates }] }`) the parser unwraps, keeping the bare record as a
  fallback, and warning loudly when discovery returns nothing valid — the silent-empty was the
  exact failure class the "no silent caps" rule exists for.
- **Run 2 (post-fix): Target 14 concepts, B&N 17 concepts, catalogued and saved.** The
  catalogues are good: Target's `price` concept holds five labelled candidates
  (`current_price` $269, `reg_price` $299, numeric twins, and `protection_plan_price` $50 —
  the wrong-entity class, now visible and labelled instead of silently pickable). **Newegg
  returned "no valid candidates" both runs** — the new warning surfaces it; likely the 30KB
  prompt slice truncating Newegg's huge API blobs so the model's paths fail the
  fabricated-path check. Needs its own look (entity-scoping the bodies per spec §4 is the
  probable fix); do NOT weaken the fabricated-path gate to make it pass.
- **Displayed-verification (`verify-displayed.ts` CLI) ran on Target and B&N and hand-review
  caught a real judge weakness:** it marked Target's `price` as
  `displayed: protection_plan_price` — the $50 warranty add-on IS visible on the page, and the
  judge prompt asks "what does the page show for price" without scoping to *the product's own
  price*. **The flag was cleared by hand (`markDisplayed(..., null)`) the same hour — nothing
  serves it.** B&N's verdicts were honest (description matched; NONE elsewhere). Before
  displayed-verification is trusted unattended, the prompt needs product-scoping (and a
  multi-visible-prices calibration case: the current calibration fixture never tests this).
  Until then, treat `displayed` flags as operator-confirmed only.

**Open items from the final-review fix wave (2026-08-26):** the results-table tooltip names the
selected candidate but not the actually-serving one (the displayed-default, when it wins, is
unannotated). Per-hostname selection scoping is a recorded follow-up from ruling R6 (today a
selection applies dataset-wide, not per contributing source hostname).

**Follow-up session, same day: Newegg discovery fixed, judge scoped, conflicts triaged (2026-08-26).**
- **Newegg discovery empty — root-caused and fixed (`1cccc60`), live-proven (5 concepts saved).**
  It was output-side truncation: the catalogue tool call ran at the 4096 default max_tokens, a
  rich page overran it, and a truncated tool_use parses as `{}`. `callWithTool` now throws on
  `stop_reason: max_tokens` (an absent answer must never impersonate an empty one — check this
  on every new tool), the catalogue call gets 8192, `sampleValue` is capped at 160 chars in the
  sanitizer, and API evidence is serialized per body (product-bearing first) instead of one
  30KB slice that used to cut Newegg's first 37KB body mid-JSON.
- **Displayed judge scoped to the main product (`1cccc60`).** The prompt now names the
  wrong-entity values that don't count even when visible (protection plans, accessories,
  bundles…); the calibration fixture carries a visible $9.99 protection-plan distractor and the
  gated case fails if the scoping regresses. `pnpm test:judge` in hand. Target/B&N `displayed`
  flags can be re-verified with `verify-displayed.ts` when screenshots are next in hand.
- **Conflict panels ("large red areas") triaged, 18 → 15 (`e6c3a79`).** Two mechanical rules
  landed: a conflict whose paths include a pinned/human path no longer reports (the pin IS the
  operator's ruling; unpinning re-arms it), and discovery is told to label every
  extraction-used path. Newegg listing `detail_url`'s junk XPaths were resolved by pinning
  `.//a[@class="item-title"]/@href`. **The remaining 15 are honest**: 1 stale cross-page
  artifact (AbeBooks `product_name`, self-heals on its next crawl once `lastUrl` stamps), and
  ~14 genuine same-page multi-valid disagreements (rating systems, granularities, phrasings)
  that stay red until their paths are labelled. **The structural gap, recorded as the next
  increment (do not drive-by):** discovery's evidence carries only each field's WINNING path,
  so the cache's other disagreeing paths cannot be labelled; and `parseCatalogueResponse`
  validates candidate paths only against api bodies + used paths, not against json-ld/meta
  evidence. Extending the evidence with the cached per-field paths (+ their lastValues) and
  teaching the validator to resolve json-ld/meta paths would let the labelled-different
  suppression clear most of the remaining panels.

## Quality/cost baseline

Unrelated to the v2 crawler, but it's the number that justifies "don't start another fix-and-dogfood cycle" above: **73% of *verifiable* fields correct across the three measured domains (22 of 30). 44% of all requested fields**, the difference being values a screenshot cannot check. **Cost ~$0.47 per cold URL, ~$0.20 warm**, pipeline only. The Tier 2 judge adds ~$0.14 per URL and is not a product cost.

**Updated 2026-09-02 — the corpus is now measured 7 of 8** (uniqlo Akamai-blocked): the four newly measured sites came in at 36/59 = 61% verifiable, putting the whole corpus at **~65% verifiable accuracy (58/89)**. The dominant non-correct class is the judge's conservative "not-on-page" (14), not outright wrong values (9). Report: `docs/testing/results/2026-09-02T13-30-dogfood.md`; per-site and defect notes in the 2026-09-02 handoff entry above. The "don't fix-and-dogfood" rule still stands — quality work goes through the cache-quality initiative, prioritized against dataset shaping.

### Corpus: 8 domains, 3 measured

`newegg`, `target`, `barnesandnoble` are measured (the numbers above). `bhphoto`, `abebooks`, `zalando`, `currys`, `uniqlo` were added 2026-08-19 and have never been run for extraction quality (`abebooks` has since been used live for the v2 crawler above, which is a different kind of run — pagination/plumbing, not a quality measurement). Only `newegg` has a Tier 1 fixture among the measured domains; two other fixtures (`ikea`, `nike`) exist but cover domains that aren't in the live corpus.

## What phase 1 and phase 2 actually do

- **Phase 1 — `crawl.plan`** (`packages/scraper/src/crawl/plan-run.ts`, `packages/api/src/routers/crawl.ts`'s `plan` procedure). Walks a Source's listing page(s) via the existing extraction chain (mechanical → cache → AI), detects pagination (`url-pattern` / `next-button` / `page-numbers`, heuristic first, AI fallback), and enumerates detail URLs into `run_items` — `kind: 'listing'` rows for pages walked (already `done`, they cost nothing further), `kind: 'detail'` rows `pending` and waiting for phase 2. It fetches nothing on the detail pages themselves and spends nothing per item. Budget (`max_pages` / `max_items` / `mode`) is enforced here, so a run never plans more than the Source allows.
- **Phase 2 — `crawl.execute`** (`packages/api/src/crawl/execute-run.ts`, `extract-item.ts`, `claim-item.ts`, `record-outcome.ts`, `roll-up-run.ts`; `crawl.execute`/`crawl.status`/`crawl.cancel` procedures). Claims one pending detail item at a time (`SKIP LOCKED`, so it's safe to call again after a crash — nothing double-claims), runs it through the same extraction chain the rest of the pipeline uses, merges input + listing + detail values into one row (`mergeRow`), and records the outcome per item: `done` with an extraction id, or `failed` with a reason. One blocked or erroring page is isolated — the loop keeps going and the run still reaches a terminal status (`completed` or `partial`, derived from the DB, not a local counter). `crawl.cancel` flips the run to `cancelling`; the loop checks between items (never mid-item) and stops cleanly, leaving the rest `pending` — calling `execute` again resumes it. **This stop-and-resume path is now proven live** (2026-08-21, run `aeaab1db-0f1f-4da5-8230-d59b3ef771af`): cancelled twice mid-run, each time the in-flight item finished, the run settled cleanly to `cancelled` with the rest of the items untouched at `pending`, and re-invoking `crawl-execute.ts` on the same run id resumed from the pending set rather than restarting or refusing. 8 of 33 detail items were extracted across both segments; 25 were deliberately left `pending` to avoid draining the run. See below for the full transcript. Runs it outside the HTTP request (deliberately not awaited, guarded so a failure can never take the api-server process down); state lives entirely in `run_items`, so an api-server restart pauses a run rather than losing it.

## How to drive them

- CLI, phase 1: `pnpm --filter @robot/api exec tsx src/crawl-plan.ts <sourceId|sourceSlug>` — prints the work list it produced and the run id.
- CLI, phase 2: `pnpm --filter @robot/api exec tsx src/crawl-execute.ts <runId>` — starts execution and polls `crawl.status` every 5s (240 ticks / 20 min cap) until the run leaves `extracting`/`cancelling`, then prints per-item final status. The crawl runs inside this CLI's own process, so hitting the poll cap while the run is still active exits non-zero with an explicit "still in progress" message rather than silently reporting success.
- Dashboard: the Source Runs page (`packages/dashboard/src/routes/source-runs.tsx`) has the button that calls `crawl.plan`. The Run detail page (`source-run-detail.tsx`) has **Extract N pending** / **Retry N failed** / **Stop**, wired to `crawl.execute`/`crawl.cancel`, with polling-based progress (`run-progress.ts`) — no live push yet, SSE/WebSocket is still future work. Which buttons appear is decided by `runControls` in `run-progress.ts`: Extract and Retry key off the item counts alone and are deliberately NOT hidden while the run is active, because a run can sit at `extracting` with no loop behind it and must stay recoverable from this page. Extract counts `running` as well as `pending` — an item abandoned mid-extraction is work a re-entered loop reclaims — and reads **Resume N stalled** (`extractButtonLabel`) when stalled items are all that is left.

## What the live runs demonstrated

Both runs used the same seeded Source, `abebooks-pagination` (budget `{mode: "first_n", max_items: 8, max_pages: 2}`), so the results are directly comparable:

- **Run 1** (`2f1b29b9-...`, pre-fix): phase 1 correctly enumerated 8 detail items, capped at page 1, never touching page 2. Phase 2 broke — item 1 succeeded, then `runExtraction` closed the shared browser it didn't own, and items 2-8 all failed with "Browser not launched." Run settled to `partial`, `result_count=1`. Left in the DB as the historical record; do not re-run it.
- **Run 2** (`bd44fa22-c667-4538-9a48-0e8066c8f444`, post-fix `376b7ac`): same plan shape, phase 2 completed 8/8 — `run_items` = 1 listing + 8 detail, all `done`; `result_count=8`; CSV export shows 8 data rows across 8 distinct `_url`s.
- Full step-by-step logs, the root-cause walkthrough, and verification queries: `.superpowers/sdd/2026-08-20-v2-crawler-phase2/task-9-report.md` (the bug run) and `task-9-fix-report.md` (the fix + reproof run).

## The fix, and its follow-up

**Ruling: whoever launches the browser closes it.** `runExtraction` (`extraction-orchestrator.ts`) no longer closes a browser it doesn't own, on any path — the invariant is documented directly on `ExtractionDeps.browser`. A review round found the identical pattern one file over: `runAnalysis` (`analysis-orchestrator.ts`) was still closing a browser it never launched, and `scraper.ts`'s `analyse` procedure had no `finally` at all, leaking a browser on its early-throw path. Both are fixed, and the rule is now structural rather than a convention each procedure has to remember: `@robot/api`'s `withBrowserSession` (`packages/api/src/browser-session.ts`) launches a browser, runs the caller's function, and always closes it in a `finally` — `extract` and `analyse` both route through it now. See `task-9-fix2-report.md` for the full fix.

## Pagination walk + caching — live proof (2026-08-21)

Tasks 1-5 of `.superpowers/sdd/2026-08-21-pagination-proof-and-caching/` built and fixture-gated: `planRun` walking listing pages 2..N, deduping detail URLs across them, writing the winning pagination strategy to `domain_intelligence.pagination_config` only once a walk verifies it produced new items, and re-detecting once (never twice) when a cached config goes stale. Task 6 is the live proof — the part fixtures cannot give. Full raw transcript, SQL, and run ids: `.superpowers/sdd/2026-08-21-pagination-proof-and-caching/task-6-report.md`.

**What worked, end to end.** Against `abebooks-pagination` (budget set to `{max_items: 60, max_pages: 3}` so `max_pages`, not `max_items`, would bind):
- `crawl-plan.ts` walked listing pages 1, 2 and 3 (run `4bf71da9-edf3-4155-8fdb-67b4cc30d7c2`) and enumerated 33 detail URLs spread across `page_number` 1 (30), 2 (2), 3 (1) — `run_items` confirms three `listing` rows and detail rows on all three page numbers.
- `domain_intelligence.pagination_config` was written for `(www.abebooks.com, listing)` — the first time this column has ever held a value in this repo's history.
- A second plan against the same Source (run `aeaab1db-0f1f-4da5-8230-d59b3ef771af`) produced the identical fan-out (30/2/1 across the same three page numbers) **without** re-detecting: the `[cache] pagination for ...` save-line that fires only on a fresh, non-cache detection was absent, which — combined with the identical result — is conclusive that the pagination `source` was `cache` on the replay. (The CLI has no direct `source: cache` print; this is inferred from the code path, precisely, not asserted from a log line saying the word.)
- `crawl.cancel` stop-and-resume, previously unit-tested only, is now live-proven (see above) — cancelled twice, resumed cleanly once, settled to `cancelled` both times, no item lost or double-run.

**What did NOT work: `deriveTemplate` picked the wrong page parameter for AbeBooks.** The three listing URLs actually fetched (identical on both plan runs):

```
page 1: https://www.abebooks.com/servlet/SearchResults?kn=python&sortby=17
page 2: https://www.abebooks.com/servlet/SearchResults?ds=2&dym=on&kn=python&p=1&rollup=on&sortby=17&sp=0&spo=30
page 3: https://www.abebooks.com/servlet/SearchResults?ds=3&dym=on&kn=python&p=1&rollup=on&sortby=17&sp=0&spo=30
```

`p=1` is pinned on every request; the template increments `ds` instead, which is not AbeBooks' page parameter. So pages 2 and 3 substantially re-fetched page 1. The 30/2/1 detail-URL split confirms it — a real second and third page of ~30 results would produce roughly 30 each, not 2 and 1; those are consistent with result-ordering jitter across near-duplicate requests slipping past cross-page dedupe, not with genuine additional inventory.

**The consequence: `gained > 0` is too weak a bar for "this config works."** `plan-run.ts` writes `pagination_config` whenever a walk yields at least one new item. 2 + 1 = 3 stray items were enough to pass that bar, so the broken `ds`-based template was certified and cached — a pre-existing gap in the Task 3/4 verification logic that this live run is what exposed it. It was purged by hand (`delete from domain_intelligence where domain='www.abebooks.com' and page_type='listing'`) rather than shipped; the row's exact contents before deletion are recorded in `task-6-report.md`. **Do not re-cache it** without first fixing `deriveTemplate` (in `@robot/browser`) or tightening the verification gate — ideally both. A candidate fix for the gate: treat a page yielding only a small fraction of page 1's item count as evidence of a broken pager, not a thin real page, rather than trusting `gained > 0` alone. **That ratio must not be implemented naively as a refusal.** `absorb` passes `remaining: cap - detailCount()` into `enumerateDetailUrls`, so a genuinely working pager legitimately gains only 1-2 new items on page 2 once the item budget is nearly full — which is this repo's own default `{max_items: 8, max_pages: 2}` shape. A bare ratio gate would refuse those correct configs, the cache would never warm, and the feature would deliver nothing. So as of 2026-08-21 the ratio shipped as a **warning only** (`THIN_WALK_SHARE` in `plan-run.ts`, suppressed whenever the walk was stopped by the item budget rather than by the pager). **UPDATE 2026-08-25: the budget-aware refusal is now implemented** — thin AND not-budget-stopped refuses to cache the config (planned items are kept; only cross-customer certification is withheld), while a budget-stopped thin walk still caches, so the default budget shape still warms the cache. Gated by tests including the AbeBooks 30-vs-3 shape.

**What this run does NOT prove.** Per-item detail extraction is not re-proven here — that is the earlier v2-crawler run (`bd44fa22-c667-4538-9a48-0e8066c8f444`, 8/8 AbeBooks detail items, described above). This run is plan-only for pages 1-3 (Steps 1-5) plus a bounded execute for the cancel/resume proof (Step 6, 8/33 items extracted, 25 left `pending` on purpose). Infinite scroll and load-more are unrelated to this bug and remain wholly unbuilt (see roadmap).

**Budget note:** `abebooks-pagination`'s budget was raised to `{max_items: 60, max_pages: 3}` for this proof and restored to its original `{max_items: 8, max_pages: 2}` afterward — confirmed by SQL in `task-6-report.md`.

## `api-param` pagination — live proof (2026-08-24)

Tasks 1-7 of `.superpowers/sdd/2026-08-22-api-param-pagination/` built and fixture-gated `api-param`: `planRun` finds the intercepted response that carries page 1's own detail URLs (`findListingApi`, requiring both `API_MATCH_MIN_COUNT = 3` matches and `API_MATCH_MIN_SHARE = 0.5` share, so a small widget or a recommendations blob can't qualify), ranks paging-parameter candidates from that endpoint's own URL, probes each one, and accepts a candidate only if its response's items overlap page 1's by at most `REPLAY_MAX_OVERLAP = 0.5` (`overlapShare` in `api-param-candidates.ts`) — a parameter is never used or cached until a probe has shown it returns genuinely different data. Detection is wrapped so it can never throw (`probeApiParam`/`detectApiParam` in `detect-api-param.ts`) and reached the case Task 5's review round added: when an endpoint was found but no candidate verified, `plan-run.ts` emits a warning naming the endpoint and every candidate tried. Task 8 (this entry) is the live proof — the part fixtures cannot give.

**Target and method.** `newegg-gpus-live` — the corpus entry recorded in `docs/roadmap.md` as exercising "JSON-LD + APIs" (P3b, 2026-08-18) — was chosen specifically because it is the only seeded source whose extraction chain touches intercepted APIs at all; AbeBooks was considered and rejected (its search results are server-rendered HTML, proven by the 2026-08-21 walk above, so it almost certainly exposes no JSON endpoint carrying detail URLs — running it would have spent money demonstrating a negative). Budget was raised from `{max_items: 5, max_pages: 1}` to `{max_items: 60, max_pages: 3}` (so `max_pages` would bind) for one plan run, then restored. Full transcript, SQL, and run id: `.superpowers/sdd/2026-08-22-api-param-pagination/task-8-report.md`.

**What happened: no anti-bot interstitial, a clean category-page capture, and `api-param` fell through.** `crawl-plan.ts` against `newegg-gpus-live` (run `c889faea-3417-4d36-97cd-1907e55653af`) planned 60 detail items across all 3 listing pages (12 / 36 / 12 by `page_number`) in 134s. `domain_intelligence.pagination_config` for `(www.newegg.com, listing)` is `{"strategy": "url-pattern", "urlTemplate": "https://www.newegg.com/p/pl?N=100006662&page={N}"}` — the pre-existing mechanical HTML pager, not `api-param`. **No warning was printed at the time of the run** — and that silence was a gap, not a finding. The warning as it then stood only fired when `findListingApi` had found a candidate *endpoint* and no parameter verified against it, so the "no endpoint at all" case said nothing, and the diagnosis below had to be reconstructed by hand from intercepted-request dumps. **That gap is now closed** (`apiParamReason` in `plan-run.ts`): an attempt carries a reason — `no-listing-api`, `no-candidates`, `none-verified` — plus how many GET/JSON/2xx responses were considered, and `planRun` emits one reason-specific warning whenever there was anything to consider at all. A future run in this situation will say so directly. **Re-running this same plan would now produce a warning where the transcript below shows none; the transcript is the record of what the code did on 2026-08-24, not of what it does today.** Here, `findListingApi` returned `null` outright — of the 34 intercepted requests (10 JSON-bearing), none had an array-of-objects overlapping page 1's 12 detail-URL identifiers at ≥3 matches / ≥50% share. The browser's own log line for the largest JSON response, `api/CountryApi` (1144 bytes), confirms it's a locale widget, not a product feed. Field extraction (a separate, independent code path) corroborates the same conclusion from the other direction: `detail_url` for this run was sourced from `json-ld`/`xpath` (`[extract] Sources: {"category_name":"json-ld","detail_url":"xpath"}`), never from an API path, meaning no listing API was visible to the AI-API extraction tier either. **This is the "no candidate endpoint at all" case — distinct from "endpoint found, every candidate rejected."** The `REPLAY_MAX_OVERLAP` overlap check in `api-param-candidates.ts` was never reached; the miss happened one gate earlier, at `findListingApi`'s multiplicity bar in `find-listing-api.ts`.

**What this means for the thresholds.** `API_MATCH_MIN_COUNT = 3`, `API_MATCH_MIN_SHARE = 0.5`, and `REPLAY_MAX_OVERLAP = 0.5` were all picked from reasoning, not traffic, when this feature was designed. This run is the first real data point, and what it shows is negative but specific: on this one real category page, the observed match count/share for every intercepted JSON response against page 1's 12 detail-URL identifiers was low enough that none crossed `API_MATCH_MIN_COUNT`/`API_MATCH_MIN_SHARE` (the exact matched/share numbers per candidate response were not logged — `findListingApi` returns only the best match or `null`, not a ranked list of near-misses — so "how close" is not knowable from this run without adding that instrumentation). No candidate ever reached the `overlapShare`/`REPLAY_MAX_OVERLAP` check, so this run says nothing about whether `0.5` is the right overlap bar — it only exercises the earlier gate. Newegg's category page renders its listing server-side (HTML + JSON-LD); the JSON it does expose over the wire on this page is unrelated widget/telemetry traffic, not the product grid. That is a fact about this one page, not a refutation of the `api-param` design — a listing that genuinely paginates by replaying its own JSON (the case this feature targets) would behave differently, and this corpus does not currently contain one that both (a) is known to load its grid from a same-origin JSON endpoint and (b) is safe to hit live without an anti-bot block.

**What this run does NOT prove.** `api-param`'s detection-and-probe machinery, its overlap guard, and its `planRun` JSON-walk integration remain proven only offline (unit tests + the Tier 1 fixture-server test, which fails if a fixture's page 2 re-serves page 1). No real site has yet been observed picking `source: api-param`. **Cursor-based APIs, POST/GraphQL endpoints, and DOM-driven infinite scroll remain wholly unsupported** — `api-param` only ever considers GET requests carrying a page-number-shaped query parameter (see `rankCandidates` in `api-param-candidates.ts`); none of the corpus's live sources have been shown to need those, and nothing in this task changes that gap. The (still unbuilt) DOM-scroll cycle referenced in the roadmap's v2 section is what would eventually cover infinite scroll and load-more — `api-param` does not and was never meant to.

## `api-param` pre-merge fix wave (2026-08-24)

A whole-branch review of `feat/api-param-pagination` returned DO NOT MERGE. Eight findings plus
minors, all fixed on the branch (`ec1b840`..`1820aaa`); full write-up with every teeth-check in
`.superpowers/sdd/2026-08-22-api-param-pagination/merge-fix-report.md`. The two that matter beyond
this feature:

**The walk fabricated detail URLs, and cached the config that did it** — the 2026-08-21 AbeBooks
failure class with a new trigger. `collectRowUrls` accepted any non-empty string at
`itemsPath[].urlPath`, and the walk resolved it against the API endpoint's own URL rather than the
listing page's. Two demonstrated failures: an API answering in bare slugs produced
`/java-in-depth` where the real URL is `/books/java-in-depth` (detection verifies a slug API
happily — identifiers compare as trailing path segments), and a cross-origin API host
(`api.<site>` fronting `www.<site>`) put every page-2+ URL on the wrong host. In both cases
`gained > 0`, nothing warned, and the config reached the cross-customer domain cache. Now resolved
against the listing page, and each value measured against the shape page 1 itself demonstrated —
same origin, inside the longest directory prefix page 1's own detail URLs agree on. A refusal stops
the walk, keeps page 1, names the value, and caches nothing (`api-row-urls.ts`). Spec §4 required
this and it had never been implemented.

**A credential that persists in the client cannot pin which document issued a request.** The Tier 1
cookie gate's comment claimed that verification succeeding "is itself the proof that the fetch ran
in the page". It was not: the browser's cookie jar outlives one `evaluate`, so the proof only held
because that test ran first in a freshly launched browser. Mutating the walk's navigation target
left all 192 tests green. Both gates now assert the `Referer` a same-origin fetch sets to the full
URL of the issuing document. Worth remembering the next time a fixture is built to prove where a
request came from.

Also corrected, because it is easy to believe otherwise: `fetch(credentials: 'include')` restores
cookies and HTTP Basic/Digest auth, **never** a JS-set `Authorization` or CSRF header. A site whose
listing XHRs carry a JS-set bearer token 401s every probe and correctly falls through — but a 401
there must not be read as "the parameter was wrong". Spec §3 had claimed the opposite.

## DOM-scroll pagination — live proof (2026-08-25)

Task 6 of `docs/superpowers/plans/2026-08-24-dom-scroll-pagination.md`. **Plan-only** — listing pages
only, no detail fetches.

**Target selection was evidence-first, and that is the transferable part.** The `api-param` live proof
failed because its target came from a roadmap note; Newegg renders its grid server-side, so the strategy
never got a candidate to try. This time nothing was spent until a free probe
(`packages/browser/scroll-probe.mts`) had shown the page actually grows. Three candidates, measured by
counting distinct product links across scroll rounds:

| Candidate | Series | Verdict |
|---|---|---|
| `uniqlo.com/us/en/men/tops` | 37 → 73 → 109 → 145 → 181 → 217 → **221** | grows, then tapers — a real finite scroll list |
| `target.com/c/laptops…` | 0, flat, empty `<title>` | anti-bot block page, not a listing |
| `currys.co.uk/…/laptops` | 116, flat | server-rendered, paginated |

The Uniqlo taper (+36 per round, then +4) is what made it the right target: it proves the list *ends*,
so the quiet-round rule could be exercised live rather than the budget simply binding.

**Budget rulings, both deliberate departures from the plan's text.** The plan's Step 2 says
`{max_items: 40, max_pages: 1}`. Both numbers were changed, for reasons worth keeping:

- **`max_items: 250`, not 40.** In plan-only mode item count does not drive spend — the AI cost is page-1
  schema discovery, identical either way. With 37 products on the first screen a cap of 40 binds after one
  round and proves little more than the fixtures already do. 250 let the walk run to natural exhaustion.
- **`max_pages: 3`, not 1.** `max_pages: 1` takes the short-circuit branch that (by follow-up 2 below)
  never consults the cache — so Step 4's warm-replay proof would have been untestable. `max_pages` is not
  consulted by this strategy anyway, so raising it changes nothing about the walk.

> **RESOLVED (same day, commit `5473e89`).** The walk now plans 220 of 220 on this
> listing, twice in a row. Root cause and the two wrong turns on the way to it are below;
> the run-by-run numbers in this section are kept because the *pattern* across them is the
> evidence, and because two confident diagnoses died here.
>
> | Run | page 1 saw | scroll rounds (rows→planned) | planned | verdict |
> |---|---|---|---|---|
> | `a2c67dc9` cold | 144 | *(no trail yet)* 36 / 36 / 4 | 220 | right by luck |
> | `03c5cc22` warm | 144 | *(no trail yet)* — gained 0 | 144 | lost 76 |
> | `4dd07799` warm | 72 | 36→36, 36→36, 4→4 | 148 | lost 72 |
> | `71af7d6b` **fixed** | 144 | **180→36**, 36→36, 4→4 | **220** | complete |
> | `3c007f3a` **fixed** | 108 | **180→72**, 36→36, 4→4 | **220** | complete |
>
> **Root cause.** `scrollPages` opens its OWN page, and how much a lazy listing has loaded
> by the time it starts is a race — 36, 108 and ~144 rows were observed on the same URL.
> Page 1's rows come from `capture`, a different navigation, which observed 144, 144 and 72.
> The generator stamped its whole initial view before the first scroll, reasoning it
> "belongs to page 1, which the caller already has". The two views overlap only by
> coincidence; everything in the gap was stamped unseen and never yielded, invisibly,
> because a stamped row is indistinguishable from one already reported.
>
> **The fix, and why it is the spec's own rule.** The generator now yields what it can see
> on the first round and lets `absorb` dedupe. Spec §4 already said correctness comes from
> the caller's `seen` set and that labels are only an optimisation — stamping the initial
> view had quietly promoted the label to load-bearing. The last two rows above are the
> proof: the round-2 `planned` count (36 vs 72) absorbs page 1's swing (144 vs 108) and the
> total lands on 220 either way. **The total is now invariant under the race that used to
> determine it.**
>
> **Coupled change.** Once the first round yields the initial view, that round is usually
> ALL duplicates of page 1 — which used to break the walk. Only `'budget'` is terminal now;
> a fully-duplicate round is the normal shape of a scroll round, and the generator's
> quiet-round rule is what decides the list has ended. That closes the old follow-up 1.
>
> **Two wrong diagnoses, kept because both were confidently written down.** First: "the
> warm path caches no row definition, so `row_xpath` drifts." Dead — `planned == rows` in
> every round, so nothing was being mis-scoped. Second: "the walk stops after three rounds
> and never exhausts the listing." Also dead — the walk reaches the end and stops correctly
> on two quiet rounds; it was the *start* that was wrong, not the end. Both survived because
> the totals were plausible. What killed them was instrumenting the generator
> (`SCROLL_DEBUG=1`) and watching it run.
>
> <details><summary>Superseded analysis, kept for the reasoning trail</summary>
>
> **CORRECTION (after the audit-trail fix `c029cc6`).** Everything from
> "Cold run" to the end of the warm-run analysis below was written before scroll rounds
> were observable, and two of its conclusions are wrong. A third plan run
> (`4dd07799-eacd-4eb7-8551-a59ae87ea1df`) with the trail in place shows:
>
> | Run | page 1 | scroll rounds (rows/planned) | total |
> |---|---|---|---|
> | cold `a2c67dc9` | 144 | 36 / 36 / 4 | 220 |
> | warm `03c5cc22` | 144 | *(no trail — not observable)* | 144 |
> | warm `4dd07799` | **72** | 36 / 36 / 4, every row planned | 148 |
>
> - **"Ended by the quiet-round rule at the list's end" is not supported.** The walk yields
>   exactly three rounds and stops, identically in both runs where it ran, on a page holding
>   ~221 products. 220 was page 1's 144 plus the walk's 76 — two partial views summing.
>   The budget never bound, but neither did the end of the list.
> - **The warm-path row-definition theory is dead.** `planned` equals `rows` in all three
>   rounds, so the walk plans everything it yields: nothing is being lost to a bad
>   `row_xpath`, and nothing is being lost to duplicates.
> - **Page-1 extraction is itself variable** (144, 144, 72) — capture scrolls the page while
>   tiling screenshots, so how much has loaded when page 1 is extracted is a race. That is a
>   second, independent source of variance and it is not the scroll walk's doing.
> - **The zero-gain warm run did NOT reproduce.** Run `4dd07799` gained 76. Whatever
>   happened in `03c5cc22` is still unexplained; it is now bounded to "no rounds yielded" vs
>   "rounds yielded, all duplicates", and the trail will say which if it recurs.
>
> **Open question for the next cycle:** why three rounds? The free probe walks the same page
> 37 → 73 → 109 → 145 → 181 → 217 → 221 with 2.5s pauses, so the content is there. The walk
> stopping at ~113 products points at the generator's growth wait
> (`GROWTH_TIMEOUT_MS = 3000`) or its quiet-round accounting, neither of which is observable
> from outside. Instrumenting the generator's per-round row counts is the next step — the
> trail records what was *yielded*, not what the generator *saw*.

**Cold run — as originally written (run `a2c67dc9-eeb2-442d-bea3-56e3f27bbcf9`, 173.2s).** 220 detail items, 220
distinct URLs, **zero duplicates**. Detail items by `page_number`, which for this strategy is the scroll
round: **144 / 36 / 36 / 4**. The budget of 250 never bound, so the walk was ended by two consecutive quiet
rounds — **the quiet-round rule, live**. The final +4 round matches the probe's taper exactly.
`domain_intelligence.pagination_config` for `(www.uniqlo.com, listing)` is `{"strategy": "dom-scroll"}`.
The reason-specific `api-param` warning added in the previous cycle also fired correctly and for the right
reason ("no intercepted JSON response carried page 1's detail URLs, 2 considered"), which is incidental
live confirmation that *that* fix works.

**Warm run — the defect (run `03c5cc22-57f0-4ece-a30e-934e591c9a62`, 176.8s).** `domain cache: warm`, so
the cached config was read. But: **144 detail items, `page_number` 1 only**, all 144 a subset of the cold
run's 220. The scroll walk gained nothing, and the only signal was
`pagination (cache: dom-scroll) produced no new items` — which reads as *"the list is finished"*, not
*"I stopped 76 products early"*.

**What is established, and what is inference.** Proven: both runs' numbers above; the page still grows on
scroll when re-probed *after* both runs, so this is not throttling and not a site change; `rowSelector` is
written in exactly one place in the codebase (`packages/api/src/routers/scraper.ts:130`, with
`source: 'human'`), so the automatic path **never** persists it; and the two runs recorded *different*
row-level `detail_url` xpaths (`.//@href` cold, `.//a[contains(@class,"product-tile__link")]/@href` warm).

Inferred, and needing its own cycle to confirm: **`dom-scroll` is the first cached strategy whose
behaviour depends on something the cache does not store.** `url-pattern` caches a self-contained template;
`{"strategy": "dom-scroll"}` caches nothing about *what a row is*, yet the walk's growth detection
(`rowCountScript`), its stamping, and its extraction scoping (`unseenXpath`) all key off `row_xpath`,
which is re-derived per run. A warm run can therefore scroll with a different row definition than the one
that was verified when the config was cached.

**One thing the run could NOT distinguish, and why.** "The generator yielded zero rounds" and "rounds were
yielded but every row was a duplicate" produce identical evidence — same item count, same warning, same
`page_number` distribution. The per-round `listing` rows would have told them apart, but scrolling never
changes the URL, so all of a run's per-round listing rows collapse to one under the unique index. That was
logged as a cosmetic follow-up on the branch; it is not cosmetic, it destroys the per-round audit trail,
and it is now the first thing to fix before re-running this.

</details>

**What these runs do NOT prove.** No detail page was fetched, so per-item extraction is untouched by them.
The load-more *button* trigger was never exercised — Uniqlo scrolls, and `findLoadMore` returned nothing,
so the cached config has no `loadMoreSelector`. Cursor APIs and POST/GraphQL remain uncovered by
`api-param`; this strategy covers them only incidentally, and nothing about those transports was tested.
No anti-bot interference on Uniqlo across four separate sessions; **Target blocked every request**, which
is a corpus fact.

**Corpus addition.** `uniqlo-scroll-live` is seeded (source `ffff6666-…-006`, input set
`eeee5555-…-005`) and is the corpus's only known infinite-scroll target. Its budget is left at the
conservative `{max_items: 40, max_pages: 3}`; the 250 used for the proof was a deliberate one-run raise.

## DOM-scroll pagination (2026-08-25)

The transport-agnostic last rung. Every other strategy needs a thing to act on — a URL template, a
next button, numbered links, a JSON endpoint with a page parameter. A listing that loads by scrolling
has none of them, and until now produced `no pagination detected … — planned page 1 only`.

**What it does.** `IBrowser.scrollPages` (`packages/browser/src/playwright-browser.ts`) is an async
generator that owns its page for the duration: it scrolls (or clicks a heuristic-matched load-more
button), waits for the row count to actually grow rather than sleeping a fixed delay, re-runs page 1's
own extraction plan scoped to unlabelled rows, stamps what it extracted, and yields the batch. It has
to live in the browser package: `IBrowser.evaluate(url, script)` navigates, so a Node-driven loop would
reload the page every round and destroy everything already loaded. `planRun` calls it from two places —
the give-up point where detection came back empty, and the `max_pages <= 1` branch, which is the one
rung such a config can actually use.

**Three things that are load-bearing and non-obvious, each established by measurement, not reasoning:**

- **The scroll trigger scrolls UP and then down.** `window.scrollTo(0, document.body.scrollHeight)`
  alone yields row counts `[1, 2, 2, 2]` — it stalls after one batch, because the page is already at the
  bottom and no new scroll event fires. `scrollTo(0, 0)` then `scrollTo(0, bottom)` yields `[1, 2, 3, 4]`.
  The comment in the source records both sequences; don't "simplify" it back.
- **`rowCountScript` deliberately counts ALL rows, stamped or not.** The growth wait is about the DOM
  growing, not about new *unseen* rows appearing; counting only unstamped rows makes a recycling list
  look permanently quiet.
- **The extraction script forces LISTING page-type.** `buildExtractionScript`'s `auto` heuristic flips to
  detail mode at 0-or-1 rows, and detail mode's fallback re-searches the whole document — which defeats
  the quiet-round check and produced five 60s timeouts before it was found. This was invisible to string
  assertions and to mutation testing; it only surfaced by running the built artifact in a real browser.

**Budgets.** `max_items` is the only budget consulted, and it counts **planned items, not yielded rows** —
`absorb`'s dedupe is what turns rows into items and it lives in Node, where the generator cannot see it.
`max_pages` is deliberately ignored so a Source configured for HTML pagination cannot silently cap a
scroll listing at two rounds. That makes `max_items`, `QUIET_ROUNDS = 2` and `MAX_SCROLL_ROUNDS = 50`
load-bearing rather than backstops, which is why the last exists.

**Labels are an optimisation, never correctness.** Rows are stamped `data-robot-seen` so round N extracts
only new cards — linear instead of quadratic over a 500-item scroll. When a virtualized list recycles a
node the stamp goes with it, the card is re-extracted, and the URL dedupe discards it. Nothing breaks.

**No AI fallback for the load-more selector, on purpose.** The spec allowed one; the cycle did not build it,
and the whole-branch review sharpened the reason: `gained > 0` does not verify a *button*. A "Show more
colours" facet toggle yields real, well-formed detail URLs and would satisfy that gate — so an AI-chosen
selector would be an unverified answer entering the cache tier, which is the failure this project has
been burned by twice (the AbeBooks `ds` template, the api-param fabricated URLs). If it is ever built, it
needs a verification that distinguishes "more of the same list" from "a different subset of the list".

**Quality of the gate.** The whole-branch review prescribed eight mutations and **all eight were killed** —
this repo's first clean mutation sweep, after a cycle that produced ten tests that ran fine and proved
nothing. Two worth remembering: `QUIET_ROUNDS 2 → 1` fails exactly one test *while making the suite
faster* (a mutation that looks like an improvement), and deleting the stamping script fails six tests, of
which only one fails on a **value** rather than a 60s timeout — the kind of coverage that quietly
evaporates during a timeout-tuning session.

**Pre-merge fix wave** (`c9f3105`, `41ed593`, `c1d4dbd`). The review returned DO NOT MERGE on one finding:
both scroll call sites sat **outside** the per-input try/catch that isolates a pagination failure, because
both `continue` before it. A throw from the live walk — `navigateWithFallback`, `dismissPopups`, any
`page.evaluate`, none of them `.catch`-guarded — therefore rejected `planRun` itself, so the run was marked
`failed` and `insert(runItems)` was never reached: **every already-planned input's detail URLs discarded.**
Verified with a throwing stub at both sites, not by reading. Fixed with a wrapper at each site, duplicated
rather than factored out precisely so one deletion cannot unguard both. Two more fixed in the same wave:
the item budget counting yielded rows (silent under-delivery on exactly the virtualized listings this
feature exists for), and the multi-round property having no teeth — every fixture used a single round, so
capping rounds at `max_pages` left the whole suite green.

**Open follow-ups, in rough priority order.** Reordered after the live proof: the warm-path defect it
found now leads, and the "duplicate listing row" item was promoted out of cosmetic because it is what
stopped the run from being self-diagnosing.

0. ~~The walk does not exhaust the listing.~~ **Fixed** in `5473e89` — root cause was the generator
   discarding its own initial view, not an early stop. 220 of 220, twice. See the RESOLVED block above.
0b. ~~Per-round `listing` rows collapse under the unique index.~~ **Fixed** in `c029cc6`: rounds are
   not pages, so the trail lives on page 1's row as `listing_values.scroll_rounds`, one entry per
   yielded round carrying `rows` and `planned`. Every diagnosis since came off that trail.
0c. ~~Page-1 extraction is racy.~~ **Fixed** in `914dd90`. It was not the screenshot tiling — `page.content()`
   is taken before the tiles. It was `expandHiddenContent`'s Phase 1 clicking its structural selectors
   (`[aria-expanded="false"]`, `details summary`) through a Playwright **locator**, which scrolls the
   element into view to click it; on a lazy listing that loads batches. Phase 1 now clicks in the page,
   as Phase 2 already did. Deliberately NOT fixed by skipping out-of-viewport elements — collapsed spec
   panels on a detail page are almost always below the fold, and that would have silently stopped
   expanding them. **Verified against a fixture only**: Uniqlo started returning Akamai "Access Denied"
   before it could be re-checked live, so the JS-click-vs-real-click change has no live confirmation yet.
   If detail-page extraction quality dips, this is the first place to look.
0d. **`uniqlo-scroll-live` is rate-limited.** Akamai "Access Denied" after roughly ten runs on
   2026-08-25 — plan runs, the free scroll probe and the generator harness combined. Not a code defect;
   the spec's risk table predicted repeated scrolling would be a visible bot signal, though cumulative
   request volume is the likelier cause. **Back off before using this source again**, and expect the
   first re-run to be a block rather than a regression.
0e. **The load-more button trigger has never run live.** Uniqlo scrolls, so `findLoadMore` returned
   nothing and the cached config carries no `loadMoreSelector`. That half of the strategy is still
   fixture-only.

1. **`walkScrollPages` breaks on any non-null `absorb` result, so `'all-duplicates'` ends a scroll walk
   after ONE quiet round** — bypassing `QUIET_ROUNDS` and contradicting the spec's own stop-signal
   decision ("a single slow round is not the end of a list; treating it as one is silent truncation").
   Reachable: the generator waits for *row-count* growth, and on a virtualized list growth can be pure
   recycling, so a window re-serving only seen cards reads as all-duplicates mid-list. Not fixed in the
   wave because the break is shared verbatim with the HTML and api-param walkers, where it IS
   load-bearing — diverging scroll from them is a design decision, not a three-line fix.
2. The `max_pages <= 1` branch never consults the cache before scrolling, so it can overwrite a proven
   config without the `replacing` warning the main path emits, and re-writes it once per input.
3. A domain with a stale **non-scroll** cached config can never reach the scroll rung — a site that
   replaces its pager with infinite scroll stays stuck on page 1 until someone clears the row by hand.
4. `[role=button]` is in the spec's load-more heuristic but in neither the code nor the tests.
5. A false-positive `loadMoreSelector` disables scrolling entirely, because the trigger is an if/else.
6. `ScrollOptions.maxItems` now has no production caller; only its doc comment stands between a future
   caller and the row-vs-item bug that was just fixed.

**What this does NOT prove.** No live site has exercised it. Cursor-based APIs, POST and GraphQL endpoints
remain uncovered by `api-param`, and are covered by this rung only insofar as they make the DOM grow —
which is the whole point of the design, but is untested against a real one.

## Cache-conflict triage (2026-08-25)

Marko's "cache conflicts / AI indecisive" complaint, triaged against the actual
`domain_intelligence` contents (15 conflicting fields across 4 domains). Every candidate value was
inspected; the classification below is from that evidence, not from the taxonomy that predicted it.

**The mechanisms actually present — five, not three:**

1. **Poisoned paths** (wrong-entity paths with perfect hit records). Confirmed instances:
   Newegg `product_name` ← api `Configs[0].name` (a feature-flag label — the motivating case
   already documented in `domain-cache.ts`); Newegg `image_url` ← json-ld `thumbnailUrl` (a
   YouTube review thumbnail, and it OUTRANKED the real og:image on hits 6-2); Newegg listing
   `detail_url` ← `.//a` / `.//a[@href]` (privacy-policy links, low-ranked but present); B&N
   `image_url` ← a Yotpo *customer review photo*. Two structural findings: **a poisoned path can
   never prune itself** — `hits` counts "returned non-empty", so garbage paths have 100% hit
   rates and the ≤10% prune bar never triggers; and **a sole poisoned path is invisible to
   conflict detection**, which needs ≥2 valued paths — Target `availability` (delivery date) is
   exactly this, so the worst case never appears in the conflicts UI.
2. **Multiple simultaneously valid values** — the biggest bucket, and exactly Open decision 1 /
   vision Pillar 1: Newegg `category` (breadcrumb "Internal SSDs" vs API "SSD"), `description`
   (json-ld long vs meta short), Target `review_count` (rating count 5 vs review count 3 — two
   different metrics), B&N `rating_value`/`review_count` (site's json-ld vs Yotpo — two different
   review systems). No fix exists at the extraction layer; needs labelling.
3. **Format-only disagreement**: Target `price` "$299.00" (api) vs `299` (api-ai) — same fact,
   `valuesMatch` sees a conflict. A normalization in `valuesMatch` would silence this class.
4. **Stale cross-page comparisons** (false conflicts): AbeBooks `product_name` api-vs-xpath and
   Newegg `product_name` json-ld-vs-og:title "conflicts" compare `lastValue`s captured on
   *different pages* (different products entirely). `detectPathConflicts` has no way to know two
   paths were last exercised on different URLs. **Cross-validation flip-flop, the third
   predicted mechanism, was NOT observed — what looks like it is this staleness artifact.**
5. **AI path-identity churn**: `ai-discovered-variants` uses the AI's prose *description* as the
   path key, so every re-discovery adds a "new" path (Newegg `variants`: 5 near-duplicate
   entries). Inflates conflicts and crowds the 5-path cap.

**Acted on (2026-08-25):** Newegg `product_name` pinned to json-ld `name`, Newegg `image_url`
pinned to meta `og:image` — via the real `pinFieldPath` machinery, verified in the DB (one pin per
field, losers kept with stats). The pin machinery itself is fully wired end to end (ranking,
prune protection, tRPC, domain-detail UI) — nothing needed building.

**Left for Marko:** Target `availability` (delete the sole poisoned path by hand + re-discover, or
wait for labelling); the low-ranked junk `detail_url` xpaths (harmless while outranked); classes
2-5, which are design work — class 2 is the candidate-labelling spec (v2.5), classes 3-5 are
small extraction-layer fixes worth folding into that same cycle.

## What NOT to redo

- **Don't reintroduce uppercase tracked labels, or cards outside dialogs and the websites list.** Both are spec decisions (§6 copy, §7 cards), both were removed screen by screen in phase 5, and both are the first thing a component copied from an older file will bring back. Secondary labels are `label-soft`; everything that is not a dialog or the websites list sits on the paper with rules.
- **Don't reach for `!important` to make an active state win.** TanStack Router's `Link` concatenates `activeProps.className` onto `className`, so an active override fights its own base class at equal specificity. Compute the active state with `useRouterState` and pick one non-overlapping class string — `sub-tab-nav.tsx` and `layout.tsx` both do it that way now.
- **Don't use `git add` followed by `git commit` when more than one agent shares the checkout.** The index is per-checkout: one agent's commit sweeps up whatever another agent has staged. `git commit -m … -- <paths>` is atomic and is the rule for multi-agent phases.
- **The API-side entity filter.** Tried and reverted (`c606a54`). Documented on `filterRequestsForPage` in `entity-match.ts`, captured as a test.
- **Don't chase the price/rating "wrong" verdicts as bugs.** Four of the eight remaining wrong verdicts are cases where the extractor returned a real value and nothing said which of several valid values was wanted. They need the labelling design (Open decision 1 below), not a fix.
- **Don't re-run the AbeBooks or Newegg live crawls to get a better-looking result.** The two v2 runs above (one broken, one fixed) are what happened; that task was authorised for exactly one planning + one execution run after the fix, and that budget is spent. Both runs stay in the DB as the record.
- **The shared-browser-close bug is fixed** (`376b7ac`, plus the `analysis-orchestrator.ts` half and the structural `withBrowserSession` fix from the review round) — don't reopen it or re-derive the root cause; read "The fix, and its follow-up" above instead.
- **Don't re-run the pagination-walk or cancel/resume proofs to get a better-looking result.** Runs `4bf71da9…`, `aeaab1db…` and the two cancel/resume cycles are the record; that budget is spent and restored. If `deriveTemplate`'s AbeBooks bug gets fixed, a fresh live run to reprove it is legitimate new work, not a re-run of this one.
- **Don't rebuild or "simplify" the three measured details in `scrollPages`** — the up-then-down scroll trigger, `rowCountScript` counting all rows, and the forced LISTING page-type. Each was established by watching real Chromium behave, each carries a comment saying why, and each looks like dead weight to a reader who wasn't there. See "DOM-scroll pagination (2026-08-25)" above.
- **The `deriveTemplate` wrong-page-parameter bug is FIXED (2026-08-25) — don't re-derive it.** The root cause was sharper than "wrong choice among plausible params": it templated the FIRST changed numeric param in URL order, which on AbeBooks was `ds` — the page-size constant — so the 2026-08-21 walk fetched pages sized 2 and 3 items (that is what the 2/1 stray yields were). The fix reads the page's own pager-link series: stride-1 param beats offset beats constant; known-name prior as tiebreak/fallback; old behaviour when no evidence exists. Gated against the real captured AbeBooks page (`p={N}` now). Remaining, recorded in the roadmap: `{N}` is the literal page number while AbeBooks' `p` is 0-indexed, so walks run one page offset until stride/base-aware template semantics exist.
- **Don't re-run the `api-param` live proof against `newegg-gpus-live` to get a better-looking result.** Run `c889faea-3417-4d36-97cd-1907e55653af` (2026-08-24) is the record; that budget is spent and the source's budget is restored to `{max_items: 5, max_pages: 1}`. It fell through to `mechanical` — see "`api-param` pagination — live proof (2026-08-24)" above. If a corpus site is added that is known to load its listing from a same-origin JSON endpoint, a fresh live run against *that* site is legitimate new work, not a re-run of this one.
- **Don't run the v2.5 candidate-labelling live dogfood (Task 11 Step 4) without Marko's explicit go.** It spends ~$0.15 + API budget and sets `ANTHROPIC_API_KEY`. Steps 1-3 (the Tier 1 fixture gate) landed 2026-08-26 — see "v2.5 candidate labelling — Task 11" above.

## Open decisions (need Marko, not code)

1. **Candidate labelling** (`docs/ideas.md` → "Label every candidate instead of picking one"). Premise confirmed: one Newegg page carries four simultaneously valid prices and the *displayed* price matches none of the API fields. Marko's direction — label all candidates, let the customer choose, per-domain catalogue and per-dataset selection — is recorded and deserves its own spec. Still open.
2. **Proxy budget.** Anti-bot remains the dominant schedule risk for the pipeline generally; unrelated to the v2 crawler work above.

## Suggested next work

1. ~~Fix `deriveTemplate`'s page-parameter choice~~ **Both halves done (2026-08-25):** the verification gate refuses thin non-budget-stopped walks, and `deriveTemplate` now chooses the pager by series evidence (see "What NOT to redo"). A fresh live AbeBooks run to re-prove the walk end to end is legitimate new work when a budget is approved for it.
2. **Live-prove DOM-scroll** (Task 6 of `docs/superpowers/plans/2026-08-24-dom-scroll-pagination.md`, unstarted and needing approval): find a corpus-safe site that genuinely infinite-scrolls, confirm with `HEADFUL=1` that scrolling adds products *before* spending anything, then plan-only with the budget shaped so `max_items` binds. Fix follow-up 1 above (the `'all-duplicates'` single-quiet-round stop) first or alongside — it is what a real virtualized listing would trigger.
3. From `docs/roadmap.md`'s v2 section: the progressive-confidence ladder (1 → 5 → 20 → 1000 URLs); a real job queue (an api-server restart still pauses a run — `run_items` survives so `execute` resumes it, but nothing resumes it automatically). `api-param` pagination detection and replay is now built and offline-gated (see above) but still wants a live site that actually exercises it — the corpus doesn't currently have a confirmed one.

## Cheap things worth doing whenever convenient

- **Never pick a live pagination target without `packages/browser/scroll-probe.mts` first.** It is free —
  no LLM, no database — navigates a candidate listing, scrolls it, and prints the distinct-product-link
  count per round. Two live proofs have now turned on this: `api-param`'s failed because its target was
  chosen from a roadmap note, and `dom-scroll`'s succeeded because three candidates were measured before
  anything was spent. Usage: `pnpm --filter @robot/browser exec tsx scroll-probe.mts "<url>" ["<url>"...]`,
  with `HEADFUL=1` to watch it.

- Measure the five unmeasured extraction-quality domains once (~$4): `bhphoto`, `abebooks`, `zalando`, `currys`, `uniqlo`.
- Capture Tier 1 fixtures for the corpus so the commit-time gate covers more than one eighth of it.
- `star_distribution` arrives as an object and is rejected as "not array".
- Target's `availability` returns a delivery date from a poisoned cached XPath — and **pinning cannot fix it**: it is the field's ONLY cached path, so there is nothing better to pin (see "Cache-conflict triage (2026-08-25)" below). It needs the path deleted by hand plus a re-discovery run, or the labelling design.

## Commands worth knowing

| Command | What it does |
|---|---|
| `docker start robot-platform-db` | Start Postgres first — the one non-obvious prerequisite on this machine. Everything below needs it running. |
| `pnpm -r test` | Free green gate. |
| `docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform -c "select domain, page_type from domain_intelligence where domain in ('example.com','listing.example','shop.example') or domain like 'test-%';"` | Cache-hygiene gate — run it **after** `pnpm -r test`, expect zero rows. The `test-%` prefix alone is not enough: the `planRun` unit fakes plan against `example.com` and `listing.example`, and an unstubbed `savePagination` in those fakes wrote real rows under those names for several commits without the prefix check noticing. `shop.example` joined the list 2026-09-07 — the customer-schema-verification fixture triple (`packages/scraper/src/__fixtures__/verify/`) is hosted under it. Add any new fake hostname to this list. |
| `pnpm typecheck` | `tsc --noEmit` (via each package's own `typecheck` script) in every package, run through turbo — `@robot/db`, `@robot/api`, `@robot/api-server`, `@robot/app`, `@robot/browser`, `@robot/agent` and `@robot/scraper` all have one. `@robot/dashboard` is deleted (cut-over, plan 6) and no longer exists to check. |
| `pnpm --filter @robot/api exec tsx src/crawl-plan.ts <sourceId\|slug>` | Phase 1 CLI — plan a crawl. |
| `pnpm --filter @robot/api exec tsx src/crawl-execute.ts <runId>` | Phase 2 CLI — execute a planned run, spends money. |
| `pnpm --filter @robot/api exec tsx src/judge-run.ts <runId> [--max-items N] [--max-usd X] [--fields a,b] [--tiles N] [--dry-run]` | Judge a completed run's stored values against freshly captured pages with the Tier 2 judge (hit rate is not correctness); writes `docs/testing/results/<stamp>-judge-run-<site>.md`, no DB writes. Paid (~$0.0086 per judge call; up to 3 screenshot tiles per value while "not on page"; URL values free; default cap $5); `--dry-run` is free and prints the work list and max cost. |
| `pnpm test:judge` | Calibrates both judges against known answers (live, paid). |
| `pnpm test:liveness` | Do the fixtures still match the pages they claim? (live, free) |
| `pnpm test:ui:app` | `@robot/app` route smoke (signs in as a throwaway address, walks every screen in both themes, screenshots into `docs/testing/screens/`); needs `pnpm dev:all`. The old dashboard's `pnpm test:ui` is gone with the package it tested. |

**Finder fixes (2026-10-12, from campaign 2's pre-screen, branch `fix/finder-errors`, merged fast-forward):** a browser that cannot launch yields one sentence everywhere ("We couldn't open a browser to read this page. Try again in a minute.", `BROWSER_UNAVAILABLE` in `verdict-copy.ts`) instead of the raw Playwright exception — in the finder, the reachability line and the proof card; the finder's capture is bounded to 20 s (networkidle and the fallback), so Find products answers within ~25 s on a site that never goes idle; the listing bar reads "Reading the listing… n s" while it works. Review clean; smoke 22 of 22. Known: the catch-all also labels a post-capture bug as the browser sentence (logged in full); the synthetic verdict kind is `crashed`.
