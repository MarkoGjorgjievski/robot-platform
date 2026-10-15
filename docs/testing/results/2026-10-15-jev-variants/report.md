# Jev with images, experiment 2 — variants

Spec: `docs/superpowers/specs/2026-10-15-jev-images-experiment.md` (inputs, §2) and experiment 1's results `docs/testing/results/2026-10-15-jev-images/report.md`; the variant feature: `docs/superpowers/specs/2026-10-14-variant-from-the-address-design.md`. CLI: `packages/api/src/jev-images-run.ts --set v|d`. Model `jev-1.14.0`, header `TypeSafe-Danger-Zone-Images: true`.

- Requests: 82 (5 failed). Answers: 152. Input tokens 349,668.
- **Cost: $0.0147** (input tokens × $0.042 / 1M; hard cap $1.00 / 400 questions in code).
- Latency per request: median 675 ms; input tokens per call median 6152.

## Set V — which variant does the page show

Fresh captures (2026-10-15T16:04:49.350Z) with our own Chromium: `load` + the proof-page ready check, network interception and the variant selection script, as Verify captures; overlays hidden; crop 1440×1500 from the top (or from 300 px above the heading when it sits lower). The variant list is the first one `detectVariantLists` finds; options are its entries' verbatim name/title/option values (no price, stock or id), `none` added. "Ours" is `pickPageEntry` over the same raw list with `capture.pageVariant` — the entry a `[page]` path would read, or nothing. Truth by reading each crop (`truth-v.json`, with the reason).

| Site | Pages | Scored (truth clear) | Jev right | Our code right | Both right | Jev only | Ours only | Both wrong |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ruggable | 5 | 4 | 4/4 | 3/4 | 3 | 1 | 0 | 0 |
| kith | 5 | 5 | 5/5 | 4/5 | 4 | 1 | 0 | 0 |
| skullcandy | 5 | 5 | 5/5 | 4/5 | 4 | 1 | 0 | 0 |
| glossier | 5 | 4 | 4/4 | 0/4 | 0 | 4 | 0 | 0 |
| burrow | 5 | 5 | 5/5 | 2/5 | 2 | 3 | 0 | 0 |
| puma | 5 | 5 | 5/5 | 4/5 | 4 | 1 | 0 | 0 |
| **all** | 30 | 28 | 28/28 | 17/28 | 17 | 11 | 0 | 0 |

"Our code right" counts nothing (no single match) as right only when the truth is `none shown`; a `[page]` path that resolves to nothing leaves the cell empty, which is not a wrong value but is not the shown variant either.

### Per page

