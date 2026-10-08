# Judge run — Barnesandnoble

> **STOPPED at the $5.00 cap** — the next item would have gone over it.
> 57 of 60 items were judged; the tables cover only those.

- Run: `a80bd75a-828f-436e-9b50-3bc25fa9b42c`
- Site: Barnesandnoble (project Credit campaign 2026-10)
- When: 2026-10-08T11:10:12.306Z
- Items: 60 items in run, 60 with values, 57 captured, 0 capture failed, judged 57 (limited by cap)
- Fields: Title, Price, Main image, SKU, Brand, Rating, In stock, Description
- Judge cost: $4.9792 (cap $5.00)
- Time: 29m 48s

Each item's URL was captured fresh (a run stores no screenshot), so a verdict compares the stored value with the page as it is now — a price that changed since the run reads as wrong.

The judge sees screenshot tiles from the top of the page (3 tiles ≈ 4608 px, 1536 px each); a value is judged on tile 1 and again on the next tile only while the verdict is "not on page". 'Not on page' after all tiles usually means further down or in a tab, not wrong.

Only each item's first stored row is judged (on a row-per-variant run, the default variant).

## Per field

Correct % is correct / (correct + wrong); "—" when neither occurred. Not on page, unverifiable and judge errors are counted apart and do not enter it. Empty values are not judged.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 57 | 56 | 0 | 0 | 0 | 1 | 0 | 100% |
| Price | 56 | 55 | 1 | 0 | 0 | 0 | 1 | 98% |
| Main image | 57 | 0 | 0 | 0 | 57 | 0 | 0 | — |
| SKU | 56 | 4 | 19 | 30 | 3 | 0 | 1 | 17% |
| Brand | 56 | 24 | 27 | 3 | 2 | 0 | 1 | 47% |
| Rating | 51 | 40 | 11 | 0 | 0 | 0 | 6 | 78% |
| In stock | 56 | 34 | 0 | 9 | 13 | 0 | 1 | 100% |
| Description | 56 | 55 | 1 | 0 | 0 | 0 | 1 | 98% |

## Per item

C correct · W wrong · N not on page · U unverifiable · E judge error · S variant list, not judged · - not judged (run interrupted) · `·` empty. The digit is the screenshot tile that decided the verdict. A bare U is a URL value (image/url field or an absolute http(s) link), marked unverifiable without a judge call or cost.

