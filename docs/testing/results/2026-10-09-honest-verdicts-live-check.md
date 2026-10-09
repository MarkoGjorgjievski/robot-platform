# Honest page verdicts — live check, 2026-10-09

Free live check against the already-running `pnpm dev:all` (api-server :4000, app :3000) on
branch `feat/honest-verdicts`, HEAD `322d73c` at the start. Signed in as
`credit-campaign@example.com` through `/login`, inside the pre-existing project "Credit
campaign 2026-10" (slug `credit-campaign-2026-10`), on the websites already set up there by the
2026-10-08 campaign. No user, org, project or website was created or deleted; no DB write was
made directly (one read-only query against `captures`/`runs` to inspect stored metadata).
Driven from `tsx` scripts in the scratchpad, one headless Chromium at a time, never two checks
concurrently.

## Results

| Site | Action | Expected (brief) | What was seen (verbatim) | Time | Screenshot |
|---|---|---|---|---|---|
| scan.co.uk | Find products on the saved listing (`.../memory-ram/all`) | Refused/challenge sentence within 10 s, no count | `scan.co.uk refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet.` — `role="alert"`, orange. No "No product links found", no count. | 551 ms | `scan-find-products.png` |
| hobbycraft.co.uk | Find products on the saved listing (`.../knitting-and-crochet/yarn`) | Refused/challenge sentence within 10 s, no count | `hobbycraft.co.uk refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet.` No count. (The site serves a Cloudflare *managed challenge* titled "Just a moment…", but it answers with HTTP 403, and `classifyVerdict` treats a challenge page served with 401/403 as `refused`, not `challenge` — see verdict.ts:31 and its comment.) | 562 ms | `hobbycraft-find-products.png` |
| otto.de | Find products on the saved listing (`.../kueche/kaffeemaschinen/`) | Refused/challenge sentence within 10 s, no count | No refused/challenge sentence: otto.de's listing itself is not walled (confirmed separately: a plain headless load of the listing returns HTTP 200 with full content). The click took 20.5 s and left the board's 3 pre-existing product cards unchanged, still reading "ready" — those cards' captures predate this branch and were not retaken (the Verification tab only starts a capture for a URL it has never captured before). This is a deviation from the brief's prediction, not a defect: per ruling, otto's *listing* loads; only its *product* pages are blocked. | 20.5 s | `otto-find-products.png` |
| otto.de | Add a 4th, never-before-captured product URL (`…/p/nescafe-dolce-gusto-kapselmaschine-kp2431-…`), confirmed directly beforehand to answer HTTP 400 with an empty body | A refused sentence (HTTP 400) on the product page instead of "ready" | The card's rail turned warn-coloured and it read `otto.de sent an empty page. Try again.` — the **`blank`** verdict's sentence, not `refused`: HTTP 400 is not one of `classifyVerdict`'s refused statuses (401/403/405/429/5xx) and no wall was detected on the empty body, so it falls through to the near-empty-body check and is classified `blank`. The brief predicted "refused"; the actual, correct classification under the shipped code is `blank`. Either way the card now says something honest instead of "ready" with silently-empty cells — the 3 old (pre-feature) cards for the same host still read "ready" with no boxes, unchanged. | 15.3 s | `otto-fresh-product-capture.png` |
| allbirds.com | Open the Verification tab, read the Description row | Description reads `only in the page data on product 2` (needs-you, not agreed) | The tab reads "Everything is verified"; Description (like every field) shows `verified 3/3`, not the B1 reason. All three Description cells already carry a stored answer from the 2026-10-08 campaign (one "agreed" accept on product 1, two "marked" answers on products 2–3) — `rowStatus` (verification-model.ts) returns `kind: 'accepted'` as soon as every card has a stored answer, before it ever re-derives `placesOf`/B1's zero-box reason; the design spec itself says the agreement-rule fix touches nothing already answered ("Not touched: certification, autosave…"). So B1's sentence can only be observed live on a field/product that is **not yet** answered; it does not retroactively relabel an already-accepted cell. No cell was cleared to force the reproduction, to avoid altering this website's certified board. | n/a (read only) | `allbirds-verification.png` |
| article.com | Extract tab → "Sample again" (free, "No AI. Free.") | — (free step before Extract) | Sample finished with the header reading "3 rows extracted" while the panel reads "Sample rows complete 0 of 3" (the same self-contradiction the 2026-10-08 campaign already found on B&N/Nike/Article — still present, not part of this feature's scope). All 8 fields read "empty on 3 of 3 sampled pages." | ~90–120 s (not reclocked precisely — see note) | `article-sample-again.png` |
| article.com | Budget set to the smallest custom (3 products, 1 page) | — | `Run custom products across custom pages. 1 listing · first 3 products from each · first 1 page of each · safety stop at 5,000 products per listing.` | — | `article-extract-budget.png` |
| article.com | Extract (clicked 10:29:11Z) | Either succeeds, or ends `failed` with the challenge sentence as the run's message; never "Done" with 0 rows | Neither predicted outcome: the run ended **green "Done"**, **3 of 3 extracted**, **3 rows**, but **every one of the 8 fields is empty on all 3 rows ("0% confidence")**, and nothing on the run page says the pages were blocked. The three detail URLs the planner picked (`/furniture-bundles/506`, `/758`, `/507`) are not the product pages from Verification; a direct, independent check of the same 3 URLs a few minutes after the run finished found all three answer **HTTP 405, title "Human Verification"** (AWS WAF's passable CAPTCHA). The run's own stored capture metadata for these 3 pages (`captures.metadata`, read-only query) shows `readyState: "timeout"` only — no `verdict` field is stored for an extraction-run capture the way `ProofPageMeta` stores one for a proof page. Run cost: `$0.00` (`runs.cost_usd`), confirming no AI was spent. Between the Extract click and the plan settling into "Idle · 3 URLs planned, not yet extracted" was ~5 min; a manual "Extract 3 pending" click was then needed to run the 3 detail captures, which finished ~40 s later. Total run duration (DB `startedAt`→`completedAt`): **6 min 37 s**. | 6 min 37 s total | `article-run-idle-pending.png`, `article-runs-list.png`, `article-run-result.png` |

