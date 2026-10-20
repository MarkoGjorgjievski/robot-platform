# Work queue

Marko edits this list; Claude works it from the top without waiting between items (standing
approval, 2026-10-20 — see "Autonomous runs" in `CLAUDE.md`). Each item: one line of scope and
"done when". Claude moves an item to **Done** with its merge commit, or to **Needs Marko** with the
reason and goes on to the next.

## Next

1. **Backups that all come from one source** *(in progress 2026-10-20)* — a field's certified paths must not all read one
   API response (Ikea's price: five paths, one response); at most one or two paths per source.
   *Done when:* certification spreads backups across sources, ops shows it, tests pass.

## Needs Marko

- **Capture-failure sentences show the host and an HTTP code** — e.g. "…refused the browser (HTTP
  403…)" (honest verdicts, 2026-10-09). Customer copy should not name internals; reword them?
  (Found while planning silent failures, 2026-10-20; that branch keeps them unchanged.)
- **Verification tab UX polish** — waiting for Marko's notes (plan 2026-10-17, Task 9).
- **"Budget" wording** — on the run page and in Settings it means a page limit; a customer may
  read it as money. Keep, or rename (e.g. "Page limit")?
- **Jev's agreement** — read it once ~20 websites are verified with readings, then decide spec
  2026-10-16 §9.
- **Tabs in captures** — off by default (2026-10-19); turning them on needs a free replay of the
  certified sources first.

## Done

- 2026-10-20 — The finder reads product links (`b577561`).
- 2026-10-20 — Verify never fails silently (`f6c97de`).
- 2026-10-19 — Captures without overlays (`91a56f3`).
- 2026-10-19 — Verify dead ends (`ed3cf41`).
