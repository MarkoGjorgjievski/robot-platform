# Judge run — Ikea

- Run: `01af1eb0-bdee-4a99-b07c-af8e750493cd`
- Site: Ikea (project Acne)
- When: 2026-10-08T11:41:26.264Z
- Items: 40 items in run, 40 with values, 40 captured, 0 capture failed, judged 40
- Fields: Price, Price currency, Title, Subtitle, Product id, Product details, Total reviews, Average rating
- Judge cost: $3.8844 (cap $4.00)
- Time: 22m 34s

Each item's URL was captured fresh (a run stores no screenshot), so a verdict compares the stored value with the page as it is now — a price that changed since the run reads as wrong.

The judge sees screenshot tiles from the top of the page (3 tiles ≈ 4608 px, 1536 px each); a value is judged on tile 1 and again on the next tile only while the verdict is "not on page". 'Not on page' after all tiles usually means further down or in a tab, not wrong.

Only each item's first stored row is judged (on a row-per-variant run, the default variant).

## Per field

Correct % is correct / (correct + wrong); "—" when neither occurred. Not on page, unverifiable and judge errors are counted apart and do not enter it. Empty values are not judged.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Price | 40 | 38 | 0 | 0 | 0 | 2 | 0 | 100% |
| Price currency | 40 | 40 | 0 | 0 | 0 | 0 | 0 | 100% |
| Title | 40 | 39 | 1 | 0 | 0 | 0 | 0 | 98% |
| Subtitle | 40 | 40 | 0 | 0 | 0 | 0 | 0 | 100% |
| Product id | 40 | 9 | 3 | 21 | 7 | 0 | 0 | 75% |
| Product details | 40 | 11 | 6 | 15 | 8 | 0 | 0 | 65% |
| Total reviews | 40 | 32 | 0 | 8 | 0 | 0 | 0 | 100% |
| Average rating | 40 | 16 | 15 | 8 | 1 | 0 | 0 | 52% |

## Per item

C correct · W wrong · N not on page · U unverifiable · E judge error · S variant list, not judged · - not judged (run interrupted) · `·` empty. The digit is the screenshot tile that decided the verdict. A bare U is a URL value (image/url field or an absolute http(s) link), marked unverifiable without a judge call or cost.

