# Judge run — Ulta

- Run: `ea82090e-efcb-43b7-bf0c-92852b95ac76`
- Site: Ulta (project Credit campaign 2026-10)
- When: 2026-10-08T13:13:45.231Z
- Items: 60 items in run, 60 with values, 60 captured, 0 capture failed, judged 60
- Fields: Title, Price, Main image, SKU, Brand, Rating, In stock, Description
- Judge cost: $4.1175 (cap $5.00)
- Time: 40m 28s

Each item's URL was captured fresh (a run stores no screenshot), so a verdict compares the stored value with the page as it is now — a price that changed since the run reads as wrong.

The judge sees screenshot tiles from the top of the page (3 tiles ≈ 4608 px, 1536 px each); a value is judged on tile 1 and again on the next tile only while the verdict is "not on page". 'Not on page' after all tiles usually means further down or in a tab, not wrong.

Only each item's first stored row is judged (on a row-per-variant run, the default variant).

## Per field

Correct % is correct / (correct + wrong); "—" when neither occurred. Not on page, unverifiable and judge errors are counted apart and do not enter it. Empty values are not judged.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 60 | 59 | 0 | 0 | 0 | 1 | 0 | 100% |
| Price | 60 | 60 | 0 | 0 | 0 | 0 | 0 | 100% |
| Main image | 60 | 0 | 0 | 0 | 60 | 0 | 0 | — |
| SKU | 60 | 55 | 1 | 0 | 4 | 0 | 0 | 98% |
| Brand | 60 | 60 | 0 | 0 | 0 | 0 | 0 | 100% |
| Rating | 60 | 60 | 0 | 0 | 0 | 0 | 0 | 100% |
| In stock | 60 | 60 | 0 | 0 | 0 | 0 | 0 | 100% |
| Description | 60 | 58 | 2 | 0 | 0 | 0 | 0 | 97% |

## Per item

C correct · W wrong · N not on page · U unverifiable · E judge error · S variant list, not judged · - not judged (run interrupted) · `·` empty. The digit is the screenshot tile that decided the verdict. A bare U is a URL value (image/url field or an absolute http(s) link), marked unverifiable without a judge call or cost.

