# First run — 2026-10-25T14:50:31.195Z

App http://localhost:3100, api http://localhost:4100.

## gymshark — passed (10 of 10 steps)

Listing: https://www.gymshark.com/collections/leggings/womens · ran 2026-10-25T14:39:19.653Z

1. ok — Sign in and land on /projects with its empty state (5 s)
2. ok — New project "First run gymshark": project first-run-gymshark (0 s)
3. ok — Fields: Title (Text) and Price (Money) from the catalogue (2 s)
4. ok — Add website with the listing page; land on Verification; the reachability line: website "Gymshark" (gymshark); This website opens normally. (17 s)
5. ok — Find products: "N products found" (N ≥ 3) and three proof pages ready: 124 products found · a pager too; 3 ready (78 s)
6. ok — Accept all agreed: Title and Price agreed and accepted on all three proof pages: Title on product 1: suggested, Everyday Seamless Leggings | Title on product 2: suggested, Everyday Seamless Flared Leggings | Title on product 3: suggested, SoftSense™ High-Rise Leggings | Price on product 1: suggested, 38 | Price on product 2: suggested, 38 | Price on product 3: suggested, 58 (1 s)
7. ok — Verify: "Verify 2 fields", both fields certified, no customer-visible money: certified title, price in 3 s; Title "verified 3/3", Price "verified 3/3" (35 s)
8. ok — Extract: listing pages, a sample, run limits 10 items / 1 page, Extract; the run reads done or partial: listing page already saved; sample done in 172 s; limits 10/1 (1 listing · first 10 products from each · first 1 page of each · safety stop at 5,000 products per listing); run e8ac4a0f reads "Extraction Done" after 109 s (367 s)
9. ok — Run page: download the CSV and JSON; ≥ 5 rows, Title and Price on every row, prices numeric: CSV 10 rows (Title, Price, _url, _page_number); JSON 10 rows (1 s)
10. ok — Project Output shows the rows: 10 rows on Output (1 s)
11. ok — Cleanup: the throwaway org and user deleted (guarded delete): deleted

## skullcandy — tripped at step 6 (5 of 10 steps)

Listing: https://www.skullcandy.com/collections/wireless-wired-bluetooth-headphones · ran 2026-10-25T14:48:13.631Z

1. ok — Sign in and land on /projects with its empty state (1 s)
2. ok — New project "First run skullcandy": project first-run-skullcandy (0 s)
3. ok — Fields: Title (Text) and Price (Money) from the catalogue (1 s)
4. ok — Add website with the listing page; land on Verification; the reachability line: website "Skullcandy" (skullcandy); This website opens normally. (15 s)
5. ok — Find products: "N products found" (N ≥ 3) and three proof pages ready: 15 products found · a pager too; 3 ready (94 s)
6. TRIP — Accept all agreed: Title and Price agreed and accepted on all three proof pages: not agreed: Title reads "not the page's heading on product 1 Fix on screenshot" (0 s)
11. ok — Cleanup: the throwaway org and user deleted (guarded delete): deleted

## ikea — tripped at step 6 (5 of 10 steps)

Listing: https://www.ikea.com/my/en/cat/sofas-fu003/ · ran 2026-10-25T14:50:31.388Z

1. ok — Sign in and land on /projects with its empty state (1 s)
2. ok — New project "First run ikea": project first-run-ikea (0 s)
3. ok — Fields: Title (Text) and Price (Money) from the catalogue (1 s)
4. ok — Add website with the listing page; land on Verification; the reachability line: website "Ikea" (ikea); This website opens normally. (9 s)
5. ok — Find products: "N products found" (N ≥ 3) and three proof pages ready: 92 products found · a pager too; 3 ready (37 s)
6. TRIP — Accept all agreed: Title and Price agreed and accepted on all three proof pages: not agreed: Title reads "not the page's heading on product 1 Fix on screenshot"; Price reads "different place on product 3 — check it Accept" (0 s)
11. ok — Cleanup: the throwaway org and user deleted (guarded delete): deleted

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
