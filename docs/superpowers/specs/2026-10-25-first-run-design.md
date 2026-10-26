# A fresh-user first run, end to end — design

**Status:** implemented on `feat/first-run` and merged to `main` on 2026-10-26 (last code commit `6a2a59af`); written 2026-10-25 under the standing approval (`CLAUDE.md`, "Autonomous runs"; `docs/queue.md` item 1,
"A fresh-user first run, end to end"). Branch `feat/first-run` from `main` @ `68a3c76a`, worktree
`C:\Users\Marko\Documents\projects\robot-platform-firstrun`.

**Proven:** on the final code head (`411b6aa1`; the one later code commit, `6a2a59af`, changes only the script), against the isolated keyless pair (api-server :4100, its worker with
`WORKER_BROWSERS=1`, the built app on :3100), one vitest process per site, all three default sites passed all ten
steps (`docs/testing/results/2026-10-25-first-run/`):
- **IKEA** (sofas, `/my/en/cat/sofas-fu003/`): 77 products found; proof pages GLOSTAD 3-seat, KIVIK, GLOSTAD 2-seat;
  Title agreed, Price "different place on product 2" taken by its own Accept; Verify certified both 3/3 in 6 s; sample
  45 s; a 10-product, 1-page run Done in 55 s; CSV, JSON and Output 10 rows, every Title and Price filled, prices numeric.