| Page | Address (from) | List | Truth (selected) | Jev | p | Ours | Address names | Noul p(yes) / truth | Params: Jev / truth | Crop |
|---|---|---|---|---|---:|---|---|---|---|---|
| v01 ruggable | ruggable.com/products/sierra-ivory-opal-tufted-rug?size=6x9&system=rug (proof page 1) | json-ld `hasVariant` ×16 | unclear | none shown | 0.92 | e10 "Sierra Ivory & Opal Rug \| All-In-One Rug \| 6'x9' \|" | e10 "Sierra Ivory & Opal Rug \| All-In-One Rug \| 6'x9' \|" | 0.200 / ? | size=6x9: size / size; system=rug-cvr: none / none | [crop](crops/v-v01-ruggable.png) |
| v02 ruggable | ruggable.com/products/morris-and-co-pimpernel-jade-tufted-rug?size=6x9 (proof page 2) | json-ld `hasVariant` ×10 | e7 "Pimpernel Jade Rug by Morris & Co. \| All-In-One Ru" | e7 "Pimpernel Jade Rug by Morris & Co. \| All-In-One Ru" ✓ | 1.00 | e7 "Pimpernel Jade Rug by Morris & Co. \| All-In-One Ru" ✓ | e7 "Pimpernel Jade Rug by Morris & Co. \| All-In-One Ru" | 1.000 / yes | size=6x9: size / size; system=rug-cvr: none / none | [crop](crops/v-v02-ruggable.png) |
| v03 ruggable | ruggable.com/products/cyrus-rose-gold-tufted-rug?size=6x9&system=rug-c (proof page 3) | json-ld `hasVariant` ×16 | e10 "Cyrus Rose Gold Rug \| All-In-One Rug \| 6'x9' \| Rug" | e10 "Cyrus Rose Gold Rug \| All-In-One Rug \| 6'x9' \| Rug" ✓ | 0.98 | e10 "Cyrus Rose Gold Rug \| All-In-One Rug \| 6'x9' \| Rug" ✓ | e10 "Cyrus Rose Gold Rug \| All-In-One Rug \| 6'x9' \| Rug" | 0.980 / yes | size=6x9: size / size; system=rug-cvr: none / none | [crop](crops/v-v03-ruggable.png) |
| v04 ruggable | ruggable.com/products/ryder-soft-white-plush-rug?size=6x9&system=rug-c (stored capture (a replaced proof page)) | json-ld `hasVariant` ×4 | e2 "Ryder Soft White Plush Rug \| All-In-One Rug \| 6'x9" | e2 "Ryder Soft White Plush Rug \| All-In-One Rug \| 6'x9" ✓ | 1.00 | e2 "Ryder Soft White Plush Rug \| All-In-One Rug \| 6'x9" ✓ | e2 "Ryder Soft White Plush Rug \| All-In-One Rug \| 6'x9" | 1.000 / yes | size=6x9: size / size; system=rug-cvr: none / none | [crop](crops/v-v04-ruggable.png) |
| v05 ruggable | ruggable.com/products/sierra-soft-black-tufted-rug (stored capture (a replaced proof page; names no variant)) | json-ld `hasVariant` ×13 | e8 "Sierra Soft Black Rug \| All-In-One Rug \| 6'x9' \| R" | e8 "Sierra Soft Black Rug \| All-In-One Rug \| 6'x9' \| R" ✓ | 1.00 | nothing ✗ | — | — | — | [crop](crops/v-v05-ruggable.png) |
| v06 kith | kith.com/collections/kith-women-sweatshirts/products/khwa030083-338 (proof page 1) | json-ld `offers` ×7 | none shown | none shown ✓ | 0.97 | nothing ✓ | — | — | — | [crop](crops/v-v06-kith.png) |
| v07 kith | kith.com/collections/kith-women-sweatshirts/products/khwa030103-2017 (proof page 2) | json-ld `offers` ×7 | none shown | none shown ✓ | 0.97 | nothing ✓ | — | — | — | [crop](crops/v-v07-kith.png) |
| v08 kith | kith.com/collections/kith-women-sweatshirts/products/khwa030086-001 (proof page 3) | json-ld `offers` ×7 | none shown | none shown ✓ | 0.98 | nothing ✓ | — | — | — | [crop](crops/v-v08-kith.png) |
| v09 kith | kith.com/collections/kith-women-sweatshirts/products/khwa030083-001 (stored capture) | json-ld `offers` ×7 | none shown | none shown ✓ | 0.98 | nothing ✓ | — | — | — | [crop](crops/v-v09-kith.png) |
| v10 kith | kith.com/collections/kith-women-sweatshirts/products/khwa030083-338?va (derived: proof page 1 with its size L variant id (product .js)) | json-ld `offers` ×7 | none shown | none shown ✓ | 0.98 | e5 "size: L" ✗ | e5 "size: L" | 0.010 / no | — | [crop](crops/v-v10-kith.png) |
| v11 skullcandy | skullcandy.com/products/smokin-buds-true-wireless-earbuds?variant=4480 (run 860cacc7 item) | json-ld `hasVariant` ×8 | e7 "Smokin’ Buds® - Preppy Sage" | e7 "Smokin’ Buds® - Preppy Sage" ✓ | 0.99 | e7 "Smokin’ Buds® - Preppy Sage" ✓ | e7 "Smokin’ Buds® - Preppy Sage" | 1.000 / yes | — | [crop](crops/v-v11-skullcandy.png) |
| v12 skullcandy | skullcandy.com/products/crusher-evo-sensory-bass-headphones-with-perso (run 860cacc7 item) | json-ld `hasVariant` ×5 | e1 "Crusher® Evo - True Black" | e1 "Crusher® Evo - True Black" ✓ | 1.00 | e1 "Crusher® Evo - True Black" ✓ | e1 "Crusher® Evo - True Black" | 0.990 / yes | — | [crop](crops/v-v12-skullcandy.png) |
| v13 skullcandy | skullcandy.com/products/push-anc-active?variant=45276014772281 (run 860cacc7 item) | json-ld `hasVariant` ×2 | e2 "Push® ANC Active - Primer" | e2 "Push® ANC Active - Primer" ✓ | 0.97 | e2 "Push® ANC Active - Primer" ✓ | e2 "Push® ANC Active - Primer" | 0.990 / yes | — | [crop](crops/v-v13-skullcandy.png) |
| v14 skullcandy | skullcandy.com/products/hesh-540-anc-noise-canceling-headphones (run 860cacc7 item (names no variant)) | json-ld `hasVariant` ×2 | e1 "Hesh® 540 ANC - Bone" | e1 "Hesh® 540 ANC - Bone" ✓ | 1.00 | nothing ✗ | — | — | — | [crop](crops/v-v14-skullcandy.png) |
| v15 skullcandy | skullcandy.com/products/smokin-buds-true-wireless-earbuds (run 860cacc7 item (names no variant)) | json-ld `hasVariant` ×8 | e1 "Smokin’ Buds® - Bone" | e1 "Smokin’ Buds® - Bone" ✓ | 1.00 | e1 "Smokin’ Buds® - Bone" ✓ | — | — | — | [crop](crops/v-v15-skullcandy.png) |
| v16 glossier | glossier.com/products/milky-jelly-cleanser?variant=44415832752373 (proof page 1) | product.js (fallback: not in the capture) `variants` ×4 | e1 "177 mL" | e1 "177 mL" ✓ | 0.97 | nothing (if listed: e1) ✗ | e1 "177 mL" | 0.970 / yes | — | [crop](crops/v-v16-glossier.png) |
| v17 | glossier.com/products/priming-moisturizer-rich?variant=43781983076597 (proof page 2) | | not asked: nothing to ask (no variant list, no address value) | | | | | | | |
| v18 glossier | glossier.com/products/glossier-after-baume?variant=44416231604469 (proof page 3) | product.js (fallback: not in the capture) `variants` ×3 | e1 "50 mL" | e1 "50 mL" ✓ | 0.92 | nothing (if listed: e1) ✗ | e1 "50 mL" | 0.990 / yes | — | [crop](crops/v-v18-glossier.png) |
| v19 glossier | glossier.com/products/milky-jelly-cleanser?variant=44415832785141 (derived: proof page 1 with its 60 mL variant id (product .js)) | product.js (fallback: not in the capture) `variants` ×4 | e2 "60 mL" | e2 "60 mL" ✓ | 0.82 | nothing (if listed: e2) ✗ | e2 "60 mL" | 0.870 / yes | — | [crop](crops/v-v19-glossier.png) |
| v20 glossier | glossier.com/products/milky-jelly-cleanser (derived: proof page 1 without its query (names no variant)) | product.js (fallback: not in the capture) `variants` ×4 | e1 "177 mL" | e1 "177 mL" ✓ | 0.97 | nothing (if listed: e1) ✗ | — | — | — | [crop](crops/v-v20-glossier.png) |
| v21 burrow | burrow.com/products/range-pro-109-3-seat-sofa?Fabric=Camel+-+Top+Grain (run fb5ee28d item (judge: base price stored)) | json-ld `hasVariant` ×3 | e2 "Range Pro 109" 3-Seat Sofa - Camel - Top Grain Lea" | e2 "Range Pro 109" 3-Seat Sofa - Camel - Top Grain Lea" ✓ | 1.00 | e2 "Range Pro 109" 3-Seat Sofa - Camel - Top Grain Lea" ✓ | e2 "Range Pro 109" 3-Seat Sofa - Camel - Top Grain Lea" | 1.000 / yes | Fabric=Camel - Top Grain Leather: material / color\|material | [crop](crops/v-v21-burrow.png) |
| v22 burrow | burrow.com/products/union-pro-108-3-seat-sofa?Fabric=Ivory+-+Performan (run fb5ee28d item) | json-ld `hasVariant` ×3 | e2 "Union Pro 108" 3-Seat Sofa - Ivory - Performance C" | e2 "Union Pro 108" 3-Seat Sofa - Ivory - Performance C" ✓ | 0.99 | e2 "Union Pro 108" 3-Seat Sofa - Ivory - Performance C" ✓ | e2 "Union Pro 108" 3-Seat Sofa - Ivory - Performance C" | 1.000 / yes | Fabric=Ivory - Performance Chenille: material / color\|material | [crop](crops/v-v22-burrow.png) |
| v23 burrow | burrow.com/products/field-leather-2-piece-sofa?Fabric=Slate+-+Top+Grai (run fb5ee28d item) | json-ld `hasVariant` ×4 | e1 "Field Leather 2-Piece Sofa - Slate - Top Grain Lea" | e1 "Field Leather 2-Piece Sofa - Slate - Top Grain Lea" ✓ | 0.97 | nothing ✗ | nothing | 0.980 / yes | Fabric=Slate - Top Grain Leather: color / color\|material; Leg Finish=Oak - Wood: leg finish / leg finish | [crop](crops/v-v23-burrow.png) |
| v24 burrow | burrow.com/products/ember-sofa?Size=75%22&Fabric=Georgia+Cla… (run fb5ee28d item) | json-ld `hasVariant` ×6 | e1 "Ember Sofa - 75" / Georgia Clay - Performance Chen" | e1 "Ember Sofa - 75" / Georgia Clay - Performance Chen" ✓ | 0.99 | nothing ✗ | nothing | 1.000 / yes | Size=75": size / size; Fabric=Georgia Clay - Performance Chenille: color / color\|material; Leg Finish=Walnut - Wood: leg finish / leg finish | [crop](crops/v-v24-burrow.png) |
| v25 burrow | burrow.com/products/range-plus-3-piece-one-arm-sofa?Fabric=Moss+Green+ (proof page 2) | json-ld `hasVariant` ×7 | e1 "Range 3-Piece One Arm Sofa - Moss Green - Performa" | e1 "Range 3-Piece One Arm Sofa - Moss Green - Performa" ✓ | 1.00 | nothing ✗ | nothing | 1.000 / yes | Fabric=Moss Green - Performance Flatweave: material / color\|material; Leg Finish=Black - Metal: leg finish / leg finish | [crop](crops/v-v25-burrow.png) |
| v26 puma | us.puma.com/us/en/pd/deviate-nitro-4-mens-road-running-shoes/312123?sw (run 3ca46d0a item (judge: rendered swatch 17)) | json-ld `hasVariant` ×24 | e11 "Deviate NITRO™ 4 Men's Road Running Shoes - Chocol" | e11 "Deviate NITRO™ 4 Men's Road Running Shoes - Chocol" ✓ | 1.00 | e11 "Deviate NITRO™ 4 Men's Road Running Shoes - Chocol" ✓ | nothing | 0.080 / yes | swatch=16: color / color | [crop](crops/v-v26-puma.png) |
| v27 puma | us.puma.com/us/en/pd/deviate-nitro-4-mens-road-running-shoes/312123?sw (run 3ca46d0a item) | json-ld `hasVariant` ×24 | e12 "Deviate NITRO™ 4 Men's Road Running Shoes - Dusty " | e12 "Deviate NITRO™ 4 Men's Road Running Shoes - Dusty " ✓ | 1.00 | nothing ✗ | nothing | 0.010 / yes | swatch=17: color / color | [crop](crops/v-v27-puma.png) |
| v28 puma | us.puma.com/us/en/pd/speedcat-og-sneakers/398846?swatch=94 (run 3ca46d0a item) | json-ld `hasVariant` ×23 | e23 "Speedcat OG Sneakers - Dark Olive-PUMA Black" | e23 "Speedcat OG Sneakers - Dark Olive-PUMA Black" ✓ | 0.99 | e23 "Speedcat OG Sneakers - Dark Olive-PUMA Black" ✓ | nothing | 0.860 / yes | swatch=94: color / color | [crop](crops/v-v28-puma.png) |
| v29 puma | us.puma.com/us/en/pd/suede-classic-sneakers/399781?swatch=01 (proof page 2) | json-ld `hasVariant` ×22 | e1 "Suede Classic Sneakers - PUMA Black-PUMA White" | e1 "Suede Classic Sneakers - PUMA Black-PUMA White" ✓ | 1.00 | e1 "Suede Classic Sneakers - PUMA Black-PUMA White" ✓ | nothing | 0.910 / ? | swatch=01: color / color | [crop](crops/v-v29-puma.png) |
| v30 puma | us.puma.com/us/en/pd/deviate-pure-nitro-mens-running-shoes/313904 (derived: proof page 3 without its query (names no variant)) | json-ld `hasVariant` ×9 | e1 "Deviate Pure NITRO™ Men's Running Shoes - PUMA Whi" | e1 "Deviate Pure NITRO™ Men's Running Shoes - PUMA Whi" ✓ | 1.00 | e1 "Deviate Pure NITRO™ Men's Running Shoes - PUMA Whi" ✓ | — | — | — | [crop](crops/v-v30-puma.png) |

