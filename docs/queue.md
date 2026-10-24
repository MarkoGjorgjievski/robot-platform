# Work queue

Marko edits this list; Claude works it from the top without waiting between items (standing
approval, 2026-10-20 — see "Autonomous runs" in `CLAUDE.md`). Each item: one line of scope and
"done when". Claude moves an item to **Done** with its merge commit, or to **Needs Marko** with the
reason and goes on to the next.

## Next

1. **Email, with a local catcher** — SMTP sending (Mailpit in Docker for local) for "Needs attention", failed runs and account messages. *Done when:* each message is sent and seen in Mailpit; a real provider is a config change.
2. **Tenant isolation audit, as tests** — two organisations, every router and capture-file route called across them, all refused; money fields removed from customer answers; rate limits. *Done when:* the sweep test passes.
3. **Metering and spend caps per organisation** — pages, runs and AI spend counted per org; AI work stops at a cap. *Done when:* tests; ops shows it.
4. **Proxy support in the browser** — proxy + country per website, tested against a local proxy. *Done when:* a capture goes through the configured proxy; tests.
5. **Monitoring basics** — health endpoints, structured logs, a stuck-job watchdog, an error-tracking hook; scheduled website checks on locally. *Done when:* tests; a week of local checks reviewed.
6. **A fresh-user first run, end to end** — a scripted new customer on three real sites, free and keyless; fix what trips it. *Done when:* the script passes on all three.
7. **Verification tab UX polish** — last; needs Marko's notes (plan 2026-10-17, Task 9).
8. **Tabs in captures** — last; turning the tabs step on needs a free replay of the certified
   websites first, to show their pages do not change in a way that breaks their paths.

## Needs Marko

- **Recurring runs are on by default** (`RECURRING_RUNS`): nothing runs until a customer saves a schedule. Keep on?
- **Webhook links point at `PUBLIC_API_URL`** (default http://localhost:4000): a customer's endpoint outside this machine
  cannot open them until the api-server has a public address. Which address?
- **How long to keep run files?** Each delivered run stores its CSV/JSON/XLSX in the database (`run_files`), never
  pruned, so the database and every nightly backup grow with each scheduled run. Keep forever, or e.g. 90 days?
- **Two pages at a time per website during runs?** It would roughly halve a large website's run again; it is a politeness
  choice (2026-10-23, run speed).
- **More browsers on this machine?** Defaults stay WORKER_BROWSERS=3 / WORKER_RUNS=1. Measured (docs/testing/results/2026-10-23-run-speed/report.md): 1,000 pages
  take ~77 min at one run, ~20 min at four, ~15 min at six on the fixture. On real pages each run needs ~1.1 GB; this
  machine had ~3.6 GB free at idle, which fits one run. WORKER_RUNS=4 / WORKER_BROWSERS=6 needs ~6 GB free.
- **Run speed fell short of 10×** — 8.1× at six runs (the item's "done when"). Merged anyway: same values, strictly
  faster. The remaining levers are the two choices here (two pages per website, more runs). Keep the item closed?
- **Politeness spacing is start to start now** (one page per host at a time, starts ≥2 s apart; it used to add ~1.7 s
  after each product). Keep?
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

- 2026-10-24 — Recurring extraction (`2881058f`): a weekly schedule per website, a CSV/JSON/XLSX snapshot per run, a signed webhook with signed links on completion; live check docs/testing/results/2026-10-24-recurring/live-recurring.md. After merge: pnpm db:migrate, restart dev:all.
- 2026-10-24 — Run speed (`b0b0f994`): lean captures on certified runs with today's capture as the fallback, page starts 2 s apart per host, runs keep a browser for Verify; measured 1.6× per 1,000 pages one website at a time, 8.1× at six, same values (docs/testing/results/2026-10-23-run-speed/report.md). After merge: pnpm install, restart dev:all.
- 2026-10-23 — Playwright aligned on 1.62.1 everywhere (`baf5f5d`).
- 2026-10-23 — The whole stack in Docker Compose, with nightly backups and a tested restore (`feat/docker-compose`).
- 2026-10-23 — Capture worker and job queue (`7d94500`). After merge: stop dev:all, pnpm install, restart.
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