| URL | Page title | Title | Price | Main image | SKU | Brand | Rating | In stock | Description |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| https://www.barnesandnoble.com/w/dead-beat-leigh-bardugo/1149244925?ean=9781250473196 | Dead Beat (B&N Exclusive Edition) \| Barnes & Noble® | C1 | W1 | U | N3 | W2 | C1 | C1 | W1 |
| https://www.barnesandnoble.com/w/hollywood-ending-john-green/1149802863?ean=9780525556657 | Hollywood, Ending (Signed Edition) \| Barnes & Noble® | C1 | C1 | U | W2 | W2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/a-court-of-forgotten-melody-sarah-j-maas/1151104531?ean=9798260200568 | A Court of Forgotten Melody (A Court of Thorns and Roses Series #7) \| Barnes & Noble® | C1 | C1 | U | N3 | W2 | · | N3 | C1 |
| https://www.barnesandnoble.com/w/the-butchers-masquerade-matt-dinniman/1146460803?ean=9780593955994 | The Butcher's Masquerade (Dungeon Crawler Carl Series #5) \| Barnes & Noble® | C1 | C1 | U | C1 | W2 | W1 | C1 | C1 |
| https://www.barnesandnoble.com/w/swan-song-charles-spencer/1151113422?ean=9798217379743 | Swan Song \| Barnes & Noble® | C1 | C1 | U | N3 | C2 | C1 | N3 | C1 |
| https://www.barnesandnoble.com/w/red-rising-pierce-brown/1110614785?ean=9780345539809 | Red Rising (Red Rising Series #1) \| Barnes & Noble® | C1 | C1 | U | N3 | U3 | C1 | U1 | C1 |
| https://www.barnesandnoble.com/w/mad-mabel-sally-hepworth/1147243855?ean=9781250284549 | Mad Mabel: A Novel \| Barnes & Noble® | C1 | C1 | U | N3 | C2 | W1 | C1 | C1 |
| https://www.barnesandnoble.com/w/the-knight-and-the-moth-rachel-gillig/1146221051?ean=9780316573757 | The Knight and the Moth \| Barnes & Noble® | C1 | C1 | U | W1 | C2 | C1 | U1 | C1 |
| https://www.barnesandnoble.com/w/dungeon-crawler-carl-matt-dinniman/1145437169?ean=9780593820254 | Dungeon Crawler Carl (Dungeon Crawler Carl Series #1) \| Barnes & Noble® | C1 | C1 | U | W2 | W2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/the-deal-elle-kennedy/1121202984?ean=9781775293934 | The Deal (Off-Campus, #1) \| Barnes & Noble® | C1 | C1 | U | C1 | W1 | C1 | C2 | C1 |
| https://www.barnesandnoble.com/w/how-to-survive-camping-bonnie-quinn/1146385251?ean=9781668271650 | How to Survive Camping: The Man With No Shadow \| Barnes & Noble® | C1 | C1 | U | N3 | C2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/murdoku-manuel-garand/1147152028?ean=9781454961796 | Murdoku: 80 Murder Mystery Logic Puzzles \| Barnes & Noble® | C1 | C1 | U | N3 | C1 | W1 | C1 | C1 |
| https://www.barnesandnoble.com/w/the-silent-patient-alex-michaelides/1128638857?ean=9781250301703 | The Silent Patient \| Barnes & Noble® | C1 | C1 | U | N3 | C2 | C1 | U1 | C1 |
| https://www.barnesandnoble.com/w/east-of-eden-john-steinbeck/1100594195?ean=9780142004234 | East of Eden \| Barnes & Noble® | C1 | C1 | U | N3 | N3 | C1 | U1 | C1 |
| https://www.barnesandnoble.com/w/lights-out-navessa-allen/1148125807?ean=9781638932239 | Lights Out (Into Darkness Series #1) \| Barnes & Noble® | C1 | C1 | U | W2 | W2 | W1 | U1 | C1 |
| https://www.barnesandnoble.com/w/the-witch-freida-mcfadden/1149622698?ean=9781464249648 | The Witch (Deluxe Edition) (Signed Book) \| Barnes & Noble® | C1 | C1 | U | N3 | W2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/regime-change-maggie-haberman/1149840903?ean=9781668067246 | Regime Change: Inside the Imperial Presidency of Donald Trump \| Barnes & Noble® | C1 | C1 | U | N3 | C2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/spooky-cutie-coco-wyo/1150127504?ean=9798217232789 | Spooky Cutie: Coloring Book for Adults and Kids \| Barnes & Noble® | C1 | C1 | U | N3 | W1 | · | C1 | C1 |
| https://www.barnesandnoble.com/w/the-eye-of-the-bedlam-bride-matt-dinniman/1146460700?ean=9780593956014 | The Eye of the Bedlam Bride (Dungeon Crawler Carl #6) \| Barnes & Noble® | C1 | C1 | U | N3 | W2 | W1 | C1 | C1 |
| https://www.barnesandnoble.com/w/murdle-g-t-karber/1141976523?ean=9781250892317 | Murdle: Volume 1: 100 Elementary to Impossible Mysteries to Solve Using Logic, Skill, and the Power of Deduction \| Barnes & Noble® | C1 | C1 | U | N3 | W2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/the-calamity-club-kathryn-stockett/1147098401?ean=9781954118812 | The Calamity Club: A Novel \| Barnes & Noble® | C1 | C1 | U | N3 | W2 | C1 | U1 | C1 |
| https://www.barnesandnoble.com/w/escape-me-tahereh-mafi/1149970815?ean=9780063512399 | Escape Me (Deluxe Limited Edition) (Signed Book) \| Barnes & Noble® | C1 | C1 | U | N3 | W1 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/hollow-bones-jodi-picoult/1149014562?ean=9780593726259 | Hollow Bones: A Novel \| Barnes & Noble® | C1 | C1 | U | U1 | C2 | W1 | C1 | C1 |
| https://www.barnesandnoble.com/w/a-court-of-splintered-harmony-sarah-j-maas/1151104530?ean=9781639739134 | A Court of Splintered Harmony (A Court of Thorns and Roses Series #6) \| Barnes & Noble® | C1 | C1 | U | N3 | U1 | · | N3 | C1 |
| https://www.barnesandnoble.com/w/carls-doomsday-scenario-matt-dinniman/1145070342?ean=9780593820261 | Carl's Doomsday Scenario (Dungeon Crawler Carl #2) \| Barnes & Noble® | C1 | C1 | U | N3 | W2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/the-sixth-faction-deluxe-limited-edition-veronica-roth/1149914472?ean=9780063462540 | The Sixth Faction Deluxe Limited Edition \| Barnes & Noble® | C1 | · | U | · | · | · | · | · |
| https://www.barnesandnoble.com/w/the-dungeon-anarchists-cookbook-matt-dinniman/1145437166?ean=9780593820285 | The Dungeon Anarchist's Cookbook (Dungeon Crawler Carl #3) \| Barnes & Noble® | C1 | C1 | U | U1 | C1 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/frankenkitty-maudie-powell-tuck/1148477253?ean=9781680108354 | Frankenkitty \| Barnes & Noble® | C1 | C1 | U | W1 | C1 | · | U2 | C1 |
| https://www.barnesandnoble.com/w/verity-colleen-hoover/1130171830?ean=9781538784051 | Verity \| Barnes & Noble® | C1 | C1 | U | W2 | C2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/falling-like-leaves-misty-wilson/1146889511?ean=9798347121151 | Falling Like Leaves \| Barnes & Noble® | C1 | C1 | U | N3 | W2 | C1 | U1 | C1 |
| https://www.barnesandnoble.com/w/whistler-ann-patchett/1148504538?ean=9780063511637 | Whistler: A Novel (Signed Book) \| Barnes & Noble® | C1 | C1 | U | N3 | C1 | W1 | C1 | C1 |
| https://www.barnesandnoble.com/w/dungeon-crawler-carl-matt-dinniman/1145437169?ean=9780593820247 | Dungeon Crawler Carl (Dungeon Crawler Carl Series #1) \| Barnes & Noble® | C1 | C1 | U | W2 | W2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/the-let-them-theory-mel-robbins/1146342595?ean=9781401971366 | The Let Them Theory: A Life-Changing Tool That Millions of People Can't Stop Talking About \| Barnes & Noble® | C1 | C1 | U | N3 | N3 | C1 | C3 | C1 |
| https://www.barnesandnoble.com/w/yesteryear-caro-claire-burke/1147793810?ean=9780593804216 | Yesteryear (GMA Book Club Pick) \| Barnes & Noble® | C1 | C1 | U | N3 | C2 | C1 | U1 | C1 |
| https://www.barnesandnoble.com/w/wild-dark-shore-charlotte-mcconaghy/1145317337?ean=9781250828019 | Wild Dark Shore (Reese's Book Club Pick) \| Barnes & Noble® | C1 | C1 | U | W2 | C2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/theo-of-golden-allen-levi/1143923011?ean=9781668236512 | Theo of Golden: A Novel \| Barnes & Noble® | C1 | C1 | U | U2 | W2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/brain-damage-freida-mcfadden/1149563990?ean=9781464249617 | Brain Damage \| Barnes & Noble® | C1 | C1 | U | C1 | C1 | C1 | N3 | C1 |
| https://www.barnesandnoble.com/w/the-knave-and-the-moon-rachel-gillig/1148304786?ean=9780316601849 | The Knave and the Moon \| Barnes & Noble® | C1 | C1 | U | W1 | C1 | C1 | U1 | C1 |
| https://www.barnesandnoble.com/w/project-hail-mary-andy-weir/1137456421?ean=9780593135228 | Project Hail Mary \| Barnes & Noble® | C1 | C1 | U | N3 | C2 | W1 | U2 | C1 |
| https://www.barnesandnoble.com/w/fahrenheit-451-ray-bradbury/1100383286?ean=9781451673319 | Fahrenheit 451 \| Barnes & Noble® | C1 | C1 | U | W1 | W1 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/21-days-of-fear-herve-commere/1149160617?ean=9798347119615 | 21 Days of Fear: One Day, One Letter \| Barnes & Noble® | C1 | C1 | U | W1 | C1 | · | C1 | C1 |
| https://www.barnesandnoble.com/w/threshing-day-rebecca-yarros/1150799611?ean=9781682818084 | Threshing Day \| Barnes & Noble® | C1 | C1 | U | W2 | W2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/protocols-andrew-d-huberman-phd/1145846225?ean=9781668032145 | Protocols: An Operating Manual for the Human Body (Signed Book) \| Barnes & Noble® | C1 | C1 | U | W1 | W1 | W1 | N3 | C1 |
| https://www.barnesandnoble.com/w/the-gate-of-the-feral-gods-matt-dinniman/1146460801?ean=9780593955970 | The Gate of the Feral Gods (Dungeon Crawler Carl #4) \| Barnes & Noble® | C1 | C1 | U | W2 | W2 | W1 | C1 | C1 |
| https://www.barnesandnoble.com/w/the-demon-overlords-retirement-plan-m-h-foster/1148450889?ean=9781538787823 | The Demon Overlord's Retirement Plan \| Barnes & Noble® | E1 | C1 | U | N3 | W2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/the-knave-and-the-moon-rachel-gillig/1148304786?ean=9780316608329 | The Knave and the Moon \| Barnes & Noble® | C1 | C1 | U | W1 | C1 | C1 | N3 | C1 |
| https://www.barnesandnoble.com/w/atomic-habits-james-clear/1129201155?ean=9780735211292 | Atomic Habits: An Easy & Proven Way to Build Good Habits & Break Bad Ones \| Barnes & Noble® | C1 | C1 | U | W2 | W2 | C1 | N3 | C1 |
| https://www.barnesandnoble.com/w/the-thoroughbreds-elin-hilderbrand/1149319401?ean=9780316567916 | The Thoroughbreds \| Barnes & Noble® | C1 | C1 | U | N3 | C2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/the-french-illusion-john-grisham/1149667428?ean=9780385550543 | The French Illusion: A Novel \| Barnes & Noble® | C1 | C1 | U | C1 | C1 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/rowley-jeffersons-awesome-friendly-spooky-stories-2-jeff-kinney/1148725786?ean=9781419788109 | Rowley Jefferson's Awesome Friendly Spooky Stories 2: From the Creator of Diary of a Wimpy Kid \| Barnes & Noble® | C1 | C1 | U | N3 | C1 | C1 | C2 | C1 |
| https://www.barnesandnoble.com/w/the-correspondent-virginia-evans/1146138272?ean=9780593798430 | The Correspondent (Women's Prize for Fiction Winner) \| Barnes & Noble® | C1 | C1 | U | W2 | W2 | C1 | U3 | C1 |
| https://www.barnesandnoble.com/w/trust-fall-lynn-painter/1149669107?ean=9798347124121 | Trust Fall \| Barnes & Noble® | C1 | C1 | U | N3 | C2 | C1 | U1 | C1 |
| https://www.barnesandnoble.com/w/grim-tidings-bk-borison/1148610168?ean=9780063430464 | Grim Tidings: A Novel \| Barnes & Noble® | C1 | C1 | U | N3 | N3 | W1 | C1 | C1 |
| https://www.barnesandnoble.com/w/the-killer-isnt-alice-iris-starling/1150460765?ean=9780316616188 | The Killer Isn't Alice: The Bestselling Murder Mystery Puzzle Book - 46,600 Suspects, 1 Killer. Can You Solve the Crime? \| Barnes & Noble® | C1 | C1 | U | W2 | W2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/the-honjin-murders-seishi-yokomizo/1133411032?ean=9781805336549 | The Honjin Murders \| Barnes & Noble® | C1 | C1 | U | N3 | W1 | C1 | N3 | C1 |
| https://www.barnesandnoble.com/w/carls-doomsday-scenario-matt-dinniman/1145070342?ean=9780593820278 | Carl's Doomsday Scenario (Dungeon Crawler Carl #2) \| Barnes & Noble® | C1 | C1 | U | W2 | W2 | C1 | C1 | C1 |
| https://www.barnesandnoble.com/w/the-love-hypothesis-ali-hazelwood/1138635323?ean=9780593336823 | The Love Hypothesis \| Barnes & Noble® | C1 | C1 | U | N3 | C2 | C1 | N3 | C1 |

