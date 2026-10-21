# Cap XPath backups too — design

**Status:** written and implemented 2026-10-21 under the standing approval (`CLAUDE.md`, "Autonomous
runs"; queue item 3, "Cap XPath backups too"); Marko approved the change on 2026-10-21. Plan:
`docs/superpowers/plans/2026-10-21-xpath-cap.md`. Branch `feat/xpath-cap` from `main` @ `584372c`.
This amends `docs/superpowers/specs/2026-10-20-one-source-backups-design.md`, whose Status line
records the controller ruling this drops.

## 1. Why

Spec 2026-10-20 (§3.1) counted the page's HTML as one source, like one API response: two XPaths into
one page fail together on a redesign, however different their anchors. While it was implemented, a
controller ruling exempted XPaths from the two-per-source cap and from the ops warning, so XPath-only
websites kept up to five paths as before, and left the question to Marko. Marko answered on
2026-10-21: cap them too. Five XPaths into one page are not five backups; they are one source
counted five times, and they hide from staff that the field has no second source.

## 2. The change

- **XPath paths count as one source** — the page's HTML (`sourceKey` gives `xpath`) — under
  `MAX_PATHS_PER_SOURCE` = 2, like an API response, the page's JSON-LD or its meta tags. An all-XPath
  field keeps its two best XPaths; an XPath beside other sources gets at most two places among the
  five.
- **`readsOneSource` is true for two or more all-XPath paths.** So:
  - **the cache shortcut** (`verify/run-verification.ts`) no longer keeps an all-XPath cached
    certification: Verify searches the proof pages again, as it already did for one API response —
    free, the AI is asked only when nothing certifies. Where the pages offer another source (JSON-LD,
    meta, an API response) it joins; where they offer none the result is the same two XPaths.
  - **ops warns** on an all-XPath field (`packages/app/src/lib/ops-view.ts` `oneSourceWarning`, the
    mirror of `readsOneSource`), with the existing text: "All backups read the same response — if it
    changes, they fail together".
- The exemption code goes: `isUncappedSource` and `spreadAcrossSources`' `uncapped` argument in
  `certify.ts`, and `isUncappedSource` in `ops-view.ts`. The shared seven-case table in the scraper
  and app tests now reads "all XPath: one source" in both.

## 3. What changes for existing websites

Nothing until their next Verify. Stored certifications are not rewritten, and a run extracts with
the stored paths in stored order as before. Ops starts warning at once on a stored field with two or
more XPaths and nothing else (display only). At the next Verify such a field is searched again: it
certifies its two best XPaths, plus any other source the pages now offer.

## 4. Safety

- **What certifies a field is unchanged**: only which of its correct paths are kept as backups.
- **The first path is today's** for a fresh search (the spread always starts with `ranked[0]`), so
  every cell's value and path, `thinEvidence`, `weakEvidence`, `provenOn`, `defaultOnly`,
  `notOnWebsite` and the fail reasons are what they were. One honest exception, the same one spec
  2026-10-20 §3.4 accepted for API pairs: a website whose cached all-XPath certification used to be
  kept by the shortcut is now searched again, so if its pages carry a structured path that ranks
  above XPath (JSON-LD, meta, an API response), that path becomes the first — exactly what a first
  Verify on those pages would certify.
- **Multi-layout covers are never capped**: a cover's paths each carry pages no other path carries;
  none is a backup, and covers do not go through the spread (unchanged).
- **Confirmed and `[page]`-twin paths still come first**: confirmed paths are structured only and are
  pinned before the rounds as before; a `[page]` path still ranks before its fixed-index twin within
  its source.
- **Cost**: the DOM search, a few seconds per such field per Verify, free; a field whose pages
  really have only HTML pays it on every Verify (as one-response API fields already do).