## Does the page show the variant the address names (Noul)

- **16/18 right** (p(yes) ≥ 0.5 = yes). Truth yes: 17, no: 1.
  - wrong: v26 us.puma.com/us/en/pd/deviate-nitro-4-mens-road-running-shoes/312123?sw — "Is the variant with swatch 16 the one selected on the screenshot?" p(yes) 0.080, truth yes
  - wrong: v27 us.puma.com/us/en/pd/deviate-nitro-4-mens-road-running-shoes/312123?sw — "Is the variant with swatch 17 the one selected on the screenshot?" p(yes) 0.010, truth yes

## Which option does each address parameter set (Choice)

- **21/21 right.**

## Stability (the Choice asked three times on ten pages)

- v01 ruggable: none (0.92) / none (0.93) / none (0.95)
- v04 ruggable: e2 (1.00) / e2 (1.00) / e2 (1.00)
- v07 kith: none (0.97) / none (0.97) / none (0.94)
- v10 kith: none (0.98) / none (0.97) / none (0.97)
- v13 skullcandy: e2 (0.97) / e2 (0.97) / e2 (0.95)
- v16 glossier: e1 (0.97) / e1 (0.97) / e1 (0.97)
- v19 glossier: e2 (0.82) / e2 (0.82) / e2 (0.84)
- v22 burrow: e2 (0.99) / e2 (0.99) / e2 (0.99)
- v25 burrow: e1 (1.00) / e1 (1.00) / e1 (1.00)
- v28 puma: e23 (0.99) / e23 (0.99) / e23 (0.99)