## Wrong values

- **Price** — https://www.barnesandnoble.com/w/dead-beat-leigh-bardugo/1149244925?ean=9781250473196 (tile 1)
  - extracted: `14.99`
  - judge's reading (uncalibrated): The page shows the BN Exclusive price as $26.99, not $14.99 (which is the eBook price).
- **Brand** — https://www.barnesandnoble.com/w/dead-beat-leigh-bardugo/1149244925?ean=9781250473196 (tile 2)
  - extracted: `Flatiron Books`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "Flatiron Books" is actually listed as the Publisher.
- **Description** — https://www.barnesandnoble.com/w/dead-beat-leigh-bardugo/1149244925?ean=9781250473196 (tile 1)
  - extracted: `INSTANT #1 NEW YORK TIMES BESTSELLERNAMED A MOST ANTICIPATED BOOK OF FALL 2026 BY GOODREADS & THE NEW YORK TIMESThe highly anticipated, explosive conclusion to …`
  - judge's reading (uncalibrated): The visible description does not include the "INSTANT #1 NEW YORK TIMES BESTSELLER" or "NAMED A MOST ANTICIPATED BOOK..." lines—it begins with "This Barnes & Noble Exclusive..." text that is obscured by a loading popup, followed by "The highly anticipated, explosive conclusion..." and continues
