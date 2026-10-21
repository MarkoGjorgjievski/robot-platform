# Websites change follow-ups — design

**Status:** written and implemented 2026-10-21 under the standing approval (queue item 1, "Websites change
follow-ups"). Plan: `docs/superpowers/plans/2026-10-21-websites-change-followups.md`. Branch
`fix/websites-change-followups` from `main` @ `4c0a727`. Amends
`docs/superpowers/specs/2026-10-21-websites-change-design.md` (§3.3, §3.5, §7.6); the three defects are the
apply report's surprises 1, 3 and 4 (`docs/testing/results/2026-10-21-websites-change-apply/report.md`).

## 1. A refresh re-verify no longer hides the rest of its check (surprise 4)

**Today.** `websiteAttention` counts a current field's finding only when the check is newer than the latest
clean Verify. A refresh re-verify (`onlyKeys` = the refreshed fields, origin `refresh`) is that latest Verify
and is always newer than the check that started it, so every other field's `moved` / `lost` / unrefreshed
`changed` from that check disappears — a real lost field on a refreshed website goes unreported.

**Rule.** A current field's finding is superseded only by a newer check (the newest check that read the field
decides, as today) or by a newer clean Verify **that verified that field**. A refresh re-verify verified only
the fields it refreshed: those are the `value_refreshes` rows whose `verification_id` is that Verify. Every
other clean Verify verified every field, as before. Held fields are unchanged (their finding counts when newer
than the Verify that failed them). No new column: `value_refreshes.verification_id` already records which
fields a refresh re-verify was for. It is written in the transaction that inserts the re-verify's row, before it runs (review Minor 1), so an
unlinked refresh re-verify — which would read as a Verify of every field — cannot exist.

## 2. A refresh-started Verify starts no check at all (surprise 1)

**Today.** A refresh re-verify that passes starts the coverage check (the listing sample) in the background,
which supersedes the coverage check the scheduled check had just started and runs a second browser
alongside the next website's check. Spec §7.6 says a refresh-started Verify never starts a check.

**Rule.** A Verify with origin `refresh` never starts the coverage check (nor the `verify` check, as today).
The scheduled check's own coverage check (started by `checkWebsite` after the check) is the only listing
sample of a scheduled check. Everything else a passing refresh re-verify does stays (saving the verified
paths, clearing `driftedFields`, ending holds).

## 3. A field with nothing to compare is never "lost" for that alone (surprise 3)

**Today.** `classifyDrift` decides on pages that have an expected value. A field whose expected value is
blank on every page (Gymshark Brand: certified by `og:site_name`, reads "Gymshark" everywhere) has no deciding
page and is classified `lost` with `pages: {}`. A run or customer check of a field passed by its default alone
(`defaultOnly`, no certified path) is recorded `lost` too. The customer would see "Brand needs you" and
"Not found on the page — Mark it again" for a field that works.

**Rule.** With no deciding page and at least one page captured, the field is classified by what a run would
write: its certified paths are read on every captured page; the field is `other-layout` (still works) when
every captured page reads a value or the field has a website default, and `lost` only when some captured
page reads nothing and there is no default (its pages then say which: `value: null` where nothing read).
With a default, a blank cell's verified answer is the default: a page whose path reads a value that is not
the default (type-aware, `valuesEqual`) is `changed` ("Page now shows Nike (was Gymshark)"), never
`other-layout`; a page where nothing reads gets the default and still works (review, Important 2).
No captured page at all keeps today's answer (`not-checked` when a page could not be read, else `lost`
with the gone pages). A field with no certified path whose certifying result is `defaultOnly` and that has a
default is `other-layout` (every product gets the default), never `lost`. `other-layout` is not
actionable, so such a field never makes the website "need attention".

## 4. Not in this change

- A customer's own `onlyKeys` re-verify (and a variants-only Verify) still supersedes every current field's
  finding, as before; only refresh re-verifies are narrowed.
- Stored check rows are not rewritten: Gymshark's stored `lost` for Brand stays until its next check.
