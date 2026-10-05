# Variants in the verified flow — design

**Date:** 2026-10-01. **Status:** agreed in conversation with Marko
(2026-09-29 to 10-01), spec for review. Adds variants (colour, size, length…)
to the verified flow: the project's contract, the Verification tab,
certification, extraction at scale and export. The May 2026 `variant_array`
work (`2026-05-28-variants-design.md`, old AI extraction chain) is reference
only; nothing here depends on it.

## 1. What was decided

- **The customer chooses up front, never mid-run.** A run that meets a
  variant product at item 2,000 follows the rule chosen at setup and reports
  afterwards. It never stops to ask. (Marko, 2026-09-29.)
- **Default: one row per variant.** Usually what customers want; the project
  can choose otherwise.
- **The method is chosen per website, at setup, on the proof pages.** Sites
  expose variants differently and partially; a website is consistent with
  itself. The project only says "we want variants, and in which shape".
- **Fields are product-level or variant-level, automatically by meaning,
  editable.**
- **Verification confirms the list and its count, and spot-checks one
  variant** per proof product — never every combination.
- **First version:** variants listed in the page data, and variants linked as
  separate pages. Variants revealed only by clicking a picker are detected and
  shown, not collected (designed in, built later).

## 2. The contract (project level)

- **Variants setting** on the project's Fields page: *One row per variant*
  (default when variants are wanted) · *One row per product, variants listed
  inside* · *Ignore variants* (today's behaviour; the default for existing
  projects).
- **Field level** on every contract field: `product` or `variant`.
  Defaults by concept —
  - variant: price, was-price, SKU, GTIN, in stock, stock count, image,
    product URL;
  - product: title, subtitle, brand, description, bullet points,
    specifications, category, breadcrumbs, rating, review count;
  - a field with no catalogue concept: product.
  Editable on the Fields page.
- **Axes** are contract columns of their own kind (`axis`): Colour, Size,
  Length, Material… They are added when a website's proof pages reveal them
  (§3) and can be renamed. One axis column can be fed by differently named
  sources on different websites (Nike's `color`, another site's `colour`) when
  the customer maps them to it.
- Stored on the dataset's schema like fields today; existing fields read as
  `level: product` until set otherwise, so every existing project and website
  is unchanged.

## 3. Setup on a website — the Variants step

Shown on the Verification tab only when the project wants variants, after the
fields. It inspects the proof pages' captures (free, no new page loads) and
reports per proof product what it found:

| Method | How it is recognised | Example wording |
|---|---|---|
| **Listed in the page data** | JSON-LD `ProductGroup.hasVariant[]`; a `Product.offers[]` list with per-entry SKU/price; an API response with a `variants[]`-like list (array of objects sharing keys, one per option, with a SKU or price each) | "Listed in the page data: 4 colours on product 1, 2 on product 2, none on product 3" |
| **Linked as separate pages** | a group of links on the product page, near a variant-like control (swatches, option buttons), each to a same-site product URL that differs by a variant parameter or slug, whose label names an option | "Linked as separate pages: 4 colour links per product" |
| **Only in a picker on the page** | option controls (select, radio, swatch buttons) whose choices appear in neither the data nor as links | "Only in a picker on the page: sizes — not collected in this version" |

The customer confirms one method and the axes it found (mapping each to a
project axis column, or adding a new one), or chooses **No variants on this
website**. The choice is stored on the website with its certified fields.

A website whose proof products show no variants can still be set to a method
(variants may exist elsewhere on the site); it then needs at least one proof
product with variants to certify (§4). Pages four to six can be used to add
one.

## 4. Verification and certification

### 4.1 On the tab