- **SKU** — https://www.barnesandnoble.com/w/hollywood-ending-john-green/1149802863?ean=9780525556657 (tile 2)
  - extracted: `9780525556657`
  - judge's reading (uncalibrated): The page shows no SKU value; it only lists the ISBN-13 as 9780525556657.
- **Brand** — https://www.barnesandnoble.com/w/hollywood-ending-john-green/1149802863?ean=9780525556657 (tile 2)
  - extracted: `Penguin Young Readers Group`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "Penguin Young Readers Group" is actually listed as the Publisher.
- **Brand** — https://www.barnesandnoble.com/w/a-court-of-forgotten-melody-sarah-j-maas/1151104531?ean=9798260200568 (tile 2)
  - extracted: `Bloomsbury Publishing`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "Bloomsbury Publishing" is listed as the Publisher.
- **Brand** — https://www.barnesandnoble.com/w/the-butchers-masquerade-matt-dinniman/1146460803?ean=9780593955994 (tile 2)
  - extracted: `Penguin Publishing Group`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "Penguin Publishing Group" is listed as the Publisher.
- **Rating** — https://www.barnesandnoble.com/w/the-butchers-masquerade-matt-dinniman/1146460803?ean=9780593955994 (tile 1)
  - extracted: `4.9`
  - judge's reading (uncalibrated): The page shows a rating of approximately 4.5 stars (based on 16 reviews), not 4.9.
