# Judge run — Mejuri

- Run: `64bf2266-bb97-45ee-a625-6bf87a8a65fb`
- Site: Mejuri (project Campaign 2 2026-10-11)
- When: 2026-10-12T11:58:56.326Z
- Items: 48 items in run, 48 with values, 48 captured, 0 capture failed, judged 48
- Fields: Title, Price, Main image, SKU, Brand, In stock, Rating, Description
- Judge cost: $3.0930 (cap $5.00)
- Time: 18m 42s

Each item's URL was captured fresh (a run stores no screenshot), so a verdict compares the stored value with the page as it is now — a price that changed since the run reads as wrong.

The judge sees screenshot tiles from the top of the page (3 tiles ≈ 4608 px, 1536 px each); a value is judged on tile 1 and again on the next tile only while the verdict is "not on page". 'Not on page' after all tiles usually means further down or in a tab, not wrong.

Only each item's first stored row is judged (on a row-per-variant run, the default variant).

## Per field

Correct % is correct / (correct + wrong); "—" when neither occurred. Not on page, unverifiable and judge errors are counted apart and do not enter it. Empty values are not judged.

| Field | Judged | Correct | Wrong | Not on page | Unverifiable | Error | Empty | Correct % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Title | 48 | 46 | 0 | 2 | 0 | 0 | 0 | 100% |
| Price | 48 | 45 | 1 | 2 | 0 | 0 | 0 | 98% |
| Main image | 48 | 0 | 0 | 0 | 48 | 0 | 0 | — |
| SKU | 48 | 0 | 0 | 47 | 1 | 0 | 0 | — |
| Brand | 48 | 48 | 0 | 0 | 0 | 0 | 0 | 100% |
| In stock | 48 | 28 | 0 | 14 | 6 | 0 | 0 | 100% |
| Rating | 47 | 45 | 0 | 2 | 0 | 0 | 1 | 100% |
| Description | 42 | 42 | 0 | 0 | 0 | 0 | 6 | 100% |

## Per item

C correct · W wrong · N not on page · U unverifiable · E judge error · S variant list, not judged · - not judged (run interrupted) · `·` empty. The digit is the screenshot tile that decided the verdict. A bare U is a URL value (image/url field or an absolute http(s) link), marked unverifiable without a judge call or cost.

