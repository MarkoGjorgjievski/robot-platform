# Judge run — Notonthehighstreet

> **STOPPED at the $3.00 cap** — the next item would have gone over it.
> 31 of 60 items were judged; the tables cover only those.

- Run: `582723e6-935a-4eb6-acc1-a01e632200b8`
- Site: Notonthehighstreet (project Campaign 2 2026-10-11)
- When: 2026-10-13T11:28:11.569Z
- Items: 60 items in run, 60 with values, 31 captured, 0 capture failed, judged 31 (limited by cap)
- Fields: Title, Price, Main image, SKU, Brand, In stock, Rating, Description
- Judge cost: $2.9942 (cap $3.00)
- Note: per-call estimate not re-measured since page text was added ($0.0086 a call — behind the cap and the saving below)
- 48 values settled from the page text without a call (saved at least $0.41)
- Time: 12m 25s

Each item's URL was captured fresh (a run stores no screenshot), so a verdict compares the stored value with the page as it is now — a price that changed since the run reads as wrong.

Some values are counted correct from the page's visible text without a judge call: a number with one of the field's words beside it (within 15 characters, nothing but spaces, colons or brackets between) or followed by "/5", "out of 5", "stars" or "★" (a single digit only right beside the field's name); a text value longer than 80 characters, not a product name or brand, whose first 80 characters occur exactly once in the page text. Money values always go to the judge. Every other value goes to the judge with page text beside the screenshot — 4,000 characters around the value when it is found, else the first 8,000; a text value longer than 80 characters is judged on its first 80, and the judge is told so.

The judge sees screenshot tiles from the top of the page (3 tiles ≈ 4608 px, 1536 px each); a value is judged on tile 1 and again on the next tile only while the verdict is "not on page". 'Not on page' after all tiles usually means further down or in a tab, not wrong.

Only each item's first stored row is judged (on a row-per-variant run, the default variant).

## Per field

Correct includes values settled from the page text without a call. Correct % is correct / (correct + wrong); "—" when neither occurred. Not on page, unverifiable and judge errors are counted apart and do not enter it. Empty values are not judged.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 31 | 30 | 0 | 0 | 0 | 1 | 0 | 100% |
| Price | 31 | 31 | 0 | 0 | 0 | 0 | 0 | 100% |
| Main image | 31 | 0 | 0 | 0 | 31 | 0 | 0 | — |
| SKU | 31 | 31 | 0 | 0 | 0 | 0 | 0 | 100% |
| Brand | 31 | 31 | 0 | 0 | 0 | 0 | 0 | 100% |
| In stock | 31 | 17 | 0 | 13 | 1 | 0 | 0 | 100% |
| Rating | 30 | 26 | 4 | 0 | 0 | 0 | 1 | 87% |
| Description | 31 | 30 | 0 | 0 | 0 | 1 | 0 | 100% |

## Shown flag vs. verdict

How well the free "shown on the page" flag (spec 2026-10-12 §3/§6, stored per field on a certified run's extraction) predicts the judge's paid verdict, among cells the judge or the local text pass called correct or wrong; a cell with no stored flag, or whose field type is not checkable, counts as unflagged, not as either side.

| Shown flag vs. verdict | Count |
|---|---:|
| Wrong & not shown | 3 |
| Wrong & shown | 1 |
| Correct & not shown | 6 |
| Correct & shown | 173 |
| Unflagged (no flag or not checkable) | 17 |

The free flag caught 3 of the 4 flagged wrong values; it flagged 6 correct values.

## Per item

C correct · W wrong · N not on page · U unverifiable · E judge error · S variant list, not judged · - not judged (run interrupted) · `·` empty. The digit is the screenshot tile that decided the verdict. Ct is a value found in the page text (a number with its field word beside it, or a long text's first 80 characters), without a judge call or cost; a trailing p means a long text judged on its first 80 characters. A bare U is a URL value (image/url field or an absolute http(s) link), marked unverifiable without a judge call or cost.

| URL | Page title | Title | Price | Main image | SKU | Brand | In stock | Rating | Description |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| https://www.notonthehighstreet.com/lisaangeljewellery/product/personalised-heart-and-birthstone-charm-bracelet | Personalised Heart And Birthstone Charm Bracelet By Lisa Angel | C1 | C1 | U | C1 | C1 | N3 | W1 | Ct |
| https://www.notonthehighstreet.com/silkpursesowsear/product/art-deco-emerald-baguette-earrings | Art Deco Emerald Baguette Earrings By Silk Purse, Sow's Ear | C1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://www.notonthehighstreet.com/potiega/product/sterling-silver-name-necklace-with-heart-birthstone | Name Necklace With Heart Birthstone By Potiega | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://www.notonthehighstreet.com/lisaangeljewellery/product/long-wildflower-amazing-friend-trinket-dish | Long Wildflower Amazing Friend Trinket Dish By Lisa Angel | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://www.notonthehighstreet.com/augustajewellery/product/ginkgo-earrings | Ginkgo Leaf Statement Earrings By Augusta Jewellery | C1 | C1 | U | C1 | C1 | C1 | C1 | C1p |
| https://www.notonthehighstreet.com/lisaangeljewellery/product/personalised-men-s-stainless-steel-plaque-bracelet | Personalised Men's Stainless Steel Plaque Bracelet By Lisa Angel | E1 | C1 | U | C1 | C1 | N3 | Ct | Ct |
| https://www.notonthehighstreet.com/withlovejewellerylimited/product/20th-30th-40th-50th-60th-70th-80th-or-90th-sterling-silver-birthday-bracelet | Sterling Silver Milestone Birthday Bracelet In Various Ages By With Love Jewellery Limited | C1 | C1 | U | C1 | C1 | N3 | W1 | Ct |
| https://www.notonthehighstreet.com/lisaangeljewellery/product/sunshine-jewellery-stand-with-terrazzo-base | Sunshine Jewellery Stand With Terrazzo Base By Lisa Angel | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://www.notonthehighstreet.com/forgeandfoundry/product/men-s-balck-braided-leather-bracelet | Men's Personalised Black Braided Leather Bracelet With Magnetic Snap Clasp – Sleek, Secure, And Stylish Jewellery By FORGE & FOUNDRY | C1p | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://www.notonthehighstreet.com/letterboxlove/product/fabulous-friend-layered-silver-stars-bracelet | Fabulous Friend Layered Silver Stars Bracelet By Letterbox Love | C1 | C1 | U | C1 | C1 | N3 | C1 | Ct |
| https://www.notonthehighstreet.com/nameitwhatyoulike/product/personalised-big-sister-charm-bracelet | Personalised Big Sister Bracelet, New Sibling Keepsake Gift By Nameitwhatyoulike | C1 | C1 | U | C1 | C1 | C1 | C1 | Ct |
| https://www.notonthehighstreet.com/potiega/product/dog-paws-bracelet-with-name | Dog Paws Bracelet With Name By Potiega | C1 | C1 | U | C1 | C1 | N3 | Ct | Ct |
| https://www.notonthehighstreet.com/withlovejewellerylimited/product/sterling-silver-anxiety-fidget-bracelet | Sterling Silver Anxiety Fidget Bracelet By With Love Jewellery Limited | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://www.notonthehighstreet.com/forgeandfoundry/product/personalised-men-s-adjustable-leather-bracelet-with-magnetic-clasp | Men’s Adjustable Black Leather Bracelet – Handmade With Secure Clasp By FORGE & FOUNDRY | C1 | C1 | U | C1 | C1 | N3 | C1 | Ct |
| https://www.notonthehighstreet.com/forgeandfoundry/product/men-s-adjustable-leather-bracelet-with-sliding-clasp | Men's Personalised Engraved Black Adjustable Leather Bracelet – Sliding Clasp, Gift For Him By FORGE & FOUNDRY | C1p | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://www.notonthehighstreet.com/lunity/product/enough-necklace-encouragement-gift-for-her-confidence-jewellery-self-worth-gift-for-women-uplifting-present-for-tough-times | Enough Necklace – Encouragement Gift For Her, Confidence Jewellery, Self Worth Gift For Women, Uplifting Present For Tough Times By Lunity | C1p | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://www.notonthehighstreet.com/clothncard/product/personalised-men-s-monogram-initial-cufflinks | Personalised Men’s Monogram Initial Cufflinks By Cloth N Card | C1 | C1 | U | C1 | C1 | N3 | Ct | C1p |
| https://www.notonthehighstreet.com/lunity/product/sisters-necklace-sterling-silver-heart-infinity-charm-personalised-gift-for-sister-birthday-or-just-because | Sisters Necklace – Sterling Silver Heart Infinity Charm, Personalised Gift For Sister, Birthday Or Just Because By Lunity | C1p | C1 | U | C1 | C1 | C1 | W1 | Ct |
| https://www.notonthehighstreet.com/lineamasks/product/velvet-jewelry-box-travel-jewellery-box-bridesmaid-proposal-small-earring-organizer-gifts-box-sister-friend-birthday-gift | Personalised Velvet Jewellery Box Valentine's Gift For Her By Awristo | C1 | C1 | U | C1 | C1 | N3 | Ct | Ct |
| https://www.notonthehighstreet.com/lisaangeljewellery/product/personalised-silver-interlocking-circles-necklace | Personalised Silver Interlocking Circles Necklace By Lisa Angel | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://www.notonthehighstreet.com/diamondrosegifts/product/60th-birthday-bracelet-birthstone-initial-gift-for-her | 60th Birthday Bracelet – Birthstone And Initial Gift For Her By Diamond Rose Gifts | C1 | C1 | U | C1 | C1 | N3 | Ct | Ct |
| https://www.notonthehighstreet.com/giftsonline4u/product/engraved-pocket-watch-mechanical-skeleton | Engraved Pocket Watch Mechanical Skeleton By Feel Good Centre | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://www.notonthehighstreet.com/lisaangeljewellery/product/layered-beaded-chain-bracelet-in-silver-and-rose-gold | Layered Beaded Bracelet In Silver And Rose Gold Plating By Lisa Angel | C1 | C1 | U | C1 | C1 | U1 | Ct | Ct |
| https://www.notonthehighstreet.com/giftsonline4u/product/gents-engraved-wrist-watch-silver-and-gold | Gents Engraved Wrist Watch Silver And Gold Plated Alloy By Feel Good Centre | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://www.notonthehighstreet.com/harfi/product/flavia-paperclip-bracelet | 18k Gold Plated Paperclip Chain Bracelet By Sophelia | C1 | C1 | U | C1 | C1 | N3 | · | E1p |
| https://www.notonthehighstreet.com/withlovejewellerylimited/product/sterling-silver-initial-and-birthstone-family-bracelet | Sterling Silver Initial And Birthstone Heart Bracelet By With Love Jewellery Limited | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://www.notonthehighstreet.com/joybycorrinesmith/product/mother-and-child-birthstone-necklace | Mother And Child Birthstone Pendant Necklace By Joy by Corrine Smith | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://www.notonthehighstreet.com/giftsonline4u/product/personalised-mens-bracelet-with-leather-woven-strap | Personalised Mens Bracelet With Leather Woven Strap By Feel Good Centre | C1 | C1 | U | C1 | C1 | N3 | W1 | Ct |
| https://www.notonthehighstreet.com/muchv/product/small-huggie-hoops-solid-sterling-silver | Tiny Huggie Hoop Earrings Solid Sterling Silver By MUCHV | C1 | C1 | U | C1 | C1 | N3 | C1 | Ct |
| https://www.notonthehighstreet.com/muchv/product/women-s-herringbone-chain-necklace-in-18k-gold | 18k Gold Or Silver Women’s Herringbone Chain Necklace By MUCHV | C1 | C1 | U | C1 | C1 | C1 | Ct | Ct |
| https://www.notonthehighstreet.com/potiega/product/circle-family-name-necklace | Circle Family Name Necklace By Potiega | C1 | C1 | U | C1 | C1 | N3 | Ct | Ct |

## Wrong values

- **Rating** — https://www.notonthehighstreet.com/lisaangeljewellery/product/personalised-heart-and-birthstone-charm-bracelet (tile 1)
  - extracted: `4.2`
  - shown: true
  - judge's reading (uncalibrated): The page shows a seller rating of 4.7/5, not 4.2.
- **Rating** — https://www.notonthehighstreet.com/withlovejewellerylimited/product/20th-30th-40th-50th-60th-70th-80th-or-90th-sterling-silver-birthday-bracelet (tile 1)
  - extracted: `4.9`
  - shown: false
  - judge's reading (uncalibrated): The page shows a rating of 4.8 (12 reviews).
- **Rating** — https://www.notonthehighstreet.com/lunity/product/sisters-necklace-sterling-silver-heart-infinity-charm-personalised-gift-for-sister-birthday-or-just-because (tile 1)
  - extracted: `4.6`
  - shown: false
  - judge's reading (uncalibrated): The page shows a rating of 5 (5/5, based on 8 reviews).
- **Rating** — https://www.notonthehighstreet.com/giftsonline4u/product/personalised-mens-bracelet-with-leather-woven-strap (tile 1)
  - extracted: `4.2`
  - shown: false
  - judge's reading (uncalibrated): The page shows a rating of 4.3 (117 reviews).

## Correct values flagged not shown

- **Description** — https://www.notonthehighstreet.com/silkpursesowsear/product/art-deco-emerald-baguette-earrings
  - extracted: `Beautiful emerald earrings, with art deco detailing and a classic baguette cut.These beautiful, emerald green earrings are translucent glass gems set in a delic…`
- **Description** — https://www.notonthehighstreet.com/augustajewellery/product/ginkgo-earrings
  - extracted: `Nature inspired statement earrings.A beautiful pair of statement earrings featuring intricately detailed Ginkgo leaves. Symbolizing endurance and peace, the des…`
- **Brand** — https://www.notonthehighstreet.com/forgeandfoundry/product/men-s-balck-braided-leather-bracelet
  - extracted: `FORGE & FOUNDRY`
- **Brand** — https://www.notonthehighstreet.com/forgeandfoundry/product/personalised-men-s-adjustable-leather-bracelet-with-magnetic-clasp
  - extracted: `FORGE & FOUNDRY`
- **Brand** — https://www.notonthehighstreet.com/forgeandfoundry/product/men-s-adjustable-leather-bracelet-with-sliding-clasp
  - extracted: `FORGE & FOUNDRY`
- **Description** — https://www.notonthehighstreet.com/clothncard/product/personalised-men-s-monogram-initial-cufflinks
  - extracted: `Personalised mens cufflinksOur Personalised Men's Monogram Initial Cufflinks are a timeless accessory, expertly engraved with your chosen initials to create a m…`

## Notes

```
claude-sonnet-5: 197 req, 992,964 in / 1,020 out
estimated $2.9942 at list rates
```

- Cost attribution: the usage counter (`@robot/agent` usage.ts) is process-wide. This CLI is a single process doing nothing else, so the figure above is its own.
- This report is the record: judge-run does not write to `runs.cost_usd` or any other table.
