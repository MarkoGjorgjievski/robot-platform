# Websites change, applied to the ten websites (2026-10-21)

The ten websites that lost their certification at the 2026-10-21 re-verify
(`docs/testing/results/2026-10-21-reverify-one-source/`), with the new behaviour applied once: holds backfilled
from each website's latest Verify, then one scheduled check on fresh pages (with any automatic refresh and its
free re-verify). Approved by Marko as part of the item.

- **Backup before any write:** `C:\Users\Marko\Documents\projects\robot-platform-backups\backup-20261021-155257-pre-websites-change-apply.sql`
  (698,222,746 bytes; the dump ends with "PostgreSQL database dump complete").
- **Script:** `packages/api/src/scripts/apply-websites-change.ts`, run from the worktree on branch
  `ops/websites-change-apply` (main @ `d5952835`). `WEBSITE_CHECKS` unset; the script refuses to start with a
  key, `JEV_SHADOW` or `WEBSITE_CHECKS` set. 15:53 → 17:04 local, exit 0.
- **Raw record:** `apply.json` (per website: state before, backfill, state after backfill, check, state after,
  the check's per-field outcome, the newest Verify).
- **What was written:** `field_holds` for exactly the ten source ids (`backfillHolds(..., { write: true })`, 22
  holds; 5 were ended by the website's own refresh re-verify, 17 remain), and what `checkWebsite` writes itself:
  ten `drift_checks` (trigger `schedule`), five `value_refreshes` rows on four websites (with their expected-value
  edits), four free refresh re-verifies, thirteen coverage checks (three `failed: superseded`, see surprise 1).
  No sign-in, no user or org, no binding or field edited by hand. Dev servers :3000/:4000 untouched.
- **Spend:** none. No agent constructed (no key); `jev_readings` rows since the run started: 0. Every Verify was
  free (refresh re-verifies on the check's own captures).

## Result

All ten were refused before and **all ten run after**. Three are fully current again (Acne / Ikea, Mejuri,
Gymshark); seven run on held fields and say exactly what needs the customer.

| Website | Runs before → after | Held now (verified on) | Refreshed automatically (was → now) | Still needs the customer — what the app shows |
|---|---|---|---|---|
| Barnesandnoble | no → **yes** | Description (8 Oct) | Rating: 4.5 → 4.6 on product 2 — re-verified, current | Banner: "Description needs you — runs go on with what you verified on 8 Oct." Row: "Page now shows … (was …)" on product 1's description (not a by-nature field) |
| Acne / Ikea | no → **yes** | — | Total reviews 149 → 150 (p1), 45 → 46 (p2), 62 → 64 (p3); Average rating 4.8 → 4.7 (p2) — re-verified, both current | Nothing |
| Madeincookware | no → **yes** | Price, SKU (8 Oct) | — | Banner: "Price and SKU need you — runs go on with what you verified on 8 Oct." (no row: products 1 and 2 did not load in time this check) |
| Everlane | no → **yes** | Price, In stock (8 Oct) | — (Price reads a fixed variant) | Banner: "Price and In stock need you — runs go on with what you verified on 8 Oct." Price row: "Page now shows 180.00 (was 125.00) on product 1; Page now shows 200.00 (was 140.00) on product 3" |
| Mejuri | no → **yes** | — | Price 615.00 → 625.00 (p1), 435.00 → 440.00 (p2), 3250.00 → 3300.00 (p3) — re-verified, current | Nothing |
| Gymshark | no → **yes** | — | Rating 4 → 4.2 on product 3 — re-verified, current | Nothing (but see surprise 3) |
| Ridge | no → **yes** | In stock (12 Oct) | — (reads a fixed variant) | Banner: "In stock needs you — runs go on with what you verified on 12 Oct." Row: InStock → OutOfStock on all four products |
| Oliverbonas | no → **yes** | Rating (12 Oct) | — (new value not shown on the page) | Banner: "Rating needs you — runs go on with what you verified on 12 Oct." Row: "Page now shows 4.5 (was 4)" (product 3) |
| Burrow | no → **yes** | Price, Rating (12 Oct) | — (Price reads a fixed variant; Rating not shown) | Banner: "Price and Rating need you — runs go on with what you verified on 12 Oct." Rows: Price 1301.0 → 1859.0, 1133.0 → 1619.0, 1306.0 → 2009.0; Rating 4.78 → 4.74 on all three |
| Skullcandy | no → **yes** | all 8 fields (12 Oct) | — (nothing moved on the two pages that load) | Banner: "Title, Price, Main image, SKU, Brand, In stock, Rating and Description need you and product 2 no longer loads — runs go on with what you verified on 12 Oct." Row: "Product 2 no longer loads — Replace product 2" |

While a website has held fields its Extract tab also says "{Fields} need(s) you on the Verification tab — runs go
on with what you verified on {date}." The banner and Extract sentences were composed by the app's own copy
functions (`packages/app/src/lib/site/attention-view.ts`, called from the script, stored in `apply.json`); the
row texts follow `packages/app/src/lib/site/drift-view.ts`.

**Done-when:** each of the ten runs. None is "refused with an empty attention".

## Compared with the read-only replay (task 11)

Same 22 fields held by the backfill, field for field (none fell into `no-evidence`, `reads-nothing` or
`no-earlier-pass`), and all ten runnable after, as the replay predicted. Differences come from the pages being
fresh rather than the stored 21 Oct captures:

1. **Barnesandnoble Rating was refreshed** (replay: held, "not shown on the page"). Today's page shows 4.6 for the
   product that read 4.5, so the refresh rule passed; the field was refreshed and re-verified current. Five
   refreshes in all, not four.
2. **Acne / Ikea Average rating** refreshed and re-verified cleanly (spec §8 hedged on "Several places match" on
   product 1; it did not happen). Product 1 still reads 4.8; only product 2 moved to 4.7, as replayed.
3. **Madeincookware:** two of its three proof pages did not answer in time, so the check read product 3 only and
   Price/SKU drift was not checked on 1 and 2. Outcome unchanged (Price and SKU held, as replayed), but the
   customer sees only the banner, no "Page now shows" row this time. Possibly caused by surprise 1.
4. Holds ended by a passing refresh re-verify: Barnesandnoble Rating, Acne / Ikea (2), Mejuri, Gymshark — 17 remain.

## Surprises

1. **Not strictly one browser at a time.** A refresh re-verify that passes starts its own coverage check in the
   background. It superseded the coverage check `checkWebsite` had just started (that one ended `failed:
   superseded` and `checkWebsite` returned), so the script, which waited only for the Verify, moved on while
   that listing sample was still loading pages. Overlaps: Acne / Ikea's sample (14:12–14:20) with
   Madeincookware's check (14:13–14:22); Mejuri's (14:37–14:45) and Gymshark's (14:39–14:49) with the Gymshark,
   Ridge and Oliverbonas checks. Every coverage check that ran finished `done`; no data harmed. Spec §7.6 says a
   refresh-started Verify never starts a check; it does start a coverage check, which also displaces the
   scheduled one — needs a decision (and any re-run of this script should also wait for running coverage checks).
2. **Madeincookware's two timeouts** (above) — the overlap or the site; nothing was retried by hand.
3. **Gymshark Brand classified `lost` with no pages.** Brand has blank expected values on all four products
   (certified by `og:site_name`, reads "Gymshark" everywhere), so `classifyDrift` has no deciding page and
   returns `lost` with `pages: {}` (`decidingUrls.length === 0` branch). It is hidden from the customer today only
   because the Rating refresh's re-verify is newer than the check; on a check without a refresh the customer
   would see "Brand needs you" and "Not found on the page — Mark it again" for a field that reads on every page.
   Not introduced by this change; not fixed here.
4. A refresh re-verify (only the refreshed fields) makes every other finding of the same check older than the
   latest Verify, so `websiteAttention` drops them. That hides surprise 3, and would equally hide a real
   `lost`/`moved` finding on another field of a refreshed website. Worth a look.

## Commands

```
docker exec robot-platform-db pg_dump -U postgres robot_platform > /c/Users/Marko/Documents/projects/robot-platform-backups/backup-20261021-155257-pre-websites-change-apply.sql
cd packages/api && npx tsc --noEmit        # clean
cd packages/api && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= \
  CAPTURES_DIR=/c/Users/Marko/Documents/projects/robot-platform/packages/api-server/public/captures \
  npx tsx src/scripts/apply-websites-change.ts
```

Rollback, if ever wanted: restore the backup above (it predates every write listed here).