| URL | Page title | Title | Price | Main image | SKU | Brand | In stock | Rating | Description |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| https://mejuri.com/my/en/products/slim-signet-ring?Material=10k+Yellow+Gold | Slim Signet Ring - Jewelry \| Mejuri | N2 | N2 | U | N2 | C1 | U1 | N2 | C1 |
| https://mejuri.com/my/en/products/duet-mixed-ring?Material=18k+Gold+Vermeil%2C+Sterling+Silver | 18k Gold Vermeil and Sterling Silver Duet Mixed Ring - Jewelry \| Mejuri | N2 | N2 | U | N2 | C1 | U1 | N2 | C1 |
| https://mejuri.com/my/en/products/duo-beaded-stacker-ring?Material=18k+Gold+Vermeil | 18k Gold Vermeil Duo Beaded Stacker Ring - Jewelry \| Mejuri | C1 | C1 | U | N2 | C1 | N2 | C1 | C1 |
| https://mejuri.com/my/en/products/lacey-lab-grown-sapphire-ring?Material=Sterling+Silver&Stone=Lab+Grown+Sapphire | Lacey Lab Grown Sapphire Ring \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/jude-pinky-signet-ring?Material=14k+Yellow+Gold&Stone=Prasiolite | Jude Pinky Signet Ring \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/bold-eternity-line-band?Material=18k+Gold+Vermeil | Bold Eternity Line Band | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/bold-open-dome-ring?Material=18k+Gold+Vermeil | Bold Open Dôme Ring - Jewelry \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/stevie-ring?Material=18k+Gold+Vermeil | Stevie Ring | C1 | C1 | U | N2 | C1 | N2 | C1 | C1 |
| https://mejuri.com/my/en/products/dome-figure-ring?Material=18k+Gold+Vermeil | Gold Figure Ring - Jewelry \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | · |
| https://mejuri.com/my/en/products/metallic-sphere-ring?Material=18k+Gold+Vermeil | Metallic Sphere Ring | C1 | C1 | U | N2 | C1 | N2 | C1 | C1 |
| https://mejuri.com/my/en/products/dome-brioche-pave-lab-grown-sapphire-ring?Material=18k+Gold+Vermeil&Stone=Lab+Grown+Sapphire | Brioche Pavé Lab Grown Sapphire Ring \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/thin-dome-ring?Material=Sterling+Silver | Thin Dôme Ring \| Mejuri | C1 | C1 | U | N2 | C1 | U1 | C1 | C1 |
| https://mejuri.com/my/en/products/pave-diamond-slim-signet-ring?Material=14k+Yellow+Gold&Stone=Natural+Diamond | 14k Yellow Gold Handcrafted Pavé Diamond Signet Ring - Jewelry \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/stacker-ring?Material=10k+Yellow+Gold | Stackable Ring \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/dome-brioche-ring?Material=18k+Gold+Vermeil | Dôme Brioche Ring \| Mejuri | C1 | C1 | U | N2 | C1 | U1 | C1 | C1 |
| https://mejuri.com/my/en/products/dome-figure-ring?Material=Sterling+Silver | Gold Figure Ring - Jewelry \| Mejuri | C1 | C1 | U | N2 | C1 | N2 | C1 | · |
| https://mejuri.com/my/en/products/diamonds-band?Material=14k+Yellow+Gold&Stone=Natural+Diamond | Diamond Band Ring \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/bezel-lab-grown-diamond-zig-zag-ring?Material=14k+Yellow+Gold&Stone=Lab+Grown+Diamond | Ziggy Ring | C1 | C1 | U | N2 | C1 | C1 | C1 | · |
| https://mejuri.com/my/en/products/daily-stacker-ring?Material=18k+Gold+Vermeil | Daily Stacker Ring - Jewelry \| Mejuri | C1 | C1 | U | N2 | C1 | N2 | C1 | C1 |
| https://mejuri.com/my/en/products/puzzle-stacker-ring?Material=18k+Gold+Vermeil&Birthstone=Lab+Grown+Blue+Sapphire | Puzzle Stacking Ring \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/charlotte-stacker-lgs-prong-ring?Material=Sterling+Silver&Stone=Lab+Grown+White+Sapphire | Charlotte Crest Stacker Ring - Jewelry \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/bold-open-dome-ring?Material=Sterling+Silver | Bold Open Dôme Ring - Jewelry \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/aurora-oval-eternity-ring?Material=18k+Gold+Vermeil&Stone=Lab+Grown+White+Sapphire | Aurora Oval Eternity Ring | C1 | C1 | U | N2 | C1 | U1 | C1 | C1 |
| https://mejuri.com/my/en/products/aurora-lab-grown-sapphire-eternity-ring?Material=Sterling+Silver&Stone=Lab+Grown+White+Sapphire | Aurora Lab Grown Sapphire Eternity Ring | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/beverly-ring?Material=14k+Yellow+Gold&Stone=Natural+Diamond%2C+Pearl | Beverly Ring \| Mejuri | C1 | C1 | U | N2 | C1 | N2 | C1 | · |
| https://mejuri.com/my/en/products/organic-dome-nesting-ring-set?Material=18k+Gold+Vermeil&Stone=Lab+Grown+White+Sapphire | Organic Dôme Nesting Ring Set in 18k Gold Vermeil & Lab-Grown Sapphires \| Mejuri | C1 | W1 | U | N2 | C1 | N2 | C1 | · |
| https://mejuri.com/my/en/products/boa-gemstone-coil-ring?Material=18k+Gold+Vermeil&Stone=White+Topaz | 18k Gold Vermeil Boa Gemstone Coil Ring - Jewelry \| Mejuri | C1 | C1 | U | N2 | C1 | U1 | C1 | C1 |
| https://mejuri.com/my/en/products/charlotte-plain-lgs-pave-stacker-set?Material=18k+Gold+Vermeil&Stone=Lab+Grown+White+Sapphire | Slim Charlotte Stacker Set - Jewelry \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/pave-puzzle-stacker-ring?Material=18k+Gold+Vermeil&Stone=Lab+Grown+White+Sapphire | Pavé Puzzle Stacking Ring \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/wishbone-ring?Material=14k+Yellow+Gold | Wishbone Ring \| Mejuri | C1 | C1 | U | N2 | C1 | N2 | C1 | C1 |
| https://mejuri.com/my/en/products/charlotte-plain-lgs-pave-stacker-set?Material=Sterling+Silver&Stone=Lab+Grown+White+Sapphire | Slim Charlotte Stacker Set - Jewelry \| Mejuri | C1 | C1 | U | N2 | C1 | N2 | C1 | C1 |
| https://mejuri.com/my/en/products/interconnected-pave-diamond-open-ring?Material=14k+Yellow+Gold&Stone=Lab+Grown+Diamond | Interconnected Strike Pavé Lab Grown Diamond Ring \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | · | C1 |
| https://mejuri.com/my/en/products/stevie-ring?Material=Sterling+Silver | Stevie Ring | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/thin-dome-ring?Material=18k+Gold+Vermeil | Thin Dôme Ring \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/jude-pinky-signet-ring?Material=Sterling+Silver&Stone=Champagne+Quartz | Jude Pinky Signet Ring \| Mejuri | C1 | C1 | U | N2 | C1 | N2 | C1 | C1 |
| https://mejuri.com/my/en/products/daily-stacker-ring?Material=Sterling+Silver | Daily Stacker Ring - Jewelry \| Mejuri | C1 | C1 | U | N2 | C1 | N2 | C1 | C1 |
| https://mejuri.com/my/en/products/charlotte-stacker-lgs-prong-ring?Material=18k+Gold+Vermeil&Stone=Lab+Grown+White+Sapphire | Charlotte Crest Stacker Ring - Jewelry \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/dome-figure-balance-ring?Material=18k+Gold+Vermeil&Stone=Lab+Grown+White+Sapphire | Dôme Figure Balance Ring | C1 | C1 | U | U1 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/lacey-lab-grown-sapphire-ring?Material=18k+Gold+Vermeil&Stone=Lab+Grown+Sapphire | Lacey Lab Grown Sapphire Ring \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/dome-figure-balance-ring?Material=Sterling+Silver&Stone=Lab+Grown+White+Sapphire | Dôme Figure Balance Ring | C1 | C1 | U | N2 | C1 | N2 | C1 | C1 |
| https://mejuri.com/my/en/products/aurora-lab-grown-sapphire-eternity-ring?Material=18k+Gold+Vermeil&Stone=Lab+Grown+White+Sapphire | Aurora Lab Grown Sapphire Eternity Ring | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/organic-dome-nesting-ring-set?Material=Sterling+Silver%2C+18k+Gold+Vermeil&Stone=Lab+Grown+White+Sapphire | Organic Dôme Nesting Ring Set in 18k Gold Vermeil & Lab-Grown Sapphires \| Mejuri | C1 | C1 | U | N2 | C1 | N2 | C1 | · |
| https://mejuri.com/my/en/products/diamonds-team-ring?Material=14k+Yellow+Gold&Stone=Natural+Diamond | Diamonds Team Ring \| Mejuri | C1 | C1 | U | N2 | C1 | N2 | C1 | C1 |
| https://mejuri.com/my/en/products/jude-pinky-signet-ring?Material=Sterling+Silver&Stone=Lab+Grown+White+Sapphire | Jude Pinky Signet Ring \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/pave-diamond-thin-dome-ring?Material=14k+Yellow+Gold&Stone=Natural+Diamond | 14k Solid Gold Pavé Diamond Thin Dôme Ring - Jewelry \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/interconnected-lattice-ring?Material=18k+Gold+Vermeil%2C+Sterling+Silver | Interconnected Lattice Ring \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/bold-dot-ring?Material=18k+Gold+Vermeil | Bold Dot Ring | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |
| https://mejuri.com/my/en/products/puffy-charlotte-stacker-ring?Material=Sterling+Silver | Puffy Charlotte Stacker Ring - Jewelry \| Mejuri | C1 | C1 | U | N2 | C1 | C1 | C1 | C1 |

## Wrong values

- **Price** — https://mejuri.com/my/en/products/organic-dome-nesting-ring-set?Material=18k+Gold+Vermeil&Stone=Lab+Grown+White+Sapphire (tile 1)
  - extracted: `910`
  - judge's reading (uncalibrated): The page shows the price as "MYR 910", not just "910".

## Notes

```
claude-sonnet-5: 397 req, 1,020,852 in / 2,029 out
estimated $3.0930 at list rates
```

- Cost attribution: the usage counter (`@robot/agent` usage.ts) is process-wide. This CLI is a single process doing nothing else, so the figure above is its own.
- This report is the record: judge-run does not write to `runs.cost_usd` or any other table.
