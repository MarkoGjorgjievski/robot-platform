# Verify never fails silently — design

**Status:** written 2026-10-20 under the standing approval (`CLAUDE.md`, "Autonomous runs"; queue
item 1), together with its plan (`docs/superpowers/plans/2026-10-20-verify-silent-failures.md`).
The cases come from campaign 2, group 3, "Silent failures" (`docs/testing/2026-10-11-campaign-2.md`;
per-site notes `docs/testing/results/campaign-2026-10-11/skims.md`, `skullcandy.md`, `ridge.md`),
left open by spec 2026-10-17 §11. Every cause below was traced in the code on `main` @ `7971bf8`;
the ridge case was reproduced with the real `certify`.

**Status:** implemented on `feat/verify-silent-failures` (seven tasks; Tasks 1, 2, 5 and 6 reviewed by the
controller, 3 by a reviewer, all covered by a whole-branch review on the most capable model). The
whole-branch review found one Important problem — a redirected proof page showed its full address
("Not checked on product 2 — redirected to https://…") — fixed in `d865300`; its Minors are left
(see the handoff). Merge gate on the branch: app 956, api 1044, scraper 1135 tests and tsc clean;
route smoke 27 of 27 against an isolated keyless pair. **Deviations:** a refusal sentence prefers a
problem that names a field over `other`; a stalled coverage check reads "The check took too long and
stopped. It runs again after your next Verify." (no button to run it again); the capture-verdict
sentences that name a host and an HTTP code are unchanged (a question for Marko in `docs/queue.md`).

## 1. Why

A customer who clicks Verify and gets nothing back cannot do anything. Campaign 2 hit three such
dead ends, and none was a page problem:

| Site | What the customer saw | What happened |
|---|---|---|
| skims | the button kept its label; no row changed; no message in view | our server refused the Verify (412) because the app and the server disagreed on a "not on this product" cell. The cause was fixed on 2026-10-13 (`aa2ae8b`), but any refusal still shows the server's raw text (field key, full address, "@") as the last element of the page, below everything. |
| skullcandy | every Status cell went blank; "Request timed out." far below the table, off-screen | one field's AI call timed out. `proposeWithAi` has no catch, so the whole run failed, everything decided was thrown away, the failed row became the newest result and every badge went blank. |
| ridge | Description "fails on product 4", the detail bar said only "fails on this product" | the description was on product 4's page, in a different place than on products 1–3. Certify's two-of-three branch called it `not_found` without checking whether another candidate was right there. The hint ("Not found on this page…") was wrong, and it only shows when the row is expanded. |

The same sweep found more places where a failure ends with no sentence a customer can read (§3.5).

## 2. The rule

**Every Verify, re-verify and proof-page capture that does not succeed ends with one sentence, in
view, that says what happened in customer words and what to do next.** Never a raw error, a field
key, an address, an HTTP code, a library's message or an internal word ("stalled", "superseded").
Results a customer already has are never wiped by a run that failed.

## 3. Changes

### 3.1 One message slot, in the Verify bar