- **Rating** — https://www.barnesandnoble.com/w/mad-mabel-sally-hepworth/1147243855?ean=9781250284549 (tile 1)
  - extracted: `4.7`
  - judge's reading (uncalibrated): The page shows a rating of approximately 4.5 stars based on 458 reviews.
- **SKU** — https://www.barnesandnoble.com/w/the-knight-and-the-moth-rachel-gillig/1146221051?ean=9780316573757 (tile 1)
  - extracted: `9780316573788`
  - judge's reading (uncalibrated): The page shows no SKU value; the visible number (9780316577788) is labeled ISBN-13, not SKU.
- **SKU** — https://www.barnesandnoble.com/w/dungeon-crawler-carl-matt-dinniman/1145437169?ean=9780593820254 (tile 2)
  - extracted: `9780593820254`
  - judge's reading (uncalibrated): The page shows no SKU field; 9780593820254 is actually the ISBN-13.
- **Brand** — https://www.barnesandnoble.com/w/dungeon-crawler-carl-matt-dinniman/1145437169?ean=9780593820254 (tile 2)
  - extracted: `Penguin Publishing Group`
  - judge's reading (uncalibrated): The page shows no "Brand" field; only "Publisher" with value "Penguin Publishing Group."
- **Brand** — https://www.barnesandnoble.com/w/the-deal-elle-kennedy/1121202984?ean=9781775293934 (tile 1)
  - extracted: `Elle Kennedy Inc.`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "Elle Kennedy Inc." is listed under "Publisher."
- **Rating** — https://www.barnesandnoble.com/w/murdoku-manuel-garand/1147152028?ean=9781454961796 (tile 1)
  - extracted: `4.9`
  - judge's reading (uncalibrated): The page shows a rating of approximately 4.5 stars (based on 27 reviews).
- **SKU** — https://www.barnesandnoble.com/w/lights-out-navessa-allen/1148125807?ean=9781638932239 (tile 2)
  - extracted: `9781638932246`
  - judge's reading (uncalibrated): The page shows no SKU value; 9781638932246 is actually the ISBN-13.
- **Brand** — https://www.barnesandnoble.com/w/lights-out-navessa-allen/1148125807?ean=9781638932239 (tile 2)
  - extracted: `Zando`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "Zando" is actually labeled as the Publisher.