- **Gymshark** (women's leggings): 124 found; three different leggings; both rows agreed; Verify 3/3 in 3 s; sample
  157 s; run Done in 105 s; 10 rows, "SoftSense™" kept.
- **Skullcandy** (headphones): 15 found; Title from the heading ("Crusher® ANC 2", "Crusher® 720", "Crusher® Evo");
  Verify 3/3 in 6 s; sample 250 s; run Done in 96 s; 10 rows.
No customer screen showed money. The route smoke passed 28 of 28 on the same isolated pair, first try. The scraper, api and app suites ran on this head in the fix wave; no
other package changed.

**Deviations:**
- §2 step 6, amended 2026-10-25 (ruling): a row's own one-click Accept is a normal new-customer action, so the script
  clicks it (IKEA's Price "different place on product N — check it" → Accept). "Fix on screenshot" / "Mark on
  screenshot" stay a trip.
- The run took five re-runs. It found 13 product defects, each fixed on the branch with a test (one line each; the
  triage is in `first-run.md`):
  1. Proof pages were colourways of one product (Gymshark, IKEA): Find products puts three products that differ first, and two card names where one begins the other are one product (`8d90a5d2`, `61c34484`).
  2. Title was the page data's name, not the page heading (Skullcandy "Crusher® 720 - Primer", IKEA "GLOSTAD … - Knisa dark grey"): the suggestion prefers the heading when the heading is the product's name, by the shallowest structured path, and the box map keeps a heading with no text of its own (`bb07cd66`, `16b3526a`, `0533765f`, `09f8d56b`, `fdaefd78`).
  3. A needs-you Title row offered no action: it offers "Fix on screenshot" (`bb07cd66`, `fcc95155`).
  4. "same on every product" showed while one product differed: only when every proof page's value is the same; otherwise "different place on product N" (`4b7e417b`).
  5. The address typed in Add website did not start the listing bar: it does when it can be a listing (`80c16036`).
  6. Product cards were named by the whole link text ("Save $70 on …", "SHOP …"): by the card's own title (`8c3d1216`).
  7. "Option: …" and radio-label links were products and card names: they are variant swatches (`25ab7284`).
  8. A run stored "SoftSenseTM" (NFKC) where Verify showed "SoftSense™": runs store text as Verify showed it, NFC; repairs match old NFKC variant keys too (`f01914a9`, `ab62b900`).
  9. The run page link and the export's `source.url` named the product page fetched last: the address the customer added (`b2d351d1`).
  10. Accept all agreed took part of a "different place" row and stranded the odd cell: it never takes part of a row, so the row keeps its own Accept (`5b734eb5`).
  11. The reachability line gave up after 30 s on a slow page ("took too long"): it waits up to 60 s (`326b9e1a`).
  12. A deleted website's jobs kept the worker busy: deleting a website, project or organisation stops its queued and running jobs (`f0ace845`).
  13. A "different place on product N" row's own Accept skipped product N, leaving only marking by hand: it takes every cell, the named product included, each with its own path (`12d718e9`); and one shared shown-text rule for headings and the shown check, so "Crusher® 720" never reads "Crusher ® 720" and inline spans never glue (`9b6802a6`).
- Script fixes (class c): one site per vitest process with `FIRST_RUN_MERGE=1` (memory); step 8 waits for the Extract
  tab to settle; the reachability line quotes "took too long"; the report keeps its hand-written triage outside
  generated markers; a start that fails before the report is loaded does not overwrite it.

## 1. Why

No test walks a brand-new customer from sign-in to a downloaded file. The route smoke stops before Verify and Extract
because they can spend. Keyless they are free, so a script can do the whole thing on real websites. The queue item:
a scripted new customer on three real sites, free and keyless; fix what trips it.

**Done when:** the script passes on all three.

## 2. The script

`packages/app/src/first-run.test.ts` is opt-in (`RUN_FIRST_RUN=1`). It runs against the isolated pair (keyless
api-server :4100, its worker, the app :3100; the same recipe as the smokes, with `SMTP_URL=`, `RECURRING_RUNS=off`
and `WEBSITE_CHECKS=off`). One real Chromium drives the real UI by roles and labels, as the route smoke does.

**Per site:** `FIRST_RUN_SITES` overrides the sites; the default is three entries. Each runs as its own throwaway
customer and records `firstRunEmail(site)` for cleanup:

| Site | Listing page | Fields |
|---|---|---|
| Gymshark | a women's leggings collection page (Shopify) | Title (text), Price (money) |
| Skullcandy | a headphones category page (BigCommerce) | Title, Price |
| IKEA | a sofas category page | Title, Price |

**Steps per site.** Each step's screenshot is saved to `docs/testing/results/2026-10-25-first-run/<site>-<n>.png`,
with a JSON step log:
1. Sign in at `/login` with a fresh `first-run-<site>-<stamp>@example.com`, and land on `/projects` with its empty
   state.
2. New project "First run <site>".
3. Fields page: add Title (Text) and Price (Money) from the catalogue.
4. Add website: paste the listing page and land on the Verification tab. The reachability line reads that the website
   opens.
5. Find products with the listing URL. It must say "N products found" (N ≥ 3) and capture three proof pages.
6. Accept all agreed. Every Title and Price cell must read agreed on all three proof pages. If a cell is missing, the
   script records it as a trip. It never marks by hand, because a new customer would need help there too.
7. Verify. The button reads "Verify 2 fields". Wait for the result: both fields certified, no customer-visible money.
8. Extract tab: set the run limits to 10 items and 1 page, then Extract. Wait for the run page to read done or partial.
9. On the run page, download the CSV and JSON. At least 5 rows, every row with a non-empty Title and Price, and the
   prices numeric.
10. Project Output shows the rows.
11. Cleanup: the throwaway org and user are deleted through the existing test helper's guarded delete. The seeded
    `default` org is never touched.

**Report.** Each step has a timeout (Verify 6 minutes, the run 8 minutes). A failed step stops that site, records the
step, the screenshot, the visible text and the last answers, and moves to the next site. The output is
`first-run.json` plus a short `first-run.md`: per site, the steps passed and what tripped, in one sentence each.

## 3. Fixing what trips

The first run is exploratory. Every trip is triaged:
- **(a) A product defect**, such as a wrong sentence, a stuck step, a bad default or an unclear state. It is fixed on
  this branch with a test, in the same SDD loop.
- **(b) A trap of that website**, such as a wall, a geo redirect or a field it doesn't have. The site is swapped for
  another known-mechanical site from campaign 2, and the reason is recorded.
- **(c) A test-script problem.** The script is fixed.

**Done** is three sites passing on the final head, with at least two of the three default sites unless one is a
recorded (b) swap.

## 4. Safety

- **Free:** keyless; no paid calls.
- **One browser at a time.** The live sites are loaded through the isolated pair's worker, and the script's own
  Chromium is the only other one.
- **Throwaway accounts:** the throwaway accounts are this script's own and are deleted afterwards; no other dev rows
  are touched.
- **Isolated:** Marko's dev servers and database rows are never used.

## 5. Not in this spec

- Marking by hand on real sites.
- More than two fields.
- Variants.
- Recurring runs.
- Email.
