# Jev with images — results

Spec: `docs/superpowers/specs/2026-10-15-jev-images-experiment.md`. CLI: `packages/api/src/jev-images-run.ts`. Model `jev-1.14.0`, header `TypeSafe-Danger-Zone-Images: true`, SDK `@typesafe-ai/sdk` 0.7.0.

- Requests: 251 (0 failed): 239 for the experiment, 12 for the billing measurement. Answers: 445.
- Input tokens: 1,102,229; output tokens: 12,871.
- **Cost: $0.0463** (input tokens × $0.042 / 1M; cap $2.00).
- Latency per request: median 585 ms (min 227, max 3767).
- Images: 1440×1000 PNG crops from our own Chromium (viewport 1440×1000), fresh captures (2026-10-15T12:51:16.385Z, 2026-10-15T13:01:07.770Z). Overlays covering a quarter of the viewport (fixed or modal: a zoom lightbox, a cart drawer, cookie dialogs) are hidden before the box map and the crops. A crop is the viewport when the value's element is inside it, else 1440×1000 centred on the element (box map; the heading for a title), else on a field hint (rating/stock/SKU words, the heading). Questions on one page that share a crop are asked in one call, the image once in `state`. Crops in `crops/`, every call and answer in `answers.json`, the requests in `plan-a.json` / `plan-b.json`.

## Batching and billing

Three set B pages, each with its 1440×1000 viewport crop and its first five questions. control: 1 question, no image. a: 1 question, image in state. b: 5 questions in one call, image in state only, the questions say "the screenshot" in words. c: the same 5 questions, each prefixed "Looking at <screenshot>:" with the image passed in `assets` under that reference (state names it too).

| Page | control (text, 1 q) | a (image, 1 q) | b (image in state, 5 q) | c (image referenced, 5 q) | image ≈ a − control | b − a | c − b |
|---|---:|---:|---:|---:|---:|---:|---:|
| sigmabeauty.com/products/skincare-brush-set | 315 (440 ms) | 4102 (720 ms) | 4237 (655 ms) | 22980 (782 ms) | 3787 | 135 | 18743 |
| sigmabeauty.com/products/f30-large-powder-chrome | 317 (227 ms) | 4101 (485 ms) | 4242 (490 ms) | 22983 (613 ms) | 3784 | 141 | 18741 |
| sigmabeauty.com/products/f03-high-cheekbone-highlighter | 318 (229 ms) | 4108 (495 ms) | 4238 (433 ms) | 22980 (529 ms) | 3790 | 130 | 18742 |

- One 1440×1000 image ≈ **3787 tokens** (median of a − control; 380 px per token; $0.000159 per image).
- Four more questions with the image in state only add a median **135 tokens** (b − a): **the image is billed once — it amortises across questions when it sits only in state.**
- Referencing it in each question adds a median **18742 tokens** over b (c − b): each reference is billed as another copy of the image (≈ 4.9 images more for 5 references).

## Tokens per call (main run)

- 1 question(s) per call: 192 calls, median 4142 input tokens, median 569 ms.
- 2 question(s) per call: 1 calls, median 4140 input tokens, median 2980 ms.
- 3 question(s) per call: 4 calls, median 4188 input tokens, median 1045 ms.
- 4 question(s) per call: 20 calls, median 4218 input tokens, median 691 ms.
- 5 question(s) per call: 10 calls, median 4264 input tokens, median 861 ms.
- 6 question(s) per call: 11 calls, median 4309 input tokens, median 807 ms.
- 7 question(s) per call: 1 calls, median 4354 input tokens, median 659 ms.

## Set A — the hard cases

| Group | Right (all repeats) | Cases right on every repeat | Unstable cases |
|---|---:|---:|---:|
| ruggable-price | 9/9 | 3/3 | 0 |
| gymshark-brand | 9/9 | 3/3 | 0 |
| colourpop-title | 27/27 | 9/9 | 0 |
| skullcandy-stock | 9/9 | 3/3 | 0 |
| real-error | 30/30 | 10/10 | 0 |
| flagged-correct | 15/30 | 5/10 | 0 |
| **all** | 99/114 | 33/38 | 0 |

Choice: the answer is the chosen candidate's value; "p" is Jev's probability of its choice, "p(truth)" of the true candidate. Noul: p(yes), and "p" is the probability of the side it took. ✓/✗ per repeat.