- **0 of 10 Choice answers flipped**; the first answer's probability moved by at most 0.03. Noul and parameter answers on the same pages that flipped: 0.

## Set D — description false alarms with a crop around the description

Experiment 1's 28 description values the judge called correct and Jev said no to (set B, p(yes) < 0.5), re-captured (`load`, overlays hidden) and cropped around the description element's own box: the deepest element whose rendered text holds a 40-character window of the stored value (its start, past a "Name. " prefix, or further in), with a 40 px margin, each side 400–1440 / 400–1500 px (a first attempt with a 256 px minimum got "400 Invalid image dimensions" on its 450×256 crops; d01–d06, whose crops were larger, kept their answers); when only hidden text holds it (a collapsed section), the nearest rendered ancestor and the reason are recorded and the crop sits at that ancestor's top. The same Noul as experiment 1.

- **2 of 28 now answer yes** (0 not asked: —).
- Found rendered: 2/17 yes; found only in hidden text (collapsed): 0/10 yes; not found in the page at all: 0/1 yes.
- sigmabeauty: 0/6 yes.
- lacoste: 0/11 yes.
- notonthehighstreet: 2/5 yes.
- ikea: 0/6 yes.

| Id (exp. 1) | Page | Stored value (start) | Found | Collapsed | Exp. 1 p(yes) / crop | Now p(yes) | Crop |
|---|---|---|---|---|---|---:|---|
| d01 (b007) | sigmabeauty.com/products/skincare-brush-set | Take your self-care up a notch with this luxurious brush set | hidden | display:none on <div .product-info__block-item>; zero box | 0.380 / viewport | 0.100 | [hint](crops/d-d01-sigmabeauty.png) |
| d02 (b020) | sigmabeauty.com/products/f03-high-cheekbone-highlighter | Hit your high points with this fluffy but firm Sigmax® fiber | hidden | display:none on <div .product-info__block-item>; zero box | 0.430 / viewport | 0.220 | [hint](crops/d-d02-sigmabeauty.png) |
| d03 (b027) | sigmabeauty.com/products/basic-eye-kit | This set does it all with 7 classic, professional-quality ey | hidden | display:none on <div .product-info__block-item>; zero box | 0.330 / viewport | 0.100 | [hint](crops/d-d03-sigmabeauty.png) |
| d04 (b034) | sigmabeauty.com/products/f53-air-contour-blush | Wake up your skin with a natural flush of color! This feathe | hidden | display:none on <div .product-info__block-item>; zero box | 0.260 / viewport | 0.160 | [hint](crops/d-d04-sigmabeauty.png) |
| d05 (b041) | sigmabeauty.com/products/4dhd-kabuki | The pyramid-shaped, Sigmax® brush you didn't know you needed | hidden | display:none on <div .product-info__block-item>; zero box | 0.390 / viewport | 0.100 | [hint](crops/d-d05-sigmabeauty.png) |
| d06 (b055) | sigmabeauty.com/products/3dhdr-kabuki-brush | You'll achieve perfect skin on every curve and contour using | hidden | display:none on <div .product-info__block-item>; zero box | 0.410 / viewport | 0.130 | [hint](crops/d-d06-sigmabeauty.png) |
| d07 (b063) | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00 | Go back to where all started with the elegant L.12.12 Origin | visible | aria-hidden; hidden attribute | 0.260 / element | 0.130 | [element](crops/d-d07-lacoste.png) |
| d08 (b069) | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1264-00 | 1933. René Lacoste invented the first polo shirt, the Origin | visible | aria-hidden; hidden attribute | 0.180 / element | 0.160 | [element](crops/d-d08-lacoste.png) |
| d09 (b075) | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1264-00 | 1933. René Lacoste invented the first polo shirt, the Origin | visible | aria-hidden; hidden attribute | 0.260 / element | 0.200 | [element](crops/d-d09-lacoste.png) |
| d10 (b081) | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH0213-0 | An elegant winter version of an iconic style from Lacoste, c | visible | aria-hidden; hidden attribute | 0.350 / element | 0.480 | [element](crops/d-d10-lacoste.png) |
| d11 (b086) | lacoste.com/gb/lacoste/men/clothing/polo-shirts/long-sleeve/L1312-00.h | Invented by René Lacoste, the Original L.12.12 has been the  | visible | aria-hidden; hidden attribute | 0.270 / element | 0.150 | [element](crops/d-d11-lacoste.png) |
| d12 (b091) | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00 | Go back to where all started with the elegant L.12.12 Origin | visible | aria-hidden; hidden attribute | 0.210 / element | 0.150 | [element](crops/d-d12-lacoste.png) |
| d13 (b096) | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH9851-0 | Lacoste is proud to present the L.12.12 LIGHT polo shirt, a  | visible | aria-hidden; hidden attribute | 0.220 / element | 0.270 | [element](crops/d-d13-lacoste.png) |
| d14 (b101) | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00 | Go back to where all started with the elegant L.12.12 Origin | visible | aria-hidden; hidden attribute | 0.220 / element | 0.140 | [element](crops/d-d14-lacoste.png) |
| d15 (b107) | lacoste.com/gb/lacoste/men/clothing/polo-shirts/long-sleeve/PH2481-00. | Inventor of polo shirts since 1933, Lacoste presents the Sma | visible | aria-hidden; hidden attribute | 0.110 / element | 0.200 | [element](crops/d-d15-lacoste.png) |
| d16 (b112) | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH4012-0 | Go back to where all started with the elegant L.12.12 Origin | visible | aria-hidden; hidden attribute | 0.270 / element | 0.200 | [element](crops/d-d16-lacoste.png) |
| d17 (b118) | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH6809-0 | The polo that Novak Djokovic wears on court. Championship te | visible | aria-hidden; hidden attribute | 0.290 / element | 0.230 | [element](crops/d-d17-lacoste.png) |
| d18 (b188) | notonthehighstreet.com/lisaangeljewellery/product/personalised-heart-a | A sweet heart charm and special birthstone bracelet that is  | visible |  | 0.490 / viewport | 0.460 | [element](crops/d-d18-notonthehighstreet.png) |
| d19 (b194) | notonthehighstreet.com/withlovejewellerylimited/product/20th-30th-40th | A sterling silver beaded stretch birthday bracelet for a 20t | visible |  | 0.180 / hint | 0.570 | [element](crops/d-d19-notonthehighstreet.png) |
| d20 (b214) | notonthehighstreet.com/silkpursesowsear/product/art-deco-emerald-bague | Beautiful emerald earrings, with art deco detailing and a cl | visible |  | 0.460 / viewport | 0.440 | [element](crops/d-d20-notonthehighstreet.png) |
| d21 (b221) | notonthehighstreet.com/potiega/product/sterling-silver-name-necklace-w | Make a statement or give the gift of timeless elegance with  | visible |  | 0.470 / viewport | 0.580 | [element](crops/d-d21-notonthehighstreet.png) |
| d22 (b235) | notonthehighstreet.com/augustajewellery/product/ginkgo-earrings | Nature inspired statement earrings.A beautiful pair of state | visible |  | 0.230 / viewport | 0.390 | [element](crops/d-d22-notonthehighstreet.png) |
| d23 (b249) | ikea.com/my/en/p/soederhamn-corner-sofa-6-seat-kelinge-dark-yellow-s99 | SÖDERHAMN Corner sofa, 6-seat - Kelinge dark yellow. SÖDERHA | hidden | display:none on <div .pipf-tabs__panel>; hidden attribute; zero box | 0.150 / hint | 0.090 | [hint](crops/d-d23-ikea.png) |
| d24 (b256) | ikea.com/my/en/p/hyltarp-3-seat-sofa-kilanda-pale-blue-s99489647/ | HYLTARP 3-seat sofa - Kilanda pale blue. Skillful craftsmans | hidden | display:none on <div .pipf-tabs__panel>; hidden attribute; zero box | 0.070 / hint | 0.030 | [hint](crops/d-d24-ikea.png) |
| d25 (b263) | ikea.com/my/en/p/soederhamn-1-seat-section-kelinge-dark-yellow-s996215 | SÖDERHAMN 1-seat section - Kelinge dark yellow. SÖDERHAMN se | hidden | display:none on <div .pipf-tabs__panel>; hidden attribute; zero box | 0.140 / hint | 0.090 | [hint](crops/d-d25-ikea.png) |
| d26 (b270) | ikea.com/my/en/p/kivik-4-seat-sofa-with-chaise-longue-tresund-anthraci | KIVIK 4-seat sofa with chaise longue - Tresund anthracite. E | hidden | display:none on <div .pipf-tabs__panel>; hidden attribute; zero box | 0.200 / hint | 0.140 | [hint](crops/d-d26-ikea.png) |
| d27 (b290) | ikea.com/my/en/p/lillehem-3-seat-modular-sofa-w-chaise-longue-vissle-b | LILLEHEM 3-seat modular sofa w chaise longue - Vissle/beige  | visible |  | 0.130 / hint | 0.240 | [element](crops/d-d27-ikea.png) |
| d28 (b297) | ikea.com/my/en/p/friheten-3-seat-sofa-bed-faringe-brown-orange-8055122 | FRIHETEN 3-seat sofa-bed - Faringe brown-orange. Readily con | none |  | 0.090 / element | 0.120 | [fallback](crops/d-d28-ikea.png) |

