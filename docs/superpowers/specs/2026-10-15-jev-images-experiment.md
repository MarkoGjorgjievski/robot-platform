# Jev with images — an experiment, not a feature

**Status:** plan written 2026-10-15 for Marko's review; nothing sent to TypeSafe yet. Builds on
`2026-09-17-typesafe-evaluation-note.md` and the parked `2026-09-28-jev-shadow-checks-design.md`.
Jev 1.14 (announced 2026-10-14) accepts images as a preview ("Images and Box questions aren't yet up
to our standards to call ready for production"); this measures whether that is good enough for us.

## 1. The question

Can Jev, looking at a screenshot, tell which of the page's candidate values a customer means, and
whether a stored value is what the page shows — the judgments text matching cannot make (list vs
sale price, tagline vs brand, shade name vs product name, the selected variant's stock)? And how
often is it wrong on ordinary values?

Nothing in the product changes. The experiment is one CLI, its results file and this note.

## 2. What is sent

- **Model** `jev-1.14.0`, header `TypeSafe-Danger-Zone-Images: true`, SDK `@typesafe-ai/sdk`
  (added to `@robot/api` as a dev dependency), key `TYPESAFE_API_KEY` from `.env`.
- **Image:** one PNG per question, inside the limits (each side 256–1568 px, ≤ 2,458,624 px):
  the viewport tile of a fresh capture (1440 × ~1000) when the value's element is in it, else a
  1440 × 1000 crop centred on the element's box from the capture's box map.
- **State:** the page title, the field's name and description, and the candidates as verbatim
  `{ id, value }` items — never free text from the page beyond the title (page text can steer the
  model; the September research).
- **Questions**, one per field per page:
  - **Choice** (selection): "Which candidate is the `<field>` of the product shown — `<field
    description>`?" Options: each candidate, plus `none`. Ruggable price: "the price a buyer pays
    now for the selected size".
  - **Noul** (check): "Does the screenshot show `<value>` as this product's `<field>`?"
- **Pages are captured by our own Chromium**, free, one at a time, under the per-host pacing.

## 3. The two sets

**A. The hard cases (the reason to do this).** Fresh captures, the candidates found by our own
structured search plus the marked element:

| Site | Field | Question | Truth |
|---|---|---|---|
| Ruggable, 3 proof pages | Price | Choice: list price vs sale price vs other sizes' prices | the sale price shown for 6'x9' |
| Gymshark, 3 proof pages | Brand | Choice: "Gymshark" vs "Gymshark \| We Do Gym" | Gymshark |
| Colourpop, ~9 products | Title | Choice: JSON-LD name (shade) vs the page heading | the heading |
| Skullcandy, 3 `?variant=` products | In stock | Noul: is the selected colour in stock? | what the page shows |
| Batch C's 10 real errors | rating, description, SKU | Noul on the stored (wrong) value | no |
| Batch C, 10 correct values the shown flag flagged (Ikea, Lacoste) | as stored | Noul | yes |

**B. A sample against the judge.** 300 values from batch C's five judged runs (Sigma Beauty,
Lacoste, Puma, Not On The High Street, Ikea), stratified: every judged-wrong value, the rest
correct. Fresh capture; a value is scored only if the fresh page still carries it in its text or
data (prices drift), otherwise it is reported as "changed since". Noul per value, compared with
the stored judge verdict and the hand count of real errors in
`docs/testing/2026-10-11-campaign-2.md`.

## 4. What is measured

- Set A: right / wrong per case, with Jev's probability.
- Set B: agreement with the judge; real errors caught (of those still on the page); correct values
  called wrong (false alarms); a calibration table (answers bucketed by probability vs how often
  they were right).
- Cost from the responses' `usage.input_tokens` × $0.042 per million; tokens per image recorded,
  since TypeSafe has not published how images are counted.
- Repeatability: Set A asked three times; answers that flip are counted.

## 5. Cost and the cap

Wes Bos measured an 850 × 850 image question at $0.0000969 (≈ 2,300 tokens). A 1440 × 1000 tile
should be ≈ 4,500 tokens ≈ $0.0002. Set A ≈ 60 questions × 3, set B ≈ 300: about 500 questions,
**≈ $0.10–0.30**. The CLI stops at a hard cap of **$2.00** computed from the reported usage, and at
600 questions, whichever comes first. Marko added $5.

## 6. Files

- `packages/api/src/jev-images-run.ts` (CLI, like `judge-run.ts`: `--set a|b`, `--max-usd`,
  `--max-questions`, `--dry-run` prints the requests without sending).
- `packages/api/package.json` (dev dependency `@typesafe-ai/sdk`).
- Results: `docs/testing/results/2026-10-15-jev-images/` (a report with the tables above, the
  crops used, the raw answers as JSON).

## 7. What would follow

- **Set A mostly right, stable across repeats:** a spec for a Verify ambiguity step (one Choice per
  ambiguous field, the answer becomes a confirmed path; the customer still sees and can override).
- **Set B: high agreement, few false alarms:** revise the parked shadow-checks design around images
  as the per-row check that replaces the noisy text "shown on the page" flag.
- **Either weak:** record the numbers and leave Jev parked until the image features leave preview.