| Case | Page | Field | Truth | Answers (r1 / r2 / r3) | p | p(truth) | Right | Stable | Crop |
|---|---|---|---|---|---|---|---|---|---|
| a01 ruggable-price | ruggable.com/products/sierra-ivory-opal-tufted-rug?size=6x9&system=rug | Price | "374.25" of 26 | "374.25" / "374.25" / "374.25" | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | ✓✓✓ | yes | [element](crops/a-p001-ruggable-1458-0.png) |
| a02 ruggable-price | ruggable.com/products/morris-and-co-pimpernel-jade-tufted-rug?size=6x9 | Price | "449.25" of 20 | "449.25" / "449.25" / "449.25" | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | ✓✓✓ | yes | [viewport](crops/a-p002-ruggable-0-0.png) |
| a03 ruggable-price | ruggable.com/products/cyrus-rose-gold-tufted-rug?size=6x9&system=rug-c | Price | "424.15" of 26 | "424.15" / "424.15" / "424.15" | 1.00 / 1.00 / 1.00 | 1.00 / 1.00 / 1.00 | ✓✓✓ | yes | [viewport](crops/a-p003-ruggable-0-0.png) |
| a04 gymshark-brand | gymshark.com/products/gymshark-everyday-seamless-leggings-leggings-bro | Brand | "Gymshark" of 2 | "Gymshark" / "Gymshark" / "Gymshark" | 0.97 / 0.97 / 0.97 | 0.98 / 0.98 / 0.98 | ✓✓✓ | yes | [viewport](crops/a-p004-gymshark-0-0.png) |
| a05 gymshark-brand | gymshark.com/products/gymshark-everyday-seamless-flared-legging-leggin | Brand | "Gymshark" of 2 | "Gymshark" / "Gymshark" / "Gymshark" | 0.98 / 0.97 / 0.97 | 0.99 / 0.98 / 0.98 | ✓✓✓ | yes | [viewport](crops/a-p005-gymshark-0-0.png) |
| a06 gymshark-brand | gymshark.com/products/gymshark-whitney-mid-rise-legging-leggings-black | Brand | "Gymshark" of 2 | "Gymshark" / "Gymshark" / "Gymshark" | 0.97 / 0.97 / 0.97 | 0.98 / 0.98 / 0.98 | ✓✓✓ | yes | [viewport](crops/a-p006-gymshark-0-0.png) |
| a07 colourpop-title | colourpop.com/products/change-me-mega-highlighter | Title | "Change Me" of 3 | "Change Me" / "Change Me" / "Change Me" | 0.97 / 0.95 / 0.97 | 0.98 / 0.96 / 0.98 | ✓✓✓ | yes | [viewport](crops/a-p007-colourpop-0-0.png) |
| a08 colourpop-title | colourpop.com/products/game-over-shadow-stix | Title | "Shadow Stix" of 4 | "Shadow Stix" / "Shadow Stix" / "Shadow Stix" | 0.92 / 0.91 / 0.87 | 0.94 / 0.93 / 0.90 | ✓✓✓ | yes | [viewport](crops/a-p008-colourpop-0-0.png) |
| a09 colourpop-title | colourpop.com/products/beetle-chrome-liquid-shadow | Title | "Chrome Liquid Eyeshadow" of 4 | "Chrome Liquid Eyeshadow" / "Chrome Liquid Eyeshadow" / "Chrome Liquid Eyeshadow" | 0.99 / 0.99 / 0.96 | 0.99 / 0.99 / 0.97 | ✓✓✓ | yes | [viewport](crops/a-p009-colourpop-0-0.png) |
| a10 colourpop-title | colourpop.com/products/truth-or-bare-lippie-pencil-vault | Title | "Lippie Pencil Vault" of 4 | "Lippie Pencil Vault" / "Lippie Pencil Vault" / "Lippie Pencil Vault" | 0.97 / 0.99 / 0.97 | 0.98 / 0.99 / 0.98 | ✓✓✓ | yes | [viewport](crops/a-p010-colourpop-0-0.png) |
| a11 colourpop-title | colourpop.com/products/drift | Title | "Super Shock Shadow" of 4 | "Super Shock Shadow" / "Super Shock Shadow" / "Super Shock Shadow" | 0.94 / 0.96 / 0.97 | 0.95 / 0.97 / 0.98 | ✓✓✓ | yes | [viewport](crops/a-p011-colourpop-0-0.png) |
| a12 colourpop-title | colourpop.com/products/cotton-candy-shadow-stix | Title | "Shadow Stix" of 4 | "Shadow Stix" / "Shadow Stix" / "Shadow Stix" | 0.85 / 0.85 / 0.89 | 0.88 / 0.88 / 0.91 | ✓✓✓ | yes | [viewport](crops/a-p012-colourpop-0-0.png) |
| a13 colourpop-title | colourpop.com/products/opaltini | Title | "Mini Shimmering Dry Oil" of 5 | "Mini Shimmering Dry Oil" / "Mini Shimmering Dry Oil" / "Mini Shimmering Dry Oil" | 1.00 / 0.99 / 0.99 | 1.00 / 0.99 / 0.99 | ✓✓✓ | yes | [viewport](crops/a-p013-colourpop-0-0.png) |
| a14 colourpop-title | colourpop.com/products/coven-clash-jelly-much-duo | Title | "Coven Clash" of 3 | "Coven Clash" / "Coven Clash" / "Coven Clash" | 0.57 / 0.57 / 0.60 | 0.68 / 0.68 / 0.70 | ✓✓✓ | yes | [viewport](crops/a-p014-colourpop-0-0.png) |
| a15 colourpop-title | colourpop.com/products/emo-inside-jelly-much-shadow-n | Title | "Jelly Much Shadow" of 4 | "Jelly Much Shadow" / "Jelly Much Shadow" / "Jelly Much Shadow" | 0.89 / 0.90 / 0.90 | 0.91 / 0.92 / 0.92 | ✓✓✓ | yes | [viewport](crops/a-p015-colourpop-0-0.png) |
| a16 skullcandy-stock | skullcandy.com/products/smokin-buds-true-wireless-earbuds?variant=4480 | In stock | no (true) | p(yes) 0.010 / p(yes) 0.010 / p(yes) 0.010 | 0.99 / 0.99 / 0.99 |  | ✓✓✓ | yes | [viewport](crops/a-p016-skullcandy-0-0.png) |
| a17 skullcandy-stock | skullcandy.com/products/crusher-evo-sensory-bass-headphones-with-perso | In stock | yes (true) | p(yes) 0.970 / p(yes) 0.970 / p(yes) 0.980 | 0.97 / 0.97 / 0.98 |  | ✓✓✓ | yes | [viewport](crops/a-p017-skullcandy-0-0.png) |
| a18 skullcandy-stock | skullcandy.com/products/push-anc-active?variant=43208350498873 | In stock | no (true) | p(yes) 0.010 / p(yes) 0.010 / p(yes) 0.010 | 0.99 / 0.99 / 0.99 |  | ✓✓✓ | yes | [viewport](crops/a-p018-skullcandy-0-0.png) |
| a19 real-error | sigmabeauty.com/products/basic-eye-kit | Rating | no (4.9) | p(yes) 0.020 / p(yes) 0.020 / p(yes) 0.030 | 0.98 / 0.98 / 0.97 |  | ✓✓✓ | yes | [viewport](crops/a-p019-sigmabeauty-0-0.png) |
| a20 real-error | sigmabeauty.com/products/4dhd-kabuki | Rating | no (4.9) | p(yes) 0.010 / p(yes) 0.010 / p(yes) 0.010 | 0.99 / 0.99 / 0.99 |  | ✓✓✓ | yes | [viewport](crops/a-p020-sigmabeauty-0-0.png) |
| a21 real-error | us.puma.com/us/en/pd/deviate-nitro-4-mens-road-running-shoes/312123?sw | SKU | yes (Style: 312123_16) | p(yes) 0.930 / p(yes) 0.930 / p(yes) 0.910 | 0.93 / 0.93 / 0.91 |  | ✓✓✓ | yes | [element](crops/a-p021-puma-0-885.png) |
| a22 real-error | us.puma.com/us/en/pd/deviate-nitro-4-mens-road-running-shoes/312123?sw | Description | no (Deviate 4 isn't just fast – its too fast. 15g lighter than i) | p(yes) 0.010 / p(yes) 0.010 / p(yes) 0.010 | 0.99 / 0.99 / 0.99 |  | ✓✓✓ | yes | [hint](crops/a-p021-puma-0-717.png) |
| a23 real-error | us.puma.com/us/en/pd/deviate-pure-nitro-mens-running-shoes/313904?swat | Description | no (Deviate Pure NITROTM Road Running Shoes are ready for traini) | p(yes) 0.170 / p(yes) 0.150 / p(yes) 0.160 | 0.83 / 0.85 / 0.84 |  | ✓✓✓ | yes | [viewport](crops/a-p022-puma-0-0.png) |
| a24 real-error | us.puma.com/us/en/pd/deviate-nitro-4-mens-road-running-shoes/312123?sw | Description | no (Deviate 4 isn't just fast – its too fast. 15g lighter than i) | p(yes) 0.010 / p(yes) 0.010 / p(yes) 0.010 | 0.99 / 0.99 / 0.99 |  | ✓✓✓ | yes | [hint](crops/a-p023-puma-0-717.png) |
| a25 real-error | us.puma.com/us/en/pd/deviate-nitro-elite-4-mens-road-running-shoes/312 | Description | no (When fast isn’t fast enough, you go beyond. The Deviate NITR) | p(yes) 0.190 / p(yes) 0.210 / p(yes) 0.200 | 0.81 / 0.79 / 0.80 |  | ✓✓✓ | yes | [hint](crops/a-p024-puma-0-525.png) |
| a26 real-error | notonthehighstreet.com/withlovejewellerylimited/product/20th-30th-40th | Rating | no (4.9) | p(yes) 0.010 / p(yes) 0.000 / p(yes) 0.010 | 0.99 / 1.00 / 0.99 |  | ✓✓✓ | yes | [viewport](crops/a-p025-notonthehighstreet-0-0.png) |
| a27 real-error | notonthehighstreet.com/lunity/product/sisters-necklace-sterling-silver | Rating | no (4.6) | p(yes) 0.010 / p(yes) 0.010 / p(yes) 0.010 | 0.99 / 0.99 / 0.99 |  | ✓✓✓ | yes | [viewport](crops/a-p026-notonthehighstreet-0-0.png) |
| a28 real-error | notonthehighstreet.com/giftsonline4u/product/personalised-mens-bracele | Rating | no (4.2) | p(yes) 0.010 / p(yes) 0.010 / p(yes) 0.010 | 0.99 / 0.99 / 0.99 |  | ✓✓✓ | yes | [viewport](crops/a-p027-notonthehighstreet-0-0.png) |
| a29 flagged-correct | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH1417-0 | Rating | yes (4.625) | p(yes) 0.080 / p(yes) 0.070 / p(yes) 0.060 | 0.92 / 0.93 / 0.94 |  | ✗✗✗ | yes | [viewport](crops/a-p028-lacoste-0-0.png) |
| a30 flagged-correct | ikea.com/my/en/p/friheten-3-seat-sofa-bed-faringe-brown-orange-8055122 | Title | yes (FRIHETEN 3-seat sofa-bed - Faringe brown-orange) | p(yes) 0.720 / p(yes) 0.730 / p(yes) 0.720 | 0.72 / 0.73 / 0.72 |  | ✓✓✓ | yes | [viewport](crops/a-p029-ikea-0-0.png) |
| a31 flagged-correct | ikea.com/my/en/p/friheten-3-seat-sofa-bed-faringe-brown-orange-8055122 | Description | yes (FRIHETEN 3-seat sofa-bed - Faringe brown-orange. Readily con) | p(yes) 0.090 / p(yes) 0.100 / p(yes) 0.100 | 0.91 / 0.90 / 0.90 |  | ✗✗✗ | yes | [element](crops/a-p029-ikea-0-1811.png) |
| a32 flagged-correct | ikea.com/my/en/p/mannarp-4-seat-sofa-with-chaise-longue-saxemara-black | Title | yes (MANNARP 4-seat sofa with chaise longue - Saxemara black-blue) | p(yes) 0.650 / p(yes) 0.680 / p(yes) 0.640 | 0.65 / 0.68 / 0.64 |  | ✓✓✓ | yes | [viewport](crops/a-p030-ikea-0-0.png) |
| a33 flagged-correct | ikea.com/my/en/p/mannarp-4-seat-sofa-with-chaise-longue-saxemara-black | Description | yes (MANNARP 4-seat sofa with chaise longue - Saxemara black-blue) | p(yes) 0.100 / p(yes) 0.090 / p(yes) 0.100 | 0.90 / 0.91 / 0.90 |  | ✗✗✗ | yes | [hint](crops/a-p030-ikea-0-499.png) |
| a34 flagged-correct | ikea.com/my/en/p/soederhamn-4-seat-sofa-with-chaise-longue-and-open-en | Title | yes (SÖDERHAMN 4-seat sofa with chaise longue - and open end/Keli) | p(yes) 0.570 / p(yes) 0.590 / p(yes) 0.600 | 0.57 / 0.59 / 0.60 |  | ✓✓✓ | yes | [viewport](crops/a-p031-ikea-0-0.png) |
| a35 flagged-correct | ikea.com/my/en/p/soederhamn-4-seat-sofa-with-chaise-longue-and-open-en | Description | yes (SÖDERHAMN 4-seat sofa with chaise longue - and open end/Keli) | p(yes) 0.170 / p(yes) 0.190 / p(yes) 0.190 | 0.83 / 0.81 / 0.81 |  | ✗✗✗ | yes | [hint](crops/a-p031-ikea-0-499.png) |
| a36 flagged-correct | ikea.com/my/en/p/kivik-3-seat-sofa-with-chaise-longue-tibbleby-beige-g | Title | yes (KIVIK 3-seat sofa with chaise longue - Tibbleby beige/grey) | p(yes) 0.660 / p(yes) 0.640 / p(yes) 0.680 | 0.66 / 0.64 / 0.68 |  | ✓✓✓ | yes | [viewport](crops/a-p032-ikea-0-0.png) |
| a37 flagged-correct | ikea.com/my/en/p/soederhamn-corner-sofa-6-seat-kelinge-dark-yellow-s99 | Title | yes (SÖDERHAMN Corner sofa, 6-seat - Kelinge dark yellow) | p(yes) 0.530 / p(yes) 0.550 / p(yes) 0.570 | 0.53 / 0.55 / 0.57 |  | ✓✓✓ | yes | [viewport](crops/a-p033-ikea-0-0.png) |
| a38 flagged-correct | ikea.com/my/en/p/soederhamn-corner-sofa-6-seat-kelinge-dark-yellow-s99 | Description | yes (SÖDERHAMN Corner sofa, 6-seat - Kelinge dark yellow. SÖDERHA) | p(yes) 0.160 / p(yes) 0.160 / p(yes) 0.130 | 0.84 / 0.84 / 0.87 |  | ✗✗✗ | yes | [hint](crops/a-p033-ikea-0-499.png) |

## Set B — against the judge

- Sample: 297 values from batch C's five judged runs (every judged-wrong value, 255 judged-correct, whole items in stored order); 42 judged wrong, of which 10 are the campaign's real errors.
- **Changed since** (the fresh page no longer carries the stored value in its text or data; not asked): **2**.
- Not captured: 0 values.
- **Scored: 295. Agreement with the judge: 238/295 = 81%.**
- **Real errors caught: 8/8** still on the page (10 in the sample; 2 changed since).
- **False alarms** (judge correct, Jev no): **44/255** = 17%.
- Judge-wrong but not a real error (the judge's own limits): Jev said no on 19/32.

| Judge \ Jev | yes (p ≥ 0.5) | no |
|---|---:|---:|
| correct | 211 | 44 |
| wrong — real error | 0 | 8 |
| wrong — judge's limit | 13 | 19 |

### Per site and field

| Site | Field | Scored | Agree | Jev no on judge-correct | Jev no on judge-wrong | Changed since |
|---|---|---:|---:|---:|---:|---:|
| sigmabeauty | Title | 8 | 8 | 0/8 | 0/0 | 0 |
| sigmabeauty | Price | 9 | 7 | 2/9 | 0/0 | 0 |
| sigmabeauty | SKU | 9 | 5 | 0/5 | 0/4 | 0 |
| sigmabeauty | Brand | 8 | 1 | 7/7 | 1/1 | 0 |
| sigmabeauty | In stock | 8 | 7 | 1/8 | 0/0 | 0 |
| sigmabeauty | Rating | 8 | 8 | 0/6 | 2/2 | 0 |
| sigmabeauty | Description | 8 | 2 | 6/8 | 0/0 | 0 |
| lacoste | Title | 12 | 12 | 0/12 | 0/0 | 0 |
| lacoste | Price | 12 | 12 | 0/12 | 0/0 | 0 |
| lacoste | Brand | 11 | 11 | 0/11 | 0/0 | 0 |
| lacoste | Rating | 12 | 12 | 0/1 | 11/11 | 0 |
| lacoste | Description | 11 | 0 | 11/11 | 0/0 | 0 |
| lacoste | In stock | 5 | 3 | 1/4 | 0/1 | 0 |
| lacoste | SKU | 3 | 3 | 0/0 | 3/3 | 0 |
| puma | Title | 8 | 5 | 3/8 | 0/0 | 0 |
| puma | Price | 9 | 9 | 0/9 | 0/0 | 0 |
| puma | SKU | 8 | 7 | 0/7 | 0/1 | 1 |
| puma | Brand | 9 | 9 | 0/9 | 0/0 | 0 |
| puma | In stock | 9 | 8 | 0/8 | 0/1 | 0 |
| puma | Rating | 6 | 5 | 1/6 | 0/0 | 0 |
| puma | Description | 8 | 8 | 0/4 | 4/4 | 0 |
| notonthehighstreet | Title | 8 | 8 | 0/8 | 0/0 | 0 |
| notonthehighstreet | Price | 9 | 9 | 0/9 | 0/0 | 0 |
| notonthehighstreet | SKU | 9 | 9 | 0/9 | 0/0 | 0 |
| notonthehighstreet | Brand | 8 | 8 | 0/8 | 0/0 | 0 |
| notonthehighstreet | Rating | 7 | 6 | 0/4 | 2/3 | 1 |
| notonthehighstreet | Description | 8 | 3 | 5/8 | 0/0 | 0 |
| notonthehighstreet | In stock | 5 | 5 | 0/5 | 0/0 | 0 |
| ikea | Title | 9 | 9 | 0/9 | 0/0 | 0 |
| ikea | Price | 9 | 9 | 0/9 | 0/0 | 0 |
| ikea | SKU | 9 | 9 | 0/9 | 0/0 | 0 |
| ikea | Brand | 9 | 9 | 0/9 | 0/0 | 0 |
| ikea | Rating | 7 | 6 | 1/7 | 0/0 | 0 |
| ikea | Description | 9 | 3 | 6/6 | 3/3 | 0 |
| ikea | In stock | 8 | 3 | 0/2 | 1/6 | 0 |

### Calibration

Answers bucketed by Jev's p(yes); "judge correct" is the share of the bucket the judge called correct (the reference); "Jev right" is the share where Jev's side (yes at p ≥ 0.5) matches the judge.

| p(yes) | n | judge correct | Jev right |
|---|---:|---:|---:|
| 0.0–0.1 | 25 | 16% | 84% |
| 0.1–0.3 | 34 | 82% | 18% |
| 0.3–0.5 | 12 | 100% | 0% |
| 0.5–0.7 | 40 | 95% | 95% |
| 0.7–0.9 | 47 | 91% | 91% |
| 0.9–1.0 | 137 | 95% | 95% |

### Disagreements

| Id | Page | Field | Stored value | Judge | p(yes) | Crop |
|---|---|---|---|---|---:|---|
| b003 | sigmabeauty.com/products/skincare-brush-set | SKU | SBS01 | wrong | 0.990 | [element](crops/b-p001-sigmabeauty-0-1068.png) |
| b004 | sigmabeauty.com/products/skincare-brush-set | Brand | SigmaBeauty | correct | 0.280 | [viewport](crops/b-p001-sigmabeauty-0-0.png) |
| b007 | sigmabeauty.com/products/skincare-brush-set | Description | Take your self-care up a notch with this luxurious brush set | correct | 0.380 | [viewport](crops/b-p001-sigmabeauty-0-0.png) |
| b010 | sigmabeauty.com/products/f30-large-powder-chrome | SKU | F30-1 | wrong | 0.980 | [element](crops/b-p002-sigmabeauty-0-1292.png) |
| b012 | sigmabeauty.com/products/f30-large-powder-chrome | In stock | true | correct | 0.000 | [viewport](crops/b-p002-sigmabeauty-0-0.png) |
| b015 | sigmabeauty.com/products/f03-high-cheekbone-highlighter | Price | 143 | correct | 0.410 | [viewport](crops/b-p003-sigmabeauty-0-0.png) |
| b016 | sigmabeauty.com/products/f03-high-cheekbone-highlighter | SKU | F03 | wrong | 0.800 | [viewport](crops/b-p003-sigmabeauty-0-0.png) |
| b017 | sigmabeauty.com/products/f03-high-cheekbone-highlighter | Brand | SigmaBeauty | correct | 0.170 | [viewport](crops/b-p003-sigmabeauty-0-0.png) |
| b020 | sigmabeauty.com/products/f03-high-cheekbone-highlighter | Description | Hit your high points with this fluffy but firm Sigmax® fiber | correct | 0.430 | [viewport](crops/b-p003-sigmabeauty-0-0.png) |
| b024 | sigmabeauty.com/products/basic-eye-kit | Brand | SigmaBeauty | correct | 0.140 | [viewport](crops/b-p004-sigmabeauty-0-0.png) |
| b027 | sigmabeauty.com/products/basic-eye-kit | Description | This set does it all with 7 classic, professional-quality ey | correct | 0.330 | [viewport](crops/b-p004-sigmabeauty-0-0.png) |
| b030 | sigmabeauty.com/products/f53-air-contour-blush | SKU | F53 | wrong | 0.750 | [viewport](crops/b-p005-sigmabeauty-0-0.png) |
| b031 | sigmabeauty.com/products/f53-air-contour-blush | Brand | SigmaBeauty | correct | 0.210 | [viewport](crops/b-p005-sigmabeauty-0-0.png) |
| b034 | sigmabeauty.com/products/f53-air-contour-blush | Description | Wake up your skin with a natural flush of color! This feathe | correct | 0.260 | [viewport](crops/b-p005-sigmabeauty-0-0.png) |
| b038 | sigmabeauty.com/products/4dhd-kabuki | Brand | SigmaBeauty | correct | 0.430 | [viewport](crops/b-p006-sigmabeauty-0-0.png) |
| b041 | sigmabeauty.com/products/4dhd-kabuki | Description | The pyramid-shaped, Sigmax® brush you didn't know you needed | correct | 0.390 | [viewport](crops/b-p006-sigmabeauty-0-0.png) |
| b043 | sigmabeauty.com/products/e42-precision-firm-blender | Price | 93 | correct | 0.470 | [viewport](crops/b-p007-sigmabeauty-0-0.png) |
| b045 | sigmabeauty.com/products/e42-precision-firm-blender | Brand | SigmaBeauty | correct | 0.210 | [viewport](crops/b-p007-sigmabeauty-0-0.png) |
| b052 | sigmabeauty.com/products/3dhdr-kabuki-brush | Brand | SigmaBeauty | correct | 0.200 | [viewport](crops/b-p008-sigmabeauty-0-0.png) |
| b055 | sigmabeauty.com/products/3dhdr-kabuki-brush | Description | You'll achieve perfect skin on every curve and contour using | correct | 0.410 | [viewport](crops/b-p008-sigmabeauty-0-0.png) |
| b063 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00 | Description | Go back to where all started with the elegant L.12.12 Origin | correct | 0.260 | [element](crops/b-p010-lacoste-0-596.png) |
| b069 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1264-00 | Description | 1933. René Lacoste invented the first polo shirt, the Origin | correct | 0.180 | [element](crops/b-p011-lacoste-0-558.png) |
| b075 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1264-00 | Description | 1933. René Lacoste invented the first polo shirt, the Origin | correct | 0.260 | [element](crops/b-p012-lacoste-0-578.png) |
| b080 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH0213-0 | In stock | true | correct | 0.160 | [viewport](crops/b-p013-lacoste-0-0.png) |
| b081 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH0213-0 | Description | An elegant winter version of an iconic style from Lacoste, c | correct | 0.350 | [element](crops/b-p013-lacoste-0-564.png) |
| b086 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/long-sleeve/L1312-00.h | Description | Invented by René Lacoste, the Original L.12.12 has been the  | correct | 0.270 | [element](crops/b-p014-lacoste-0-546.png) |
| b091 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00 | Description | Go back to where all started with the elegant L.12.12 Origin | correct | 0.210 | [element](crops/b-p015-lacoste-0-522.png) |
| b096 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH9851-0 | Description | Lacoste is proud to present the L.12.12 LIGHT polo shirt, a  | correct | 0.220 | [element](crops/b-p016-lacoste-0-484.png) |
| b101 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00 | Description | Go back to where all started with the elegant L.12.12 Origin | correct | 0.220 | [element](crops/b-p017-lacoste-0-522.png) |
| b107 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/long-sleeve/PH2481-00. | Description | Inventor of polo shirts since 1933, Lacoste presents the Sma | correct | 0.110 | [element](crops/b-p018-lacoste-0-488.png) |
| b112 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH4012-0 | Description | Go back to where all started with the elegant L.12.12 Origin | correct | 0.270 | [element](crops/b-p019-lacoste-0-512.png) |
| b118 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH6809-0 | Description | The polo that Novak Djokovic wears on court. Championship te | correct | 0.290 | [element](crops/b-p020-lacoste-0-498.png) |
| b124 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH1417-0 | In stock | true | wrong | 0.510 | [viewport](crops/b-p024-lacoste-0-0.png) |
| b147 | us.puma.com/us/en/pd/lafrance-sneakers/314471?swatch=01 | SKU | Style: 314471_01 | wrong | 0.940 | [element](crops/b-p028-puma-0-741.png) |
| b151 | us.puma.com/us/en/pd/speedcat-og-sneakers/398846?swatch=94 | Title | Speedcat OG Sneakers | correct | 0.240 | [viewport](crops/b-p029-puma-0-0.png) |
| b155 | us.puma.com/us/en/pd/speedcat-og-sneakers/398846?swatch=94 | In stock | true | wrong | 0.690 | [viewport](crops/b-p029-puma-0-0.png) |
| b156 | us.puma.com/us/en/pd/speedcat-og-sneakers/398846?swatch=94 | Rating | 4.4 | correct | 0.040 | [element](crops/b-p029-puma-0-5845.png) |
| b165 | us.puma.com/us/en/pd/suede-snake-print-sneakers/408329?swatch=01 | Title | Suede Snake Print Sneakers | correct | 0.100 | [viewport](crops/b-p031-puma-0-0.png) |
| b171 | us.puma.com/us/en/pd/arizona-suede-sneakers/402362?swatch=11 | Title | Arizona Suede Sneakers | correct | 0.100 | [viewport](crops/b-p032-puma-0-0.png) |
| b187 | notonthehighstreet.com/lisaangeljewellery/product/personalised-heart-a | Rating | 4.2 | wrong | 0.990 | [viewport](crops/b-p034-notonthehighstreet-0-0.png) |
| b188 | notonthehighstreet.com/lisaangeljewellery/product/personalised-heart-a | Description | A sweet heart charm and special birthstone bracelet that is  | correct | 0.490 | [viewport](crops/b-p034-notonthehighstreet-0-0.png) |
| b194 | notonthehighstreet.com/withlovejewellerylimited/product/20th-30th-40th | Description | A sterling silver beaded stretch birthday bracelet for a 20t | correct | 0.180 | [hint](crops/b-p035-notonthehighstreet-0-1363.png) |
| b214 | notonthehighstreet.com/silkpursesowsear/product/art-deco-emerald-bague | Description | Beautiful emerald earrings, with art deco detailing and a cl | correct | 0.460 | [viewport](crops/b-p038-notonthehighstreet-0-0.png) |
| b221 | notonthehighstreet.com/potiega/product/sterling-silver-name-necklace-w | Description | Make a statement or give the gift of timeless elegance with  | correct | 0.470 | [viewport](crops/b-p039-notonthehighstreet-0-0.png) |
| b235 | notonthehighstreet.com/augustajewellery/product/ginkgo-earrings | Description | Nature inspired statement earrings.A beautiful pair of state | correct | 0.230 | [viewport](crops/b-p041-notonthehighstreet-0-0.png) |
| b248 | ikea.com/my/en/p/soederhamn-corner-sofa-6-seat-kelinge-dark-yellow-s99 | In stock | true | wrong | 0.940 | [viewport](crops/b-p044-ikea-0-0.png) |
| b249 | ikea.com/my/en/p/soederhamn-corner-sofa-6-seat-kelinge-dark-yellow-s99 | Description | SÖDERHAMN Corner sofa, 6-seat - Kelinge dark yellow. SÖDERHA | correct | 0.150 | [hint](crops/b-p044-ikea-0-499.png) |
| b254 | ikea.com/my/en/p/hyltarp-3-seat-sofa-kilanda-pale-blue-s99489647/ | In stock | true | wrong | 0.980 | [viewport](crops/b-p045-ikea-0-0.png) |
| b256 | ikea.com/my/en/p/hyltarp-3-seat-sofa-kilanda-pale-blue-s99489647/ | Description | HYLTARP 3-seat sofa - Kilanda pale blue. Skillful craftsmans | correct | 0.070 | [hint](crops/b-p045-ikea-0-499.png) |
| b261 | ikea.com/my/en/p/soederhamn-1-seat-section-kelinge-dark-yellow-s996215 | In stock | true | wrong | 0.790 | [viewport](crops/b-p046-ikea-0-0.png) |
| b263 | ikea.com/my/en/p/soederhamn-1-seat-section-kelinge-dark-yellow-s996215 | Description | SÖDERHAMN 1-seat section - Kelinge dark yellow. SÖDERHAMN se | correct | 0.140 | [hint](crops/b-p046-ikea-0-499.png) |
| b268 | ikea.com/my/en/p/kivik-4-seat-sofa-with-chaise-longue-tresund-anthraci | In stock | true | wrong | 0.970 | [viewport](crops/b-p047-ikea-0-0.png) |
| b270 | ikea.com/my/en/p/kivik-4-seat-sofa-with-chaise-longue-tresund-anthraci | Description | KIVIK 4-seat sofa with chaise longue - Tresund anthracite. E | correct | 0.200 | [hint](crops/b-p047-ikea-0-499.png) |
| b276 | ikea.com/my/en/p/vimle-3-seat-sofa-with-chaise-longue-with-wide-armres | Rating | 5 | correct | 0.180 | [viewport](crops/b-p048-ikea-0-0.png) |
| b288 | ikea.com/my/en/p/lillehem-3-seat-modular-sofa-w-chaise-longue-vissle-b | In stock | true | wrong | 0.770 | [viewport](crops/b-p050-ikea-0-0.png) |
| b290 | ikea.com/my/en/p/lillehem-3-seat-modular-sofa-w-chaise-longue-vissle-b | Description | LILLEHEM 3-seat modular sofa w chaise longue - Vissle/beige  | correct | 0.130 | [hint](crops/b-p050-ikea-0-499.png) |
| b297 | ikea.com/my/en/p/friheten-3-seat-sofa-bed-faringe-brown-orange-8055122 | Description | FRIHETEN 3-seat sofa-bed - Faringe brown-orange. Readily con | correct | 0.090 | [element](crops/b-p051-ikea-0-1811.png) |

### Judge-wrong values

| Id | Page | Field | Stored value | Judge | p(yes) | Crop |
|---|---|---|---|---|---:|---|
| b003 | sigmabeauty.com/products/skincare-brush-set | SKU | SBS01 | wrong | 0.990 | [element](crops/b-p001-sigmabeauty-0-1068.png) |
| b010 | sigmabeauty.com/products/f30-large-powder-chrome | SKU | F30-1 | wrong | 0.980 | [element](crops/b-p002-sigmabeauty-0-1292.png) |
| b011 | sigmabeauty.com/products/f30-large-powder-chrome | Brand | SigmaBeauty | wrong | 0.210 | [viewport](crops/b-p002-sigmabeauty-0-0.png) |
| b016 | sigmabeauty.com/products/f03-high-cheekbone-highlighter | SKU | F03 | wrong | 0.800 | [viewport](crops/b-p003-sigmabeauty-0-0.png) |
| b026 | sigmabeauty.com/products/basic-eye-kit | Rating | 4.9 | wrong (real) | 0.030 | [viewport](crops/b-p004-sigmabeauty-0-0.png) |
| b030 | sigmabeauty.com/products/f53-air-contour-blush | SKU | F53 | wrong | 0.750 | [viewport](crops/b-p005-sigmabeauty-0-0.png) |
| b040 | sigmabeauty.com/products/4dhd-kabuki | Rating | 4.9 | wrong (real) | 0.010 | [viewport](crops/b-p006-sigmabeauty-0-0.png) |
| b062 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00 | Rating | 4.7672 | wrong | 0.030 | [viewport](crops/b-p010-lacoste-0-0.png) |
| b068 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1264-00 | Rating | 4.7363 | wrong | 0.070 | [viewport](crops/b-p011-lacoste-0-0.png) |
| b074 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1264-00 | Rating | 4.7363 | wrong | 0.040 | [viewport](crops/b-p012-lacoste-0-0.png) |
| b078 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH0213-0 | SKU | 3617078031774 | wrong | 0.040 | [viewport](crops/b-p013-lacoste-0-0.png) |
| b085 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/long-sleeve/L1312-00.h | Rating | 4.9559 | wrong | 0.040 | [viewport](crops/b-p014-lacoste-0-0.png) |
| b090 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00 | Rating | 4.7672 | wrong | 0.040 | [viewport](crops/b-p015-lacoste-0-0.png) |
| b095 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH9851-0 | Rating | 4.8214 | wrong | 0.090 | [viewport](crops/b-p016-lacoste-0-0.png) |
| b100 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00 | Rating | 4.7672 | wrong | 0.070 | [viewport](crops/b-p017-lacoste-0-0.png) |
| b106 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/long-sleeve/PH2481-00. | Rating | 4.9792 | wrong | 0.050 | [viewport](crops/b-p018-lacoste-0-0.png) |
| b111 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH4012-0 | Rating | 4.6635 | wrong | 0.020 | [viewport](crops/b-p019-lacoste-0-0.png) |
| b115 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH6809-0 | SKU | 3617077699852 | wrong | 0.040 | [viewport](crops/b-p020-lacoste-0-0.png) |
| b121 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/long-sleeve/L1312-00.h | Rating | 4.9559 | wrong | 0.030 | [viewport](crops/b-p021-lacoste-0-0.png) |
| b122 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH9851-0 | Rating | 4.8214 | wrong | 0.050 | [viewport](crops/b-p022-lacoste-0-0.png) |
| b123 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH5522-0 | SKU | 3614030789520 | wrong | 0.030 | [viewport](crops/b-p023-lacoste-0-0.png) |
| b124 | lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/DH1417-0 | In stock | true | wrong | 0.510 | [viewport](crops/b-p024-lacoste-0-0.png) |
| b131 | us.puma.com/us/en/pd/deviate-nitro-4-mens-road-running-shoes/312123?sw | Description | Deviate 4 isn't just fast – its too fast. 15g lighter than i | wrong (real) | 0.010 | [hint](crops/b-p025-puma-0-717.png) |
| b138 | us.puma.com/us/en/pd/deviate-pure-nitro-mens-running-shoes/313904?swat | Description | Deviate Pure NITROTM Road Running Shoes are ready for traini | wrong (real) | 0.180 | [viewport](crops/b-p026-puma-0-0.png) |
| b144 | us.puma.com/us/en/pd/deviate-nitro-4-mens-road-running-shoes/312123?sw | Description | Deviate 4 isn't just fast – its too fast. 15g lighter than i | wrong (real) | 0.010 | [hint](crops/b-p027-puma-0-717.png) |
| b147 | us.puma.com/us/en/pd/lafrance-sneakers/314471?swatch=01 | SKU | Style: 314471_01 | wrong | 0.940 | [element](crops/b-p028-puma-0-741.png) |
| b155 | us.puma.com/us/en/pd/speedcat-og-sneakers/398846?swatch=94 | In stock | true | wrong | 0.690 | [viewport](crops/b-p029-puma-0-0.png) |
| b164 | us.puma.com/us/en/pd/deviate-nitro-elite-4-mens-road-running-shoes/312 | Description | When fast isn’t fast enough, you go beyond. The Deviate NITR | wrong (real) | 0.160 | [hint](crops/b-p030-puma-0-525.png) |
| b187 | notonthehighstreet.com/lisaangeljewellery/product/personalised-heart-a | Rating | 4.2 | wrong | 0.990 | [viewport](crops/b-p034-notonthehighstreet-0-0.png) |
| b200 | notonthehighstreet.com/lunity/product/sisters-necklace-sterling-silver | Rating | 4.6 | wrong (real) | 0.010 | [viewport](crops/b-p036-notonthehighstreet-0-0.png) |
| b206 | notonthehighstreet.com/giftsonline4u/product/personalised-mens-bracele | Rating | 4.2 | wrong (real) | 0.010 | [viewport](crops/b-p037-notonthehighstreet-0-0.png) |
| b243 | ikea.com/my/en/p/kivik-3-seat-sofa-with-chaise-longue-tibbleby-beige-g | Description | KIVIK 3-seat sofa with chaise longue - Tibbleby beige/grey.  | wrong | 0.240 | [hint](crops/b-p043-ikea-0-499.png) |
| b248 | ikea.com/my/en/p/soederhamn-corner-sofa-6-seat-kelinge-dark-yellow-s99 | In stock | true | wrong | 0.940 | [viewport](crops/b-p044-ikea-0-0.png) |
| b254 | ikea.com/my/en/p/hyltarp-3-seat-sofa-kilanda-pale-blue-s99489647/ | In stock | true | wrong | 0.980 | [viewport](crops/b-p045-ikea-0-0.png) |
| b261 | ikea.com/my/en/p/soederhamn-1-seat-section-kelinge-dark-yellow-s996215 | In stock | true | wrong | 0.790 | [viewport](crops/b-p046-ikea-0-0.png) |
| b268 | ikea.com/my/en/p/kivik-4-seat-sofa-with-chaise-longue-tresund-anthraci | In stock | true | wrong | 0.970 | [viewport](crops/b-p047-ikea-0-0.png) |
| b277 | ikea.com/my/en/p/vimle-3-seat-sofa-with-chaise-longue-with-wide-armres | Description | VIMLE 3-seat sofa with chaise longue - with wide armrests/Kn | wrong | 0.170 | [hint](crops/b-p048-ikea-0-499.png) |
| b282 | ikea.com/my/en/p/vimle-corner-sofa-5-seat-gunnared-beige-s99399576/ | In stock | true | wrong | 0.020 | [viewport](crops/b-p049-ikea-0-0.png) |
| b283 | ikea.com/my/en/p/vimle-corner-sofa-5-seat-gunnared-beige-s99399576/ | Description | VIMLE Corner sofa, 5-seat - Gunnared beige. This soft sofa w | wrong | 0.130 | [hint](crops/b-p049-ikea-0-499.png) |
| b288 | ikea.com/my/en/p/lillehem-3-seat-modular-sofa-w-chaise-longue-vissle-b | In stock | true | wrong | 0.770 | [viewport](crops/b-p050-ikea-0-0.png) |
| b127 | us.puma.com/us/en/pd/deviate-nitro-4-mens-road-running-shoes/312123?sw | SKU | Style: 312123_16 | wrong (real) | not asked: changed since | |
| b193 | notonthehighstreet.com/withlovejewellerylimited/product/20th-30th-40th | Rating | 4.9 | wrong (real) | not asked: changed since | |

## Reading the numbers (2026-10-15, by hand)

- **Set A truths set by looking at the crops** (`truth-a.json`): Ruggable shows the sale price for 6'x9' ($374.25 / $449.25 / $424.15, the list price struck through beside it); Skullcandy shows OUT OF STOCK on Smokin' Buds and Push ANC Active, ADD TO CART on Crusher Evo. **a21 changed since batch C:** Puma 312123 `?swatch=16` now prints "Style: 312123_16", the stored value, so its truth is yes (Jev said yes); the other 9 real errors are still wrong on the fresh pages.
- **Set A misses are all one kind:** the 5 flagged-correct cases Jev rejects are 4 Ikea descriptions (the stored JSON-LD copy starts with the product name, and the crop does not show it as stored) and Lacoste's rating 4.625 (the page shows stars only). Those values are not printed as stored, so Jev's "no" is literally right; the case list called them correct because the judge did.
- **Set B false alarms (44) are mostly values not visible in the crop:** 28 are descriptions (collapsed accordions, text below the crop, Ikea's name-prefixed JSON-LD copy), 7 are Sigma's brand "SigmaBeauty" against a "SIGMA" logo, and the rest are scattered (2 Sigma prices shown in MYR, 3 Puma titles split over two lines, 2 stock answers, 2 ratings). On title, price, SKU and brand outside Sigma, Jev agreed with the judge on every value but 4 (3 Puma titles, and the Puma Lafrance SKU, where Jev is right).
- **Where Jev and the judge disagree on judge-wrong values, Jev is usually the one that is right:** Sigma's SKUs are printed at the bottom of the page ("SKU: SBS01", seen in the crop), and Puma's Lafrance "Style: 314471_01" is printed; the judge said "no SKU" (its known limit). Jev agrees with the judge on Lacoste's 11 star-only ratings and 3 barcodes, which really are not printed.
- **Calibration:** above 0.5 Jev is 91–95% in line with the judge; below 0.5 the low bucket (0.0–0.1) is mostly real "not shown", while 0.1–0.5 is mostly correct values Jev could not see (descriptions) — a useful "unsure" band rather than a "wrong" signal.
- **Stability:** no answer flipped across the three set A repeats; probabilities moved by at most 0.05.

