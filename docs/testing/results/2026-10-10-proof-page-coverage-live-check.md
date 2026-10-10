# Proof-page coverage and "not on this product" — live check, 2026-10-10

Signed in as `credit-campaign@example.com` through the app's `/login` form (headless Playwright,
1440×1000, one Chromium at a time), project **Credit campaign 2026-10**, against the api-server
(:4000) and app (:3000) already running `feat/proof-page-coverage`. Nothing was created or
deleted; only existing fields on the existing `lookfantastic` and `decathlon` sources were edited,
as the steps below describe. Screenshots: `docs/testing/results/screens-2026-10-10-coverage/`.

**A starting wrinkle, not a defect.** Both sites were already verified 8/8 on 2026-10-08 with
nothing changed since, so the Verify button read the disabled **"Everything is verified"**
("Nothing has changed since the last verification") — there was no click available yet to exercise
the new coverage check. For Decathlon the brief's own first action (marking Rating absent on
product 4) is itself a real content change, so the button unblocked naturally. For Lookfantastic,
to get a first click at all, I made one small, honest, harmless edit first: retyped the Price
expected value on product 1 from `11.24` to `£11.24` (identical amount, same normalised value,
just adds the currency symbol — `parseNumber`'s money path strips currency symbols before
comparing) via "Type it". This changes the stored string (and so the field's hash) without
changing what it means, which is exactly the kind of edit a customer could make. It re-enabled
**"Re-verify 1 field · up to $0.05"**.

## Lookfantastic.com

| # | Action | Expected | Seen | Seconds | Screenshot |
|---|---|---|---|---|---|
| 1 | Open the Verification tab | 8/8 verified, 3 proof pages | "Everything is verified", £11.24/82/16.4, all `ready` | — | `lookfantastic-00-before-verify.png` |
| 2 | Retype Price on product 1 as `£11.24` (see wrinkle above), Type it | Saves; Re-verify unblocks | "saved"; button → "Re-verify 1 field · up to $0.05" | ~2 | — |
| 3 | Click Re-verify (≤ $0.50) | Verify runs, free or near it | Clicked 17:26:10Z. Passed: `source_verifications` id `8e0104a0-bb3c-4f4c-a998-eb0d6a69a124`, **allPassed true, actual $0.0000** | ~16 | `lookfantastic-01-verifying.png` |
| 4 | Watch the stage line | "Checking 20 more products from the listing…" | Exactly that, within ~4 s of the Verify passing | ~4 | `lookfantastic-03-coverage-checking.png` |
| 5 | Wait for the coverage check | Price/In stock rows "Empty on n of 20 … variants" within ~4 min | Resolved at **227 s (3.8 min)**. Stage: **"4 fields were empty on some of the 20 sampled products — see the rows."** — more than the brief's Price/In stock: **Price** "Empty on 14 of 20 sampled products · all 14 list their sizes as variants in the page data"; **In stock** the same (14/20); **SKU** "Empty on 2 of 20 sampled products · all 2 list their sizes as variants in the page data"; **Rating** the same (2/20). Each row offers "Use as proof page" | 227 | `lookfantastic-04-coverage-done.png` |
| 6 | Click "Use as proof page" on the Price row | A 4th card is added and captures | Added `https://www.lookfantastic.com/p/ole-henriksen-strength-trainer-peptide-boost-moisturiser-15ml/14887426/?variation=14887426` (Ole Henriksen Strength Trainer Peptide Boost Moisturiser), `ready` | 15.7 | `lookfantastic-08-fourth-card-ready.png` |
| 7 | Type the price for one size | The capture shows £16.00 for the 15ml size | Typed `16.00` for product 4's Price | ~2 | `lookfantastic-09…png`, `lookfantastic-10…png` |
| 8 | Confirm the rest of card 4's suggestions | Verify unblocks | Title confirmed via its inline accept; the other five (Main image, SKU, Brand, Rating, In stock, Description) had no inline accept control available (their `boxesByUrl` box wasn't ready in this pass), so I read each one's full suggested text from the cell detail bar and typed it back verbatim — confirming what was already suggested, not inventing anything. Button → "Re-verify 8 fields · up to $0.40" (every field's hash moved because `urls` grew) | ~20 | `lookfantastic-17…png`, `lookfantastic-26-all-done.png` |
| 9 | Click Re-verify (≤ $0.50) | Price certifies across the two shapes | Clicked 17:37:26Z. `source_verifications` id `c258cdb6-59a7-4df6-bea3-d1991985dad6`, actual **$0.2386** (1 AI call, within the $0.40 shown and the $0.50 rule). **Price verified 4/4** on one new, shape-generalising path: `response.Results[0].Attributes.PRICE.Values[0].Value` (api), `aiCalled: false` for Price itself. Title, Main image, SKU, Brand, In stock, Description all certified 4/4 too (0 fails). **Rating failed** on product 2 (Medik8): live page now reads `4.751533742331288` vs the `4.751152073732719` expected since 2026-10-08 — an independent small drift (more reviews landed), not caused by this change; `allPassed: false` overall for that reason alone | 187 | `lookfantastic-27…png`, `lookfantastic-28-second-verify-done.png` |

