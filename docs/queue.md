# Work queue

Marko edits this list; Claude works it from the top without waiting between items (standing
approval, 2026-10-20 — see "Autonomous runs" in `CLAUDE.md`). Each item: one line of scope and
"done when". Claude moves an item to **Done** with its merge commit, or to **Needs Marko** with the
reason and goes on to the next.

## Next

1. **A job queue and a separate capture worker** — page capture leaves the api-server for its own worker process, fed by a Postgres-backed queue (Verify, runs, checks, samples); one place limits browsers and memory. *Done when:* the api-server starts no browser; every capture job goes through the queue; a stuck or crashed worker job is retried or failed with a sentence; tests, smoke. (Marko: start, 2026-10-23.)
2. **The whole stack in Docker Compose** — app, api, worker, Postgres from one command, plus a nightly pg_dump with a tested restore. *Done when:*  serves the app locally end to end; a restore test passes.
3. **Run speed** — lean captures on certified runs and several websites in parallel through the queue (design: docs/superpowers/specs/2026-10-07-run-speed-and-language-note.md). *Done when:* a measured 1,000-page-equivalent run is an order of magnitude faster with the same values.
4. **Recurring extraction** — a schedule per website (e.g. every Monday 06:00); each run produces a downloadable file and a webhook on completion. *Done when:* a scheduled run fires, writes its file and posts its webhook; tests, smoke.
5. **Email, with a local catcher** — SMTP sending (Mailpit in Docker for local) for "Needs attention", failed runs and account messages. *Done when:* each message is sent and seen in Mailpit; a real provider is a config change.
6. **Tenant isolation audit, as tests** — two organisations, every router and capture-file route called across them, all refused; money fields removed from customer answers; rate limits. *Done when:* the sweep test passes.
7. **Metering and spend caps per organisation** — pages, runs and AI spend counted per org; AI work stops at a cap. *Done when:* tests; ops shows it.
8. **Proxy support in the browser** — proxy + country per website, tested against a local proxy. *Done when:* a capture goes through the configured proxy; tests.
9. **Monitoring basics** — health endpoints, structured logs, a stuck-job watchdog, an error-tracking hook; scheduled website checks on locally. *Done when:* tests; a week of local checks reviewed.
10. **A fresh-user first run, end to end** — a scripted new customer on three real sites, free and keyless; fix what trips it. *Done when:* the script passes on all three.
11. **Verification tab UX polish** — last; needs Marko's notes (plan 2026-10-17, Task 9).
12. **Tabs in captures** — last; turning the tabs step on needs a free replay of the certified
   websites first, to show their pages do not change in a way that breaks their paths.

## Needs Marko

- **Turn the scheduled checks on?** `WEBSITE_CHECKS=on` makes the api-server check each certified website
  every 3 days (free, proof pages + 20 listing products). Off by default.
- **Backfill holds for other websites** whose last Verify failed only on stale values (e.g. Decathlon,
  Lookfantastic)? Only the 10 were approved.
- **Customer-marked "changes on its own" fields** and **email notices** — later?
- **Jev's agreement** — read 2026-10-21 (`docs/testing/results/2026-10-21-jev-agreement.md`): 86 %
  at confidence 0.9+, most other disagreements are how we compare. Recommendation: do not apply
  Jev's pick yet; fix the comparison and two candidate follow-ups, read again, then consider Price
  only. Agree?

## Done

- 2026-10-21 — Websites change follow-ups (`5ec19af`): a refresh no longer hides other findings, never starts a listing sample, and a default-backed field is judged against its default. Gymshark re-checked: all 8 fields read as working (15:49); a later re-check could not open a browser (low memory) and is recorded as failed.
- 2026-10-21 — Websites change: keep running, re-check, tell the customer (`d595283`); applied to the 10 websites — all 10 run again (report in docs/testing/results/2026-10-21-websites-change-apply/).
- 2026-10-21 — The 10 websites that lost certification at the re-verify are kept as they are (Marko); item 1 brings them back.
- 2026-10-21 — Re-verified the 20 one-source websites (`docs/testing/results/2026-10-21-reverify-one-source/report.md`); Jev agreement read.
- 2026-10-21 — HTML backups capped too (`33a67c7`).
- 2026-10-21 — Customer copy: capture failures and run limits (`ae1f9ed`).
- 2026-10-20 — Backups from more than one source (`357b202`).
- 2026-10-20 — The finder reads product links (`b577561`).
- 2026-10-20 — Verify never fails silently (`f6c97de`).
- 2026-10-19 — Captures without overlays (`91a56f3`).
- 2026-10-19 — Verify dead ends (`ed3cf41`).
