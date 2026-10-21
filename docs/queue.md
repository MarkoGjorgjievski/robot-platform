# Work queue

Marko edits this list; Claude works it from the top without waiting between items (standing
approval, 2026-10-20 — see "Autonomous runs" in `CLAUDE.md`). Each item: one line of scope and
"done when". Claude moves an item to **Done** with its merge commit, or to **Needs Marko** with the
reason and goes on to the next.

## Next

1. **Verification tab UX polish** — last; needs Marko's notes (plan 2026-10-17, Task 9).
2. **Tabs in captures** — last; turning the tabs step on needs a free replay of the certified
   websites first, to show their pages do not change in a way that breaks their paths.

## Needs Marko

- **10 websites lost their certification at the re-verify** — their live pages changed since they
  were verified (prices, ratings, descriptions moved; widgets no longer read; a Skullcandy proof page
  is now a 404): Barnesandnoble, Acne / Ikea, Madeincookware, Everlane, Mejuri, Gymshark, Ridge,
  Oliverbonas, Burrow, Skullcandy. Runs on them are refused until their failing fields are fixed and
  verified again. Keep (the honest state; fix them in the app), or roll back (delete the 20 new
  verification rows listed in `docs/testing/results/2026-10-21-reverify-one-source/results.json`, or
  restore `backup-20261021-115643-pre-reverify-one-source.sql`)?
- **Jev's agreement** — read 2026-10-21 (`docs/testing/results/2026-10-21-jev-agreement.md`): 86 %
  at confidence 0.9+, most other disagreements are how we compare. Recommendation: do not apply
  Jev's pick yet; fix the comparison and two candidate follow-ups, read again, then consider Price
  only. Agree?

## Done

- 2026-10-21 — Re-verified the 20 one-source websites (`docs/testing/results/2026-10-21-reverify-one-source/report.md`); Jev agreement read.
- 2026-10-21 — HTML backups capped too (`33a67c7`).
- 2026-10-21 — Customer copy: capture failures and run limits (`ae1f9ed`).
- 2026-10-20 — Backups from more than one source (`357b202`).
- 2026-10-20 — The finder reads product links (`b577561`).
- 2026-10-20 — Verify never fails silently (`f6c97de`).
- 2026-10-19 — Captures without overlays (`91a56f3`).
- 2026-10-19 — Verify dead ends (`ed3cf41`).