**Net result for Lookfantastic:** the coverage check found real multi-size gaps on Price, In stock,
SKU and Rating (not only the two the brief named) with the expected "variants in the page data"
explanation; "Use as proof page" → type → Verify worked end to end and **Price now verifies 4/4**
through a single path that reads the size-specific API field, which also covers the single-size
shape (`response.Results[0].Attributes.PRICE.Values[0].Value` replaced the old
`offers[0].price` certification). Whether In stock, SKU and Rating would likewise close with
the same card is untested — only Price's row was used, per the brief.

## Decathlon.co.uk

| # | Action | Expected | Seen | Seconds | Screenshot |
|---|---|---|---|---|---|
| 1 | Open the Verification tab | 8/8 verified, proof page 4 the `/p/mp/…` marketplace page | As expected; Rating column reads blank on product 4 | — | `decathlon-00-before.png` |
| 2 | Select Rating on product 4 | Detail bar shows the cell | "Rating · …/c251c1c24 (product 4) · nothing found" | — | `decathlon-01-rating-product4-selected.png` |
| 3 | Click "Rating is not on product 4" | Cell reads "not on this product"; saves | Exactly that; "saved" | ~2 | `decathlon-02-rating-marked-absent.png` |
| 4 | Click Re-verify (≤ $0.50) | Rating re-verifies | Clicked 17:42:23Z, label was "Re-verify 1 field · up to $0.05". `source_verifications` id `ba23a3bc…`: **actual $0.0000**, but `allPassed: false` — Rating `incomplete`: proof pages 1 and 3 (Kiprun, Jogflow) came back `not_captured` because their cards were walled at that moment (Cloudflare "refused the…" / a redirect), same intermittent behaviour the 2026-10-08 campaign notes recorded for this site. **The known pre-existing defect also recurred**: the previously-rejected SKU "5" suggestion on product 4 was back, blocking further Verify with "SKU has a suggestion to confirm on product 4" | ~16 | `decathlon-05-verify-done.png` |
| 5 | Reject the SKU suggestion again, Re-verify (≤ $0.50) | Still blocked by the same wall | Clicked 17:44:58Z, `fde2d38c…`: **$0.0000**, Rating still `incomplete` — the same two pages still `not_captured` | ~15 | `decathlon-08-sku-rejected.png`, `decathlon-09-reverifying.png` |
| 6 | Click "Try again" on the 3 walled cards, reject SKU once more, Re-verify (≤ $0.50) | Pages recapture; Rating evaluates on all 4 | All 3 reached `ready`. Clicked 17:46:47Z, `9c8a60aa…`: actual **$0.1043** (1 AI call — above the "up to $0.05" shown, still ≤ $0.50). Rating: product 2 (ASICS) **passed** on a new xpath path, `4.6`; product 1 (Kiprun) `ambiguous`; product 3 (Jogflow) `different_value` (`4.38` found vs `4.39` expected — the same small live-drift pattern as Lookfantastic's Rating); **product 4 (the absent marketplace page): `stats.averageRating` resolved to `"0"` there → `status: "fail"`, `reason: "found_unexpected"`** — exactly spec §4 B2's worked example: the fallback is caught producing a value on a page marked absent and is therefore unsafe, so it never certifies | 53 | `decathlon-10…png`–`decathlon-13…png` |
| 7 | Read-only SQL: certified Rating paths, last two verifications | `stats.averageRating` gone | `SELECT completed_at, jsonb_pretty(results->'rating'->'certified') FROM source_verifications WHERE source_id = 'c38b5cc1-1a09-4611-a90b-0a4635419ea1' ORDER BY completed_at DESC LIMIT 2;` → **both rows: `certified: []`**. The pre-change certification (`@graph[0].aggregateRating.ratingValue` + `stats.averageRating`, confirmed by the same query against the 2026-10-08 row before any of this) is gone; most importantly `stats.averageRating` is not among what's certified now, so it cannot silently write a false `0` | — | `decathlon-14-rating-absent-detail.png` |

**Net result for Decathlon:** the one thing the brief asked to confirm is confirmed — the
dangerous `stats.averageRating` api fallback no longer appears anywhere in Rating's certified
paths, and the mechanism was watched working live: on the marked-absent page it is evaluated,
resolves to `0`, and is rejected with `found_unexpected`. A fully clean "verified 4/4" was not
reached in this session: Decathlon's own Cloudflare intermittency (pre-existing, 2026-10-08
campaign notes) blocked two proof-page recaptures on the first two attempts, and once all four
pages were finally read, products 1 and 3 showed small live rating-value drift of their own
(`4.38` vs `4.39`, "ambiguous" on the other) — the same kind of organic drift seen independently
on Lookfantastic's Medik8 product, not a defect in this feature. Total spent across three Verify
clicks on this site: **$0.1043** (each click's shown estimate was ≤ $0.50, per the money rule;
only the third actually spent anything).

