# Work queue

Marko edits this list; Claude works it from the top without waiting between items (standing
approval, 2026-10-20 — see "Autonomous runs" in `CLAUDE.md`). Each item: one line of scope and
"done when". Claude moves an item to **Done** with its merge commit, or to **Needs Marko** with the
reason and goes on to the next.

## Next

1. **Capture-failure sentences in customer words** — the honest-verdict sentences (2026-10-09) name
   the host and an HTTP code ("…refused the browser (HTTP 403…)"); reword every customer-visible
   capture verdict so it names neither, staff/ops keep the detail. *Done when:* no customer string
   has a host or an HTTP code (a test sweeps them), route smoke passes. (Marko: yes, 2026-10-21.)
2. **"Budget" becomes "Page limit"** — on the run page and in Settings, everywhere a customer reads
   "budget" meaning a page limit. *Done when:* no customer string says "budget"; tests, smoke.
   (Marko: yes, 2026-10-21.)
3. **Cap XPath backups too** — the page's HTML counts as one source under the two-per-source cap
   (drop the 2026-10-20 exemption); ops warns on all-XPath fields. *Done when:* certification and
   ops treat XPath like the other sources; tests. (Marko: yes, 2026-10-21.)
4. **Re-verify the one-source websites** — after item 3: re-verify, free and keyless, the websites
   the one-source check flagged (both Ikea websites, Lookfantastic, the rest in
   `docs/testing/results/2026-10-20-one-source/recertify.md`); `pg_dump` first; record before/after.
   (Marko: yes, 2026-10-21; the two first-path switches are accepted.)
5. **Jev's agreement** — count the websites verified with Jev readings; with about 20, run the
   agreement report and write up spec 2026-10-16 §9's decision for Marko; with fewer, record the
   count and move it back to Needs Marko. (Marko: yes, 2026-10-21.)
6. **Verification tab UX polish** — last; needs Marko's notes (plan 2026-10-17, Task 9).
7. **Tabs in captures** — last; turning the tabs step on needs a free replay of the certified
   websites first, to show their pages do not change in a way that breaks their paths.

## Needs Marko

*(Nothing waiting — items 6 and 7 above need Marko only for the UX notes.)*

## Done

- 2026-10-20 — Backups from more than one source (`357b202`).
- 2026-10-20 — The finder reads product links (`b577561`).
- 2026-10-20 — Verify never fails silently (`f6c97de`).
- 2026-10-19 — Captures without overlays (`91a56f3`).
- 2026-10-19 — Verify dead ends (`ed3cf41`).