| URL | Page title | Price | Price currency | Title | Subtitle | Product id | Product details | Total reviews | Average rating |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| https://www.ikea.com/my/en/p/mannarp-3-seat-sofa-saxemara-black-blue-s89619197/ | MANNARP 3-seat sofa, Saxemara black-blue - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | C1 | C1 | C1 |
| https://www.ikea.com/my/en/p/kivik-2-seat-sofa-tibbleby-beige-grey-s19440594/ | KIVIK 2-seat sofa, Tibbleby beige/grey - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | U2 | C1 | W1 |
| https://www.ikea.com/my/en/p/landskrona-three-seat-sofa-grann-bomstad-black-metal-s79031701/ | LANDSKRONA three-seat sofa, Grann/Bomstad black/metal - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | W2 | C1 | C1 |
| https://www.ikea.com/my/en/p/lillesaeter-3-seat-sofa-axvall-off-white-20619072/ | LILLESÄTER 3-seat sofa, Axvall off-white - IKEA Malaysia | C1 | C1 | C1 | C1 | C2 | N3 | C1 | C1 |
| https://www.ikea.com/my/en/p/klippan-2-seat-sofa-grimsmala-black-beige-s69625203/ | KLIPPAN 2-seat sofa, Grimsmåla black/beige - IKEA Malaysia | C1 | C1 | C1 | C1 | U1 | N3 | C1 | C1 |
| https://www.ikea.com/my/en/p/kivik-3-seat-sofa-with-chaise-longue-tibbleby-beige-grey-s19440589/ | KIVIK 3-seat sofa with chaise longue, Tibbleby beige/grey - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | N3 | C1 | U1 |
| https://www.ikea.com/my/en/p/stockholm-2025-3-seat-sofa-sundhamn-beige-50586094/ | STOCKHOLM 2025 3-seat sofa, Sundhamn beige - IKEA Malaysia | C1 | C1 | C1 | C1 | C2 | U1 | C1 | C1 |
| https://www.ikea.com/my/en/p/soederhamn-3-seat-sofa-fridtuna-light-beige-s69449691/ | SÖDERHAMN 3-seat sofa, Fridtuna light beige - IKEA Malaysia | C1 | C1 | C1 | C1 | U1 | U1 | C1 | C1 |
| https://www.ikea.com/my/en/p/vimle-3-seat-sofa-with-wide-armrests-johanneshov-brown-beige-s89635183/ | VIMLE 3-seat sofa, with wide armrests/Johanneshov brown-beige - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | N3 | N3 | N3 |
| https://www.ikea.com/my/en/p/kivik-4-seat-sofa-with-chaise-longue-tresund-anthracite-s99494385/ | KIVIK 4-seat sofa with chaise longue, Tresund anthracite - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | N3 | C1 | W1 |
| https://www.ikea.com/my/en/p/glostad-2-seat-sofa-knisa-dark-grey-10489009/ | GLOSTAD 2-seat sofa, Knisa dark grey - IKEA Malaysia | C1 | C1 | C1 | C1 | C2 | W1 | C1 | W1 |
| https://www.ikea.com/my/en/p/glostad-3-seat-sofa-knisa-dark-grey-40595937/ | GLOSTAD 3-seat sofa, Knisa dark grey - IKEA Malaysia | C1 | C1 | C1 | C1 | C2 | N3 | C1 | C2 |
| https://www.ikea.com/my/en/p/lillehem-3-seat-modular-sofa-w-chaise-longue-vissle-beige-wood-s89570412/ | LILLEHEM 3-seat modular sofa w chaise longue, Vissle/beige wood - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | N3 | C1 | C1 |
| https://www.ikea.com/my/en/p/jaettebo-4-seat-mod-sofa-w-chaise-longue-right-samsala-dark-blue-s89617607/ | JÄTTEBO 4-seat mod sofa w chaise longue, right/Samsala dark blue - IKEA Malaysia | C1 | C1 | W1 | C1 | N3 | C1 | N3 | N3 |
| https://www.ikea.com/my/en/p/gullvalla-2-seat-sofa-silkeryd-grey-green-60618508/ | GULLVALLA 2-seat sofa, Silkeryd grey-green - IKEA Malaysia | C1 | C1 | C1 | C1 | C2 | C1 | C1 | C1 |
| https://www.ikea.com/my/en/p/mannarp-3-seat-sofa-with-chaise-longue-gunnared-beige-s49619199/ | MANNARP 3-seat sofa with chaise longue, Gunnared beige - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | C1 | C1 | C1 |
| https://www.ikea.com/my/en/p/saltsjoebaden-3-seat-sofa-fridtuna-light-beige-s09599933/ | SALTSJÖBADEN 3-seat sofa, Fridtuna light beige - IKEA Malaysia | C1 | C1 | C1 | C1 | U1 | C1 | N3 | N3 |
| https://www.ikea.com/my/en/p/soederhamn-1-seat-section-kelinge-dark-yellow-s99621595/ | SÖDERHAMN 1-seat section, Kelinge dark yellow - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | U1 | C1 | W1 |
| https://www.ikea.com/my/en/p/hyltarp-3-seat-sofa-kilanda-pale-blue-s99489647/ | HYLTARP 3-seat sofa, Kilanda pale blue - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | C1 | C1 | W1 |
| https://www.ikea.com/my/en/p/soederhamn-4-seat-sofa-with-chaise-longue-and-open-end-kelinge-beige-s99621675/ | SÖDERHAMN 4-seat sofa with chaise longue, and open end/Kelinge beige - IKEA Malaysia | C1 | C1 | C1 | C1 | W2 | N3 | C1 | C1 |
| https://www.ikea.com/my/en/p/friheten-3-seat-sofa-bed-faringe-brown-orange-80551229/ | FRIHETEN 3-seat sofa-bed, Faringe brown-orange - IKEA Malaysia | E1 | C1 | C1 | C1 | C2 | C1 | C1 | W1 |
| https://www.ikea.com/my/en/p/glostad-2-seat-sofa-with-chaise-longue-knisa-dark-grey-s09618804/ | GLOSTAD 2-seat sofa with chaise longue, Knisa dark grey - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | U1 | C1 | W1 |
| https://www.ikea.com/my/en/p/mannarp-2-seat-sofa-gunnared-beige-s79619193/ | MANNARP 2-seat sofa, Gunnared beige - IKEA Malaysia | C1 | C1 | C1 | C1 | U3 | C1 | C1 | C1 |
| https://www.ikea.com/my/en/p/gullvalla-3-seat-sofa-silkeryd-dark-grey-beige-90618502/ | GULLVALLA 3-seat sofa, Silkeryd dark grey-beige - IKEA Malaysia | C1 | C1 | C1 | C1 | C2 | W1 | C1 | C1 |
| https://www.ikea.com/my/en/p/rocksjoen-2-seat-sofa-kilanda-light-beige-s39508861/ | ROCKSJÖN 2-seat sofa, Kilanda light beige - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | N3 | C1 | W1 |
| https://www.ikea.com/my/en/p/vimle-corner-sofa-5-seat-gunnared-beige-s99399576/ | VIMLE corner sofa, 5-seat, Gunnared beige - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | N3 | N3 | N3 |
| https://www.ikea.com/my/en/p/lillesaeter-4-seat-sofa-gunnared-bright-green-yellow-s49614272/ | LILLESÄTER 4-seat sofa, Gunnared bright green-yellow - IKEA Malaysia | C1 | C1 | C1 | C1 | W2 | W1 | N3 | N3 |
| https://www.ikea.com/my/en/p/vimle-3-seat-sofa-knaebaeck-grey-green-s69635117/ | VIMLE 3-seat sofa, Knäbäck grey-green - IKEA Malaysia | E1 | C1 | C1 | C1 | N3 | U1 | C1 | W1 |
| https://www.ikea.com/my/en/p/ektorp-3-seat-sofa-mangbyn-brown-multicolour-s99619757/ | EKTORP 3-seat sofa, Mångbyn brown/multicolour - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | N3 | C1 | W1 |
| https://www.ikea.com/my/en/p/ektorp-3-seat-sofa-with-chaise-longue-mangbyn-brown-multicolour-s79628729/ | EKTORP 3-seat sofa with chaise longue, Mångbyn brown/multicolour - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | N3 | N3 | N3 |
| https://www.ikea.com/my/en/p/hyltarp-3-seat-sofa-w-chaise-longue-left-gransel-natural-s59489687/ | HYLTARP 3-seat sofa w chaise longue, left, Gransel natural - IKEA Malaysia | C1 | C1 | C1 | C1 | W2 | W1 | C1 | W1 |
| https://www.ikea.com/my/en/p/hyltarp-2-seat-sofa-gransel-natural-s59489611/ | HYLTARP 2-seat sofa, Gransel natural - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | W1 | C1 | C2 |
| https://www.ikea.com/my/en/p/glostad-3-seat-sofa-with-chaise-longue-knisa-dark-grey-s49578599/ | GLOSTAD 3-seat sofa with chaise longue, Knisa dark grey - IKEA Malaysia | C1 | C1 | C1 | C1 | U1 | N3 | C1 | C1 |
| https://www.ikea.com/my/en/p/saltmyran-2-seat-sofa-oereryd-grey-beige-40618528/ | SALTMYRAN 2-seat sofa, Öreryd grey-beige - IKEA Malaysia | C1 | C1 | C1 | C1 | C2 | U1 | C1 | W1 |
| https://www.ikea.com/my/en/p/lillehem-4-seat-modular-sofa-gunnared-brown-red-metal-s99536026/ | LILLEHEM 4-seat modular sofa, Gunnared/brown-red metal - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | N3 | N3 | N3 |
| https://www.ikea.com/my/en/p/soederhamn-3-seat-section-viarp-beige-brown-s69305616/ | SÖDERHAMN 3-seat section, Viarp beige/brown - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | U1 | C1 | W1 |
| https://www.ikea.com/my/en/p/kivik-3-seat-sofa-tibbleby-beige-grey-s59440592/ | KIVIK 3-seat sofa, Tibbleby beige/grey - IKEA Malaysia | C1 | C1 | C1 | C1 | N3 | N3 | C1 | W1 |
| https://www.ikea.com/my/en/p/mannarp-4-seat-sofa-with-chaise-longues-gunnared-beige-s89604087/ | MANNARP 4-seat sofa with chaise longues, Gunnared beige - IKEA Malaysia | C1 | C1 | C1 | C1 | U1 | C1 | N3 | N3 |
| https://www.ikea.com/my/en/p/hemlingby-2-seat-sofa-knisa-dark-grey-70434368/ | HEMLINGBY 2-seat sofa, Knisa dark grey - IKEA Malaysia | C1 | C1 | C1 | C1 | U1 | C1 | C1 | C1 |
| https://www.ikea.com/my/en/p/saltmyran-3-seat-sofa-oereryd-grey-beige-90618516/ | SALTMYRAN 3-seat sofa, Öreryd grey-beige - IKEA Malaysia | C1 | C1 | C1 | C1 | C2 | C1 | C1 | W1 |

