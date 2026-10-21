# Work queue

Marko edits this list; Claude works it from the top without waiting between items (standing
approval, 2026-10-20 — see "Autonomous runs" in `CLAUDE.md`). Each item: one line of scope and
"done when". Claude moves an item to **Done** with its merge commit, or to **Needs Marko** with the
reason and goes on to the next.

## Next

1. **Websites change: keep running, re-check, tell the customer** — a failed re-verify never revokes a
   certification that still extracts (runs continue on the last good paths; the website shows "needs
   attention"); fields that change by nature (price, rating, review count, stock) refresh their
   expected value when the certified path still reads a valid value in the same place; a free
   scheduled drift check of the proof pages (no AI) notices structural changes and tells the customer
   in one plain notice; a partly rolled-out new design comes back as a new page shape with "Use as
   proof page". *Done when:* the 10 websites from the 2026-10-21 re-verify run again or say exactly
   what needs the customer; tests, smoke. (Marko: yes, start, 2026-10-21.)
2. **Verification tab UX polish** — last; needs Marko's notes (plan 2026-10-17, Task 9).
3. **Tabs in captures** — last; turning the tabs step on needs a free replay of the certified
   websites first, to show their pages do not change in a way that breaks their paths.

## Needs Marko

- **Jev's agreement** — read 2026-10-21 (`docs/testing/results/2026-10-21-jev-agreement.md`): 86 %
  at confidence 0.9+, most other disagreements are how we compare. Recommendation: do not apply
  Jev's pick yet; fix the comparison and two candidate follow-ups, read again, then consider Price
  only. Agree?

## Done

- 2026-10-21 — The 10 websites that lost certification at the re-verify are kept as they are (Marko); item 1 brings them back.
- 2026-10-21 — Re-verified the 20 one-source websites (`docs/testing/results/2026-10-21-reverify-one-source/report.md`); Jev agreement read.
- 2026-10-21 — HTML backups capped too (`33a67c7`).
- 2026-10-21 — Customer copy: capture failures and run limits (`ae1f9ed`).
- 2026-10-20 — Backups from more than one source (`357b202`).
- 2026-10-20 — The finder reads product links (`b577561`).
- 2026-10-20 — Verify never fails silently (`f6c97de`).
- 2026-10-19 — Captures without overlays (`91a56f3`).
- 2026-10-19 — Verify dead ends (`ed3cf41`).
