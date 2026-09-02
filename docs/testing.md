# Testing

Two tiers + three channels (CLI / agent / web). The strategy is in `docs/superpowers/specs/2026-05-22-testing-strategy-design.md`; this file is the *how-to*.

## Tier 1 — Deterministic fixture-replay gate

Runs on every change. No LLM, no network, no flakes. Replays each fixture's deterministic chain (mechanical → cached API paths → cached XPaths via Playwright `setContent` → cross-validation) and asserts golden values.

**Run it:** `pnpm -r test` (or just `pnpm --filter @robot/scraper test corpus`).

**Add a fixture (one real page → one regression-protected test):**

```bash
pnpm --filter @robot/scraper exec tsx src/capture-fixture.ts \
  "<the URL>" <label> [detail|listing]
```

That writes `packages/scraper/src/__fixtures__/corpus/<label>.json` with a real capture, the current domain's cached `fieldPaths`, and an empty `expected` map. Then probe what the chain actually returns for this page (so you don't write goldens by guessing):

```bash
cat > /tmp/probe.ts <<'EOF'
import { loadFixture } from './__fixtures__/load.js';
import { runFixtureReplay } from './__fixtures__/replay.js';
const r = await runFixtureReplay(loadFixture(process.argv[2]));
console.log(JSON.stringify(r.resolved, null, 2));
EOF
```

Or just open the fixture JSON, copy `Object.keys(fieldPaths)` into `expected` with `null` placeholders, write a one-shot script that calls `runFixtureReplay` and dumps the output, then transcribe the *correct* values into `expected`. Use `null` for fields the chain legitimately can't resolve (absent from the page). Use `number` literals (e.g. `4.7`) for numeric fields so `validateFieldShape` coerces the string the XPath returns into a number — that's the same normalization prod does. Skip fields whose cached path returns garbage (the same wrong-but-non-null cases that haunt prod, e.g. `product_name = "otFlat"` from a cached `priceNumeral` path); those belong in the cache-lifecycle backlog, not in the gate.

Then re-run `pnpm --filter @robot/scraper test corpus` and iterate goldens until green. Commit the fixture.

**When a fixture starts failing, do this in order:**
1. Look at the actual replayed value vs the golden. `git log` what changed in the code or in the fixture.
2. If our code regressed: that's the bug. Fix the code; the fixture stays.
3. If the page changed (selectors no longer match the same text): re-capture and update the goldens.
4. **Never update the goldens to silence a real regression.**

## Tier 2 — Live dogfood with LLM-as-judge

Runs on demand. The full real pipeline against a corpus of live URLs, plus an LLM-judge that scores each resolved field (`correct` / `wrong` / `not-on-page`). Writes a timestamped Markdown report to `docs/testing/results/`.

**Status (2026-05-25):** the Tier 1 gate (this section above) is shipped. Tier 2 is planned but not yet implemented — see `docs/superpowers/plans/2026-05-22-testing-strategy.md` § Phase P2 (manifest + `judgeFieldExtraction` + `dogfood` CLI + per-run report writer).

When it lands:

**Run it:** `pnpm --filter @robot/api dogfood` (set `ANTHROPIC_API_KEY`; needs DB up; uses real Claude calls — costs ~a few cents per run).

**Add a live URL:** append an entry to `packages/scraper/src/__fixtures__/corpus/manifest.ts`. Include `knownAbsentFields` for fields the page legitimately doesn't expose (so they're counted as *absent* not *miss*).

**Read a report:** the `[wrong]` flags are the high-signal output — they're the wrong-but-non-null cases. Resolution rate is just the headline; the per-field judge column is where the truth lives.

## Web channel

A dashboard smoke E2E is on the backlog (single test that drives `create source → analyze → probe → results render`). Deferred until a real UI behaviour actively regresses.

## CI

There's no remote yet, so "CI" is `pnpm -r test` run locally. When a remote is wired, the Tier 1 gate is the obvious thing to run on push.

## What's currently in the corpus

- `ikea-kallax-detail` — IKEA Kallax shelf (US), 15 gated fields covering JSON-LD (brand/color/sku/rating/etc.) and one cached XPath (dimensions).

(Notes on what we tried and rejected: Amazon Godiva — headless Chromium gets a stripped/blocked page from Amazon; commits stable extractions to the cache only via a real-browser flow we don't yet have. Nike Air Jordan — captured fine but the cache row had zero `fieldPaths`, so there was nothing deterministic to replay against.)