## Wrong values

- **Average rating** — https://www.ikea.com/my/en/p/kivik-2-seat-sofa-tibbleby-beige-grey-s19440594/ (tile 1)
  - extracted: `4.8`
  - judge's reading (uncalibrated): The page shows a 5-star rating icon with (43) reviews, but no numeric average rating value is displayed.
- **Product details** — https://www.ikea.com/my/en/p/landskrona-three-seat-sofa-grann-bomstad-black-metal-s79031701/ (tile 2)
  - extracted: `Contact areas with soft, dyed-through 1.2 mm thick grain leather that is supple and smooth to the touch.`
  - judge's reading (uncalibrated): The page shows "Through dyed grain leather from cattle, with a treated, embossed and pigmented surface" as the product details text visible.
- **Average rating** — https://www.ikea.com/my/en/p/kivik-4-seat-sofa-with-chaise-longue-tresund-anthracite-s99494385/ (tile 1)
  - extracted: `4.2`
  - judge's reading (uncalibrated): The page shows a rating of 6 reviews with a star rating displayed, but no explicit numeric average rating value is shown—only "(6)" indicating the review count.
- **Product details** — https://www.ikea.com/my/en/p/glostad-2-seat-sofa-knisa-dark-grey-10489009/ (tile 1)
  - extracted: `GLOSTAD sofa has a simple design which is also comfortable with its thick seat, padded armrests and soft back cushions that sit firmly in place.`
  - judge's reading (uncalibrated): The page shows no visible content for the "Product details" tab in the screenshot.