## Reading the numbers (2026-10-15, by hand)

- **Set V: Jev picked the selected variant on all 28 pages with a readable crop, with p ≥ 0.82 (27 of 28 at ≥ 0.92).** That includes the four "none shown" Kith pages and the Kith page whose address names size L while the page highlights no size. v01 is excluded: its crop rendered blank below the header (Ruggable had not painted). Jev answered "none shown", which is right for a blank image.
- **Our code's `[page]` decision was right on 17 of 28.** Jev was never wrong where our code was right. The 11 differences, each one with Jev right:
  - **Glossier ×4: there is no variant list in the capture** (no JSON-LD offers list and no intercepted variants body), so `[page]` has nothing to pick from. The options here came from the store's public `<product>.js`, a fallback added for this experiment. Over that list, `pickPageEntry` would have picked the right entry on all four ("if listed" in the table).
  - **Burrow ×3 (v23–v25, addresses with Fabric and Leg Finish): two entries match, so the result is nothing.** The entries carry `Leg Finish` as an `additionalProperty` pair but not `Fabric`. Rule 2 (option pairs) accepts every entry whose Leg Finish agrees and never checks the Fabric value against the entry's name. Two entries share "Oak - Wood" or "Black - Metal", so the step yields nothing. On single-pair addresses (v21, v22) it picked right.
  - **Puma v27 (`?swatch=17`): a bug in the selection script.** `capture.pageVariant` holds the picker label as `"Du ty Orchid-Ro y Outlook"`. `buildSelectionScript` (`packages/scraper/src/verify/variant-dom.ts`, about line 421) has `.replace(/\s+/g, ' ')` inside a template literal, so the page receives `/s+/g`, which turns every run of the letter "s" into a space. Every selected option whose text contains an "s" is corrupted before matching. v26/v28/v29 matched only because their colour names have no "s". Not fixed here (no product changes in this brief).
  - **Ruggable v05 and Skullcandy v14: the address names no variant and the page's own selection was not read** (`selected: false`). Ruggable highlights 6'x9' by default and Skullcandy outlines the first colour; our code returns nothing on both.
  - **Kith v10 (`?variant=` the L id): our code picks L** because the address names it, but the page shows no size selected (SELECT A SIZE). By the 2026-10-14 design, "the row means the variant the address names", so this is the intended behaviour. It counts as "wrong" only against the question "what does the page show". Jev's Noul said no at p(yes) 0.01, which is the signal a wrong-variant verdict would want here.
