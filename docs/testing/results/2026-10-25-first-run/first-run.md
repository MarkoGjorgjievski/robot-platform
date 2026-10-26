<!-- first-run:generated:start — written by first-run.test.ts; edit outside these markers -->
# First run — 2026-10-26T10:33:07.607Z

App http://localhost:3100, api http://localhost:4100.

## gymshark — passed (10 of 10 steps)

Listing: https://www.gymshark.com/collections/leggings/womens · ran 2026-10-26T09:51:05.736Z

1. ok — Sign in and land on /projects with its empty state (1 s)
2. ok — New project "First run gymshark": project first-run-gymshark (0 s)
3. ok — Fields: Title (Text) and Price (Money) from the catalogue (1 s)
4. ok — Add website with the listing page; land on Verification; the reachability line: website "Gymshark" (gymshark); This website opens normally. (13 s)
5. ok — Find products: "N products found" (N ≥ 3) and three proof pages ready: 124 products found · a pager too; 3 ready (75 s)
6. ok — Accept all agreed (and a row's own one-click Accept): Title and Price accepted on all three proof pages: Title on product 1: suggested, Everyday Seamless Leggings | Title on product 2: suggested, Everyday Seamless Flared Leggings | Title on product 3: suggested, Poise Seamless Leggings | Price on product 1: suggested, 38 | Price on product 2: suggested, 38 | Price on product 3: suggested, 30 (1 s)
7. ok — Verify: "Verify 2 fields", both fields certified, no customer-visible money: certified title, price in 3 s; Title "verified 3/3", Price "verified 3/3" (35 s)
8. ok — Extract: listing pages, a sample, run limits 10 items / 1 page, Extract; the run reads done or partial: listing page already saved; sample done in 175 s; limits 10/1 (1 listing · first 10 products from each · first 1 page of each · safety stop at 5,000 products per listing); run eccd6b18 reads "Extraction Done" after 103 s (363 s)
9. ok — Run page: download the CSV and JSON; ≥ 5 rows, Title and Price on every row, prices numeric: CSV 10 rows (Title, Price, _url, _page_number); JSON 10 rows (0 s)
10. ok — Project Output shows the rows: 10 rows on Output (1 s)
11. ok — Cleanup: the throwaway org and user deleted (guarded delete): deleted

## skullcandy — passed (10 of 10 steps)

Listing: https://www.skullcandy.com/collections/wireless-wired-bluetooth-headphones · ran 2026-10-26T09:59:40.038Z

1. ok — Sign in and land on /projects with its empty state (1 s)
2. ok — New project "First run skullcandy": project first-run-skullcandy (0 s)
3. ok — Fields: Title (Text) and Price (Money) from the catalogue (1 s)
4. ok — Add website with the listing page; land on Verification; the reachability line: website "Skullcandy" (skullcandy); This website opens normally. (14 s)
5. ok — Find products: "N products found" (N ≥ 3) and three proof pages ready: 15 products found · a pager too; 3 ready (93 s)
6. ok — Accept all agreed (and a row's own one-click Accept): Title and Price accepted on all three proof pages: Title on product 1: suggested, Crusher® ANC 2 | Title on product 2: suggested, Crusher® 720 | Title on product 3: suggested, Crusher® Evo | Price on product 1: suggested, 259.99 | Price on product 2: suggested, 209.99 | Price on product 3: suggested, 209.99 (1 s)
7. ok — Verify: "Verify 2 fields", both fields certified, no customer-visible money: certified title, price in 6 s; Title "verified 3/3", Price "verified 3/3" (38 s)
8. ok — Extract: listing pages, a sample, run limits 10 items / 1 page, Extract; the run reads done or partial: listing page already saved; sample done in 238 s; limits 10/1 (1 listing · first 10 products from each · first 1 page of each · safety stop at 5,000 products per listing); run 5ef3b732 reads "Extraction Done" after 93 s (416 s)
9. ok — Run page: download the CSV and JSON; ≥ 5 rows, Title and Price on every row, prices numeric: CSV 10 rows (Title, Price, _url, _page_number); JSON 10 rows (0 s)
10. ok — Project Output shows the rows: 10 rows on Output (1 s)
11. ok — Cleanup: the throwaway org and user deleted (guarded delete): deleted

## ikea — passed (10 of 10 steps)

Listing: https://www.ikea.com/my/en/cat/sofas-fu003/ · ran 2026-10-26T10:33:07.762Z

1. ok — Sign in and land on /projects with its empty state (4 s)
2. ok — New project "First run ikea": project first-run-ikea (0 s)
3. ok — Fields: Title (Text) and Price (Money) from the catalogue (2 s)
4. ok — Add website with the listing page; land on Verification; the reachability line: website "Ikea" (ikea); This website opens normally. (9 s)
5. ok — Find products: "N products found" (N ≥ 3) and three proof pages ready: 77 products found · a pager too; 3 ready (40 s)
6. ok — Accept all agreed (and a row's own one-click Accept): Title and Price accepted on all three proof pages: Price ("different place on product 2 — check it Accept") accepted with its own Accept; Title on product 1: suggested, GLOSTAD 3-seat sofa, Knisa dark grey | Title on product 2: suggested, KIVIK 3-seat sofa, Tibbleby beige/grey | Title on product 3: suggested, GLOSTAD 2-seat sofa, Knisa dark grey | Price on product 1: suggested, 449 | Price on product 2: suggested, 1495 | Price on product 3: suggested, 349 (1 s)
7. ok — Verify: "Verify 2 fields", both fields certified, no customer-visible money: certified title, price in 6 s; Title "verified 3/3", Price "verified 3/3" (38 s)
8. ok — Extract: listing pages, a sample, run limits 10 items / 1 page, Extract; the run reads done or partial: listing page already saved; sample done in 45 s; limits 10/1 (1 listing · first 10 products from each · first 1 page of each · safety stop at 5,000 products per listing); run e8072e16 reads "Extraction Done" after 55 s (121 s)
9. ok — Run page: download the CSV and JSON; ≥ 5 rows, Title and Price on every row, prices numeric: CSV 10 rows (Title, Price, _url, _page_number); JSON 10 rows (0 s)
10. ok — Project Output shows the rows: 10 rows on Output (1 s)
11. ok — Cleanup: the throwaway org and user deleted (guarded delete): deleted

<!-- first-run:generated:end -->

## Triage — Re-run 5, the gate (head 411b6aa1, written by hand, 2026-10-26): unfinished

Each site ran in its own vitest process: IKEA, then Gymshark, then Skullcandy (`FIRST_RUN_MERGE=1`,
`WORKER_BROWSERS=1`). Free memory was 3.8 GB before IKEA and 3.1 GB before Gymshark.

- **ikea: 10 of 10 on 411b6aa1.**
  - Proof pages: GLOSTAD 3-seat (449), KIVIK (1495) and GLOSTAD 2-seat (349).
  - Price's "different place on product 2" row was taken by its own Accept, and Verify certified both fields 3/3.
  - The sample took 45 s, and the run read Done. The CSV, JSON and Output each held 10 rows.
- **gymshark: steps 1–7 passed on 411b6aa1**, and Verify certified both fields 3/3 (`re-run-5-gymshark-partial/`).
  Claude Code's low-memory stop killed the process during step 8 (the sample). It was not restarted, as the notice
  asks. Its entry above is still Re-run 4's (12d718e9).
- **skullcandy: not run on 411b6aa1.** Its entry above is Re-run 4's (12d718e9).

No trips. The route smoke was not run.

## Triage — Re-run 4 (head 12d718e9, written by hand, 2026-10-26): all three pass

**Done (spec §3): all three default sites pass, 10 of 10, on one head (12d718e9).** Each site ran in its own vitest
process, in this order: IKEA, then Gymshark, then Skullcandy. Every run used `FIRST_RUN_MERGE=1`, the isolated
keyless pair and `WORKER_BROWSERS=1`, with 2.9–3.3 GB free before each site.

- **ikea: 10 of 10** (228 s).
  - Proof pages: GLOSTAD 3-seat (449), KIVIK 3-seat (1495) and GLOSTAD 2-seat (349). Title agreed.
  - Price read "different place on product 2 — check it". Its own **Accept** took all three cells (the ruling, and
    fix 12d718e9).
  - Verify certified both fields 3/3 in 6 s. The sample took 48 s, and the run read Done after 55 s.
  - The CSV and JSON held 10 rows; Output showed 10 rows. The run page links the listing.
- **gymshark: 10 of 10** (501 s).
  - Proof pages: Everyday Seamless, Everyday Seamless Flared and Poise; prices 38 / 38 / 30. Both rows agreed.
  - Verify certified both fields 3/3. The sample took 175 s, and the run read Done after 103 s.
  - 10 rows, with "SoftSense™" and "CottonMove™" kept in the stored text. The run links the listing.
- **skullcandy: 10 of 10** (576 s).
  - Title from the heading: "Crusher® ANC 2", "Crusher® 720", "Crusher® Evo". Both rows agreed.
  - Verify certified both fields 3/3. The sample took 238 s.
  - The run read Done, and the CSV, JSON and Output each held 10 rows.

No trips, and no money appeared in the app's own text on any Verification tab.

Script change, class (c): `first-run.md` now keeps everything outside the generated markers, so the hand-written
triage below survives a run. Earlier runs' screenshots moved to `re-run-2/` and `re-run-3/`; nothing was deleted.

## Triage — Re-run 3 (head f0ace845, written by hand, 2026-10-26)

IKEA ran alone (one vitest process, `FIRST_RUN_MERGE=1`, `WORKER_BROWSERS=1`, 3.2 GB free). Gymshark and Skullcandy
were not re-run on this head, because IKEA did not pass. Their entries above are from Re-run 2 (head fdaefd78 plus
script fixes).

- **ikea: tripped at step 6, (a).** Steps 1–5 passed: "This website opens normally.", "76 products found", 3 ready.
  - Proof pages: KIVIK 3-seat (1495), GLOSTAD 3-seat (449), GLOSTAD 2-seat (349).
  - Title agreed. Price read "different place on product 1 — check it", with its Accept button.
  - The script clicked the row's own **Accept Price** first, as the ruling allows. It accepted Price on products 2
    and 3 only.
  - Product 1 (1495) stayed "suggested", and the row then read "check product 1" with only **Fix on screenshot**.
    The Verify bar says "Price still needs product 1" (`ikea-6-trip.png`).
  - So the row's one-click Accept does not accept the cell its own warning names. The customer is left with
    marking by hand. 5b734eb5 kept the Accept from being taken away by Accept all agreed, but the Accept itself
    still leaves the odd cell.
  - Script reading: no script problem. The click happened (recorded in `facts.rowAccepted`), and the trip is what
    the page shows after it.

Re-run 2's IKEA screenshots (attempt 3, steps 1–4) are kept in `re-run-2/`.

## Triage — Re-run 2 (head fdaefd78 + script fixes, written by hand, 2026-10-26)

**Ruling recorded (spec §2 step 6, amended 2026-10-25):** a row's own one-click Accept counts as a normal action for
a new customer, so the script may click it. "Fix on screenshot" and "Mark on screenshot" are marking by hand, and
they still count as a trip.

- **gymshark: passed, 10 of 10.**
  - Proof pages: Everyday Seamless, Everyday Seamless Flared and Poise Seamless; prices 38 / 38 / 30. Both rows agreed.
  - Verify certified both fields 3/3. The sample took 178 s, and the run read Done after 133 s.
  - The CSV, the JSON and Output each held 10 rows.
- **skullcandy: passed, 10 of 10.**
  - Title now comes from the heading: "Crusher® ANC 2", "Crusher® 720", "Crusher® Evo". Both rows agreed.
  - Verify certified both fields 3/3. The sample took 247 s, and the run read Done after 265 s.
  - 10 rows, with ® kept in the stored text. The run page links the listing that was added.
  - It took two script fixes to get there (class c), listed below.
- **ikea: not finished.** Over three attempts, steps 1–6 each passed at least once; Verify onward never ran.
  - Title agreed: "GLOSTAD 3-seat sofa, Knisa dark grey", now with a comma. The colourways are gone: the proof pages
    are GLOSTAD 3-seat, KIVIK and GLOSTAD 2-seat.
  - Price read "different place on product 2 — check it", with its Accept button.
  - Attempt 1 tripped on the script's click order (c); see the attempts above.
  - Attempt 2 tripped on a 30 s timeout at the reachability check; a 2-minute wait came before attempt 3.
  - Attempt 3 was killed during step 5 when the machine ran low on memory.

Script fixes in this re-run, all class (c):
1. Step 6 clicks a row's own "Accept <field>" (the ruling), and before Accept all agreed. Clicking Accept all agreed
   first leaves a "different place" row with only "Fix on screenshot". That is product behaviour, (a) below.
2. Step 8 waits for the Extract tab to load the saved pages before it reads them. On skullcandy the script had clicked
   the "Listing pages" option just as the tab disabled it.
3. Step 4 also quotes "took too long … Try again" as the reachability line, instead of reporting "no line".

Product issues seen, all class (a):
- **The "different place" row loses its Accept after Accept all agreed** (ikea attempt 1). Accept all agreed takes
  the agreeing cells of that row. After that the row reads "check product 2" and offers only "Fix on screenshot",
  so a customer who clicks the bar's button first must mark by hand. The screenshot of this was lost while
  clearing files; the row texts are in this triage.
- **The reachability check timed out at 30 s on IKEA's listing** (ikea attempt 2) and told a new customer "took
  too long". The next check, 2 minutes later, read "opens normally". It is a flaky first impression; it could also
  be a site trait (b).
- **Skullcandy's first Extract attempt:** the reachability check waited behind a coverage check from the previous,
  deleted website that held the only browser (`WORKER_BROWSERS=1`), then timed out at 30 s. A deleted org's
  background job still occupies the worker for a while.
## Triage — first run (head f9e59882)

All three sites passed steps 1–5 and stopped at step 6, so steps 7–10 (Verify, Extract, the downloads, Output)
did not run on any site. None of the three trips is a wall or a geo redirect, and none is a script problem.
The row texts match the screenshots (`*-6-trip.png`) and `first-run.json` → `facts.beforeAccept`.

- **gymshark: (a) product defect.** The first three listing cards are colourways of one or two products: two are
  titled "Everyday Seamless Leggings" and one "…Flared Leggings". All three are priced 38, so Price reads "same on
  every product — check it" and Accept all agreed leaves it out. A new customer has to choose "Accept anyway" or
  replace products by hand, and the listing has 124 products to choose from.
- **skullcandy: (a) product defect.** Title on product 1 is suggested from the page data as "Crusher® 720 - Primer".
  The row reads "not the page's heading on product 1" and offers no action. The Verify bar says "Title still needs
  product 1", so the only way on is to mark by hand. Price agreed.
- **ikea: (a) product defect, twice.** (1) The same Title heading rule as skullcandy fires on "GLOSTAD 3-seat sofa -
  Knisa dark grey", and the row offers no action. (2) Price reads "same on every product — check it; product 3
  differs" for 449 / 449 / 1495. The words say every product, but one product differs. Products 1–2 are colourways
  of GLOSTAD.

Smaller things seen on the way, all (a):
- Product cards take their names from the listing's link text, prefixes included: "Save $70 on Crusher 720…",
  "SHOP Crusher® 540…", "Option: GLOSTAD, 3-seat…". The skullcandy card shows a dollar amount from the shop's own
  text.
- The website's address (the listing page pasted in Add website) does not fill the listing bar, so the customer
  pastes it a second time (`*-4.png`).

## Triage — Re-run 1 (head 8c3d1216, written by hand, 2026-10-25)

Each site ran in its own vitest process (`FIRST_RUN_SITES` naming one site, `FIRST_RUN_MERGE=1` for the second and
third). Every run used the isolated keyless pair with `WORKER_BROWSERS=1`, and more than 2 GB of memory was free
before each site.

- **gymshark: passed, 10 of 10.** The proof pages now differ (Everyday Seamless, Everyday Seamless Flared,
  SoftSense™; prices 38 / 38 / 58), and both rows agreed. Verify certified title and price, each 3/3, in 3 s. The
  sample took 172 s. The run (10 products, 1 page) read Done after 109 s. The CSV and JSON each held 10 rows, every
  Title and Price was filled, and every Price was numeric. Output showed 10 rows. No money appeared in our chrome.
- **skullcandy: tripped at step 6, (a).** Title is still suggested from the page data as "Crusher® 720 - Primer",
  while the page heading is "CRUSHER® 720". The row reads "not the page's heading on product 1" and now offers
  "Fix on screenshot". Fixing it means marking by hand on the screenshot, which spec §5 rules out, so it is
  recorded as a trip. The heading fix (bb07cd66 and the commits after it) did not reach this page. Price agreed.
  The card names are clean now ("CRUSHER® 720").
- **ikea: tripped at step 6, (a).**
  - (1) The same Title rule as skullcandy fires on "GLOSTAD 3-seat sofa - Knisa dark grey", with Fix on screenshot.
  - (2) Two proof pages are still colourways of GLOSTAD (dark grey and medium blue, both 449). The distinct-pages
    pick (8d90a5d2) did not separate them; perhaps the titles differ only by the colour suffix.
  - (3) Price reads "different place on product 3 — check it", with an Accept button. That is not "agreed", so
    Accept all agreed leaves it out.
  - (4) The second card is still named "Option: GLOSTAD, 3-seat…" (8c3d1216 did not cover it).

Minor things seen on gymshark's run:
- The run stored "SoftSenseTM High-Rise Leggings" where Verify showed "SoftSense™".
- The run export's `source.url` and the link under the run title are a product page (…whitney-leggings…), not the
  listing that was added.
