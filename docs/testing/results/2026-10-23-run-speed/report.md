# Run speed — measured (2026-10-23)

Spec `docs/superpowers/specs/2026-10-23-run-speed-design.md`. Fixture: `packages/worker/src/bench/fixture-shop.ts`
(realistic latency), throwaway database, own queue; nothing written to the dev database, nothing paid. Benchmarks run
one at a time on 2026-10-24, on this machine (16 GB, ~3.6 GB free at idle with Marko's usual load).

| Run | Commit | Pages | Runs/browsers | Wall | Per 1,000 pages | Item cycle median / p90 | Modes | Chromium peak |
|---|---|---|---|---|---|---|---|---|
| before | d2ed37bb | 100 | 1/3 | 745.0 s | 124.2 min | 6,391 / 14,292 ms | — (none 100) | 912 MB |
| after-1 | 95efb007 | 100 | 1/3 | 458.8 s | 76.5 min | 2,685 / 10,730 ms | lean 90, lean+full:check 4, lean+full:miss 6 | 242 MB |
| after-4 | 95efb007 | 1,000 | 4/6 | 1,169.4 s | 19.5 min | 2,665 / 10,635 ms | lean 900, lean+full:check 40, lean+full:miss 60 | 1,476 MB |
| after-6 | 95efb007 | 1,000 | 6/8 | 916.6 s | 15.3 min | 2,667 / 10,641 ms | lean 900, lean+full:check 40, lean+full:miss 60 | 2,126 MB |

**Speed-up per 1,000 pages:** after-1 1.62× (lean + politeness, one website at a time), after-4 6.37×, after-6 8.13×.
The plan's "done when" (after-6 ≥ 10×) is **not met**: 8.13×. Nothing was tuned to reach it. Why it falls short of the
spec's estimate (≈15× at `R` = 6):
- Per website the fixture averages 4.56 s per item (mean cycle), not the ≈2.6 s estimated: 10 of every 100 items
  (2 check items and 3 confirmed-miss fallbacks per website, `Rating` absent) pay lean + full at ≈10.6 s (the p90),
  and lean items themselves take a 2.7 s median against a 2 s politeness floor. 50 items ≈ 228 s per website.
- Websites start in whole waves: 20 websites at `R` = 6 run in 4 waves (6+6+6+2) ≈ 4 × 228 s = 912 s (measured
  917 s); at `R` = 4, 5 waves ≈ 1,140 s (measured 1,169 s). The per-website speed-up (1.62×) times the number of
  waves saved is the whole story; the last wave of 2 at `R` = 6 leaves 4 slots idle.
- No `unshown`, `verdict` or `switched` fallback occurred on the fixture, and no run switched to full.

**Same values:** before vs after-1, 100 pages: 0 differences (data and shown; `compare.ts`: "100 pages in both;
0 difference(s)"); every after run against the fixture's truth: 16,800 cells (after-1
800, after-4 8,000, after-6 8,000), 0 mismatches. Real pages (`real-sites.md`): 15 pages, 0 value and 0 shown differences; median
today 11,827 ms, lean 12,180 ms (a fresh lean state per page, so every page pays its first-sight fallbacks).

**Real pages, honestly.** Gymshark took lean on every page (median 5,308 ms vs 10,423 ms today). Ikea and Skullcandy
fell back (`lean+full:unshown` — Ikea title/description, Skullcandy sku/brand, fields today's capture also reads as
not shown) on every page in the fresh-state pass, so there lean was slower than today (16.1 s vs 12.8 s; 12.2 s vs
8.0 s). The run-like pass (one state per website, its two check items first) shows the fallbacks stop once confirmed:
lean from about the 3rd–5th item (Ikea item 5 lean, Skullcandy items 4–5 lean, lean capture 3.8–5.8 s). None of the
three websites has a variant plan; a website with variants now runs today's full capture on every item (spec, final
review I1) and gets no lean speed-up — the projection below assumes no variant websites.

**Projection for 1,000 real pages** (20 websites × 50, no variant websites): today ≈ 1,000 × (11.8 s real today median
+ ~1.7 s politeness gap) = 13,530 s ≈ **3 h 46 min**. After, per website: 4 fallback items (2 check + ~2 unshown/miss
until confirmed) × 14.4 s (mean lean+full on real pages) + 46 lean items × 5.3 s (real lean median, Gymshark) ≈ 301 s,
i.e. ≈ 6.0 s per page — not the 4–6 s hoped for once fallbacks are counted. Websites in whole waves:
- `WORKER_RUNS` 1 (today's default): 20 × 301 s ≈ **1 h 40 min** (≈2.2×);
- `WORKER_RUNS` 4: 5 waves × 301 s ≈ **25 min** (≈9.0×);
- `WORKER_RUNS` 6: 4 waves × 301 s ≈ **20 min** (≈11×).
A variant website costs ≈ today's ~11.8 s per page throughout and lengthens its wave accordingly.

**Memory:** per-run MB = max(fixture per run, one real page) = max(1,476 / 4 = 369, 2,126 / 6 = 354, real page
1,049) = **1,049 MB** (one Chromium on a real product page, Gymshark, `real-sites.json` `chromiumPeakMb`). Free at
idle 3,594–3,742 MB. Rule (spec §3.8): `R × 1,049 + 800 ≤ free − 1,024` → `R ≤ (3,594 − 1,824) / 1,049 = 1.7`, so
**the largest `WORKER_RUNS` that fits this machine today is 1** (`WORKER_BROWSERS` = 3). **Defaults stay 3/1**
(raising them is Marko's decision); the recommendation for this machine is to keep `WORKER_RUNS=1`,
`WORKER_BROWSERS=3` — unless more memory is freed: each extra run needs ≈1.05 GB free at idle on real pages (≈0.37 GB
on the fixture, where after-6's 2.1 GB Chromium peak ran without a failure). `WORKER_RUNS=4`/`WORKER_BROWSERS=6` would
need ≈6.0 GB free at idle; `6`/`8`, ≈8.1 GB.