| URL | Page title | Title | Price | Main image | SKU | Brand | Rating | In stock | Description |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| https://www.ulta.com/p/hydrating-milky-moisturizer-pimprod2054921?sku=2645477 | BYOMA - Hydrating Milky Moisturizer \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/cc-nude-glow-lightweight-foundation-glow-serum-with-spf-40-pimprod2031824?sku=2594106 | IT Cosmetics - Light Medium CC+ Nude Glow Lightweight Foundation + Glow Serum with SPF 40 \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/vita-a-retinal-01-shot-booster-treatment-pimprod2056283?sku=2650371 | celimax - The Vita-A Retinal 0.1% Shot Booster Treatment \| Ulta Beauty | C1 | C1 | U | W2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/lightweight-daily-moisturizer-pimprod2023937?sku=2582316 | Good Molecules - 3.3 oz Lightweight Daily Moisturizer \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/cicaplast-balm-b5-soothing-therapeutic-multi-purpose-cream-pimprod2018263?sku=2570171 | La Roche-Posay - 1.3 oz Cicaplast Balm B5 Soothing Therapeutic Multi Purpose Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/hypochlorous-acid-spray-pimprod2046015?sku=2628365 | Magic Molecule - 8.0 oz Hypochlorous Acid Spray \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/moisture-surge-broad-spectrum-spf-28-sheer-hydrator-moisturizer-pimprod2038272?sku=2604860 | Clinique - 1.7 oz Moisture Surge Broad Spectrum SPF 28 Sheer Hydrator Moisturizer \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C2 |
| https://www.ulta.com/p/24-7-moisture-hydrating-day-night-cream-xlsImpprod18731039?sku=2577530 | TULA - 3.4 oz 24-7 Moisture Hydrating Day & Night Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/complexion-rescue-tinted-moisturizer-with-hyaluronic-acid-mineral-spf-30-pimprod2049741?sku=2633110 | bareMinerals - Opal 01 COMPLEXION RESCUE Tinted Moisturizer with Hyaluronic Acid and Mineral SPF 30 \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C2 |
| https://www.ulta.com/p/lipikar-apm-triple-repair-body-moisturizing-cream-dry-skin-xlsImpprod17102349?sku=2521449 | La Roche-Posay - 13.5 oz Lipikar AP+M Triple Repair Body Moisturizing Cream for Dry Skin \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C2 |
| https://www.ulta.com/p/moisturizing-gel-cream-pimprod2034790?sku=2601332 | BYOMA - 1.6 oz Moisturizing Gel Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/hueguard-skin-tint-spf-50-mineral-sunscreen-broad-spectrum-pimprod2043870?sku=2621475 | Live Tinted - 5 Hueguard Skin Tint SPF 50 Mineral Sunscreen Broad Spectrum \| Ulta Beauty | C1 | C1 | U | U1 | C1 | C1 | C1 | C2 |
| https://www.ulta.com/p/pro-collagen-night-cream-pimprod2034312?sku=2599129 | ELEMIS - 1.0 oz Pro-Collagen Night Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/moisture-surge-sheertint-hydrator-broad-spectrum-spf-25-tinted-moisturizer-pimprod2013655?sku=2562149 | Clinique - Light Medium Moisture Surge Sheertint Hydrator Broad Spectrum SPF 25 Tinted Moisturizer \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C2 |
| https://www.ulta.com/p/renergie-lift-multi-action-lifting-firming-cream-all-skin-types-xlsImpprod4700067?sku=2249740 | Lancôme - 2.6 oz Rénergie Lift Multi-Action Lifting And Firming Cream - All Skin Types \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/dream-skin-in-one-sleep-skincare-gift-set-pimprod2059866?sku=2658132 | Estée Lauder - Dream Skin In One Sleep Skincare Gift Set \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/honey-halo-ultra-hydrating-ceramide-moisturizer-pimprod2049448?sku=2635153 | FARMACY - 1.7 oz Honey Halo Ultra-Hydrating Ceramide Moisturizer \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C2 |
| https://www.ulta.com/p/renergie-collagen-lift-xtend-face-cream-firming-lifting-pimprod2057661?sku=2652990 | Lancôme - Rénergie Collagen+ Lift-Xtend Face Cream for Firming & Lifting \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/confidence-in-a-cream-anti-aging-hydrating-moisturizer-pimprod2033684?sku=2598796 | IT Cosmetics - 2.0 oz Confidence in a Cream Anti-Aging Hydrating Moisturizer \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/ultra-facial-cream-with-squalane-pimprod2002804?sku=2540234 | Kiehl's Since 1851 - 0.95 oz Ultra Facial Cream with Squalane \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/dewy-milk-moisturizer-pimprod2051809?sku=2640456 | TATCHA - 1.7 oz The Dewy Milk Moisturizer \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/stabilizing-repair-cream-pimprod2039798?sku=2612125 | Dermalogica - 1.7 oz Stabilizing Repair Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/toleriane-double-repair-face-moisturizer-with-niacinamide-xlsImpprod16011007?sku=2509730 | La Roche-Posay - 3.38 oz Toleriane Double Repair Face Moisturizer with Niacinamide \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | W1 |
| https://www.ulta.com/p/pout-preserve-hydrating-peptide-lip-treatment-pimprod2042281?sku=2660968 | OLEHENRIKSEN - Pomegranate Fizz Glimmer Pout Preserve Hydrating Peptide Lip Treatment \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/dramatically-differentmoisturizing-gel-face-xlsImpprod10791745?sku=2153924 | Clinique - 4.2 oz Dramatically Different Moisturizing Gel For Face \| Ulta Beauty | C1 | C1 | U | U1 | C1 | C1 | C1 | C2 |
| https://www.ulta.com/p/advanced-rebound-bioglow-zombie-cream-pimprod2059736?sku=2659444 | PEACH & LILY - Advanced Rebound Bioglow Zombie Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C2 |
| https://www.ulta.com/p/royal-tulip-moisturizing-nectar-pimprod2057147?sku=2651719 | Bloomeffects - 1.7 oz Royal Tulip Moisturizing Nectar \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/147-barrier-cream-pimprod2058844?sku=2659149 | Dr. Althea - 147 Barrier Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/smart-clinical-repair-wrinkle-correcting-face-cream-pimprod2033123?sku=2598026 | Clinique - 1.7 oz Smart Clinical Repair Wrinkle Correcting Face Cream \| Ulta Beauty | C1 | C1 | U | C3 | C1 | C1 | C1 | C2 |
| https://www.ulta.com/p/triple-lipid-peptide-cream-pimprod2060094?sku=2659630 | Skinfix - 1.7 oz Triple Lipid-Peptide Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/moisture-surge-intense-72h-lipid-replenishing-hydrator-moisturizer-pimprod2018283?sku=2568219 | Clinique - 1.7 oz Moisture Surge Intense 72H Lipid-Replenishing Hydrator Moisturizer \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/vitamin-enriched-face-base-moisturizer-primer-with-vitamin-c-hyaluronic-acid-pimprod2060115?sku=2658591 | BOBBI BROWN - 0.5 oz Vitamin Enriched Face Base+ Moisturizer & Primer with Vitamin C + Hyaluronic Acid \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/do-it-all-hydrating-sheer-tinted-moisturizer-balm-pimprod2056858?sku=2650275 | IT Cosmetics - 110 Do It All Hydrating Sheer Tinted Moisturizer Balm \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | W2 |
| https://www.ulta.com/p/indigo-overnight-repair-redness-reducing-barrier-cream-pimprod2049119?sku=2634116 | TATCHA - 1.7 oz Indigo Overnight Repair Redness Reducing Barrier Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/ultra-facial-meltdown-recovery-cream-medicated-pimprod2055934?sku=2649929 | Kiehl's Since 1851 - 1.6 oz Ultra Facial Meltdown Recovery Cream Medicated \| Ulta Beauty | C1 | C1 | U | U1 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/dramatically-different-moisturizing-lotion-face-xlsImpprod10791743?sku=2261902 | Clinique - 4.2 oz Dramatically Different Moisturizing Lotion+ For Face \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C2 |
| https://www.ulta.com/p/get-ready-routine-skincare-set-pimprod2057748?sku=2652533 | Estée Lauder - Get Ready Routine Skincare Set \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/ceo-glow-vitamin-c-turmeric-face-oil-pimprod2007862?sku=2550172 | SUNDAY RILEY - 0.5 oz C.E.O. Glow Vitamin C and Turmeric Face Oil \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/345-relief-cream-pimprod2056740?sku=2651804 | Dr. Althea - 345 Relief Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/black-tea-advanced-age-renewal-cream-pimprod2036988?sku=2603047 | fresh - 1.6 oz Black Tea Advanced Age Renewal Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/long-wear-tinted-moisturizer-natural-dewy-skin-tint-spf-30-with-hyaluronic-acid-pimprod2049491?sku=2633114 | Laura Mercier - 0N Silk Long-Wear Tinted Moisturizer Natural Dewy Skin Tint SPF 30 with Hyaluronic Acid \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C2 |
| https://www.ulta.com/p/345-relief-cream-mist-pimprod2055842?sku=2649892 | Dr. Althea - 345 Relief Cream Mist \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/moisture-surge-100h-auto-replenishing-hydrator-gel-moisturizer-with-hyaluronic-acid-pimprod2021615?sku=2576544 | Clinique - 1.0 oz Moisture Surge 100H Auto-Replenishing Hydrator Gel Moisturizer with Hyaluronic Acid \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C2 |
| https://www.ulta.com/p/water-cream-oil-free-pore-minimizing-moisturizer-pimprod2049088?sku=2634101 | TATCHA - 1.7 oz The Water Cream Oil-Free Pore Minimizing Moisturizer \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/ultra-repair-cream-intense-hydration-moisturizer-xlsImpprod13491031?sku=2648273 | First Aid Beauty - 4.0 oz Ultra Repair Cream Intense Hydration Moisturizer \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/do-it-all-lip-transformer-hydrating-lip-balm-lip-liner-pimprod2059164?sku=2655594 | IT Cosmetics - BERRY BRAVE Do It All Lip Transformer Hydrating Lip Balm + Lip Liner \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/protini-polypeptide-firming-moisturizer-pimprod2028061?sku=2588434 | Drunk Elephant - 1.6 oz Protini Polypeptide Firming Moisturizer \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/magic-cream-anti-aging-moisturizer-with-hyaluronic-acid-pimprod2057537?sku=2652683 | Charlotte Tilbury - 1.7 oz Magic Cream Anti-Aging Moisturizer with Hyaluronic Acid \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/korean-skin-care-ultra-glow-turmeric-face-cream-mkt77000102?sku=77000175 | Seoul Ceuticals - Korean Skin Care Ultra Glow Turmeric Face Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/halo-glow-liquid-filter-pimprod2036949?sku=2604924 | e.l.f. Cosmetics - 3 Light/Medium Halo Glow Liquid Filter \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/moisture-whipped-ceramide-cream-pimprod2034179?sku=2597743 | Kopari Beauty - Moisture Whipped Ceramide Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C2 |
| https://www.ulta.com/p/renergie-multi-action-lift-firm-anti-aging-night-cream-moisturizer-xlsImpprod4700071?sku=2249741 | Lancôme - 2.6 oz Rénergie Multi-Action Lift And Firm Anti-Aging Night Cream Moisturizer \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/daily-facial-moisturizer-with-hyaluronic-acid-ceramides-pimprod2042403?sku=2619671 | VANICREAM - Daily Facial Moisturizer with Hyaluronic Acid and Ceramides \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/mini-daywear-advanced-multi-protection-anti-oxidant-24h-moisturizer-creme-spf-15-xlsImpprod14941003?sku=2310497 | Estée Lauder - Mini DayWear Advanced Multi-Protection Anti-Oxidant 24H Moisturizer Crème SPF 15 \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/cicalfate-restorative-protective-cream-pimprod2020798?sku=2577161 | Avène - 1.3 oz Cicalfate+ Restorative Protective Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/renergie-hpn-300-peptide-cream-pimprod2040492?sku=2612984 | Lancôme - 1.7 oz Rénergie H.P.N. 300-Peptide Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/dewy-skin-cream-line-plumping-moisturizer-pimprod2049087?sku=2634098 | TATCHA - 1.7 oz The Dewy Skin Cream Line-Plumping Moisturizer \| Ulta Beauty | E1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/glow-reviver-melting-lip-balm-pimprod2051370?sku=2637280 | e.l.f. Cosmetics - Blackberry Sorbet Glow Reviver Melting Lip Balm \| Ulta Beauty | C1 | C1 | U | U1 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/5-step-glass-skin-routine-set-pimprod2057060?sku=2651356 | ANUA - 5-Step Glass Skin Routine Set \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |
| https://www.ulta.com/p/pdrn-hyaluronic-acid-100-moisturizing-cream-pimprod2053248?sku=2646983 | ANUA - PDRN Hyaluronic Acid 100 Moisturizing Cream \| Ulta Beauty | C1 | C1 | U | C2 | C1 | C1 | C1 | C1 |

