# TypeSafe (System One / Jev) — evaluation note, a possible future improvement

**Status:** read and assessed 2026-09-17, nothing built, no decision. Not a
priority: AI is a small part of our cost (see "What it would and would not
change"). Revisit when second-layout learning wants automatic discovery, or
when a per-row quality check becomes worth having.

## What it is

TypeSafe (docs.typesafe.ai) sells a class of small models it calls System One;
the current one is Jev 1.13 (`jev-1.13.0`, alias `jev-latest`). It does not
generate text or reason. Given some state (text or JSON) and a question, it
returns a typed answer with probabilities. Three question types: Choice (one of
a defined set, with a distribution), Noul (probability that a condition holds),
Score (position along described ordered levels). Code owns the workflow; the
model supplies the judgment.

| | From their docs, 2026-09-17 |
|---|---|
| Price | $0.042 per million input tokens, output free |
| Limits | 64k tokens per request; 32k for state plus the longest question |
| Rate | 1,200 requests/min, 250k tokens/s, "adjusting dynamically" |
| Input | text and JSON only — no images |
| SDK | `@typesafe-ai/sdk`, Node 20+, ESM; key in `TYPESAFE_API_KEY` from console.typesafe.ai |
| Not stated | latency, free tier, data retention (legal page not read) |

Their own limitations page (`model-jaggedness/jev-1.13`): unreliable at
counting, arithmetic and date ordering; reads wording literally; too much
irrelevant state degrades accuracy; can be steered by instructions inside the
state. Calibration is their claim and is a property of groups of predictions,
not of one answer — it needs checking on our data.

A Claude Code skill is installed on Marko's machine (`typesafe:typesafe-ai`);
it points at the live docs as the source of truth, starting from
`https://docs.typesafe.ai/llms.txt`. Two cookbooks are in our domain:
pre-parsed value extraction (code finds candidates, a Choice selects one, the
value is copied verbatim) and the SDE cascade (cheap extract, per-field Noul
verification, escalate above a threshold; benchmarked on scrapegraphai prompts).

## Where it fits us

The pattern that matches our rules is **select, do not generate**: our code
already flattens JSON-LD, API bodies and DOM text into candidate (path, value)
pairs; the model picks which candidate is the field; the value is copied from
the page. It cannot invent a value, which is our "every value must corroborate
against the rendered page" rule by construction.

1. **Second-layout learning, automatic discovery** (steps 2–3 of
   `2026-09-11-second-layout-learning-design.md`). Finding a field on a missed
   page with no expected value is a Choice among candidates with a none option.
   The customer still confirms before a path certifies.
2. **The paid steps of the analysis chain.** "Claude reads raw API JSON and
   finds the path" is a choice among flattened paths. So is the proof sheet's
   ambiguous case (a value present in several places).
3. **A cheap quality check on every row.** A Noul per field, e.g. "does this
   title match the product in the URL" — the wrong-but-self-consistent page
   (Barnes & Noble, 2026-08-19). Feeds the drift flag only; never writes a cell.

## Where it does not

- It cannot write an XPath or a path; it can only choose among candidates we
  enumerate, and it cannot choose one we left out.
- The 32k state limit means candidates are pre-filtered in code (an Ikea
  product page is 1.3M characters of HTML).
- No vision, so it cannot replace the screenshot-based Tier 2 judge.
- Web pages are untrusted input and the model can be steered by text in the
  state, so it should only ever select among verbatim candidates.
- A young model from a new vendor.

## What it would and would not change (our numbers, 2026-09-17)

Recorded AI cost per website, from `source_verifications.cost_usd`: AbeBooks
$0.12 (one verification), Ikea $0.11 (all on the first of three), Currys $0.00
(four). Extraction at scale on a verified website costs nothing in AI. So AI is
a one-time ~$0.11 setup cost per website, and only when the mechanical search
misses a field. Replacing the Claude fallback with selection would take that
under a cent: about $100 per thousand websites. Not a lever on price.

The value is elsewhere: checks that are too expensive per product with Claude
(a few cents each, multiplied across a run) cost cents per thousand products
with Jev. It makes new features affordable rather than existing ones cheaper.
Per-product cost is browser time, which the lean capture work addresses.

## If we pick it up: a spike, not an integration

Use the fixture corpus with known answers. Enumerate candidates with existing
code (`searchStructured`, the DOM search), ask Jev to choose per field, and
measure selection accuracy and whether its probabilities track being right.
Costs almost nothing. Needs an API key from Marko and a read of their legal
page on data handling first.
