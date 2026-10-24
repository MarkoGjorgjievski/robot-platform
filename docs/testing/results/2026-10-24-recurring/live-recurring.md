# Recurring extraction — live check, 2026-10-24

`cd packages/worker && npx tsx src/live-recurring.ts` — free, local, keyless (spec 2026-10-24 §5). A throwaway
`robot_bench_*` database (dropped afterwards), the run-speed fixture shop (one site, instant latency), a local webhook
receiver on 127.0.0.1, the api-server on :4310 as a child process (it serves the signed links) and an in-process
worker on its own queue, recurring runs on, website checks off. Exit 0, all 22 checks ok. Numbers: `live-recurring.json`.

What happened:

- **Schedule saved** 07:06:10 UTC, every day at 07:07 UTC; `next_run_at` 07:07:00.
- **The run started by itself** at 07:07:20, labelled `scheduled`. That is 20 s after the due time, because the
  sweep runs every minute (10 s after the worker starts, then every 60 s). Nobody started it by hand.
- **It completed** at 07:07:30 (10 s): 3 rows, one per proof page, 8/8 fields on each.
- **Three files** went into `run_files`: CSV 501 B, JSON 1,567 B, XLSX 6,942 B, 3 rows each.
- **One POST** reached the receiver at 07:07:30.8, 0.4 s after the run completed: `POST /hook`, one delivery attempt,
  answered 200. The script recomputed `X-Robot-Signature` as HMAC-SHA256 over the raw body, keyed with the website's
  stored secret, and it matched. The headers were `run.finished`, `robot-platform-webhook/1` and `application/json`,
  and `X-Robot-Delivery` matched the body's `deliveryId`. The body had all thirteen keys. The links expire
  2026-10-31, 7 days later.
- **The three links** came through the real api-server export route with no session. Each answered 200 with exactly
  the stored file's bytes. The CSV and JSON were also byte-identical to a fresh live export of the run's rows. The
  row count was 3 in the webhook body, the export, the run row and every file. A link with one changed signature digit
  answered 404.
- **Cleanup:** the worker stopped with 0 browsers open, no Chromium with this process's `--robot-owner` remained,
  nothing was left listening on :4310 and no `robot_bench_*` database remained.