Note on the Article Sample timing: the first polling script's loop window (90 s) elapsed while the
sample was still running ("Sampling · 0 of 30 rows extracted"); a follow-up check immediately after
found it already finished, so the exact wall time was not captured to the second. It is consistent
with the 2026-10-08 campaign's measured 95–105 s for the same site.

## Defects found

1. **A run can read "Done" with every field empty and no hint that the pages were blocked.**
   Article's Extract (3 products / 1 page, fully certified, $0.00) completed "Done", 3 of 3
   extracted, 0% confidence, no values in any of the 8 fields on any of the 3 rows. The 3 pages
   it extracted were confirmed (independently, minutes later) to be behind AWS WAF's CAPTCHA
   (HTTP 405). Nothing on the run page — not the status dot, not the "Pages" table (each detail
   row reads plain "done"), not the "Empty cells" panel (which only offers the generic
   "lays this field out differently, add a proof page" hint) — says a wall was involved. This is
   not literally the brief's forbidden case ("Done" with **0 rows**: here there are 3, just empty
   ones), so it slipped past the specific rule Tasks 6–7 implemented; it is the same deception in
   substance. `pipeline.ts`, `analysis-orchestrator.ts` and `extraction-orchestrator.ts` do read
   `capture.verdict` and build a `verdictSentence` reason when it is not `ok` (confirmed by
   reading the code), but whatever happened to these 3 captures during this run, the
   wall/verdict reason did not reach the run page, and the per-capture row stored in `captures`
   for this run has no `verdict` field at all (only proof-page captures do). Worth a closer look:
   is this `readyState: timeout` case (the capture's own "ready" wait, separate from
   `classifyVerdict`) a path that bypasses verdict classification entirely?
2. **otto.de's stale, pre-feature product-card captures still read "ready" with silently empty
   rows.** The three product cards left over from the 2026-10-08 campaign (captured before this
   branch existed) still show "ready" with 0 boxes and every field "missing on product 1" (etc.),
   because the Verification tab only starts a capture for a URL it has never captured — it does
   not retroactively reclassify an old capture under the new verdict code. Not a code defect (old
   data, nothing re-evaluates it), but a real product gap: an operator looking at otto.de's board
   today still sees "ready" on pages that are actually blank/blocked, unless they are dropped and
   re-added. A fresh capture of a never-before-seen page on the same host (added as a 4th product)
   correctly reads the honest `blank` sentence.
3. **The brief's predicted verdict kind for otto.de's HTTP 400 blank product pages was wrong — a
   documentation/expectation gap, not a code defect.** HTTP 400 is classified `blank` (page sent
   is near-empty, no wall detected), not `refused`. `refused` status codes per
   `classifyVerdict` are 401/403/405/429 and 5xx. This is worth fixing in whatever predicted this
   in ruling #1, not in the code.

## Not checked

- **The reachability line on a new website** (`Reached {host} (HTTP 200).` / the failing sentence
  / `Waiting N min before trying again.`). This only shows on an empty Verification tab before
  "Find products" has ever run, and exercising it would mean creating a new website, which the
  brief forbids. Not checked.
- **Allbirds' B1 "only in the page data on product n" sentence, live, in the UI.** As recorded
  above, it cannot be observed on this website without first clearing an already-accepted answer,
  which was not done to avoid touching certified production data. `verification-model.test.ts`
  already covers the exact string (`'only in the page data on product 2'` etc.) at the unit level.
- **Hobbycraft and Scan's proof-card-level wording** (`screenshot refused on product n` /
  `human check on product n`): neither site ever got past "Find products" (0 product links), so
  no proof cards exist to carry that reason. Not checked live; covered by
  `verification-model.test.ts`.
- **Re-running Article's Sample/Extract a second time** to see whether the 3 "furniture-bundles"
  URLs are consistently chosen and consistently walled, to separate "WAF rate-limited at the
  moment of this run" from "always walled" — not done, to keep to one Extract start per the
  campaign's own one-start-per-website convention and the money rule.
