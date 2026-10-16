# Jev at Verify, in shadow — design

**Status:** spec written 2026-10-16 at Marko's request ("yes" to writing the spec for Jev at Verify
in shadow), after two measured experiments; not yet planned. Builds on
`2026-10-15-jev-images-experiment.md` and its results
(`docs/testing/results/2026-10-15-jev-images/report.md`, `…/2026-10-15-jev-variants/report.md`),
`2026-10-14-variant-from-the-address-design.md` (`[page]`), and the parked
`2026-09-28-jev-shadow-checks-design.md` (whose per-row check stays a separate, later spec).

## 1. The problem

Verify fails, or certifies the wrong thing, where the page offers several plausible values and only
a reader can tell which one the customer means, and where the page's selected variant is not named
in its address:

| Case | What goes wrong today | Jev, measured 2026-10-15 |
|---|---|---|
| Ruggable price | the typed list price 499.00 matches no data; the sale price 374.25 sits in the 6'x9' entry | picked the sale price, 3 of 3 |
| Gymshark brand | the tagline "Gymshark \| We Do Gym" certified as the Brand | picked "Gymshark", 3 of 3 |
| Colourpop title | the shade name certified as the Title | picked the heading, 9 of 9 |
| Selected variant | `[page]` is right on 17 of 28 pages: default selections, no variant list, two-option addresses | 28 of 28 |

Jev reads the screenshot, chooses among values our code offers, costs ≈ $0.0002 per page with every
question in one call, answers in ≈ 0.6 s, and never changed an answer when asked again.

## 2. What changes, in one paragraph

