# Judge run — Ikea

> **STOPPED at the $3.00 cap** — the next item would have gone over it.
> 25 of 47 items were judged; the tables cover only those.

- Run: `09250446-55d9-41b9-8812-f3ef8c41c948`
- Site: Ikea (project Campaign 2 2026-10-11)
- When: 2026-10-13T11:40:51.278Z
- Items: 47 items in run, 47 with values, 25 captured, 0 capture failed, judged 25 (limited by cap)
- Fields: Title, Price, Main image, SKU, Brand, In stock, Rating, Description
- Judge cost: $2.9569 (cap $3.00)
- Note: per-call estimate not re-measured since page text was added ($0.0086 a call — behind the cap and the saving below)
- 13 values settled from the page text without a call (saved at least $0.11)
- Time: 11m 9s

Each item's URL was captured fresh (a run stores no screenshot), so a verdict compares the stored value with the page as it is now — a price that changed since the run reads as wrong.

Some values are counted correct from the page's visible text without a judge call: a number with one of the field's words beside it (within 15 characters, nothing but spaces, colons or brackets between) or followed by "/5", "out of 5", "stars" or "★" (a single digit only right beside the field's name); a text value longer than 80 characters, not a product name or brand, whose first 80 characters occur exactly once in the page text. Money values always go to the judge. Every other value goes to the judge with page text beside the screenshot — 4,000 characters around the value when it is found, else the first 8,000; a text value longer than 80 characters is judged on its first 80, and the judge is told so.

The judge sees screenshot tiles from the top of the page (3 tiles ≈ 4608 px, 1536 px each); a value is judged on tile 1 and again on the next tile only while the verdict is "not on page". 'Not on page' after all tiles usually means further down or in a tab, not wrong.

Only each item's first stored row is judged (on a row-per-variant run, the default variant).

## Per field

Correct includes values settled from the page text without a call. Correct % is correct / (correct + wrong); "—" when neither occurred. Not on page, unverifiable and judge errors are counted apart and do not enter it. Empty values are not judged.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 25 | 24 | 0 | 0 | 0 | 1 | 0 | 100% |
| Price | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 100% |
| Main image | 25 | 0 | 0 | 0 | 25 | 0 | 0 | — |
| SKU | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 100% |
| Brand | 25 | 25 | 0 | 0 | 0 | 0 | 0 | 100% |
| In stock | 25 | 15 | 6 | 3 | 1 | 0 | 0 | 71% |
| Rating | 25 | 20 | 0 | 5 | 0 | 0 | 0 | 100% |
| Description | 25 | 22 | 3 | 0 | 0 | 0 | 0 | 88% |

## Shown flag vs. verdict

How well the free "shown on the page" flag (spec 2026-10-12 §3/§6, stored per field on a certified run's extraction) predicts the judge's paid verdict, among cells the judge or the local text pass called correct or wrong; a cell with no stored flag, or whose field type is not checkable, counts as unflagged, not as either side.

| Shown flag vs. verdict | Count |
|---|---:|
| Wrong & not shown | 3 |
| Wrong & shown | 0 |
| Correct & not shown | 46 |
| Correct & shown | 95 |
| Unflagged (no flag or not checkable) | 21 |

The free flag caught 3 of the 3 flagged wrong values; it flagged 46 correct values.

## Per item

C correct · W wrong · N not on page · U unverifiable · E judge error · S variant list, not judged · - not judged (run interrupted) · `·` empty. The digit is the screenshot tile that decided the verdict. Ct is a value found in the page text (a number with its field word beside it, or a long text's first 80 characters), without a judge call or cost; a trailing p means a long text judged on its first 80 characters. A bare U is a URL value (image/url field or an absolute http(s) link), marked unverifiable without a judge call or cost.

| URL | Page title | Title | Price | Main image | SKU | Brand | In stock | Rating | Description |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| https://www.ikea.com/my/en/p/friheten-3-seat-sofa-bed-faringe-brown-orange-80551229/ | FRIHETEN 3-seat sofa-bed, Faringe brown-orange - IKEA Malaysia | C1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://www.ikea.com/my/en/p/mannarp-4-seat-sofa-with-chaise-longue-saxemara-black-blue-s49619203/ | MANNARP 4-seat sofa with chaise longue, Saxemara black-blue - IKEA Malaysia | C1 | C1 | U | C1 | C1 | N3 | Ct | C1p |
| https://www.ikea.com/my/en/p/soederhamn-4-seat-sofa-with-chaise-longue-and-open-end-kelinge-beige-s99621675/ | SÖDERHAMN 4-seat sofa with chaise longue, and open end/Kelinge beige - IKEA Malaysia | C1 | C1 | U | C1 | C1 | C1 | C1 | C1p |
| https://www.ikea.com/my/en/p/kivik-3-seat-sofa-with-chaise-longue-tibbleby-beige-grey-s19440589/ | KIVIK 3-seat sofa with chaise longue, Tibbleby beige/grey - IKEA Malaysia | C1 | C1 | U | C1 | C1 | N3 | Ct | W1p |
| https://www.ikea.com/my/en/p/soederhamn-corner-sofa-6-seat-kelinge-dark-yellow-s99622335/ | SÖDERHAMN corner sofa, 6-seat, Kelinge dark yellow - IKEA Malaysia | C1 | C1 | U | C1 | C1 | W1 | N3 | C1p |
| https://www.ikea.com/my/en/p/kivik-3-seat-sofa-tibbleby-beige-grey-s59440592/ | KIVIK 3-seat sofa, Tibbleby beige/grey - IKEA Malaysia | C1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://www.ikea.com/my/en/p/hyltarp-3-seat-sofa-kilanda-pale-blue-s99489647/ | HYLTARP 3-seat sofa, Kilanda pale blue - IKEA Malaysia | C1 | C1 | U | C1 | C1 | W1 | Ct | C1p |
| https://www.ikea.com/my/en/p/klippan-2-seat-sofa-grimsmala-black-beige-s69625203/ | KLIPPAN 2-seat sofa, Grimsmåla black/beige - IKEA Malaysia | C1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://www.ikea.com/my/en/p/vimle-4-seat-sofa-with-chaise-longue-gunnared-medium-grey-s99399487/ | VIMLE 4-seat sofa with chaise longue, Gunnared medium grey - IKEA Malaysia | C1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://www.ikea.com/my/en/p/lillesaeter-3-seat-sofa-axvall-off-white-20619072/ | LILLESÄTER 3-seat sofa, Axvall off-white - IKEA Malaysia | C1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://www.ikea.com/my/en/p/saltmyran-2-seat-sofa-oereryd-grey-beige-40618528/ | SALTMYRAN 2-seat sofa, Öreryd grey-beige - IKEA Malaysia | C1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://www.ikea.com/my/en/p/soederhamn-1-seat-section-kelinge-dark-yellow-s99621595/ | SÖDERHAMN 1-seat section, Kelinge dark yellow - IKEA Malaysia | C1 | C1 | U | C1 | C1 | W1 | C1 | C1p |
| https://www.ikea.com/my/en/p/mannarp-2-seat-sofa-gunnared-beige-s79619193/ | MANNARP 2-seat sofa, Gunnared beige - IKEA Malaysia | C1 | C1 | U | C1 | C1 | N3 | C1 | C1p |
| https://www.ikea.com/my/en/p/lillesaeter-4-seat-sofa-gunnared-bright-green-yellow-s49614272/ | LILLESÄTER 4-seat sofa, Gunnared bright green-yellow - IKEA Malaysia | C1 | C1 | U | C1 | C1 | C1 | N3 | C1p |
| https://www.ikea.com/my/en/p/kivik-4-seat-sofa-with-chaise-longue-tresund-anthracite-s99494385/ | KIVIK 4-seat sofa with chaise longue, Tresund anthracite - IKEA Malaysia | C1 | C1 | U | C1 | C1 | W1 | Ct | C1p |
| https://www.ikea.com/my/en/p/gullvalla-2-seat-sofa-silkeryd-grey-green-60618508/ | GULLVALLA 2-seat sofa, Silkeryd grey-green - IKEA Malaysia | C1 | C1 | U | C1 | C1 | C1 | C1 | C1p |
| https://www.ikea.com/my/en/p/vimle-3-seat-sofa-knaebaeck-grey-green-s69635117/ | VIMLE 3-seat sofa, Knäbäck grey-green - IKEA Malaysia | C1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://www.ikea.com/my/en/p/vimle-3-seat-sofa-with-chaise-longue-with-wide-armrests-knaebaeck-grey-green-s69635037/ | VIMLE 3-seat sofa with chaise longue, with wide armrests/Knäbäck grey-green - IKEA Malaysia | C1 | C1 | U | C1 | C1 | C1 | C1 | W1p |
| https://www.ikea.com/my/en/p/kivik-2-seat-sofa-tibbleby-beige-grey-s19440594/ | KIVIK 2-seat sofa, Tibbleby beige/grey - IKEA Malaysia | C1 | C1 | U | C1 | C1 | C1 | Ct | C2p |
| https://www.ikea.com/my/en/p/jaettebo-4-seat-mod-sofa-w-chaise-longue-right-samsala-dark-blue-s89617607/ | JÄTTEBO 4-seat mod sofa w chaise longue, right/Samsala dark blue - IKEA Malaysia | C1 | C1 | U | C1 | C1 | C1 | N3 | C1p |
| https://www.ikea.com/my/en/p/hemlingby-2-seat-sofa-knisa-dark-grey-70434368/ | HEMLINGBY 2-seat sofa, Knisa dark grey - IKEA Malaysia | E1 | C1 | U | C1 | C1 | C1 | Ct | C1p |
| https://www.ikea.com/my/en/p/vimle-corner-sofa-5-seat-gunnared-beige-s99399576/ | VIMLE corner sofa, 5-seat, Gunnared beige - IKEA Malaysia | C1 | C1 | U | C1 | C1 | W1 | N3 | W1p |
| https://www.ikea.com/my/en/p/lillehem-3-seat-modular-sofa-w-chaise-longue-vissle-beige-wood-s89570412/ | LILLEHEM 3-seat modular sofa w chaise longue, Vissle/beige wood - IKEA Malaysia | C1 | C1 | U | C1 | C1 | W1 | C1 | C1p |
| https://www.ikea.com/my/en/p/gullvalla-3-seat-sofa-silkeryd-dark-grey-beige-90618502/ | GULLVALLA 3-seat sofa, Silkeryd dark grey-beige - IKEA Malaysia | C1 | C1 | U | C1 | C1 | C1 | C1 | C1p |
| https://www.ikea.com/my/en/p/mannarp-4-seat-sofa-with-chaise-longues-gunnared-beige-s89604087/ | MANNARP 4-seat sofa with chaise longues, Gunnared beige - IKEA Malaysia | C1 | C1 | U | C1 | C1 | U1 | N3 | C1p |

## Wrong values

- **Description** — https://www.ikea.com/my/en/p/kivik-3-seat-sofa-with-chaise-longue-tibbleby-beige-grey-s19440589/ (tile 1) (judged on its first 80 characters)
  - extracted: `KIVIK 3-seat sofa with chaise longue - Tibbleby beige/grey. Enjoy the super comfy KIVIK sofa with deep seat cushions made of pocket springs, high resilience foa…`
  - shown: false
  - judge's reading (uncalibrated): The page shows only a partial description: "...generous size, low ... adapts to the body ... of socialising and," with the rest hidden by the cookie banner.
- **In stock** — https://www.ikea.com/my/en/p/soederhamn-corner-sofa-6-seat-kelinge-dark-yellow-s99622335/ (tile 1)
  - extracted: `true`
  - shown: —
  - judge's reading (uncalibrated): The page shows "Check in-store stock" with a grey indicator, not a confirmed in-stock status.
- **In stock** — https://www.ikea.com/my/en/p/hyltarp-3-seat-sofa-kilanda-pale-blue-s99489647/ (tile 1)
  - extracted: `true`
  - shown: —
  - judge's reading (uncalibrated): The page shows "Check in-store stock" (availability not directly stated as true/false).
- **In stock** — https://www.ikea.com/my/en/p/soederhamn-1-seat-section-kelinge-dark-yellow-s99621595/ (tile 1)
  - extracted: `true`
  - shown: —
  - judge's reading (uncalibrated): The page shows "Check in-store stock" with a status indicator (not a definitive "in stock" value).
- **In stock** — https://www.ikea.com/my/en/p/kivik-4-seat-sofa-with-chaise-longue-tresund-anthracite-s99494385/ (tile 1)
  - extracted: `true`
  - shown: —
  - judge's reading (uncalibrated): The page shows "Check in-store stock" with a gray dot, indicating stock status is unspecified rather than confirmed in stock.
- **Description** — https://www.ikea.com/my/en/p/vimle-3-seat-sofa-with-chaise-longue-with-wide-armrests-knaebaeck-grey-green-s69635037/ (tile 1) (judged on its first 80 characters)
  - extracted: `VIMLE 3-seat sofa with chaise longue - with wide armrests/Knäbäck grey-green. This soft sofa will have a long life since the seat cushions are filled with high …`
  - shown: false
  - judge's reading (uncalibrated): The page shows no such description text; it only displays the product title "VIMLE 3-seat sofa with chaise longue, with wide armrests/Knäbäck grey-green."
- **In stock** — https://www.ikea.com/my/en/p/vimle-corner-sofa-5-seat-gunnared-beige-s99399576/ (tile 1)
  - extracted: `true`
  - shown: —
  - judge's reading (uncalibrated): The page shows "Check in-store stock" with a gray indicator, not a confirmed in-stock status.
- **Description** — https://www.ikea.com/my/en/p/vimle-corner-sofa-5-seat-gunnared-beige-s99399576/ (tile 1) (judged on its first 80 characters)
  - extracted: `VIMLE Corner sofa, 5-seat - Gunnared beige. This soft sofa will have a long life since the seat cushions are filled with high resilience foam that gives good su…`
  - shown: false
  - judge's reading (uncalibrated): The page shows no description text matching that extracted value; only the partially visible marketing text "...be combined as you...your home – and as...a and let it change" is visible.
- **In stock** — https://www.ikea.com/my/en/p/lillehem-3-seat-modular-sofa-w-chaise-longue-vissle-beige-wood-s89570412/ (tile 1)
  - extracted: `true`
  - shown: —
  - judge's reading (uncalibrated): The page shows the in-store stock status as "Check in-store stock," not a true/false value.

## Correct values flagged not shown

- **Title** — https://www.ikea.com/my/en/p/friheten-3-seat-sofa-bed-faringe-brown-orange-80551229/
  - extracted: `FRIHETEN 3-seat sofa-bed - Faringe brown-orange`
- **Description** — https://www.ikea.com/my/en/p/friheten-3-seat-sofa-bed-faringe-brown-orange-80551229/
  - extracted: `FRIHETEN 3-seat sofa-bed - Faringe brown-orange. Readily converts into a bed. Big, practical storage space under the seat. 10 year guarantee. Read about the ter…`
- **Title** — https://www.ikea.com/my/en/p/mannarp-4-seat-sofa-with-chaise-longue-saxemara-black-blue-s49619203/
  - extracted: `MANNARP 4-seat sofa with chaise longue - Saxemara black-blue`
- **Description** — https://www.ikea.com/my/en/p/mannarp-4-seat-sofa-with-chaise-longue-saxemara-black-blue-s49619203/
  - extracted: `MANNARP 4-seat sofa with chaise longue - Saxemara black-blue. This sofa combines soft, cosy comfort with a modern design and neat armrests that evoke a sense of…`
- **Title** — https://www.ikea.com/my/en/p/soederhamn-4-seat-sofa-with-chaise-longue-and-open-end-kelinge-beige-s99621675/
  - extracted: `SÖDERHAMN 4-seat sofa with chaise longue - and open end/Kelinge beige`
- **Description** — https://www.ikea.com/my/en/p/soederhamn-4-seat-sofa-with-chaise-longue-and-open-end-kelinge-beige-s99621675/
  - extracted: `SÖDERHAMN 4-seat sofa with chaise longue - and open end/Kelinge beige. SÖDERHAMN seating series allows you to sit deeply, low and softly with the loose back cus…`
- **Title** — https://www.ikea.com/my/en/p/kivik-3-seat-sofa-with-chaise-longue-tibbleby-beige-grey-s19440589/
  - extracted: `KIVIK 3-seat sofa with chaise longue - Tibbleby beige/grey`
- **Title** — https://www.ikea.com/my/en/p/soederhamn-corner-sofa-6-seat-kelinge-dark-yellow-s99622335/
  - extracted: `SÖDERHAMN Corner sofa, 6-seat - Kelinge dark yellow`
- **Description** — https://www.ikea.com/my/en/p/soederhamn-corner-sofa-6-seat-kelinge-dark-yellow-s99622335/
  - extracted: `SÖDERHAMN Corner sofa, 6-seat - Kelinge dark yellow. SÖDERHAMN seating series allows you to sit deeply, low and softly with the loose back cushions for extra su…`
- **Title** — https://www.ikea.com/my/en/p/kivik-3-seat-sofa-tibbleby-beige-grey-s59440592/
  - extracted: `KIVIK 3-seat sofa - Tibbleby beige/grey`
- **Description** — https://www.ikea.com/my/en/p/kivik-3-seat-sofa-tibbleby-beige-grey-s59440592/
  - extracted: `KIVIK 3-seat sofa - Tibbleby beige/grey. Enjoy the super comfy KIVIK sofa with deep seat cushions made of pocket springs, high resilience foam and polyester fib…`
- **Title** — https://www.ikea.com/my/en/p/hyltarp-3-seat-sofa-kilanda-pale-blue-s99489647/
  - extracted: `HYLTARP 3-seat sofa - Kilanda pale blue`
- **Description** — https://www.ikea.com/my/en/p/hyltarp-3-seat-sofa-kilanda-pale-blue-s99489647/
  - extracted: `HYLTARP 3-seat sofa - Kilanda pale blue. Skillful craftsmanship and a perfect fit means that the sofa will always shows off its best side. The Kilanda fabric wi…`
- **Title** — https://www.ikea.com/my/en/p/klippan-2-seat-sofa-grimsmala-black-beige-s69625203/
  - extracted: `KLIPPAN 2-seat sofa - Grimsmåla black/beige`
- **Description** — https://www.ikea.com/my/en/p/klippan-2-seat-sofa-grimsmala-black-beige-s69625203/
  - extracted: `KLIPPAN 2-seat sofa - Grimsmåla black/beige. Durable metal springs in the seat give the sofa a springy comfort, allowing you to sit, relax and enjoy it for many…`
- **Title** — https://www.ikea.com/my/en/p/vimle-4-seat-sofa-with-chaise-longue-gunnared-medium-grey-s99399487/
  - extracted: `VIMLE 4-seat sofa with chaise longue - Gunnared medium grey`
- **Description** — https://www.ikea.com/my/en/p/vimle-4-seat-sofa-with-chaise-longue-gunnared-medium-grey-s99399487/
  - extracted: `VIMLE 4-seat sofa with chaise longue - Gunnared medium grey. This soft sofa will have a long life since the seat cushions are filled with high resilience foam t…`
- **Title** — https://www.ikea.com/my/en/p/lillesaeter-3-seat-sofa-axvall-off-white-20619072/
  - extracted: `LILLESÄTER 3-seat sofa - Axvall off-white`
- **Description** — https://www.ikea.com/my/en/p/lillesaeter-3-seat-sofa-axvall-off-white-20619072/
  - extracted: `LILLESÄTER 3-seat sofa - Axvall off-white. Suitable for use in public environments. The fabric has a silicone-based, liquid-repellent treatment that stops liqui…`
- **Title** — https://www.ikea.com/my/en/p/saltmyran-2-seat-sofa-oereryd-grey-beige-40618528/
  - extracted: `SALTMYRAN 2-seat sofa - Öreryd grey-beige`
- **Description** — https://www.ikea.com/my/en/p/saltmyran-2-seat-sofa-oereryd-grey-beige-40618528/
  - extracted: `SALTMYRAN 2-seat sofa - Öreryd grey-beige. Elegant, sleek sofa with simple lines and a slim design that goes well in many different settings. The rounded backre…`
- **Title** — https://www.ikea.com/my/en/p/soederhamn-1-seat-section-kelinge-dark-yellow-s99621595/
  - extracted: `SÖDERHAMN 1-seat section - Kelinge dark yellow`
- **Description** — https://www.ikea.com/my/en/p/soederhamn-1-seat-section-kelinge-dark-yellow-s99621595/
  - extracted: `SÖDERHAMN 1-seat section - Kelinge dark yellow. SÖDERHAMN seating series allows you to sit deeply, low and softly with the loose back cushions for extra support…`
- **Title** — https://www.ikea.com/my/en/p/mannarp-2-seat-sofa-gunnared-beige-s79619193/
  - extracted: `MANNARP 2-seat sofa - Gunnared beige`
- **Description** — https://www.ikea.com/my/en/p/mannarp-2-seat-sofa-gunnared-beige-s79619193/
  - extracted: `MANNARP 2-seat sofa - Gunnared beige. This sofa combines soft, cosy comfort with a modern design and neat armrests that evoke a sense of elegant lightness. You …`
- **Title** — https://www.ikea.com/my/en/p/lillesaeter-4-seat-sofa-gunnared-bright-green-yellow-s49614272/
  - extracted: `LILLESÄTER 4-seat sofa - Gunnared bright green-yellow`
- **Description** — https://www.ikea.com/my/en/p/lillesaeter-4-seat-sofa-gunnared-bright-green-yellow-s49614272/
  - extracted: `LILLESÄTER 4-seat sofa - Gunnared bright green-yellow. Suitable for use in public environments. This cover is made of dope-dyed Gunnared fabric in polyester. It…`
- **Title** — https://www.ikea.com/my/en/p/kivik-4-seat-sofa-with-chaise-longue-tresund-anthracite-s99494385/
  - extracted: `KIVIK 4-seat sofa with chaise longue - Tresund anthracite`
- **Description** — https://www.ikea.com/my/en/p/kivik-4-seat-sofa-with-chaise-longue-tresund-anthracite-s99494385/
  - extracted: `KIVIK 4-seat sofa with chaise longue - Tresund anthracite. Enjoy the super comfy KIVIK sofa with deep seat cushions made of pocket springs, high resilience foam…`
- **Title** — https://www.ikea.com/my/en/p/gullvalla-2-seat-sofa-silkeryd-grey-green-60618508/
  - extracted: `GULLVALLA 2-seat sofa - Silkeryd grey-green`
- **Description** — https://www.ikea.com/my/en/p/gullvalla-2-seat-sofa-silkeryd-grey-green-60618508/
  - extracted: `GULLVALLA 2-seat sofa - Silkeryd grey-green. Soft, simple shapes with well-thought-out details, such as wrinkles on the back cushions and rounded legs – creatin…`
- **Title** — https://www.ikea.com/my/en/p/vimle-3-seat-sofa-knaebaeck-grey-green-s69635117/
  - extracted: `VIMLE 3-seat sofa - Knäbäck grey-green`
- **Description** — https://www.ikea.com/my/en/p/vimle-3-seat-sofa-knaebaeck-grey-green-s69635117/
  - extracted: `VIMLE 3-seat sofa - Knäbäck grey-green. This soft sofa will have a long life since the seat cushions are filled with high resilience foam that gives good suppor…`
- **Title** — https://www.ikea.com/my/en/p/vimle-3-seat-sofa-with-chaise-longue-with-wide-armrests-knaebaeck-grey-green-s69635037/
  - extracted: `VIMLE 3-seat sofa with chaise longue - with wide armrests/Knäbäck grey-green`
- **Title** — https://www.ikea.com/my/en/p/kivik-2-seat-sofa-tibbleby-beige-grey-s19440594/
  - extracted: `KIVIK 2-seat sofa - Tibbleby beige/grey`
- **Description** — https://www.ikea.com/my/en/p/kivik-2-seat-sofa-tibbleby-beige-grey-s19440594/
  - extracted: `KIVIK 2-seat sofa - Tibbleby beige/grey. Enjoy the super comfy KIVIK sofa with deep seat cushions made of pocket springs, high resilience foam and polyester fib…`
- **Title** — https://www.ikea.com/my/en/p/jaettebo-4-seat-mod-sofa-w-chaise-longue-right-samsala-dark-blue-s89617607/
  - extracted: `JÄTTEBO 4-seat mod sofa w chaise longue - right/Samsala dark blue`
- **Description** — https://www.ikea.com/my/en/p/jaettebo-4-seat-mod-sofa-w-chaise-longue-right-samsala-dark-blue-s89617607/
  - extracted: `JÄTTEBO 4-seat mod sofa w chaise longue - right/Samsala dark blue. JÄTTEBO modular sofa has a simple shape with clean lines and is soft, comfortable – and pract…`
- **Description** — https://www.ikea.com/my/en/p/hemlingby-2-seat-sofa-knisa-dark-grey-70434368/
  - extracted: `HEMLINGBY 2-seat sofa - Knisa dark grey. A sofa with small, neat dimensions which is easy to furnish with, even when space is limited. 10 year guarantee. Read a…`
- **Title** — https://www.ikea.com/my/en/p/vimle-corner-sofa-5-seat-gunnared-beige-s99399576/
  - extracted: `VIMLE Corner sofa, 5-seat - Gunnared beige`
- **Title** — https://www.ikea.com/my/en/p/lillehem-3-seat-modular-sofa-w-chaise-longue-vissle-beige-wood-s89570412/
  - extracted: `LILLEHEM 3-seat modular sofa w chaise longue - Vissle/beige wood`
- **Description** — https://www.ikea.com/my/en/p/lillehem-3-seat-modular-sofa-w-chaise-longue-vissle-beige-wood-s89570412/
  - extracted: `LILLEHEM 3-seat modular sofa w chaise longue - Vissle/beige wood. Combine the seat modules with armrests. Use the planning tool to put the modules together in d…`
- **Title** — https://www.ikea.com/my/en/p/gullvalla-3-seat-sofa-silkeryd-dark-grey-beige-90618502/
  - extracted: `GULLVALLA 3-seat sofa - Silkeryd dark grey-beige`
- **Description** — https://www.ikea.com/my/en/p/gullvalla-3-seat-sofa-silkeryd-dark-grey-beige-90618502/
  - extracted: `GULLVALLA 3-seat sofa - Silkeryd dark grey-beige. Soft, simple shapes with well-thought-out details, such as wrinkles on the back cushions and rounded legs – cr…`
- **Title** — https://www.ikea.com/my/en/p/mannarp-4-seat-sofa-with-chaise-longues-gunnared-beige-s89604087/
  - extracted: `MANNARP 4-seat sofa with chaise longues - Gunnared beige`
- **Description** — https://www.ikea.com/my/en/p/mannarp-4-seat-sofa-with-chaise-longues-gunnared-beige-s89604087/
  - extracted: `MANNARP 4-seat sofa with chaise longues - Gunnared beige. This sofa combines soft, cosy comfort with a modern design and neat armrests that evoke a sense of ele…`

## Notes

```
claude-sonnet-5: 187 req, 979,822 in / 1,163 out
estimated $2.9569 at list rates
```

- Cost attribution: the usage counter (`@robot/agent` usage.ts) is process-wide. This CLI is a single process doing nothing else, so the figure above is its own.
- This report is the record: judge-run does not write to `runs.cost_usd` or any other table.