Under each proof product, a **Variants** row expands to that product's
variants, pre-filled by the chosen method:
- *List*: each entry's axis values and variant fields read from the list.
- *Links*: each variant link with its label (link text, `title`, `aria-label`
  or an inner image's `alt`) as the axis value.

Per proof product that has variants, the customer:
1. confirms the **count and the axis values** — one ✓ ("4 colours: Black/Red,
   Taxi, … — right?"); if wrong, marks the variant control on the screenshot
   and the list or links are searched again near it;
2. **spot-checks one variant**:
   - *List*: ticks its variant fields in the variant row, with the same
     suggestions, one-click ✓ and Accept as fields today;
   - *Links*: the first variant page is captured (as a proof-page capture)
     and must pass the website's certified fields automatically; the
     customer sees pass or fail.

Proof products without variants show "no variants" and need nothing.

### 4.2 What certification proves

The same engine and rules as fields (spec 2026-09-29: confirmed paths first,
the weak-field fit rule, API first among the rest):

- **List method:**
  - a **list path** (structured path or XPath to a repeated element) that
    yields the confirmed count on every proof product with variants, and
    nothing (or an empty list) on those without;
  - per variant field and axis, an **entry path** relative to one entry
    (`offers.price`, `color`, `mpn`) that reads the spot-checked variant's
    confirmed value and a valid value of the field's type on every other
    entry of every proof product.
- **Links method:** a **link collector** — a structured path or an XPath over
  the product page's links — that yields exactly the confirmed variant links
  on every proof product with variants. Variant pages need no new paths: the
  spot-checked one must pass the website's certified fields.
- **Failure** is reported, never guessed: "found 3 of 4 colours on product 2",
  "price missing on 2 of 4 entries". The customer re-marks, or chooses
  No variants on this website.
- Verify costs nothing new for the list method, and one extra free page
  capture per proof product for the links method. No AI.
- Variant certification is part of the website's certification: Extract stays
  locked until it passes, when the project wants variants and the website has
  a method.

## 5. Extraction at scale

Per product page, after the product's certified fields are extracted:

- **List method:** the list path gives N entries; each entry becomes a row:
  product-level fields from the page, variant-level fields and axes from the
  entry paths. A variant-level field the entries do not provide falls back to
  the product page's certified value on every row, and the column is marked
  as coming from the product. Same single page load as today.
- **Links method:** the link collector yields the variant URLs; each is
  queued as a page of the same run, extracted with the website's certified
  fields, and given its axis value from the link's label. One page load per
  variant.
  - The website's item budget counts products; a product's variant pages
    come with it, up to the run's hard limit of 5,000 pages, and a product's
    variants are queued together, so the limit never cuts a product's
    variants halfway. (Changed 2026-10-05, Marko: option 1 after the live
    extraction.)
  - A variant URL also found on the listing is extracted once, as a variant
    of its product.
- **No variants on a product:** one row with the product's own values; axis
  cells empty; counted as "products without variants".
- **Never stops to ask.** Everything that does not fit the website's method
  is counted and reported.

### 5.1 Rows and identity

- Every row carries `product_key` (the product page URL) and, for a variant,
  `variant_key`: the entry's SKU or GTIN, else its own URL, else its axis
  values joined ("Black/Red · 10C").
- Re-runs, backfills and drift match variants on `variant_key` within
  `product_key`.
- Storage: rows stay in `extractions.data` (already an array per captured
  page with `rowCount`); a product page's capture holds all its variant rows
  for the list method; for the links method each variant page's capture holds
  its row, carrying its `product_key`.

### 5.2 Export

- *One row per variant*: CSV / XLSX / JSON with columns product fields → axis
  columns → variant fields, plus `product_key` and `variant_key`.
- *One row per product, variants listed inside*: JSON with a `variants` array
  on the product row; CSV / XLSX repeat the product's columns with variants
  joined in one cell per field (documented as lossy).
- *Ignore variants*: today's shape.

### 5.3 The run page

Reports variants extracted, products with and without variants, and products
whose variants came back partial (list found but an entry path empty for some
entries; a variant link that failed to load). Partial variants feed drift per
variant field, as fields do today.

## 6. Not in this version

- **Collecting picker-only variants** (clicking each option and reading the
  page): designed in — setup detects and names it — built later.
- Variants on listing pages.
- Per-variant stock counts behind "add to cart" or store-availability calls.
- Matching the same variant across websites.
- Jev (parked).

## 7. Testing

- **Unit (scraper):** variant detection on the Nike fixture (`ProductGroup`,
  2 colours), an `offers[]` list fixture, and a links fixture (swatch links
  with labels); list-path and entry-path certification, including a product
  without variants and an entry missing a field; the link collector on three
  proof pages with different counts; `variant_key` choice.
- **Unit (app):** field levels by concept and override; the Variants row's
  states (count confirm, spot-check, partial); export shapes.
- **API:** the project setting, field levels and axes round-trip; a website's
  method and certification; Extract gated on variant certification.
- **Smoke:** a local fixture site with a listing, three products with colour
  links and JSON-LD `hasVariant`; set variants on, confirm counts, spot-check,
  verify (keyless), run a small extract, export one row per variant.
- **Live, free** (keyless :4100, throwaway identity): one site of each method
  (a `hasVariant` site, a variant-links site); record variant counts, rows,
  and time per product.

## 8. Order of work (one plan each)

1. **Contract and detection:** project setting, field levels, axes; variant
   detection over captures (list, links, picker); the Variants step on the
   tab showing what was found.
2. **Verification and certification:** the Variants row, count confirm and
   spot-check; list path, entry paths, link collector; Extract gating.
3. **Extraction, export and reporting:** variant rows at scale for both
   methods, identity, budget, export shapes, the run page counts.

## 9. Decisions to confirm

1. The project setting's default for **new** projects is *Ignore variants*
   until the customer turns variants on, and *One row per variant* is the
   default **once** they do.
2. The *one row per product* shape in CSV/XLSX joins variant values in one
   cell per field (lossy); JSON keeps the full list.
3. A variant URL that is also a listing product is extracted once, as a
   variant.
