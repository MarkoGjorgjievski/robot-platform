# Jev in shadow: a row check and a page-type gate — design

**Date:** 2026-09-28. **Status:** **parked — not scheduled.** Marko,
2026-09-28: "we will not implement Jev for now, maybe in the future." This
records the design so it can be picked up without redoing the research.
Evidence and sources: `2026-09-28-jev-research-update.md` (and the earlier
`2026-09-17-typesafe-evaluation-note.md`).

## 1. Why, and why shadow

Two decisions the platform cannot afford to make today, both judgments rather
than extractions:

1. **Is this extracted row right?** Drift today counts only *empty* cells
   (`flagDrift`, ≥ 20 % empty over ≥ 5 rows). A certified path that starts
   reading the wrong element — a shipping price, a related product's title —
   goes unnoticed while it returns something.
2. **Is this page what we wanted?** A captcha, a 404, a consent wall or a
   listing captured where a product page was expected is caught today only by
   heuristics (`captureProblem`).

Jev (TypeSafe) answers typed questions with calibrated probabilities for
about $0.00003 a question. The best published evidence is in our domain:
Zyte (2026-09-21) used it as a per-record check on a scraped catalogue — 46
of 59 wrong descriptions caught with no false alarms — and as a page-type
switch (a 404 scored 0.04 for "is a book").

**Shadow** means Jev labels and today's path decides. Nothing the customer
sees, nothing extracted, nothing certified changes until the measured numbers
on our own data say a check earns a place. The research's risks make this
non-negotiable: page text can move its answers (0.09 %–61 % of answers flipped
across studies; 1.8 % of attacks in the one paper), answers vary between
identical calls, and the service is two weeks old.

## 2. The two checks

### 2.1 Row check (after extraction)

For each extracted row, one request with one Noul per field, e.g.:

- "Is `row.title` the name of the product this page sells?"
- "Is `row.price` the price a customer pays for this product now — not a
  shipping, unit, instalment or crossed-out price?"
- "Does `row.description` describe the product named in `row.title`?"

State: the row's values, the page URL, the page `<title>` and `og:title` —
nothing else (irrelevant state degrades answers). Questions come from the
field's catalogue concept; a custom field without one gets a generic "Is
`row.<field>` a plausible `<name>` for the product on this page?" Numbers,
dates and counts are never asked (documented weak spots); code checks those.

### 2.2 Page-type gate (at capture)

One Choice over {product page, listing page, blocked or captcha, not found,
consent or cookie wall, login wall, other}, plus "none of these" semantics
through `other`. State: HTTP status, final URL, title, meta description, and
the first 40 lines of visible text from the box map. Anything a status code or
a rule answers (a 404 status, a redirect to a known login path) is decided in
code and never asked.

## 3. How it runs

- **One module**, `packages/api/src/jev/` — the only place that talks to
  TypeSafe:
  - model pinned to `jev-1.13.0` (never `jev-latest`);
  - the key in `TYPESAFE_API_KEY`; absent key → the checks are off;
  - timeout 2 s, no retries in the extraction path; any error, timeout or 429
    → the check is skipped and logged (**fail open**: the pipeline carries on
    exactly as today);
  - one request per row / per page, all questions together (shared state).
- **Where it is called:** after a certified run's rows are written (the row
  check, off the run's critical path, as a follow-up job over the run's
  extractions) and after each capture (the gate, same job pattern as the
  proof-page capture). Neither blocks or changes a run.
- **A decisions log**, new table `jev_decisions`: `id`, `kind` (`row` |
  `page`), `source_id`, `run_id` / `capture_id`, `question_id`, `answer`
  (probability or chosen option + distribution), `model`, `latency_ms`,
  `cost_usd`, `created_at`, and `truth` (nullable, filled later — §4).
- **A budget cap** per run (e.g. $0.05 ≈ 1,500 rows) so a large run cannot
  surprise anyone; above it the rest is skipped and the log says so.

## 4. Measuring it — where the truth comes from

The shadow is only worth running because we already hold labels:

- **Proof pages.** Every verified website has three to six pages with
  customer-accepted values and certified paths: rows known to be right, and
  pages known to be product pages.
- **Known wrong values.** Take a verified row and swap one field with another
  product's or another field's value (the Zyte method): rows known to be
  wrong, generated in code.
- **Known bad pages.** Tier 1 fixtures and saved captures of blocked, 404 and
  consent pages from past runs; captures `captureProblem` already flagged.
- **Later truth.** A drift check (spec 2026-09-28 Part B) that finds a field
  moved or changed labels the rows extracted before it.

Report per question: precision and recall at a few thresholds kept outside
0.4–0.6; calibration (predicted vs observed rate per bucket); the flip rate
across three identical calls on a sample; cost and latency per run.

## 5. When it could leave shadow

Only with Marko's decision, and only per check, when on our data:

- the row check flags ≥ 70 % of known-wrong values with ≤ 1 % false alarms on
  known-right rows, stable across repeated calls; then it may **add a warning**
  on the run page ("12 rows look wrong for Price") — never change or drop a
  value, never block Extract;
- the page gate agrees with the known labels on ≥ 95 % of pages; then it may
  **mark** a capture as not a product page for the customer to see — never
  skip a site or delete data on Jev's word alone.

## 6. Not in this design

- Popup/consent button choice, crawl and pagination choices, replacing the
  paid Claude path-finding step, cross-website matching, normalisation — the
  research ranks them after these two; each would get its own shadow first.
- Anything on the Verification tab's own decisions (Part A's agreement rule is
  code and measured by customers' ticks).
- Images: Jev reads text only.

## 7. Cost, for scale

At the September prices ($0.042 per million input tokens, output free) and
about 700 tokens of state per row, 10,000 rows cost about $0.30; a page gate
over 10,000 captures at about 1,000 tokens each, about $0.42.