- **Noul (does the page show the variant the address names): 16/18.** Both misses are Puma `swatch=16` / `swatch=17`. The swatch number appears only as "Style: 312123_16" at the bottom of the crop, and Jev answered no (0.08, 0.01). On `swatch=94`, with the style line higher up, it said yes (0.86). Address values that are words (sizes, fabrics, colour names) are answered right at ≥ 0.87. The only real "no" (Kith L) was caught.
- **Parameter mapping: 21/21.** `size` → size, `system=rug-cvr` → none, `swatch` → color, Burrow `Fabric` → color or material (both accepted: the value is a colour and a material together), `Leg Finish` → leg finish. Mostly easy name matches. `swatch` → color and `system` → none are the two that are not.
- **Stability: 0 of 10 Choice answers flipped** across three asks, with probabilities within 0.03. No Noul or parameter answer on those pages flipped either.
- **Set D: a crop around the description element does not fix the description false alarms: 2 of 28 now say yes.** The element search says why: the description is not on screen on most of these pages.
  - **Sigma ×6:** the text sits in a `display:none` product-info block (a tab that is not open).
  - **Ikea ×4:** it sits in a hidden tab panel (`pipf-tabs__panel`). One Ikea value was found visibly (the span repeats the name prefix) and one was not found at all.
  - **Lacoste ×11:** it sits inside an `aria-hidden` / `hidden` section, so the crop shows the folded accordion rows ("Care", "Traceability").
  - **Not On The High Street ×5:** the visible element holds only the first paragraph of the longer stored text, and Jev is unsure (p 0.39–0.58, 2 yes).
  - Experiment 1's reading was right: these are values not shown on the screen, not values Jev failed to see. A per-field crop helps only when the page opens the section. Expanding collapsed sections before the crop (the proof-page capture's expand rounds) is the change to try next.
- **Image limits:** TypeSafe rejected 450×256 crops with "400 Invalid image dimensions" (5 requests, nothing billed), although the spec's stated minimum is 256 px. Set D now crops at 400 px per side at least, and d07–d28 were re-sent with those crops. d01–d06 were sent before the change; their 493×680 crops were valid.