- **Average rating** — https://www.ikea.com/my/en/p/glostad-2-seat-sofa-knisa-dark-grey-10489009/ (tile 1)
  - extracted: `4.8`
  - judge's reading (uncalibrated): The page shows a rating based on 150 reviews, with no explicit average rating number displayed.
- **Title** — https://www.ikea.com/my/en/p/jaettebo-4-seat-mod-sofa-w-chaise-longue-right-samsala-dark-blue-s89617607/ (tile 1)
  - extracted: `JÄTTEBO`
  - judge's reading (uncalibrated): The page shows "4-seat mod sofa w chaise longue, right/Samsala dark blue" as the title, with "JÄTTEBO" as a separate series label above it.
- **Average rating** — https://www.ikea.com/my/en/p/soederhamn-1-seat-section-kelinge-dark-yellow-s99621595/ (tile 1)
  - extracted: `5`
  - judge's reading (uncalibrated): The page shows an average rating indicated by 5 filled stars with "(2)" reviews next to it.
- **Average rating** — https://www.ikea.com/my/en/p/hyltarp-3-seat-sofa-kilanda-pale-blue-s99489647/ (tile 1)
  - extracted: `4.9`
  - judge's reading (uncalibrated): The page shows a rating with 14 reviews, but no numeric average rating value is displayed—only star icons and the review count (14).
- **Product id** — https://www.ikea.com/my/en/p/soederhamn-4-seat-sofa-with-chaise-longue-and-open-end-kelinge-beige-s99621675/ (tile 2)
  - extracted: `996.216.75`
  - judge's reading (uncalibrated): No product id is shown on this part of the page; only assembly instruction article numbers (e.g., 202.239.19, 602.238.99, 702.238.94, 906.294.64, 906.295.53) are visible.
- **Average rating** — https://www.ikea.com/my/en/p/friheten-3-seat-sofa-bed-faringe-brown-orange-80551229/ (tile 1)
  - extracted: `4.7`
  - judge's reading (uncalibrated): The page shows a star rating icon with (107) reviews, but no numeric average rating value is displayed.
- **Average rating** — https://www.ikea.com/my/en/p/glostad-2-seat-sofa-with-chaise-longue-knisa-dark-grey-s09618804/ (tile 1)
  - extracted: `5`
  - judge's reading (uncalibrated): The page shows a rating of 5 stars based on 5 reviews.
- **Product details** — https://www.ikea.com/my/en/p/gullvalla-3-seat-sofa-silkeryd-dark-grey-beige-90618502/ (tile 1)
  - extracted: `Soft, simple shapes with well-thought-out details, such as wrinkles on the back cushions and rounded legs – creating a timeless sofa that feels both inviting an…`
  - judge's reading (uncalibrated): The page does not show any text under "Product details" in the visible screenshot—that tab is not currently selected, so no value is displayed.
