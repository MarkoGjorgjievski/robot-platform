# A fresh-user first run, end to end — design

**Status:** written 2026-10-25 under the standing approval (`CLAUDE.md`, "Autonomous runs"; `docs/queue.md` item 1,
"A fresh-user first run, end to end"). Branch `feat/first-run` from `main` @ `68a3c76a`, worktree
`C:\Users\Marko\Documents\projects\robot-platform-firstrun`.

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
