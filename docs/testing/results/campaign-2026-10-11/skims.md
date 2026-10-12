# skims.com — campaign 2, 2026-10-12 (phase 2, batch A, site 6)

**Status: STOPPED at Verify, 7/8.** Description cannot be verified, either as marked or as typed. Extract is locked. Spend: **$0.2907** (2 Verifies with AI).

- The listing is the one the pre-screen saved: https://skims.com/collections/bras
- The api-server's browser lands on the **Malaysia** store: `/en-my/`, "RM 265", "MYR" in the header.

## Findings in the product (most important first)

1. **Verify fails silently with HTTP 412.** With Rating answered "Not on this product" on product 3 (a new colour with no reviews), the button read "Verify 8 fields · up to $0.40" and was enabled.
   - Clicking it sent `sources.verify`, which returned **412**: `"Rating @ https://skims.com/en-my/products/everyday-cotton-t-shirt-bra-currant: Expected value is required"`.
   - **Nothing appeared on screen.** The button kept its label, no row changed, and no error was shown. Two clicks, two silent failures (`skims-04-vclick.png`).
   - The client lets an absent value on one of the first three products through; the server refuses it.
2. **A paragraph marked on the screenshot drops its inline links' words.** The box map's text for a `<p>` leaves out its `<a>` children:
   - "…our viral **Ultimate Bra** redefines the traditional **push-up** by lifting…" was stored as "…our viral redefines the traditional by lifting…".
   - "**The t-shirt bra** that started it all … with **demi** coverage" was stored as "The that started it all … with coverage".
   - Marked values were therefore wrong. They also did not verify, because the verifier reads the full text and lists the right sentence as a near miss.
3. **A value marked on the screenshot fails as "ambiguous".** Product 1's description was marked (no links in it), and Verify answered **"Several places match. Add what makes yours different to the description."** Its near misses were the paragraph itself and the truncated meta description ("…shape without bul...").
4. **The typed full description failed too.** I typed the correct text (with the link words) on products 2 and 3; the result was `not_found`.
5. **The cost ran over the cap shown on the button.** The re-Verify read **"Re-verify 1 field · up to $0.05"** and cost **$0.1521**, three times the cap. The estimate is `fields × EST_AI_COST_PER_FIELD_USD`.
6. **Title "SKIMS" was suggested on every product** (the site name, in page data). Even on the right products, Title had to be marked. The marked heading is the lower-case DOM text "balconette bra", while the product line "FITS EVERYBODY" sits in a separate element.
7. **In stock page data read "Out of stock" on a buyable product** (FITS EVERYBODY T-Shirt Bra, Onyx, which shows "SELECT A SIZE" and all sizes). Probably the first variant (30AA). I typed "In stock", and it verified.
8. **The pre-screen's three cards were not from the saved bras listing.** They were Cotton Jersey T-Shirt, Long Sleeve T-Shirt and Lace Thong. Today's `checkListingPage` on the same URL returns bras only.
9. Popup dismissal leaves a "Select Size" dropdown open in "Complete the look" (`skims-p3` tile).

## Proof pages

1. https://skims.com/en-my/products/fits-everybody-balconette-bra-onyx
2. https://skims.com/en-my/products/skims-ultimate-balconette-push-up-bra-clay
3. https://skims.com/en-my/products/fits-everybody-t-shirt-bra-onyx. This replaced everyday-cotton-t-shirt-bra-currant, which has no reviews (finding 1).

| Field | What it needed | Verdict |
|---|---|---|
| Title | **marked** the heading ×3 (the suggestion was "SKIMS") | verified 3/3 |
| Price | agreed (265 / 315 / 265, "RM 265" on screen) | verified 3/3 |
| Main image | page data (FLT flat-lay images in the right colours), confirmed | verified 3/3 |
| SKU | page data, confirmed (size-specific: `BL-BAL-8709W-ONX-32A`, …) | verified 3/3 |
| Brand | page data "SKIMS", confirmed | verified 3/3 |
| In stock | confirmed on 1–2; **typed** "In stock" on 3 (finding 7) | verified 3/3 |
| Rating | page data 3.4 / 3.3 / 4.4 | verified 3/3 |
| Description | **marked** ×3, then **typed** the full text on 2–3, then re-**marked** 2–3 | **fails on products 1, 2 and 3 0/3** |

Counts: agreed 1, page data confirmed 4, marked 2, typed 1 (one In stock cell and two Description cells), absent 0. The one absent, Rating on the reviewless bra, was refused by the server.

## Verify

| When (UTC) | Label | Result | AI / cost |
|---|---|---|---|
| 10:39:05 and 10:44:57 | "Verify 8 fields · up to $0.40" | nothing: HTTP 412, silent (finding 1) | — / $0 |
| 10:49:35 | "Verify 8 fields · up to $0.40" | 7/8, Description fails (p1 ambiguous; p2, p3 not found) | 1 / $0.1386 |
| 10:51:29 | "Re-verify 1 field · up to $0.05" | 7/8, Description fails (marked values not found) | 1 / **$0.1521** |

## Not done

- **Coverage:** none.
- **Sample / Extract:** locked.
- **Judge:** none.

## Screenshots

- `skims-00-cards-as-found`: the t-shirt cards and the "SKIMS" titles.
- `-01-cards`, `-02-table-before`, `-03-before-verify`.
- `-04-vclick`: after the silent 412.
- `-05-after-verify`, `-06-description-fail` ("Several places match…"), `-07-after-verify`.
- Marks: `skims-mark-Title-1…3`, `-Description-1…3`.