- **Average rating** — https://www.ikea.com/my/en/p/rocksjoen-2-seat-sofa-kilanda-light-beige-s39508861/ (tile 1)
  - extracted: `5`
  - judge's reading (uncalibrated): The page shows a rating of 5 stars based on (5) reviews, but the actual review count shown is "(5)" next to the star icons—no separate average rating value is displayed.
- **Product id** — https://www.ikea.com/my/en/p/lillesaeter-4-seat-sofa-gunnared-bright-green-yellow-s49614272/ (tile 2)
  - extracted: `496.142.72`
  - judge's reading (uncalibrated): The page shows product IDs "406.210.50" and "606.184.95", not "496.142.72".
- **Product details** — https://www.ikea.com/my/en/p/lillesaeter-4-seat-sofa-gunnared-bright-green-yellow-s49614272/ (tile 1)
  - extracted: `Suitable for use in public environments.`
  - judge's reading (uncalibrated): The page does not display this value; it shows no "suitable for use in public environments" text, only partial fabric/foam material details.
- **Average rating** — https://www.ikea.com/my/en/p/vimle-3-seat-sofa-knaebaeck-grey-green-s69635117/ (tile 1)
  - extracted: `4.6`
  - judge's reading (uncalibrated): The page shows a rating with 7 reviews, but no numeric average rating value is displayed.
- **Average rating** — https://www.ikea.com/my/en/p/ektorp-3-seat-sofa-mangbyn-brown-multicolour-s99619757/ (tile 1)
  - extracted: `4.6`
  - judge's reading (uncalibrated): The page shows a rating based on 34 reviews, with no explicit average rating number displayed.
- **Product id** — https://www.ikea.com/my/en/p/hyltarp-3-seat-sofa-w-chaise-longue-left-gransel-natural-s59489687/ (tile 2)
  - extracted: `594.896.87`
  - judge's reading (uncalibrated): The page shows the product/article number as 905.407.87, not 594.896.87.
- **Product details** — https://www.ikea.com/my/en/p/hyltarp-3-seat-sofa-w-chaise-longue-left-gransel-natural-s59489687/ (tile 1)
  - extracted: `Skillful craftsmanship and a perfect fit means that the sofa will always shows off its best side.`
  - judge's reading (uncalibrated): The page shows no value for a "Product details" field; the visible text reads "...eryone wants to ...has a clean look that ...rage space in the".
- **Average rating** — https://www.ikea.com/my/en/p/hyltarp-3-seat-sofa-w-chaise-longue-left-gransel-natural-s59489687/ (tile 1)
  - extracted: `4.8`
  - judge's reading (uncalibrated): The page shows a rating of 5 stars with (4) reviews, not an average rating of 4.8.
- **Product details** — https://www.ikea.com/my/en/p/hyltarp-2-seat-sofa-gransel-natural-s59489611/ (tile 1)
  - extracted: `Skillful craftsmanship and a perfect fit means that the sofa will always shows off its best side.`
  - judge's reading (uncalibrated): The page shows no "Product details" field with that text; the visible text instead reads "...eryone wants to ...e essential features – ...easing on the eye." (a partial description obscured by the cookie banner).
- **Average rating** — https://www.ikea.com/my/en/p/saltmyran-2-seat-sofa-oereryd-grey-beige-40618528/ (tile 1)
  - extracted: `4.6`
  - judge's reading (uncalibrated): The page shows 8 reviews but does not display a numeric average rating value.
- **Average rating** — https://www.ikea.com/my/en/p/soederhamn-3-seat-section-viarp-beige-brown-s69305616/ (tile 1)
  - extracted: `4.8`
  - judge's reading (uncalibrated): The page shows a 5-star rating icon with (12) reviews, but no explicit average rating number is displayed.
- **Average rating** — https://www.ikea.com/my/en/p/kivik-3-seat-sofa-tibbleby-beige-grey-s59440592/ (tile 1)
  - extracted: `4.7`
  - judge's reading (uncalibrated): The page shows no numeric average rating value, only a star icon display with (84) reviews count.
- **Average rating** — https://www.ikea.com/my/en/p/saltmyran-3-seat-sofa-oereryd-grey-beige-90618516/ (tile 1)
  - extracted: `5`
  - judge's reading (uncalibrated): The page shows an average rating of 4 stars (based on 5 reviews).

## Notes

```
claude-sonnet-5: 465 req, 1,278,116 in / 3,334 out
estimated $3.8844 at list rates
```

- Cost attribution: the usage counter (`@robot/agent` usage.ts) is process-wide. This CLI is a single process doing nothing else, so the figure above is its own.
- This report is the record: judge-run does not write to `runs.cost_usd` or any other table.