- **Rating** — https://www.barnesandnoble.com/w/lights-out-navessa-allen/1148125807?ean=9781638932239 (tile 1)
  - extracted: `4.6`
  - judge's reading (uncalibrated): The page shows a rating of about 4.5 stars based on 150 reviews, not 4.6.
- **Brand** — https://www.barnesandnoble.com/w/the-witch-freida-mcfadden/1149622698?ean=9781464249648 (tile 2)
  - extracted: `Sourcebooks`
  - judge's reading (uncalibrated): The page shows "Sourcebooks" labeled as "Publisher," not "Brand" — there is no Brand field shown.
- **Brand** — https://www.barnesandnoble.com/w/spooky-cutie-coco-wyo/1150127504?ean=9798217232789 (tile 1)
  - extracted: `Random House Children's Books`
  - judge's reading (uncalibrated): The page shows no value for a "Brand" field; "Random House Children's Books" is listed as the Publisher.
- **Brand** — https://www.barnesandnoble.com/w/the-eye-of-the-bedlam-bride-matt-dinniman/1146460700?ean=9780593956014 (tile 2)
  - extracted: `Penguin Publishing Group`
  - judge's reading (uncalibrated): The page shows no "Brand" field; it lists "Publisher" as Penguin Publishing Group instead.
- **Rating** — https://www.barnesandnoble.com/w/the-eye-of-the-bedlam-bride-matt-dinniman/1146460700?ean=9780593956014 (tile 1)
  - extracted: `4.8`
  - judge's reading (uncalibrated): The page shows a rating of approximately 4.5 stars (based on 12 reviews), not 4.8.
- **Brand** — https://www.barnesandnoble.com/w/murdle-g-t-karber/1141976523?ean=9781250892317 (tile 2)
  - extracted: `St. Martin's Publishing Group`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "St. Martin's Publishing Group" is actually the Publisher.
- **Brand** — https://www.barnesandnoble.com/w/the-calamity-club-kathryn-stockett/1147098401?ean=9781954118812 (tile 2)
  - extracted: `Spiegel & Grau`
  - judge's reading (uncalibrated): The page shows no value for "Brand"; "Spiegel & Grau" is listed as the Publisher, not a Brand.
- **Brand** — https://www.barnesandnoble.com/w/escape-me-tahereh-mafi/1149970815?ean=9780063512399 (tile 1)
  - extracted: `HarperCollins`
  - judge's reading (uncalibrated): The page shows no "Brand" field; it lists "Publisher" as HarperCollins instead.
- **Rating** — https://www.barnesandnoble.com/w/hollow-bones-jodi-picoult/1149014562?ean=9780593726259 (tile 1)
  - extracted: `4.7`
  - judge's reading (uncalibrated): The page shows a rating of 4.5 stars (with 115 reviews).
- **Brand** — https://www.barnesandnoble.com/w/carls-doomsday-scenario-matt-dinniman/1145070342?ean=9780593820261 (tile 2)
  - extracted: `Penguin Publishing Group`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "Penguin Publishing Group" is listed as the Publisher.
- **SKU** — https://www.barnesandnoble.com/w/frankenkitty-maudie-powell-tuck/1148477253?ean=9781680108354 (tile 1)
  - extracted: `9781680108354`
  - judge's reading (uncalibrated): The page shows ISBN-13 as 9781664391000, not the extracted SKU value.
- **SKU** — https://www.barnesandnoble.com/w/verity-colleen-hoover/1130171830?ean=9781538784051 (tile 2)
  - extracted: `9781538724743`
  - judge's reading (uncalibrated): The page shows no SKU value; it only lists ISBN-13: 9781538724743.
- **Brand** — https://www.barnesandnoble.com/w/falling-like-leaves-misty-wilson/1146889511?ean=9798347121151 (tile 2)
  - extracted: `Margaret K. McElderry Books`
  - judge's reading (uncalibrated): The page does not display a "Brand" field; "Margaret K. McElderry Books" is actually listed as the Publisher.
- **Rating** — https://www.barnesandnoble.com/w/whistler-ann-patchett/1148504538?ean=9780063511637 (tile 1)
  - extracted: `4.7`
  - judge's reading (uncalibrated): The page shows a rating of 4.5 stars (with 96 reviews).
- **SKU** — https://www.barnesandnoble.com/w/dungeon-crawler-carl-matt-dinniman/1145437169?ean=9780593820247 (tile 2)
  - extracted: `9780593820254`
  - judge's reading (uncalibrated): The page shows no SKU value; it lists ISBN-13 as 9780593820247, not a SKU.