After a proof page's capture is stored, a **Jev reading** runs in the background for that page: one
call with the screenshot in its state, a Choice per field whose candidates are ambiguous, and a
Choice for the selected variant when the page data carries a variant list. The answers are stored
and **shown, never applied**: beside a row the Verification tab says what Jev reads when it differs
from the row's suggestion or the customer's answer ("Jev reads 374.25 as the price a buyer pays on
product 1"), and the cell detail bar shows Jev's pick and its probability. Nothing Jev says changes
an answer, a suggestion, a certification, a run or a cost the customer pays. Every reading is
measured against what the customer finally verifies, so we learn when Jev may become the suggestion
(§9). The whole step is off unless the api-server has a TypeSafe key and the switch is on.

## 3. When a reading runs (`@robot/api`, `verify/jev-reading.ts`)

- **Trigger:** a proof-page capture reaches `ok` (`runProofPageCapture`'s success path), and again
  when the website's binding changes which fields exist (a field added to the project). One reading
  per capture; a capture already read is not read again.
- **Switch:** `JEV_SHADOW=1` in the api-server's environment **and** `TYPESAFE_API_KEY` set. Either
  missing → no reading, no error, nothing shown. No per-website setting in this spec.
- **Budget:** at most `JEV_DAILY_READINGS` readings per day across the api-server, default **2,000**
  (≈ $0.40). A reading happens only per proof-page capture (3–6 per Verify), so 2,000 covers
  roughly 330–650 websites verified a day; raise the setting in `.env` when needed, no code change.
  Past it, readings wait for the next day. Each reading's `input_tokens` and cost are stored.
- **Isolation:** runs after the capture is stored, in its own async job (like the coverage check),
  with a 10 s timeout and one retry; a failure stores `{ status: 'failed', error }` and shows nothing.
  A Verify click never waits for a reading.

## 4. What is asked

One `systemOne` call per proof page, model `jev-1.14.0`, header `TypeSafe-Danger-Zone-Images: true`.

- **State:** `{ screenshot, title, candidates }` — the viewport tile (1440 × 1000; below the fold →
  a 1440 × 1000 crop centred on the topmost candidate's box), the page `<title>`, and every
  question's candidates as verbatim `{ id, value }`. **Never free page text** (page text can steer
  the model). The screenshot is referenced only from state; questions say "the screenshot" in words
  (the image is billed once per call, measured).
- **Field questions** — for each contract field whose type is `text`, `money` or `number`, when the
  page offers **two or more distinct candidate values** (after normalising for the field's type):
  a Choice "Which of these is the `<field name>` of the product shown — `<field description>`?",
  options = the candidates (≤ 30) plus `none`. The candidate builder is the experiment's
  `candidatesFor`, moved to `@robot/scraper` (`verify/jev-candidates.ts`): structured leaves that fit
  the field's concept, `og:site_name`/`product:brand` for a brand, the visible `h1` and `og:title`
  for a name, visible money-shaped boxes near the heading for a price. A field with one candidate,
  or none, is not asked. Booleans, images, urls, dates and lists are not asked in this spec.
- **Variant question** — when the capture's page data carries a variant list (`variant-detect`'s
  entries: JSON-LD `hasVariant`/`offers[]`, an API list), a Choice "Which variant is selected on the
  screenshot?", options = each entry labelled by its verbatim option values and name (never prices,
  ≤ 40, keeping the `[page]` match and a spread of the rest) plus `none shown`. When the page data
  has no list, not asked (the store-JSON fallback the experiment used for Glossier is out of scope).
- **Description for the price:** the question's instructions add "the price a buyer pays now for the
  selected variant" when the field's concept is `price`.

## 5. Storage (`@robot/db`, migration 0018)

Table `jev_readings`: `id`, `source_id` (fk, cascade), `capture_id` (unique), `status`
(`running|done|failed`), `model`, `answers jsonb`, `input_tokens int`, `cost_usd numeric(10,6)`,
`error text`, `created_at`. `answers` =
`{ fields: Record<fieldKey, { candidates: Array<{id,value,source}>, pick: id | 'none', p: number }>,
variant?: { entries: Array<{ id, label, entryIndex }>, pick: id | 'none', p: number, pageMatch: id | null } }`
where `pageMatch` is what `[page]` picked over the same list (for §9's comparison).

## 6. What the Verification tab shows (`@robot/app`)

`sources.suggestMarks` (which already returns `headingText`, `pageText`, `pageVariant` per url)
returns `jev` per url: the reading's `answers` when `done`, else `null`. The model mirrors the shape
locally (`lib/site/jev-view.ts`, pure). Nothing renders when `jev` is null.

- **Row note, field:** when Jev's pick has p ≥ 0.6 and its value differs (by `sameValue` for the
  type) from the row's live suggestion on that product, or from the customer's answer when there is
  one: one muted line in the status column, `Jev reads 374.25 as the Price on product 1`. One line
  per row (the lowest product number that differs); never a status kind, a badge, a gate reason.
- **Row note, variant:** on the Variants row (when variants are on) or, when variants are off, under
  the fields whose certified or suggested path has `[page]` or a fixed index on a variant list: when
  Jev's variant pick (p ≥ 0.6) differs from `pageMatch`, `Jev reads the selected variant as
  6'x9' on product 1`.
- **Cell detail bar:** for the selected cell, `Jev: 374.25 (0.98)` or `Jev: none of these (0.71)`
  in muted text beside the value; `Jev: not read` when there is no reading. Read-only.
- **Copy** is §8's table; every line starts with "Jev reads" so a customer can tell it from our own
  checks.

## 7. Measurement (the point of shadow)

When a Verify run completes, for every proof page with a `done` reading, record per asked field:
Jev's pick, the customer's final expected value, whether they match (`sameValue`), and whether the
field certified; per variant question: Jev's pick, `pageMatch`, and the certified `[page]` cell's
entry. Stored as `verify_agreement jsonb` on the `source_verifications` row (one object, written by
`runSourceVerification` after results). A CLI `pnpm --filter @robot/api exec tsx src/jev-agreement.ts`
reports, across websites: agreement rate by field concept, by probability bucket, and the cases
where the customer and Jev differ, linked to the proof page.

## 8. Copy table

| where | reads |
|---|---|
| row note, field | Jev reads 374.25 as the Price on product 1 |
| row note, variant | Jev reads the selected variant as 6'x9' on product 1 |
| cell detail bar | Jev: 374.25 (0.98) · Jev: none of these (0.71) · Jev: not read |
| ops website page, per field | Jev agreed on 5 of 6 proof pages |

## 9. When it could leave shadow (not in this spec)

After at least 20 websites verified with readings: if agreement on field picks with p ≥ 0.8 is at
least 95% and no customer-confirmed value was ever contradicted at p ≥ 0.9, a later spec makes Jev's
pick the row's suggestion for ambiguous fields (still accepted by the customer). The variant pick
becomes `[page]`'s fallback when `[page]` resolves to nothing, under the same bar.

## 10. Safety properties the tests must pin

1. With `JEV_SHADOW` unset or no key, no reading runs, no request is sent, nothing renders.
2. A reading never changes an answer, a suggestion, a certification, `fieldHash`, a run row, a
   verification's `cost_usd` or a gate; the Verify button never waits for it.
3. Only the screenshot, the title and verbatim candidate values are sent; never page text.
4. The screenshot appears once per request, in state; no question repeats its reference.
5. A failed or timed-out reading stores `failed` and renders nothing; the daily budget is enforced
   before a request is sent.
6. A field with fewer than two distinct candidates is not asked; booleans/images/urls/dates/lists
   are never asked.
7. Row notes appear only at p ≥ 0.6 and only when Jev differs from the suggestion or answer; at most
   one per row.

## 11. Testing

- **Unit, scraper:** `jevCandidates` on fixtures copied from the experiment (Ruggable price,
  Gymshark brand, Colourpop title); distinctness after normalisation; caps.
- **Unit, api:** `buildJevRequest` (state shape, one image, no page text, question set, variant
  options capped with the `[page]` match kept); the switch and budget; `runJevReading` with a fake
  client (done, failed, timeout); agreement recording.
- **Unit, app:** `jevNotes(board, live, jevByUrl)` → the row notes; the detail-bar text.
- **Route smoke:** a seeded `jev_readings` row on the smoke website's product 1 reading Price
  differently from the suggestion → the row note and the detail-bar text; no seeded reading → no note.
- **Live, small:** with `JEV_SHADOW=1`, re-capture the proof pages of Ruggable, Gymshark, Colourpop
  and Kith in the campaign project and read the notes; cost recorded (≈ $0.01).

## 12. Not in this spec

- Applying Jev's pick (§9 is a later spec); the per-row check after a run; replacing the judge.
- Booleans (stock), images, descriptions (the experiment showed hidden sections defeat a crop).
- A per-website or per-org switch; showing Jev to staff only.
- The store-JSON variant list fallback (Glossier).
- Opening collapsed sections before capture.

## 13. Decisions (recommended, 2026-10-16)

1. Shadow only: shown, measured, never applied.
2. One call per proof page, image once in state; a daily budget from `JEV_DAILY_READINGS`, default 2,000.
3. Ambiguity = two or more distinct candidates; only text, money and number fields.
4. Notes only when Jev differs, at p ≥ 0.6, one per row, prefixed "Jev reads".
5. A global switch (`JEV_SHADOW`) rather than per website, for now.
