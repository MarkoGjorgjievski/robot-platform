# First run — 2026-10-25T12:08:22.268Z

App http://localhost:3100, api http://localhost:4100.

## gymshark — tripped at step 6 (5 of 10 steps)

Listing: https://www.gymshark.com/collections/leggings/womens

1. ok — Sign in and land on /projects with its empty state (1 s)
2. ok — New project "First run gymshark": project first-run-gymshark (0 s)
3. ok — Fields: Title (Text) and Price (Money) from the catalogue (1 s)
4. ok — Add website with the listing page; land on Verification; the reachability line: website "Gymshark" (gymshark); This website opens normally. (14 s)
5. ok — Find products: "N products found" (N ≥ 3) and three proof pages ready: 124 products found · a pager too; 3 ready (79 s)
6. TRIP — Accept all agreed: Title and Price agreed and accepted on all three proof pages: not agreed: Price reads "same on every product — check it Accept anyway Make it the default" (0 s)
11. ok — Cleanup: the throwaway org and user deleted (guarded delete): deleted

## skullcandy — tripped at step 6 (5 of 10 steps)

Listing: https://www.skullcandy.com/collections/wireless-wired-bluetooth-headphones

1. ok — Sign in and land on /projects with its empty state (1 s)
2. ok — New project "First run skullcandy": project first-run-skullcandy (0 s)
3. ok — Fields: Title (Text) and Price (Money) from the catalogue (1 s)
4. ok — Add website with the listing page; land on Verification; the reachability line: website "Skullcandy" (skullcandy); This website opens normally. (13 s)
5. ok — Find products: "N products found" (N ≥ 3) and three proof pages ready: 15 products found · a pager too; 3 ready (93 s)
6. TRIP — Accept all agreed: Title and Price agreed and accepted on all three proof pages: not agreed: Title reads "not the page's heading on product 1" (0 s)
11. ok — Cleanup: the throwaway org and user deleted (guarded delete): deleted

## ikea — tripped at step 6 (5 of 10 steps)

Listing: https://www.ikea.com/my/en/cat/sofas-fu003/

1. ok — Sign in and land on /projects with its empty state (1 s)
2. ok — New project "First run ikea": project first-run-ikea (0 s)
3. ok — Fields: Title (Text) and Price (Money) from the catalogue (1 s)
4. ok — Add website with the listing page; land on Verification; the reachability line: website "Ikea" (ikea); This website opens normally. (8 s)
5. ok — Find products: "N products found" (N ≥ 3) and three proof pages ready: 92 products found · a pager too; 3 ready (41 s)
6. TRIP — Accept all agreed: Title and Price agreed and accepted on all three proof pages: not agreed: Title reads "not the page's heading on product 1"; Price reads "same on every product — check it; product 3 differs Accept anyway Make it the default" (0 s)
11. ok — Cleanup: the throwaway org and user deleted (guarded delete): deleted
## Triage (written by hand after the run, 2026-10-25)

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