- **Brand** — https://www.barnesandnoble.com/w/dungeon-crawler-carl-matt-dinniman/1145437169?ean=9780593820247 (tile 2)
  - extracted: `Penguin Publishing Group`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "Penguin Publishing Group" is listed as the Publisher.
- **SKU** — https://www.barnesandnoble.com/w/wild-dark-shore-charlotte-mcconaghy/1145317337?ean=9781250828019 (tile 2)
  - extracted: `9781250827999`
  - judge's reading (uncalibrated): The page shows no SKU value; that number is the ISBN-13, not a SKU.
- **Brand** — https://www.barnesandnoble.com/w/theo-of-golden-allen-levi/1143923011?ean=9781668236512 (tile 2)
  - extracted: `Atria Books`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "Atria Books" is listed under "Publisher."
- **SKU** — https://www.barnesandnoble.com/w/the-knave-and-the-moon-rachel-gillig/1148304786?ean=9780316601849 (tile 1)
  - extracted: `9780316608329`
  - judge's reading (uncalibrated): No SKU value is shown on the page; the visible identifier is ISBN-13: 9780316573818.
- **Rating** — https://www.barnesandnoble.com/w/project-hail-mary-andy-weir/1137456421?ean=9780593135228 (tile 1)
  - extracted: `4.7`
  - judge's reading (uncalibrated): The page shows a rating of 4.5 stars (based on 147 ratings).
- **SKU** — https://www.barnesandnoble.com/w/fahrenheit-451-ray-bradbury/1100383286?ean=9781451673319 (tile 1)
  - extracted: `9781613832493`
  - judge's reading (uncalibrated): The page shows no SKU value, only an ISBN-13 of 9781439142677.
- **Brand** — https://www.barnesandnoble.com/w/fahrenheit-451-ray-bradbury/1100383286?ean=9781451673319 (tile 1)
  - extracted: `Simon & Schuster`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "Simon & Schuster" is listed as the Publisher.
- **SKU** — https://www.barnesandnoble.com/w/21-days-of-fear-herve-commere/1149160617?ean=9798347119615 (tile 1)
  - extracted: `9798347119622`
  - judge's reading (uncalibrated): The page shows no SKU value; 9798347119622 is actually the ISBN-13.
- **SKU** — https://www.barnesandnoble.com/w/threshing-day-rebecca-yarros/1150799611?ean=9781682818084 (tile 2)
  - extracted: `9781682818527`
  - judge's reading (uncalibrated): The page shows no SKU field; the value "9781682818527" shown is actually the ISBN-13.
- **Brand** — https://www.barnesandnoble.com/w/threshing-day-rebecca-yarros/1150799611?ean=9781682818084 (tile 2)
  - extracted: `Entangled Publishing, LLC`
  - judge's reading (uncalibrated): The page shows no distinct "Brand" field; "Entangled Publishing, LLC" is labeled as the Publisher.
- **SKU** — https://www.barnesandnoble.com/w/protocols-andrew-d-huberman-phd/1145846225?ean=9781668032145 (tile 1)
  - extracted: `9781668093634`
  - judge's reading (uncalibrated): The page shows no SKU field; the value 9781668093634 is actually the ISBN-13.
- **Brand** — https://www.barnesandnoble.com/w/protocols-andrew-d-huberman-phd/1145846225?ean=9781668032145 (tile 1)
  - extracted: `S&S/Simon Element`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "S&S/Simon Element" is listed as the Publisher, not Brand.
- **Rating** — https://www.barnesandnoble.com/w/protocols-andrew-d-huberman-phd/1145846225?ean=9781668032145 (tile 1)
  - extracted: `4.5`
  - judge's reading (uncalibrated): The page shows a rating of 4 (with 4.5 stars displayed) and "4" listed as the review count text next to the stars.
- **SKU** — https://www.barnesandnoble.com/w/the-gate-of-the-feral-gods-matt-dinniman/1146460801?ean=9780593955970 (tile 2)
  - extracted: `9780593955970`
  - judge's reading (uncalibrated): The page shows no SKU field; it only lists an ISBN-13 value of 9780593955970.
- **Brand** — https://www.barnesandnoble.com/w/the-gate-of-the-feral-gods-matt-dinniman/1146460801?ean=9780593955970 (tile 2)
  - extracted: `Penguin Publishing Group`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "Penguin Publishing Group" is listed as the Publisher.