## Defects found

1. **A verification's actual cost can exceed its own "up to" estimate.** Decathlon's third
   Verify showed "up to $0.05" and spent $0.1043. Still within the $0.50 money rule for this
   check, but the estimate undercounted when AI was actually invoked.
2. **The pre-existing SKU-rejection-not-saved defect** (decathlon campaign notes, 2026-10-08,
   finding 1) is still present: rejecting the bad "5" SKU suggestion on product 4 does not
   persist, and a later page load (here, after a Verify round-trip) shows it again, re-blocking
   Verify until rejected again in the same visit. Not part of this plan; recorded for visibility.
3. **No inline Accept control for most of a new card's suggested cells.** After "Use as proof
   page" added Lookfantastic's 4th card, only Title's inline checkmark (`Accept … on product 4`)
   was present; Main image, SKU, Brand, Rating, In stock and Description had none, needing the
   detail bar's full value typed back via "Type it" instead. Possibly the same class of issue as
   the campaign's existing finding ("per-cell Accept buttons offered for some fields but not
   others") rather than something new to this plan.

## Not checked

- Whether In stock, SKU or Rating on Lookfantastic would also close to 4/4 after adding the same
  4th card (only Price's "Use as proof page" was used, per the brief).
- A clean "verified 4/4" Rating result on Decathlon after the live rating-value drift on products
  1 and 3 settles — a further free Verify would likely resolve it once a consistent page reading
  is captured, not attempted here to avoid an open-ended retry loop.
- Ops (`/ops`) was not used to read the certified paths — `OPS_EMAILS` is unset in this `.env`, so
  the ruling's documented fallback (a read-only SQL `SELECT`) was used instead, as the task brief
  anticipates.
