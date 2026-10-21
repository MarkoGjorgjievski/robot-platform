# Jev's agreement, read 2026-10-21

Spec 2026-10-16 §9 asks: once about 20 websites are verified with Jev readings, should Jev's pick
become the row's suggestion for ambiguous fields, and its variant pick `[page]`'s fallback?
Readings: 89 on 21 websites (24 from the 2026-10-16 live check, 65 from the 2026-10-21 re-verify,
$0.019). Report: `pnpm --filter @robot/api exec tsx src/jev-agreement.ts` (read-only).

## Numbers

| Jev's confidence | Agrees with the verified value |
|---|---|
| 0.9 and above | 72 of 84 (86 %) |
| 0.8–0.9 | 11 of 23 (48 %) |
| 0.6–0.8 | 5 of 14 (36 %) |
| below 0.6 | 8 of 25 (32 %) |

| Field | Agrees |
|---|---|
| Brand | 9 of 12 |
| Title | 42 of 60 |
| SKU | 25 of 35 |
| Price | 9 of 13 |
| Rating | 10 of 23 |
| Average rating | 1 of 3 |

Variant: 5 of 36 — but almost every "disagreement" is Jev answering "none" where `[page]` also reads
nothing (no variant in the address), so this number measures nothing yet.

## What the 81 disagreements are

- **The comparison, not Jev (about half):** ratings that differ in the third decimal (4.7645 vs
  4.7610 — the report compares raw numbers, not rounded); `&amp;` against `&`; titles where Jev reads
  the page heading in full ("FITS EVERYBODY T-SHIRT BRA | ONYX") and the customer verified a short
  form ("t-shirt bra"); "Sigma Beauty" against "SigmaBeauty".
- **Jev reads a different identifier:** SKU as the barcode (810171783127) where the customer verified
  the style code (A0456); Everlane's size (L vs XS).
- **The page changed:** Colourpop's "Mega Palette" (seen 2026-10-16 too).
- **Jev may be right:** Ruggable prices — Jev reads the sale price on the screenshot, the stored value
  is the list price ("not certified" on those rows).

## Recommendation (decision is Marko's)

**Do not apply Jev's pick yet.** At 0.9 and above it agrees 86 % of the time, and most of the rest is
how we compare. Next, cheaply: make the report compare like Verify does (rounding, entities,
title containment), drop `og:title` long forms as Title candidates and trim variant labels (both
follow-ups from 2026-10-16), then read again. If high-confidence agreement is then well above 90 %,
apply Jev's pick for ambiguous Price only (the field where a wrong value costs most and the
screenshot is decisive), behind a flag, and keep everything else in shadow.