- **Rating** — https://www.barnesandnoble.com/w/the-gate-of-the-feral-gods-matt-dinniman/1146460801?ean=9780593955970 (tile 1)
  - extracted: `4.8`
  - judge's reading (uncalibrated): The page shows a rating of approximately 4.5 stars (based on 20 reviews), not 4.8.
- **Brand** — https://www.barnesandnoble.com/w/the-demon-overlords-retirement-plan-m-h-foster/1148450889?ean=9781538787823 (tile 2)
  - extracted: `Grand Central Publishing`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "Grand Central Publishing" is listed under "Publisher."
- **SKU** — https://www.barnesandnoble.com/w/the-knave-and-the-moon-rachel-gillig/1148304786?ean=9780316608329 (tile 1)
  - extracted: `9780316608329`
  - judge's reading (uncalibrated): The page shows no SKU value; it displays ISBN-13 as 9780316573818 instead.
- **SKU** — https://www.barnesandnoble.com/w/atomic-habits-james-clear/1129201155?ean=9780735211292 (tile 2)
  - extracted: `9780735211292`
  - judge's reading (uncalibrated): The page shows no SKU field; it lists ISBN-13 as 9780735211308.
- **Brand** — https://www.barnesandnoble.com/w/atomic-habits-james-clear/1129201155?ean=9780735211292 (tile 2)
  - extracted: `Penguin Publishing Group`
  - judge's reading (uncalibrated): The page shows no value for a "Brand" field; "Penguin Publishing Group" is actually listed as the Publisher.
- **SKU** — https://www.barnesandnoble.com/w/the-correspondent-virginia-evans/1146138272?ean=9780593798430 (tile 2)
  - extracted: `9780593798447`
  - judge's reading (uncalibrated): The page shows no SKU value; 9780593798447 is actually labeled ISBN-13.
- **Brand** — https://www.barnesandnoble.com/w/the-correspondent-virginia-evans/1146138272?ean=9780593798430 (tile 2)
  - extracted: `Crown Publishing Group`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "Crown Publishing Group" is listed as the Publisher.
- **Rating** — https://www.barnesandnoble.com/w/grim-tidings-bk-borison/1148610168?ean=9780063430464 (tile 1)
  - extracted: `4.7`
  - judge's reading (uncalibrated): The page shows a rating of approximately 4.5 stars based on 155 reviews.
- **SKU** — https://www.barnesandnoble.com/w/the-killer-isnt-alice-iris-starling/1150460765?ean=9780316616188 (tile 2)
  - extracted: `9780316616188`
  - judge's reading (uncalibrated): The page shows no SKU field; the value 9780316616188 is actually labeled ISBN-13.
- **Brand** — https://www.barnesandnoble.com/w/the-killer-isnt-alice-iris-starling/1150460765?ean=9780316616188 (tile 2)
  - extracted: `Little, Brown and Company`
  - judge's reading (uncalibrated): The page does not display a "Brand" field; the shown "Little, Brown and Company" is listed as the Publisher.
- **Brand** — https://www.barnesandnoble.com/w/the-honjin-murders-seishi-yokomizo/1133411032?ean=9781805336549 (tile 1)
  - extracted: `Pushkin Press Limited`
  - judge's reading (uncalibrated): The page shows no "Brand" field; "Pushkin Press Limited" is listed as the Publisher.
- **SKU** — https://www.barnesandnoble.com/w/carls-doomsday-scenario-matt-dinniman/1145070342?ean=9780593820278 (tile 2)
  - extracted: `9780593820278`
  - judge's reading (uncalibrated): The page shows no SKU field; that value is actually the ISBN-13.
- **Brand** — https://www.barnesandnoble.com/w/carls-doomsday-scenario-matt-dinniman/1145070342?ean=9780593820278 (tile 2)
  - extracted: `Penguin Publishing Group`
  - judge's reading (uncalibrated): The page shows no Brand field; "Penguin Publishing Group" is actually listed under Publisher.

## Notes

```
claude-sonnet-5: 588 req, 1,635,293 in / 4,888 out
estimated $4.9792 at list rates
```

- Cost attribution: the usage counter (`@robot/agent` usage.ts) is process-wide. This CLI is a single process doing nothing else, so the figure above is its own.
- This report is the record: judge-run does not write to `runs.cost_usd` or any other table.