The Verify bar (beside the button, where the disabled button's reason already appears) holds one
message: the refusal, the failed run, or the stalled run. The bottom-of-page `error` / `runNote`
block goes. The slot shows the newest message and clears when a new Verify starts.

### 3.2 The server's refusals in customer words

`sources.verify` refuses with structured problems, not one joined string: for each, the field's
name, the product number (the proof page's position), and a reason code. The app writes them:

| Reason | Sentence |
|---|---|
| a required cell is blank | "Rating on product 3 needs a value, or "Not on this product". Nothing was checked." |
| too few values (today's D3 text) | "{Field} needs a value on at least two products, or "not on this product" on every one." (spec 2026-10-17 §9, unchanged) |
| no schema | "This website has no fields yet. Add fields to the project, then verify." |
| a variants refusal | the existing variants sentence, moved into the slot |
| anything else | "Verify could not start. Try again; if it keeps happening, contact us." |

The product number is the page's position in the proof pages (1–6); an address is never shown.
The raw server text stays in the server log.

### 3.3 One field's AI failure is that field's result, not the run's

A throw inside one field's AI proposal (time-out, a malformed answer, credit exhausted, the
provider down) is caught for that field. The field ends `failed` with a new field-level reason,
`ai_unavailable`, and every other field's result stands; captures, cost and AI call count are
kept. The row's hint: "We couldn't finish checking {Field} this time. Verify again — nothing else
changed." The badge names it like any failure.

A throw outside a field (database, capture storage, browser launch) still fails the run. Then:
- the run's stored error stays raw (for ops), and the customer sees "Verify stopped before it
  finished. Your last results are kept — try again.";
- the Verification tab keeps showing **the newest completed run's** verdicts, badges and counts,
  not the failed run's empty ones. `verificationStatus` returns the failed run's message alongside
  the last completed result.

### 3.4 "Found here, in another place" is not "not found"

In certify's two-of-three branch, when the majority path reads nothing on this page and another
candidate is correct here, the cell is `fail` with a new reason `elsewhere`, not `not_found`. Hint:
"Found on this product, but not where your other products show it. If this product really has no
{field} of its own, choose "Not on this product"." The field still does not certify on that
evidence alone (the existing rules decide that).

### 3.5 Hints where the customer looks; captures that say why

1. The selected-cell detail bar shows the cell's hint under "fails on this product" (today only
   the expanded row has it).
2. A proof page whose capture fails during Verify (a page refused, time-out, gone) says why on
   the card and in its cells: the stored `blockedReason` is read and shown with the same verdict
   sentences the capture already uses (spec 2026-10-09, honest page verdicts). A field left
   incomplete by it gets a badge: "Not checked on product {n} — {reason}." instead of a blank status.
3. A field that failed with no fail cell (incomplete, or every page passed yet nothing certified)
   always gets a badge naming the reason; a failed field never shows a blank Status.
4. `found_unexpected`'s hint becomes a sentence: "Found {value} on product {n}, but you said it
   isn't there. Is it there after all?"
5. Cards and stage lines never show "stalled" or "superseded" or a raw start error:
   - a stalled proof-page capture: "The screenshot took too long. Take it again.";
   - a failed capture start: "The screenshot could not start. Take it again.";
   - a superseded coverage check: no message (a newer one replaced it); a stalled one: "The check
     took too long and stopped. Run it again.";
   - a proof-page poll that errors stops showing "taking screenshot…" and shows the start-error
     sentence.

## 4. What a customer sees

Every failure is a sentence beside the Verify button or on the cell, card or row it concerns, in
view. A failed run never blanks the table. No money, no internal words (memory
`customer-copy-no-internals`). Staff see the same; ops keeps the raw error.

## 5. Safety properties

1. A Verify that the server refuses changes nothing stored, and says so.
2. A failed AI call never discards another field's result, a capture, or the cost record.
3. A run that failed never replaces the last completed results on screen.
4. No customer-visible string contains an address, a field key, an HTTP status, "@", or a
   library's error text. A test sweeps the copy functions for these.
5. `elsewhere` never makes a field certify that would not certify today.
6. A set, result or status with none of the new fields behaves as today (old rows: no
   `ai_unavailable`, no `elsewhere`, no structured problems).

## 6. Testing

- Unit: the problem → sentence table; `ai_unavailable` (an agent whose `proposePaths` throws for
  one field: that field fails with the reason, the others certify, cost/calls kept); certify's
  `elsewhere` (the ridge shape, reproduced); the status query returning the last completed result
  with a failed run's message; every hint and badge copy; the no-internals sweep.
- API: `sources.verify` refusing with structured problems (product numbers, no addresses).
- Route smoke: a seeded refusal and a seeded failed run show their sentence in the Verify bar and
  the table keeps its verdicts; a seeded `elsewhere` cell shows its hint in the detail bar.

## 7. Not in this spec

- The variant check's single "The variant check failed — try Verify again" (it needs the variant
  vocabulary).
- Making the app's own gate match the server's checks exactly (a contract test).
- Removing amounts from the API's answers to customers (spec 2026-10-17 §11).
- Retrying a timed-out AI call automatically (the customer's next Verify is the retry).
