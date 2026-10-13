# "Shown on the page" and Part B — live check, 2026-10-12

Signed in as `credit-campaign@example.com` through the app's `/login` form (headless Playwright,
1440×1000, one Chromium at a time, scripted from the scratchpad, against the already-running
main servers: api-server :4000, app :3000 on `main` after the merge, commit `3ea7f2a`). Nothing
was created or deleted except one new Extract run on gymshark.com. Screenshots:
`docs/testing/results/screens-2026-10-12-shown/`.

## Gymshark — a small Extract

| # | Action | Expected | Seen (verbatim) | Screenshot |
|---|---|---|---|---|
| 1 | Open the Extract tab, set the budget to custom 10 products across custom 1 page, click Extract | Button shows no estimate; run starts | Button read only "Extract" (no amount), exactly as the brief said. Clicked 08:07:00Z | `gymshark-extract-budget-set.png` |
| 2 | Wait for the run | Completes in a few minutes, cost $0.00–$0.08 | Run `4a2c0349-509b-4297-b5cc-61ee54cbffc9`: planned/executing from 08:07:00Z, **completed 08:10:10Z** (3 min). `runs.status = completed`, `runs.result_count = 10`, **`runs.cost_usd = 0.0000`** (read from the database — the run page itself shows only Started/Completed/Duration/Rows, never a dollar figure, so the cost is not readable from that screen) | `gymshark-run.png` |
| 3 | Read the Brand column head's badge | `10 not shown` or close | **`Brand10 not shown`** — i.e. "Brand" then the badge "10 not shown", exactly the spec's `{n} not shown` form. `Main image` and `In stock` carry `not checked` (the §8/D2 types) | `gymshark-run.png` |
| 4 | Read the "Values not shown on their page" panel's Brand row | `Brand: n of m values are not on the product's page · from {source} ({path})` | **`Brand: 10 of 10 values are not on the product's page · from json-ld (brand.name)`**, with the fixed sentence above it and 5 "Use as proof page" links (one per distinct product among the 10) | `gymshark-run.png` |
| 5 | Read the run summary line's suffix | `· n values not shown on their page` | **`10 rows · 100% confidence · 10 values not shown on their page`** | `gymshark-run.png` |
| 6 | Read a flagged cell's title / text | value stays, warning rail, title "not shown on the page" | 10 of 10 Brand cells carry the rail; the value is unchanged (`Gymshark \| We Do Gym`), `title="not shown on the page"` confirmed on the DOM (`td[title="not shown on the page"]`, count 10) | `gymshark-run.png` |

**Cost, precisely.** The run's own `cost_usd` is `$0.0000` (database, authoritative for this one
run). The Usage page does not isolate a single run — it shows October's project total, read
after this run: **Campaign 2 2026-10-11 — $3.13, 469 pages captured** (October total, all sites
in the project, not this run alone — "before" was not separately captured, so the delta cannot
be isolated from that screen; the run row's own `$0.0000` is the number that answers the brief).

### Gymshark Verification tab — card 1's Brand cell

| # | Action | Expected | Seen | Screenshot |
|---|---|---|---|---|
| 7 | Open Verification, read Brand's row | Card 1 reads "not on this page" (the typed tagline) | **Yes.** Brand's row: card 1 `Gymshark \| We Do Gym` + **`not on this page`**; card 2 the same; card 3 the same; **card 4 (the Adapt Solid Sports Bra, added by coverage) does NOT carry the flag** — its page apparently does show the tagline string somewhere the §3 check matches, so B2 did not warn there. All four cells still read `verified 4/4` overall — Verify is not blocked (B2's rule: it warns, never blocks) | `gymshark-verification.png`, `gymshark-verification-brand-cell.png` |

## Colourpop — Verification tab, the Title row

| # | Action | Expected | Seen | Screenshot |
|---|---|---|---|---|
| 8 | Open Verification, read the Title row | `not the page's heading on product n` if still a live suggestion; honest "does not apply" if already accepted | **The rule does not apply here, and for two independent reasons, both recorded honestly:** (a) Colourpop's Verify is `verified 4/4` / "Everything is verified" — every Title cell is an **accepted answer**, not an open "agreed" suggestion, so B1's `needs-you` reason has nothing to attach to; (b) separately, per the campaign notes (finding 2), these four current proof pages are palettes, where the JSON-LD name and the page's `h1` heading are literally the same string ("Fade Into Hue", "Aurora Struck", "Bare Necessities", "Fallen Collection"), so B1 would not fire on them even as a live suggestion. No "not the page's heading" text appears anywhere on the page (checked against the full body text) | `colourpop-verification.png` |

## Judge CLI, `--dry-run` (free)

`pnpm --filter @robot/api exec tsx src/judge-run.ts 4a2c0349-509b-4297-b5cc-61ee54cbffc9 --dry-run`:

```
[judge-run] run 4a2c0349-509b-4297-b5cc-61ee54cbffc9 — Gymshark (project Campaign 2 2026-10-11)
[judge-run] 10 detail items, 10 with stored values; judging 10
[judge-run] fields: title, price, main_image, sku, brand, in_stock, rating, description; up to 3 screenshot tile(s) per value
[judge-run] 70 values to judge (+10 URL values marked unverifiable for free) — estimate ~$0.60 at $0.0086/call on tile 1, ~$0.66 with the 10% retry/explain allowance; cap $5.00
... (10 items planned)
[judge-run] --dry-run: nothing captured, nothing judged, no report written.
```

The report plumbing is reachable and estimates correctly; nothing was captured, judged, spent or
written, as `--dry-run` promises. The judge's "shown" column and confusion table were not
exercised here (that needs a real, paid run) — this only confirms the CLI accepts the run id and
builds its plan.

## Defects found

None new. The one pre-existing, already-documented behaviour re-observed: Brand cannot certify
as plain "Gymshark" on this site (campaign notes, gymshark.md finding 1) — unrelated to this
plan, which is why the flagged-not-shown mechanism exists at all.

## Not checked

- The judge's "shown" column and confusion table against a paid judge run (not run here — the
  CLI call above was `--dry-run` only, per the brief's "optionally, free" step).
- Why card 4's Brand cell does not carry "not on this page" while cards 1–3 do (not investigated
  further — recorded as seen above, not a defect in this plan's scope).
- Isolating this one run's cost on the Usage page (the page reports a monthly project total, not
  a per-run figure; the run's own `cost_usd` in the database was used instead, see above).