## Wrong values

- **SKU** — https://www.ulta.com/p/vita-a-retinal-01-shot-booster-treatment-pimprod2056283?sku=2650371 (tile 2)
  - extracted: `2650371`
  - judge's reading (uncalibrated): The page shows the item number as "26503" (partially obscured, likely truncated).
- **Description** — https://www.ulta.com/p/toleriane-double-repair-face-moisturizer-with-niacinamide-xlsImpprod16011007?sku=2509730 (tile 1)
  - extracted: `La Roche-Posay Toleriane Double Repair Face Moisturizer for sensitive skin with niacinamide provides 48-hour hydration and prebiotic benefits for the skin barri…`
  - judge's reading (uncalibrated): The page shows no description text, only the product title "Toleriane Double Repair Face Moisturizer with Niacinamide" with no accompanying description.
- **Description** — https://www.ulta.com/p/do-it-all-hydrating-sheer-tinted-moisturizer-balm-pimprod2056858?sku=2650275 (tile 2)
  - extracted: `IT Cosmetics Do It All Sheer Tint Face Balm is your ultimate 4-in-1 tinted moisturizer that transforms skin instantly and over time. This next-generation serum …`
  - judge's reading (uncalibrated): The page only shows "This next-generation serum combines sheer, buildable coverage with 92% skincare ingredients for a radiant look that firms, hydrates, and minimizes the look of lines." with no preceding product name sentence.

## Notes

```
claude-sonnet-5: 493 req, 1,360,807 in / 2,339 out
estimated $4.1175 at list rates
```

- Cost attribution: the usage counter (`@robot/agent` usage.ts) is process-wide. This CLI is a single process doing nothing else, so the figure above is its own.
- This report is the record: judge-run does not write to `runs.cost_usd` or any other table.
