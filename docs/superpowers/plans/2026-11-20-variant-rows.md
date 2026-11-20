# Variant rows in the proof table — plan (2026-11-20)

Marko, 2026-11-20: a product's variants should be rows of the proof table, checked like any product, not a
separate sideways table under it. Up to **two variants per product** are checked; the rest are said to be read
the same way.

## What the customer sees

1. **Detected.** Under a product's row, one line:
   `6 colours detected: Tibbleby yellow, Sulviken blue/beige, … · [Accept] · Not right?`
2. **Accept.** The variant column (e.g. Colour) is added to the table (created on the project if it is new), and
   the product's row becomes **two variant rows**, each with its own Colour value, its own screenshot and its own
   values. They are checked, accepted and fixed like any product.
3. **The others.** Under the two rows, one muted line:
   `The others (Sulviken blue/beige, Tommaboda brown-red, …) are read the same way.`
   "Check another" swaps which variant is checked.
4. **Not right?** opens what exists today, in a popover: another list, mark the variant buttons on the
   screenshot, or "No variants on this product".
5. The separate Variants table under the proof table, and the Variants step box, go away; the method/column
   choice moves into Accept (with today's suggestion as the default) and into "Not right?".

Values on a variant row are **never copied** from the product row. Product-level fields (same for every variant)
are read from the same page and show the same value; variant-level fields show what that variant's page or list
entry reads. A field that really differs per variant but is set to "Same for every variant" is the customer's
level setting on the Fields page; the Status row says so when the two variant rows disagree on it.

## Today (research, 2026-11-20)

- Two methods. **list**: variants are entries in the product page's data (JSON-LD `hasVariant`/`offers[]`, an
  API `variants[]`); no extra page. **links**: each variant is its own page (swatch links).
- The answer per proof page is `verificationSet.variants[url]` (`count`, `labels`, `list` | `links`, one `spot`).
- **list** spot: one entry; the customer confirms each variant-level field's value on it; Verify certifies one
  entry path per field (`certifyVariantList`).
- **links** spot: one variant page (picked automatically, not the product page), captured; Verify only checks
  that each field *reads something* there — no expected values (`variant-check.ts:103-128`).
- Runs: list rows from the entries (`buildVariantRows`); links pages queued as their own run items and read with
  the product's certified paths.
- Proof pages: 3–6 URLs (`VERIFY_URL_MIN/MAX`); a variant page is not a proof page.
- GTIN's concept is `sku`, already "Differs per variant" by default (no change needed).

## Design

**The two checked variants are the product page itself and today's one checked variant.** A product page *is* one
variant (the one it shows), and it is already a verified proof page; today's `spot` is a second variant (links:
another variant's page; list: another entry in the page's data). So the stored answer does not change shape, the
six-product limit, the proof-page rules, the field hashes and the coverage check stay as they are, and variant
rows never count as proof products.

- **Row 1** = the proof product's row, labelled with its own variant (the link whose href is the page, or the
  entry the page shows).
- **Row 2** = the spot: links → the spot page's screenshot and values; list → the product page's screenshot and the
  entry's values for variant-level fields.
- **Verify, links:** the spot page is read with the certified paths and every value confirmed there
  (`spot.expected`) must match, like a proof page (done 2026-11-20: "Price on the Red page of product 1 reads
  12.00, not 999.99"); a field with nothing confirmed keeps today's "reads something" check.
- **Verify, list:** unchanged (`certifyVariantList` already checks the spot entry's confirmed values).
- **Hash:** `variantHash` covers the answers, so a changed row 2 re-verifies variants only.

## Steps

1. ~~Server: links spot compares confirmed values~~ (done, `variant-check.ts`, test in `variant-check.test.ts`).
2. **App model.** Pure: per product, the variant rows (row 1 label; row 2 label, url, values from
   `spot.expected` and suggestions); a row-2 cell answer writes `spot.expected[key]`. Tested.
3. **App table.** Row 2 under its product (indented), the axis column after Link, screenshot popover on the
   spot page (links) or the product page (list), Accept/Fix per cell. The detected line with Accept /
   Not right? / the others line. Remove the separate Variants table and the Variants step box.
4. **App table.** Variant rows under their product (indented, axis column after Link), screenshot popover on the
   variant's page (links) or the product page (list), Accept/Fix per cell, Status row unchanged. The detected
   line with Accept / Not right? / the others line. Remove `VariantsRow` and `VariantsStep` from the tab.
4. **Accept.** One click: `setVariantSetup` with the suggested method and column, then `confirmAnswer` for every
   product with two spots. The column is, in order: the one this website's setup already maps to (while it
   exists); a project column with the same name or **a name that means the same** (Marko 2026-11-20: colour =
   color = colours = farbe…, size = sizes = taille…, a small fixed list in `variants-view.ts`, case-insensitive);
   else a new column ("Colour", or "Colour (variant)" when a field already has that name). "Not right?" still
   lets the customer pick any column.
5. **Gates.** Full test run and type-check of app, api, scraper; route smoke against an isolated pair; a free
   live check on a links website and a list website (screenshots looked at).

## Not in this plan

- Checking more than two variants, or every variant.
- Variant rows in the Extract tab's "first 3 products" and in the checked-products table.
- Picker-only variants (selects with no links or data list) — still not collected.
