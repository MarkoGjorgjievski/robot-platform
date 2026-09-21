---
name: Session handoff — state, decisions, and what to do next
description: Where the project stands as of 2026-09-02 and how to pick it up. Read this before starting.
type: project
---

# Handoff — 2026-09-02

## Read this first

**State on 2026-09-11.** `main` holds the whole MVP flow: routes and shell (phase 1), the contract on the dataset (phase 2), the Schema tab as the proof sheet (phase 3), the Extract tab stepper (phase 4) and the visual system (phase 5), all merged fast-forward from `feat/schema-verification` at `b025fbf`. Spec: `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md`; one plan per phase under `docs/superpowers/plans/2026-09-*-mvp-flow-phase*`; one section per phase below. `main` is not pushed: `origin/main` is at `941cac3`, far behind.

**Every phase was gated the same way:** a review per task, a whole-branch review on the most capable model, one fix wave, one scoped re-review, then the full per-package test gate (`pnpm --filter <pkg> test -- --maxWorkers=1`; `pnpm -r test` gets killed for memory on this machine) and `RUN_UI_SMOKE=1` against `pnpm dev:all`. All green on `b025fbf`.

**What a customer can do today, live and free:** create a project, name its fields, add a website with three product pages and expected values, verify (Ikea reads 8 of 8 fields verified; a re-verify of certified paths costs nothing), set listing pages on the Extract tab (each checked for product links and a pager), sample three products (the probe, no AI), and see the run sentence with both dropdowns on all. Screenshots of every state: `docs/testing/screens/` (its README says which is which).

**The next work, in order:**

1. **Click Extract once, on a real website, for free.** The plan-then-execute path from the Extract tab has never run live (phase 4 stopped short of it on purpose). Ikea's eight fields are all mechanical, so a full Extract there spends nothing; "custom 5 products across custom 1 page" is the cheapest proof. Watch the run page's results sheet (it now falls back to the contract's columns) and the Runs tab.
2. **A second website through the whole flow**, one whose fields need AI, under the budget rule: never click a Verify or Extract that shows a dollar amount without Marko's say-so. This is also the only way to capture the Verifying strip's rough time (no current screenshot; see the README's "no current capture" note).
3. **Engine follow-ups the phases surfaced** (details in the phase 4 and 5 sections): the listing check and the probe walk count product links differently on the same page (7 vs 28 on Ikea); the 5,000-product ceiling is per listing input, not per run; spec 5.3's row counts on the Output page were never built.
4. Then the older roadmap items below (pagination live proofs, the job queue). None of them blocks a customer.

**Two design notes written 2026-09-11, decision pending (Marko picks which goes first):**
`docs/superpowers/specs/2026-09-11-lean-capture-for-certified-runs-design.md` (measured 2026-09-15: a certified run
spent ~70 s per product on Ikea, 60 s of it the networkidle timeout. **First increment landed 2026-09-15:** the certified path now waits for its own values (`CaptureOptions.ready`) and takes the domain lock; measured 10.5 s per product on the same website, 8 of 8 fields on every row. Still to do there: the capture built for the AI chain — screenshots, markdown, click
rounds, a second render — when the certified paths need under a second; also records that the
certified path bypasses the 2 s politeness lock) and
`docs/superpowers/specs/2026-09-11-second-layout-learning-design.md` (a listing whose product
pages differ in layout leaves cells empty on a verified website with no way to certify the second
layout; the cheap increment is a grouped miss list with "use as proof page"). Both are drafts,
not approved designs. Marko's testing of the MVP flow on 2026-09-11 came back happy; a few
non-urgent UX tweaks are still to be named. A third note, `docs/superpowers/specs/2026-09-17-typesafe-evaluation-note.md`, records TypeSafe (small typed-judgment models, ~100x cheaper than Claude per call) as a possible later improvement for second-layout discovery and per-row checks: assessed, not a priority, nothing built.

**Do not** start another fix-and-dogfood cycle on extraction quality (see *What NOT to redo*), reintroduce uppercase labels or cards outside dialogs and the websites list, or run parallel implementer agents in this checkout without explicit-path commits (the shared index bit twice in phase 5).

## App redesign, plan 1: the shell (2026-09-21)

Spec: `docs/superpowers/specs/2026-09-21-app-redesign-design.md` (approved in
conversation). Plan and task briefs: `.superpowers/sdd/2026-09-21-app-redesign-plan1-shell/`.
Branch `feat/app-redesign-shell`, base `4a4b0ac`. The warm-paper proof-sheet look
was rejected outright on 2026-09-21; the customer surface is being rebuilt as a
dark, monochrome tech console (AI Studio / Vercel register) in a new package,
with an organisation and user model under it. `@robot/dashboard` keeps running
untouched on :3456 until parity, then goes (spec §7).

**What landed, one line per task** (`git log --oneline 4a4b0ac..HEAD`):

| Commit | What |
|---|---|
| `94f8e8a` | `users`, `memberships`, `sessions`; `orgs.personal` and `orgs.owner_user_id` |
| `ea98f12` | sessions, the `auth` router, and the `orgSlug` shim that keeps the old dashboard working |
| `b16ee4a` | adoption keeps the `default` slug; sign-in picks an org the user still belongs to |
| `ccd5d9a` | `orgs` router with roles; projects live in the session's organisation |
| `2c481e8` | `projects.delete` keeps the session-less default-org fallback |
| `6d915eb` | the `robot_session` cookie in and out of `@robot/api-server`; CORS for :3000 |
| `d187573`, `be8a2d9` | sign-in never adopts `default`; adoption becomes an explicit script (see *the incident*) |
| `6f9791d` | `@robot/app`: TanStack Start, tokens, themes, Geist, the tRPC client, `/login` |
| `c866c33` | `--muted` is never a text colour; the theme-boot hydration warning suppressed |
| `dd81020`, `fa19367` | light `warn` becomes `#a26000`, so every text colour clears 4.5:1 |
| `6ada990` | the shell — sidebar, org switcher, user menu, ⌘K, the projects table, the RunDot |
| `5bcb5e5` | a signed-out account's data never reaches the next one (`queryClient.clear()`) |
| `575f681` | `adopt-default` moves the user's sessions and drops the empty auto-created org |
| this task | the app smoke, the look-only check, the screenshot set, these docs |

**API changes** (all additive, `packages/api/src/routers/`): `auth.signIn / signOut /
me / switchOrg / setTheme`; `orgs.create / rename / delete / members.*`;
`resolveOrg(ctx, fallbackSlug)` in the customer procedures, which takes the org
from `ctx.org` when a session exists and otherwise from the `orgSlug` input. That
fallback — `orgSlug ?? 'default'` in `projects.list / create / delete / rename` — is the
**shim** that keeps `@robot/dashboard` working while both apps run; the cut-over
plan (spec §7, plan 6) deletes it together with `DEFAULT_ORG_SLUG`. Those four
are the only procedures that resolve the org at all so far: `projects.getBySlug /
getWithStats / listByOrg`, `sources.*`, `datasets.*` and `domains.*` still take
the org straight from the caller's input and ignore the session, and each
migrates to `resolveOrg` when its screen is rebuilt in plans 2–4. Migration:
`packages/db/drizzle/0010_identity.sql`.

**The incident (read before touching the dev database).** While executing an
earlier task of this plan, an implementer signed in ad hoc against the dev
database. Sign-in then *adopted* the seeded `default` org, and the cleanup that
followed deleted **that org** — which cascades to everything under it and so
took **every project with it**. (Deleting the user alone would not have done it:
`orgs.owner_user_id` is `on delete set null`. It was the org row that went.) The
data was rebuilt from the cached certified paths at $0 (nothing paid was lost),
but the rules changed:

- adoption of `default` is never automatic. It is the explicit script
  `pnpm db:adopt-default -- --email <email>` (`packages/db/src/scripts/adopt-default.ts`).
- no implementer runs sign-ins, deletes or cleanup scripts against the dev
  database. Browser sign-ins through `/login` with a throwaway
  `smoke-<timestamp>@example.com` address only; an org is never deleted, and the
  org whose slug is `default` is never touched.
- backups live in `C:\Users\Marko\Documents\projects\robot-platform-backups\`
  (`pg_dump` before any identity work).

**Spec amendments made while executing** (all written into the spec): adoption is
a script, §2; light `warn` is `#a26000`, §4; `--muted` is a divider/placeholder
colour and never a text colour. Two rulings were added to the adopt script on
2026-09-21: after adoption every session of that user is repointed at the adopted
org (so an open browser lands on the projects, not on an empty org), and the
personal org `signIn` auto-created seconds earlier is dropped — but only when it
is provably the empty shell (slug not `default`, personal, owned by that user, no
project, no cached extractors — those are org-scoped and would cascade — and no
other member). Otherwise it is kept and the script says why.

**The first sign-in on the dev database, done 2026-09-21** (the one live proof of
the adoption path):

```
browser, /login, markodjordjievski@gmail.com  -> user created + empty personal
                                                 org "Markodjordjievski"; /projects empty

pnpm db:adopt-default -- --email markodjordjievski@gmail.com
  org "default" (c812f66e…) is now personal, owned by markodjordjievski@gmail.com, named "Markodjordjievski"
  membership: created
  sessions moved to this org: 1
  dropped the empty personal org "markodjordjievski"

select slug, name, personal, owner_user_id from orgs
  default | Markodjordjievski | t | ccf03067-23e7-4557-877b-1d3a231b960b
  (plus the throwaway smoke-* orgs)

browser again: switcher lists exactly one organisation ("Markodjordjievski", Owner);
the projects table lists Acne (1 website, 8 fields) and Scratch;
auth.me -> currentOrg { slug: "default", name: "Markodjordjievski", personal: true, role: "owner" }
```

**How to run.** `pnpm dev:all` now starts **three** servers: api-server :4000,
the old dashboard :3456 and the new app :3000. `pnpm test:ui:app` is the app's
Playwright smoke (needs all three up; signs in through `/login` as a throwaway
address, walks every screen in both themes, creates and deletes one project).
The look-only check is
`cp docs/testing/ui-check-app-shell.mts packages/browser/src/__ui-check.mts && cd packages/browser && pnpm exec tsx src/__ui-check.mts <outDir> [email]`
— with an email it measures that account's data instead of an empty throwaway org.

**The screenshot set for Marko's review** (`docs/testing/screens/`, 1440×900,
full page): `app-login.png`, and `app-projects`, `app-runs`, `app-usage`,
`app-settings`, `app-account` each as `-dark.png` and `-light.png`. The two
`app-projects-*` were retaken against the real database, so they show Acne and
Scratch rather than an empty throwaway org.

**What the look-only check measured, and what it fixed.** Measured on the real
data, dark: sidebar 240 px, body 13 px, page title 20 px/600, tallest table row
37.00 px, uppercase elements 0, shadowed elements 0 (also with the dialog and its
overlay open), running dot `pulse-dot 1.6s` at 8 px. Three things the screenshots
changed: `app-login.png` was a **blank page** because a headless browser starts
the page-load `.rise` animation only on the frame the screenshot itself provokes,
so the capture froze the `opacity: 0` keyframe — every capture now passes
`animations: 'disabled'`; the user menu's **Theme** item sat 18 px left of
*Account* and *Sign out* because it alone had no icon, and now has one; and the
shadow rule is now also asked with the dialog open, since a page with nothing
floating over it has no shadow to find.

**Open decisions for the design review:**

- a signed-out `/login` is always dark, because a visitor has no stored
  preference and the OS one is not read there. Confirm with Marko, or read
  `prefers-color-scheme` on that one screen.
- the `QueryClient` lives in `Providers`, one per browser session, and three
  exits remember to clear it. Keying it on the session identity
  (`<Providers key={session?.user.id}>`) makes that structural — worth doing in
  plan 2, when a screen caches more than one list.
- the org switcher truncates a long organisation name because the "Personal"
  badge and the chevron take fixed width ("Markodjordjiev…"). Spec §3 asks for
  the tag, so it stands until Marko says otherwise.
- a placeholder is `--secondary`, the same grey as its label, because `--muted`
  misses 4.5:1 on every surface. An empty field therefore reads a little like a
  filled one.
- the focus ring is a 1 px outline in `--text` at 2 px offset, not the
  `--border-hover` the plan asked for: `#333333` on `#0a0a0a` is all but
  invisible, and a focus ring that cannot be seen is not one. It is crisp and has
  no glow, so it stays inside the system's register — but it is brighter than the
  plan intended and Marko should look at it.

**Next: plan 2** — project home, fields, output (spec §5 rows 3 to 5).

## Schema stepper, engine (2026-09-18)

Spec: `docs/superpowers/specs/2026-09-18-schema-stepper-with-marks-design.md`
(approved). Plan: `docs/superpowers/plans/2026-09-18-schema-stepper-engine.md`
(spec §7 items 1 and 2; the screens, items 3 to 6, are separate plans still to
write). Branch `feat/schema-stepper-engine`, eleven tasks, each reviewed;
whole-branch review at the end. The idea: a customer marks a field by clicking
it on a screenshot of a proof page instead of typing its value; the click gives
the expected value plus the element's XPaths as one more candidate, and
certification is otherwise unchanged. No model anywhere in the stepper
(TypeSafe/Jev was considered and rejected for it, see spec §1).

What landed, one line per task: `CaptureOptions.annotate` (a page script run
once after the expand rounds, its value on `PageCapture.annotation`) and
`maxTiles`; the box map (`box-map.ts`: every visible element with its own text,
plus images and links, with the generator's XPaths and page-pixel rects);
`buildProofPageReadyCheck` (stable text plus one structured source), the shared
`captureProblem`, and `captureProofPage` (six tiles); `Mark` and
`VerificationSet.marks`, folded into `fieldHash`/`definitionHash` (byte-identical
without marks) and into `gatherCandidates` (a marked page takes the mark's
XPaths instead of the DOM search); `suggestMarks` (JSON-LD → meta → API,
shallowest path wins, boxes matched by `valuesEqual`); `transferMarks` (page 1's
candidates tried on the other pages in certification's order, stable first);
`capture-store.ts` and the proof-page capture job on the `captures` table
(`metadata` is the `capturing`/`captured`/`failed` state machine, tiles as PNGs,
`contentHeight` = bottom of the lowest box, NOT the captured height);
verification reuses a fresh proof-page capture; `updateBinding` accepts `marks`
(a mark on a blank cell is refused); the procedures `sources.captureProofPage`,
`proofPageCapture`, `suggestMarks`, `transferMarks`.

Spec amendments made while executing (all written into the spec): the API
keeps requiring a location hint per field (the screens send the catalogue
description or the field name); `proofPageCapture` returns three heights —
`pageHeight` (the document), `capturedHeight` (what the tiles cover; the viewer
says "page cut at N px" when the page is longer) and `contentHeight` (the
lowest box's bottom edge) — and boxes below the captured strip are dropped;
`suggestMarks` and `transferMarks` answer with the `captureId` their box
indices refer to, and a target page with no fresh capture comes back `null`;
a `capturing` row older than three minutes is closed as `failed` / `stalled`;
a mark whose text no longer equals its cell's value is dropped on save.
**`updateBinding` is a whole-binding save**: a client that omits `marks`
erases them, so the stepper and Import values must both round-trip marks.

Known risk, parked with a ruling (whole-branch review, item 5): verification
that reuses a proof-page capture skips its own ready check, which waits for
the typed values; a proof-page capture waited only for stable text plus one
structured source. A field the customer typed rather than marked can be
absent from that capture and read `not_found` where a fresh capture would
pass. Mitigation when it shows up: re-capture only the pages where a field is
`not_found` on a reused capture.

Live check, 2026-09-18, free (keyless api-server on :4100, nothing written to
the Ikea binding): `docs/testing/2026-09-18-proof-page-capture-live.md`.
Captures 14.7 / 16.8 / 16.3 s per page, six tiles, 252 to 288 boxes.
`suggestMarks` on page 1: price, total reviews and rating right with the
element outlined (the price box checked by eye on the tile), title right
after a same-day fix (the BreadcrumbList block's `name` had beaten the
Product's), `price_currency` and `subtitle` wrong for reasons outside this
plan, `product_id` and `product_details` none. `transferMarks` to pages 2 and
3: 8 of 8 and 7 of 8 fields, 8.9 s. Follow-ups in that file: `deriveConcept`
makes `price currency` a `price` and gives `product_id` no alias; the
unknown-concept fallback matches API translation strings; a value spread over
child elements gets no box.

Next: the screens. Plan order per spec §7: catalogue and step 1, step 2 with
background captures, step 3 (the mark screen), then the proof-sheet controls,
arrivals and the smoke run.

## Schema stepper, step 1 (2026-09-19)

Spec: `docs/superpowers/specs/2026-09-18-schema-stepper-with-marks-design.md`
§2.1. Plan: `docs/superpowers/plans/2026-09-19-schema-stepper-step1-fields.md`.
Branch `feat/schema-stepper-step1`, six tasks, each reviewed. The Schema tab is
a stepper now: **1 · Fields** (the catalogue) and **2 · Pages and values**
(today's proof sheet, standing in for spec §2.2 and §2.3 until they land).

What landed, one line per task: `packages/api/src/schema-catalogue.ts` and
`datasets.catalogue` — 24 for Product, 12 to 20 for the others, grouped, each carrying
the engine `concept` so a catalogue field suggests and caches without
`deriveConcept`'s name guessing; `datasets.addField` takes `description` and
`concept`, and the description becomes every website's default location hint;
`src/lib/schema-stepper-view.ts` (`stepOf`, `stepStates`, `sharedNote`,
`addNote`) as pure decisions; `src/components/field-catalogue.tsx` — a schema
type row with a 2px rail, then labelled rows of chips, a chip already in the
contract reading "added" and disabled — wired into `ContractEditor`, so the
project home's field list offers the same catalogue; `src/routes/source-schema.tsx`
as the two-step stepper (`?step=fields|pages`, the grid as interim step 2) with
`reconcileRows` carrying a field added, renamed, retyped or deleted in step 1
down onto the grid's rows without losing typed cells; and this look-only
browser check.

From the whole-branch review, also landed: `datasets.addField`, `renameField`,
`retypeField` and `deleteField` re-read the dataset row `FOR UPDATE` inside
their own transaction and compute the new schema from that (two chips clicked
in a row used to lose one field — both calls appended to the same
pre-transaction copy), with concurrent-add tests; step 1 renders `locked`
("Fields are locked while verifying") for the length of a run, because a field
added mid-run makes the paid run not-current the moment it ends; and a `done`
section is `inert`, so a finished step is read-only until Edit.

Three amendments made while executing, recorded here rather than in the spec
(spec §2.1 still describes the intent, not these details): `datasets.catalogue()` takes
no input and returns every type in one object (the client picks; the list is a
static module, so there is nothing to save by asking per type); the
proof sheet's "Edit fields on the project page" sentence is gone — step 1 sits
directly above the grid, so the errand it sent the customer on no longer exists;
and §2.1's "20 to 30 entries per type" was relaxed to 12 to 20 for every type
but Product — a listing card or an event page simply has fewer fields worth
suggesting, and padding the list to 20 would mean inventing them. A test in
`schema-catalogue.test.ts` enforces both ranges.

The look-only browser check (`docs/testing/ui-check-schema-step1.mts`, five
screenshots in `docs/testing/screens/`, 27 assertions, all green) found two
things unit tests cannot see, both fixed:

- **Adding the first field silently finished step 1.** The step is a search
  param, and with no `?step` at all `stepOf` answers `pages` the moment the
  project has a field — so the customer's own first chip faded the catalogue
  they were still picking from to `done` and made "Next: pages" a no-op.
  `source-schema.tsx` now pins `?step=fields` (replace) the first time the tab
  opens on step 1 by itself; the Add website dialog already pinned it (§2.5).
- **Wrapped chips did not line up.** The group label was the first item of the
  same `flex-wrap` row, so on the project home's narrow left column a second
  line of chips started under the label. The label is its own column now and
  the chips wrap inside theirs.

Left alone, for the redesign of step 2 to settle: the grid's "Where it is on
this website" column is 240px, so the longest catalogue hint ("The product name
as shown in the page heading") is clipped in its input.

Next: **step 2 — pages with background captures** (spec §2.2): a listing URL
that fills three proof-page slots, `sources.captureProofPage` running per slot
in the background with a thumbnail, Swap and Try again, and Next enabled once
every slot has a landed capture.

## Second-layout proof pages (2026-09-17)

Spec: `docs/superpowers/specs/2026-09-17-second-layout-proof-pages-design.md`.
Plan: `docs/superpowers/plans/2026-09-17-second-layout-proof-pages.md`. This is
the cheap increment the 2026-09-11 second-layout-learning note called for.
Landed: a website may carry three to six proof pages instead of exactly three
(Schema tab: an "Add page" column, "Remove this page" on pages four to six,
"not checked" for a blank cell there). A field certifies when a set of at most
five paths together covers every page it is checked on, where a path is safe
only if it is correct or resolves to nothing on every page it touches — a path
wrong on any checked page is never certified, so a second layout can only add
coverage, never launder a bad path. A one-layout website certifies exactly as
before. When more than one layout is needed, each certified path carries
`provenOn` (the pages it was proven on), and the field carries
`thinEvidence: true` if some path is proven on only a single page. `fieldHash`
and stored-result reuse are per field, over the pages that field is checked
on, so adding a page for one field leaves every other field's certification
untouched, and a field with a value on every page keeps its existing hash and
stays current. `crawl.misses({ runId })` groups a run's empty cells by field
and by the listing each missed product came from
(`run_items.input_values.url`); the run page lists them per field with "Use as
proof page", which pre-fills the Schema tab via `?addPage=<url>&field=<key>`
(waiting if the table is locked by a running verification).
`crawl.backfillPreview` reports `certified` with a zero cost estimate for an
already-certified website, and offers no dead-field strategy. Not built:
automatic discovery of a second layout's path without an expected value, using
the other missed pages as unlabelled evidence, a blank on pages one to three
meaning "not on this product," or speeding up verification's own captures. A
real second-layout website has not been run through this flow live yet.

Live check, 2026-09-17, free by construction (a second api-server started with no `ANTHROPIC_API_KEY`, driven over tRPC; Marko's own dev servers untouched): a fourth Ikea product page was added with only `price` typed. On save, 7 of 8 fields stayed current and only `price` went stale; the estimate counted `price` as AI-reachable (`aiFields: 1`, $0 with no key); verifying `price` alone passed on all four pages with no `provenOn` and no thin-evidence flag (Ikea has one layout), and the other seven fields were not re-run. It took 346 s because verification still captures with `networkidle` (four pages at ~70 s on Ikea; the certified-run speed fix does not cover verification). The website was then restored to its three pages (verify 5 s on fresh captures, 8 of 8 current). A look-only browser check of the Schema tab and the run page found and fixed three defects no unit test could see: a cold load of the `?addPage` link applied the page to the placeholder grid before the website's data loaded; the Add page control sat off-screen in the scrolling table (there is now an "Add proof page" button beside the import); and `crawl.misses` counted never-extracted products as empty cells (it now counts only products that produced a row). The look-only browser check is kept at `docs/testing/ui-check-schema-arrival.mts` (its header says how to run it; it is hard-wired to the Acne / Ikea website and never clicks Verify); the UI smoke does not cover the arrival link yet.

A whole-branch review on the most capable model then found two defects sitting between tasks, both fixed (`b88097c`, `7d00089`): the AI fallback was handed pages a field is not checked on, with a blank expected value (never exercised, since every live check ran keyless); and removing page four while a page five exists could write the removed URL onto page five, because the header popover stayed open with a stale draft. The same wave made the run page's missed-products list survive the moment the customer saves a fourth page (`crawl.misses` now reports `proofSheet`; the website is uncertified until that verify passes).

**Follow-ups this work surfaced, in the order I would take them:**

1. **What "resolves to nothing" means.** `certify` treats a path as unsafe if it yields any non-empty value that is not the expected one, including a value that fails the field's type (the price path reading "Out of stock" on the second layout). Extraction skips exactly those values and falls through, so they could safely count as nothing. Today such a page blocks the second layout and uncertifies the website. It fails closed and matches the approved spec wording, so it was left alone: it is a spec decision.
2. **The failure reads badly.** When a path is wrong on page four, pages one to three say "Several places match" (the old three-page wording). A neutral line there would point the customer at page four.
3. **The AI path on more than three pages has never run live**, and `EST_AI_COST_PER_FIELD_USD` is flat per field while the prompt grows with each checked page. Exercise it once under the budget rule and decide whether the estimate scales.
4. ~~Verification captures still wait for `networkidle`.~~ **Done 2026-09-17.** A proof page is now captured with `load` plus a ready check built from the values typed on that page (`buildVerificationReadyCheck` in `packages/scraper/src/verify/verification-ready.ts`): the page is ready once every typed value can be found, by the same DOM search and structured search verification runs afterwards. It polls after the popup and "show more" rounds (`ReadyCheck.when: 'after-expand'`), because some values only exist in the DOM once those have run, and then takes a short grace (no new response for 750 ms, capped at 3 s) so an API response landing just after the value is visible is not missed. Measured on Ikea's three proof pages, no key, nothing written: about 70 s per page before; 8.4 s per page after (16 s for the first, a cold load), ready on the first poll each time, grace 0.8 to 1.1 s, all eight fields pass with no AI, and seven of eight certify exactly the stored paths (the eighth differs only by a build hash in a backup XPath, see 8). A value that never appears costs the bounded 8 s poll plus at most 10 s, not 60 s.
5. Paste of a six-column block onto a four-page grid is ambiguous (name, type, description, three values versus name, description, four values); the file import was made tolerant, the paste path was not.
6. Small UI items: a sticky field-name column (focusing page four scrolls it out of view); `disabled` instead of `pointer-events-none` on the Import and Add proof page buttons while the table is locked; `?addPage` stays in the URL after it is consumed; the look-only browser check for the arrival link (`docs/testing/ui-check-schema-arrival.mts`) is a manual script, not part of the UI smoke.
7. A real website with two layouts has not been through this flow yet.
8. ~~Certified XPaths lean on attributes that change when the site redeploys.~~ **Done 2026-09-17**, and it took four rules, not one, because each fix exposed the next weakness on Ikea's `subtitle` (whose only certified path was anchored on `data-skapa="price-module@11.1.8"`):
   - **`looksVolatile`** (`dom-scripts.ts`): the generator skips ids, data-* values and class tokens that look generated: build hashes (`634a7e0`), version stamps, long numbers, CSS-module and CSS-in-JS names, React `:r1:`, and state values (`true`, `0`). The last was added when, with the version stamp skipped, the generator anchored on `data-online-sellable="true"`.
   - **Several anchors per element.** One page cannot tell a stable anchor from a product-specific one (`data-product-name="KIVIK"`). The generator now offers up to three XPaths per element, nearest anchor first, then the next one up, then the body-rooted path, and the proof pages decide.
   - **Class lists with state in them are matched on their stable base.** Ikea's price module is `… pipcom-price-module--bti` on one sofa and `--none` on the next, so an exact class match gave the same element a different XPath per product. A list with a BEM modifier or a state token is now matched as `contains(concat(" ",normalize-space(@class)," ")," base ")`; a plain list keeps the exact form, so existing XPaths look as they did.
   - **A cover is not made of one-page paths** (amends the 2026-09-17 second-layout spec §3). Before the two rules above, the cover rule had certified `subtitle` with three XPaths anchored on the three proof pages' own product names: each safe, together covering every page, and matching no other product. A cover's strongest path must now be proven on at least two pages.
   Certification also prefers stable paths: `certify` tries the stable candidates alone and falls back to volatile XPaths only when nothing else certifies (a fragile column still beats an empty one), and a re-verify no longer takes the cached shortcut when the cached certification rests on a volatile XPath. Checked on Ikea with no key and nothing written: all eight fields pass, no volatile XPath remains, and the newly generated XPaths for `subtitle`, `title` and `product_details` returned the right value in 45 of 45 checks on five products they were not built from. **Ikea's STORED certification still holds the old paths** until that website is re-verified, and the Schema tab will not offer a re-verify because nothing on it changed; there is no "re-verify everything" control yet.
9. **The other customer-facing captures still wait for `networkidle`** and pay the same 60 s on a site like Ikea: the listing check and "Find pages" (`sources.ts`, two calls) and planning's listing captures (`plan-run.ts`; the Ikea plan took 86 s for two listing pages). They need their own ready check (enough product links found), which is a smaller job than this one was.

## MVP flow phase 1 (2026-09-08): routes and shell landed; phases 2 to 5 follow the spec

Spec: `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md`. Plan for this phase:
`docs/superpowers/plans/2026-09-08-mvp-flow-phase1-routes-and-shell.md`. What changed: `/projects`
is home; every customer route moved from `/p/…` to `/projects/…` with redirects kept
(`packages/dashboard/src/lib/legacy-routes.ts` is the table); operator cache views moved to
`/ops/domains`; the wizard landing page is gone; a project is created by name
(`projects.create` also makes its dataset) and a website by name inside it
(`sources.createInProject`); both are renameable inline; `sources.updateSchema` now keeps the
source's input set in step with the schema (listing URL → one listing row, else the three product
URLs as detail rows). Scratch is an ordinary project. `createWithSchema` and `quickCreate` still
exist and are removed in phase 2 with the project-level field list.

Next: phase 2 (contract on the dataset, per-field certification), then 3 (Schema tab), 4 (Extract
tab), 5 (visual system), each as its own plan.

## MVP flow phase 2 (2026-09-09): contract on the dataset

Spec: `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md` §12 item 2. Plan:
`.superpowers/sdd/2026-09-09-mvp-flow-phase2-contract-on-dataset/`. Field name and type now live
on the project's dataset (the contract), not on the website: `datasets.schema` is an array of
`ContractField` entries — `{ key, name, type, concept }` — with a stable `key` derived once from
the name and never recomputed on rename, so a field keeps its identity across a rename or a
retype. `datasets.addField`, `renameField`, `retypeField`, and `deleteField` mutate that array and
propagate the change to every website in the project; `datasets.fieldStatus` and `getContract`
read back the per-field state (name, type, concept, and "verified on n of m websites") that the
project home's editable field list and the Schema tab both use. `sources.updateBinding` replaced
`sources.updateSchema` and now owns only a website's own state: its location hints (description
per field), its three proof pages, and the expected values typed on them — never the field's name
or type, which the Schema tab now locks and links back to the project page instead of letting you
edit inline. `sources.createInProject` seeds a new website's bindings straight from the project's
current contract, so a website is never created with an empty or divergent field list.
`sources.createWithSchema` and `sources.quickCreate` — phase 1 leftovers that let a website define
its own fields — are removed. Certification is current per field rather than for the source as a
whole: each verification result carries a `fieldHash` (derived from that field's key, type,
description and concept, plus its binding's proof pages and that field's expected cells —
deliberately excluding `name`, since a rename is free per spec §4.3), and
`verificationStatus.currentKeys` is the set of field keys whose stored result's `fieldHash` still
matches the field's current definition. A retype (or a proof-page/expected-value edit) after a
website was verified falls out of `currentKeys` for that website until it is re-verified — free,
since a re-verify replays the same proof pages against the new definition.

`pnpm db:lift-contracts` migrates pre-phase-2 data: it lifts each project's existing per-website
fields into that project's (until-now-empty) dataset, so existing projects get a contract instead
of starting over. **It has been run once on this machine**, during Task 6 of this plan. Its final
run here printed `datasets updated: 0; projects given a dataset: 0` — not because there was
nothing to lift, but because the lift had already happened earlier in the same test run; the
run that actually did the lifting is the one the summary line describes as having found the one
real conflict it flagged for hand review: the dataset for the Scratch project, field `price`,
**kept `money` and ignored `number`** from one Scratch source. That conflict is parked for hand
review, not auto-resolved. Every website that existed before this lift needs **one free re-verify**
to become current again — the lift populates the contract and the bindings, but a stored
verification result's `fieldHash` predates the lift and won't match until the website is
re-verified against its now-contract-derived field definitions.

## MVP flow phase 3 (2026-09-10): the Schema tab is the table

Spec: `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md` §5.6. Plan:
`.superpowers/sdd/2026-09-10-mvp-flow-phase3-schema-tab/`. The Schema tab (`source-schema.tsx` +
`SchemaGrid`) is now the table itself — no separate grid screen and no ghost row; paste and
CSV/XLSX import both match cells to rows by field name only (unchanged from phase 2). Field and
Type are read-only in this table (they live on the project's dataset since phase 2) with a note
pointing back to the project page for edits.

Page URLs moved from the old "Product URL 1/2/3" input row into the table's own column headers
(`PageHeaderCell`): each header shows the shortened path, a per-column capture-state icon
(`idle`/`queued`/`capturing`/`captured`/`not_captured`), and — unless the table is read-only or
locked by an in-flight run — a pencil (`aria-label="Edit page N"`) that opens a popover to retype
the URL directly, or to type a listing-page URL and "Find pages", picking one of the results with
"Use as page N". Editing a page URL there marks the whole grid stale via the existing
`isRowStale`/`reverifyKeys` machinery — a URL change re-verifies *everything*, not just that
column; this is stricter than necessary but deliberately kept (every stored cell result is keyed
to the URL it was proven against, so a moved column has no safe partial reuse). **The listing URL
is no longer edited on this tab at all** — phase 4 gives it a proper home on the Extract tab.
Nothing was dropped to make room for that: the binding's `listing_url` still round-trips
untouched — `GridState.listingUrl` still carries it and `toBindingInput` still sends it
(`{ ...(state.listingUrl.trim() ? { listingUrl: state.listingUrl.trim() } : {}) }`) — the tab
simply has no input for it right now, so it can only change via `findProductPages`'s remembered
value or a future Extract-tab control.

The status strip (`StatusStrip`, fixed 38px tall, `role="status"`) has five states
(`schema-tab-view.ts`'s `stripState`/`stripSummary`): `editing` ("Not verified yet · n fields · k
pages"), `active` ("Verifying", with the progress bar and stage text), `stalled` ("This
verification stalled. Run it again."), `failed` ("The last verification failed"), and `results`
("n of m fields verified" plus " · k need attention" / " · j changed since" when either is
nonzero). Every expected cell reserves a second line (`cellLine`) so cells never resize between
states: pass shows "from <source>" or, when the page's live value differs from what was typed,
"page shows <value>"; fail shows one of the five red hints (`hintFor` — not_found,
different_value, ambiguous, type_mismatch, verbatim per spec); stale shows "changed since
verified"; not_captured shows "page not captured" with a screenshot link when one exists. A
not-found text cell whose typed values are all http(s) URLs gets the type-fix chip (
`typeFixSuggestion`) suggesting a retype to `url` via `retypeField`, which surfaces the
project-dataset "which website" ownership error if the field is shared and locked elsewhere.

Re-verify pricing is now scoped and can be free: `sources.verifyEstimate` takes an optional
`onlyKeys` and returns `capturesFresh` — true when every proof-page URL's last completed
verification captured within `CAPTURE_REUSE_MAX_AGE_MS` (currently one day). The dashboard's
`verifyButton` (`schema-tab-view.ts`) labels the button "Re-verify n fields · free" only when
captures are fresh AND (AI is unavailable OR the scoped upper bound is $0) — otherwise "Re-verify
n fields · up to $X.XX". `verification-view.ts`'s `reverifyKeys` now also takes a `currentKeys`
argument: a field whose last result certified but whose stored `fieldHash` the server no longer
counts as current (phase 2's per-field certification currency, e.g. after
`pnpm db:lift-contracts`) now falls into the re-verify set too, so a pre-phase-2 proof that never
touched this UI can still be re-verified for free once captures are fresh, instead of silently
reading as "everything is verified" against a stale hash.

Unrelated fix folded in here because it's the same button code: `disabled:pointer-events-none`
was added to the `btn-primary`/`btn-quiet` Tailwind utilities (`styles.css`). Without it, a
disabled `<button>` still intercepts the pointer event itself, so a wrapping `<span onClick=...>`
placed around it — used here to show the disabled reason as a tooltip/toast, and already used the
same way by phase 1's dialogs — never received the click. With `pointer-events-none` on the
disabled button, the hit-test falls through to the wrapper, which now fires correctly; this
incidentally fixes a phase 1 dialog bug of the same shape, not just this tab.

Screenshots taken for this task live under `docs/testing/screens/`: `schema-tab-editing.png` (the
Ikea Schema tab as it loads — 8 fields, 3 captured pages, all cells passing) and
`schema-tab-popover.png` (page 1's pencil clicked, showing the URL field and the "find pages from
a listing" control). **The Ikea live re-verify was NOT run**: its button read `Re-verify 8 fields
· up to $0.40` (captures older than a day), which this task's budget rule forbids clicking, so
`schema-tab-verifying.png` and `schema-tab-results.png` do not exist yet. They can be captured
once Marko approves that spend, or once a fresh (same-day) capture makes the button read "free".

**Live proof, same day, free:** after the final fix wave made `verifyEstimate` price only fields that still need AI (a field whose latest result already certified replays stored paths at no cost), the Ikea button read `Re-verify 8 fields · free` and the controller clicked it. The cycle took 9 s: strip `Verifying · starting` then `searching` with the table locked and every header `queued`, then `8 of 8 fields verified` with Extract unlocked. `schema-tab-verifying.png` and `schema-tab-results.png` now exist under `docs/testing/screens/`. The earlier `$0.40` label was the old pricing rule (every field in the set priced), not stale captures.

## MVP flow phase 4 (2026-09-10): the Extract tab is a stepper

Spec: `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md` §5.7. Plan:
`.superpowers/sdd/2026-09-10-mvp-flow-phase4-extract-tab/`. Landed across seven tasks
(`git log --oneline 8671af7..HEAD`): budget accepts `'all'` pages, resolved to the single-burst
ceiling (`da65e0e`); `sources.checkListingPage` reports product links and pager presence
(`49fbbeb`); pure view logic for the stepper (`6211aa9`, `eedd0b5`); listing pages and product
URLs as the source's input, budget on `update`, binding-save input-mode respect (`c4efcbc`); the
stepper shell and its three sections (`a6811f3`); an API fix wave for the input-set lost-update
window and the sandbox-source case (`e027653`); the sample polling from `planning` plus six review
fixes (`803eb74`); the tab itself — `source-extract.tsx` — wired up, with Overview retired from
the tab bar (`6d8b24e`); a fix wave including the switched-mode-is-not-saved-pages blocker
(`2152a66`); and the 40/3-starter-vs-real-choice fix (`38af6e1`). The tab bar is now **Schema /
Extract / Runs / Settings** — `/overview` and `/p/…/overview` both redirect to `/extract`, and
nothing on the Schema tab starts a run any more (its strip button became a navigation, "Go to
Extract").

The tab is three always-rendered sections — **1 · Pages**, **2 · Sample**, **3 · Run** — over one
`Stepper` strip. Nothing disappears: a finished section locks with an `Edit` button, a
not-yet-reachable section stays visible and dimmed with the reason in place of its hint, and only
`inert` removes interactivity. When the website's schema is not fully verified, a `StatusStrip`
reading "Extraction is locked · n of m fields verified · fix `<field>` on the Schema tab" replaces
all three sections with the locked/dimmed state and a link back to Schema — nothing below it
applies until every cell is green.

**API surface added or extended:** `sources.checkListingPage` (product-link count + pager
detection, free, no AI), `sources.setListingPages` / `sources.setProductUrls` (the input set),
`sources.inputRows` (new public procedure — `{ urls, updatedAt }`, keyed off `input_sets.updated_at`
rather than the Source's own `updated_at`, which a rename/budget/schema save/confirm all bump for
unrelated reasons), `sources.update` now taking a `budget`, and `sources.listByProject` now also
selecting `budget` and `parameters` (verified live: Ikea's row returns
`budget: {mode:'first_n',max_items:40,max_pages:3}` and `parameters: {...}`).

**`'all'` pages resolves to `PAGES_ALL_CEILING` (10), not an unbounded walk.** The walk's own
anti-bot rule already caps a single burst at ten pages, so an "all" that tried to mean "no limit"
would silently behave like ten anyway; the tab is honest about that limit up front ("up to 10
pages per listing") instead of promising something the engine can't do in one burst.

**`parameters.inputMode` is the marker that the Extract tab, not the old flow, now owns this
Source's input.** It is set the first time `setListingPages`/`setProductUrls` saves pages, and it
has two effects: (1) a **binding save leaves the input alone** — `toBindingInput`'s remembered
listing URL no longer overwrites what the tab has saved, so re-running "find pages from a listing"
on the Schema tab can't clobber the Extract tab's input set; (2) the old flow's **40/3 automatic
starter budget counts as unset only while the marker is absent**. `budgetIsUnchosen` reads the
Source's *prior* `inputMode` inside the same transaction as the budget it's judging — an empty
budget is always unset, but the exact starter triple `{max_items:40,max_pages:3,mode:'first_n'}`
is unset **only when `priorInputMode === undefined`**. Once the marker exists, any non-empty budget
is treated as a real choice and never silently reseeded to all/all — which matters because
`budgetFromForm(40, 3)` is byte-identical to the starter, so a customer who deliberately picks
40/3 must not have that choice mistaken for the unset default on their next visit.

**The 5,000-product safety stop is per listing input, not per run.** `planRun` measures each
input's item cap and `maxPages` against that input's own gain, never a running total across the
run — invisible before this tab, when a Source had exactly one listing URL from the wizard, and
material now that up to 50 listing pages can be saved (50 × 5,000 at all/all). The Run sentence
says "safety stop at 5,000 products per listing" for that reason; product-URL mode, which has one
input row per URL and no walk, says "safety stop at 5,000 products". Enforcing a genuine run-level
total in `planRun` is the alternative, and is a phase 5 decision.

**The sample-finished rule**, used to unlock step 3: a probe run counts as finished when its
status is `completed`, **or** `partial` with `rows > 0`. `partial` is a terminal status on this
engine (it never becomes `completed`), and the ordinary outcome of a sample walk that finds more
product links than it extracts is exactly `partial` with some rows — so gating step 3 on
`completed` alone would make it unreachable forever for a normal listing. `sampleFinished` lives in
`lib/extract-view.ts` and is the single source of truth `stepStates` calls; the route does not
launder the status.

**Live proof — Ikea, project `acne`, `/projects/acne/sources/ikea/extract`, free throughout (one
listing check, one probe sample, no AI). Extract was never clicked.** The check on the saved
listing page read, verbatim, **`7 product links · pager found`**. The sample that followed walked
**2** pages, found **28** product links, detected pagination as **`mechanical: url-pattern`**, and
finished with sample rows complete **3 of 3**. Instrumenting the network confirmed **0** captures
on page load — the saved row shows `saved` with a manual `Check` button, nothing fires until it's
clicked. For a website going through the tab for the first time, the Run section opens with both
dropdowns on `all`/`all`: "1 listing · up to 10 pages per listing · safety stop at 5,000 products
per listing". Four screenshots recorded the walk-through: `docs/testing/screens/extract-pages.png`,
`extract-checked.png`, `extract-sample.png`, `extract-run.png`. **The plan+execute path — the
Extract button itself, in every branch — was not exercised live**; only the free steps (check,
sample) were clicked.

**Ikea's own Source is a dev-database quirk, not the general case.** Its stored budget is still
the 40/3 starter, because the first live save against it (during this phase's fix-round checks)
happened *before* the `inputMode`-gated reseed rule existed, so the save that set the marker did
not also clear the starter. The two together now read as "a real 40/3 choice" under the current
rule, so **Ikea's Run section opens on custom 40 / custom 3**, not all/all — that is the rule
working correctly on a Source whose history predates it, not a bug. One `sources.update` with
`{max_items:'all',max_pages:'all',mode:'all'}` would clear it if a true all/all screenshot against
Ikea is ever needed; nothing was written to the customer's Source just to make a screenshot match.

**The listing-check and the probe-walk disagree on the same page (7 vs 28 links), and this is
pre-existing, not introduced here.** `describeListingPage` (the free check) groups raw anchors by
path template and reports the largest same-template group; the probe's own walk uses the full
extraction engine and found 23–28 product links on the identical page. The two numbers sit two
sections apart on the same tab and can look contradictory to an operator. Worth a look in phase 5.

**Parked, not forgotten:** detail mode still persists `max_pages` even though a fixed URL list has
nothing to page through; `{saved: true}` checks are seeded for detail-mode URLs but are inert
there (no check ever fires for them); "rough time" in the Verifying strip, the strip's
summary/detail split, and the visual system generally are all deferred to phase 5 (see the spec
corrections below). Two residuals from the fix wave's re-review, both minor: the `crawl.status`
polls in `source-extract.tsx` and `extract-sample.tsx` key on status alone, so a run that ended
at the planning stage (`planned` with `completedAt` set, the 0-item walk) keeps polling every 2 s
while the tab is open — `crawl.status` does not return `completedAt`, which is the one-line fix;
and after an Extract the Run section shows the run line permanently, so a second Extract in the
same visit needs a reload.

## MVP flow phase 5 (2026-09-10): the proof sheet

Spec: `docs/superpowers/specs/2026-09-08-mvp-flow-and-workspace-design.md` §7. Plan:
`.superpowers/sdd/2026-09-10-mvp-flow-phase5-visual-system/`. Landed across eight tasks
(`git log --oneline 7b66ca2..HEAD`): the tokens and the utilities (`e82f3cc`); the shell —
header, page header, sub-tabs, dialogs, states, strip, status dot (`77579d4`, fix `d5a8c27`);
the ops screens (`54ddf16`); the Schema tab as the sheet, with rough time and the strip's
accessibility (`2c68f3d`, `9c92afc`, `f3bb5d7`); the Extract tab on paper (`cb039fd`,
`d077301`, smoke assertion `af1f8f9`); the customer screens and website delete moved to
Settings (`f9a3f4c`, `079c13e`, `d36550c`); run detail (`11a6464`, `94e3a58`); and this entry
with the smoke run's screenshots. **Nothing about the flow changed.** Every query, mutation,
prop, handler and exported name in phases 1 to 4 survives; this phase is classes, markup and
copy, plus the four defects it tripped over on the way.

**One file restyles everything.** `packages/dashboard/src/styles.css`'s `@theme` block remaps
the *existing* class vocabulary rather than introducing a parallel one: the whole `gray-*` ramp
becomes the warm neutrals (`gray-50` surface `#fbfbf9`, `gray-100` paper `#f3f4f1`, `gray-200`
rule-soft, `gray-300` rule, `gray-600` ink-soft `#5f665c`, `gray-900` ink `#1c1f1a`), `accent-*`
becomes the moss green `#1f5e4a`, the three fonts become Fraunces / Public Sans / IBM Plex Mono,
and `pass`/`fail`/`warn`/`changed` with their tints are added as named colours. `--color-white`
is remapped to surface too — Tailwind 4.3 honours that, so every `bg-white` in the tree landed on
paper without being touched. That is why a phase that repaints eleven screens is mostly a
stylesheet: a component that already said `bg-gray-50 border-gray-200` was already correct.

**The named utilities and what each one means.** `name` — the name of a thing, in Fraunces
(project, website, page title, section heading). `label-soft` — a secondary label in sentence
case, 12px ink-soft; it replaces the retired uppercase `micro-label`, whose alias is now deleted
(zero users left in `src`). `sheet` / `sheet-head` / `sheet-row` — a table on the paper: a 2px
ink rule across the top, 1px rule-soft between rows, surface background, header in Public Sans
600. `strip` — the 38px paper-dark status bar; `strip-wrap` is the same bar for contents that
must wrap onto a second line instead of being clipped. `btn-primary` / `btn-quiet` — the filled
accent button and the 1px-rule outline button, both at 45% opacity when disabled. `cell-rail-*`
— a 3px rail on the left edge of a cell plus its status tint: **the rail is the glyph**, so no
icon ever appears inside a data cell. `line-*` — the 11px second line under a cell's value,
coloured only for fail and warn and ink-soft otherwise. `card` — a rounded box, and per spec 7
it is now used in three places: dialogs (`dialog.tsx`), the websites list on the project home
(`project-home.tsx`), and the proof-page URL popover (`page-header-cell.tsx`), which is a
`role="dialog"` and so is covered by the same rule.
Everything else sits on the paper with rules.

**The contrast floor is mechanical, not a promise.** `packages/dashboard/src/lib/tokens.ts`
holds the palette as data plus a WCAG 2.x `contrastRatio`, and `tokens.test.ts` asserts every
text-token-on-its-tint pairing at ≥ 4.5:1. It caught one: the spec's `changed` `#7a8077` measures
**3.42:1** on its own tint `#ebece8`. The rule was to darken the text token, never to lower the
threshold, so `changed` is **`#666c63`** (4.55:1 — `#676d64`, one step lighter, still misses at
4.48:1). The spec's §7 palette line was corrected to match.

**The content column is `max-w-6xl`.** The schema grid is `min-w-[1100px]` by design (three page
columns plus field, type and location hint), and the old `max-w-5xl` main column gave it 976px —
Page 3 was clipped until the operator scrolled. Widening the column in `layout.tsx` is what makes
the sheet a sheet; it also lets the Extract sample's "mechanical: url-pattern" fact sit on one line.

**Rough time in the Verifying strip**, the last piece parked from phase 3:
`seconds = (capturesFresh ? 0 : 3 × 12) + aiFields × 8`, rendered as "a few seconds" at zero,
"under a minute" below 45s, and "about N min" otherwise — so "Verifying · about 2 min", the one
place the copy rules allow a separator. It is computed from `sources.verifyEstimate`, which the
tab already queries, and **frozen at run start**: a live-recomputed estimate would tick downward
as captures landed and read as a progress bar the number is not.

**Names are Public Sans in tables; keys are mono.** This is the rule that settled the schema
grid's Field column, which had drifted out of step with the contract editor. Fraunces is for the
*name of a thing at title scale* — a project, a website, a page heading. Inside a table a field's
**name** is Public Sans 500 in ink, and its **key**, type, values, URLs and numbers are Plex Mono.
A name is language; a key is a value.

**The stepper's finished rail is ink, not pass.** `pass` (`#1f7a4d`) and `accent` (`#1f5e4a`) are
the same colour to the eye in a 2px rule, so a done step and the current step were
indistinguishable — exactly the one thing the strip exists to say. Done is now `gray-900`, the
sheet's own 2px language; current stays accent; later stays rule-soft.

**What moved.** Deleting a website was a `window.confirm` button buried at the bottom of a run
detail page. It is now a block on the **Settings** tab — "Delete this website", the sentence "Its
runs and results are deleted too. This cannot be undone.", and a fail-coloured quiet button
opening the app's own `Dialog` with "Delete website" / "Keep it". A `sources.delete` refusal (the
`PRECONDITION_FAILED` on a confirmed website) is rendered verbatim under the buttons. Moved, not
duplicated: the block is gone from `source-run-detail.tsx`.

**Four defects the restyle exposed, all pre-existing, all fixed.** (1) *The active nav underline
never rendered.* TanStack Router's `Link` **concatenates** `activeProps.className` onto
`className` rather than replacing it, so `border-transparent` and `border-accent-600` both landed
on the element and the transparent one won on stylesheet order. Fixed the way `SubTabNav` already
did it: compute the active path with `useRouterState` and pick one non-overlapping class string
with a ternary. (2) *Every dialog rendered in the top-left corner.* Tailwind's preflight zeroes
the UA stylesheet's `margin: auto` on `<dialog>`, which is what centres a modal — `m-auto` in
`dialog.tsx` fixes New project, Add website and Delete website at once. Pre-existing since phase 1.
(3) *The run page's results table had zero columns for any verification-era website.* Its columns
came from the legacy `source.selectorsJson.fields`, which is empty once the schema lives on the
project dataset — three rows and no headers. It now falls back to `datasets.getContract` keyed by
contract key exactly as `effective-schema.ts` and the Extract tab do; Ikea's run shows all eight
columns with its three rows. (4) *Settings spoke in enums* — `listing_to_detail` and `direct` are
now "Listing pages, then each product" and "Given URLs", with an unrecognised value shown verbatim
rather than swallowed.

**A pre-flight correction worth keeping.** The plan's file map called
`routes/datasets-list.tsx` and `routes/dataset-detail.tsx` dead and scheduled their deletion.
They are not dead: `routes/project-output.tsx` is a three-line router that renders one or the
other. They are the Output page, and they were restyled instead of deleted.

**Concurrency lesson, for the next multi-agent phase.** Git's index is per-checkout, not per-agent.
Two implementers running `git add <paths>` then `git commit` in the same working copy produced one
commit carrying both agents' files under one agent's message, and an empty commit for the other.
Recovered by hand, then the rule for the rest of the phase: **`git commit -m … -- <paths>` only**,
never `git add` followed by `git commit`, whenever agents share a checkout.

**Screenshots are now part of the smoke run.** With `RUN_UI_SMOKE=1` (i.e. `pnpm test:ui`, servers
up), every `checkRoute` writes a full-page 1280×900 screenshot to `docs/testing/screens/<route with
slashes turned to dashes>.png`. Not asserted — spec 10 asks for one screenshot per screen state
*for hand review*, and a screenshot cannot tell you a page is right. States the smoke run cannot
reach without spending money or clicking something destructive (a verification in flight, a real
sample, the delete dialog) are still captured by hand and keep their older names, so a few routes
have two files. `docs/testing/screens/README.md` says which is which. The throwaway project the
smoke run creates gets screenshotted under a timestamped name and is gitignored.

**Parked, not forgotten.** Spec 5.3's per-website row counts on the Output page — a restyle had no
place to add the query, and `projects.list` still carries no per-field verified count, so the
projects list shows "Fields", not "Fields verified". The 18px mono "figure" size is now scoped to
the probe gate's four evidence facts only (the shared `Stat` was giving header timestamps the same
treatment); it is a size spec 7's scale does not name, and it stays on that one block until it
does. And phase 4's **7-vs-28 listing-link disagreement** — `describeListingPage`'s free check
groups anchors by path template and reports the largest group, while the probe's real walk found
23–28 links on the identical page — is still open, and is engine work, not visual.

## Customer schema verification (2026-09-07): built and offline-proven — NO live site has verified through this flow yet

**What shipped.** Marko's ruling after the 2026-09-02 corpus measurement (~65% verifiable accuracy over 7 of 8 domains) was that discovery-based extraction cannot reach competitive precision, and that the customer must define what they need and we must prove we can get it before spending at scale. `docs/superpowers/specs/2026-09-04-customer-schema-verification-design.md` is the spec; 39 commits across Tasks 1-16 (plus the final whole-branch review's fix wave) of `docs/superpowers/plans/2026-09-04-customer-schema-verification.md` built it: a new `packages/scraper/src/verify/` module (normalization, mechanical structured/DOM search, cross-capture certification, the closed transform set, the AI `propose_path` fallback, `runVerification`, and `runVerifiedExtraction` for certified-only extraction at scale); `@robot/api`'s `sources.createWithSchema`, `sources.updateSchema`, `sources.findProductPages`, `sources.verify`, `sources.verificationStatus`, and `sources.verifyEstimate` procedures plus the `requireCertification` gate wired into `sources.confirm`; and a dashboard schema-grid screen (`packages/dashboard/src/routes/new-source.tsx` / `source-schema.tsx`) that replaces the old landing page and Set-up workspace — one row per field, an expected value typed on each of three product URLs, Verify paints cells green/red, Extract stays locked until every cell is green. See `docs/extraction-architecture.md` → "Verification-first sources" for how the mechanism works and `CLAUDE.md`'s Extraction Chain step 0.

**This is all on `feat/schema-verification`, and that branch is NOT merged to `main`.** Task 16 (this entry, plus the dead-procedure removal above) is the last offline task; Task 17 is the live proof and has not been started.

**What "offline-proven" means here, concretely.** (1) The `shop-example` fixture triple under `packages/scraper/src/__fixtures__/verify/shop-example/` (three captured product-page JSON bodies) drives Tier 1 tests that certify fields mechanically with zero AI calls, exercise the one-AI-call-per-stubborn-field path with a stubbed agent, and prove `runVerifiedExtraction` leaves a field empty and records a miss when no certified path resolves. (2) Real-Chromium tests cover the in-browser DOM search and XPath probe scripts (`packages/scraper/src/verify/dom-scripts.test.ts`) — not mocked, but still no network egress and no spend. (3) A UI smoke run exercised the grid screen (paste, CSV/XLSX import, type validation, Verify/Extract enabled states) under `pnpm test:ui`. None of this has touched a real website through this flow. No dollar has been spent verifying a real customer schema, and no certified path has ever been produced from a live capture.

**Task 17 (live proof) is unstarted and needs Marko's explicit go before any spend** — same rule as every other paid proof in this project: fill a real grid against a corpus domain not currently blocked, verify, extract a handful of items, hand-check every cell, record it under `docs/testing/`.

**Live pre-check 2026-09-07 — found and fixed a `__name` crash, `dev:all:noai` added.** Task 17's free Step 1 pre-check (`docs/testing/2026-09-07-schema-verification-live-precheck.md`) ran a real grid against currys.co.uk and hit a reproducible `ReferenceError: __name is not defined` inside the "searching" (DOM cross-validation) stage before any field could be scored — not a data/config problem. Root cause: `packages/scraper/src/verify/dom-scripts.ts` builds page-injected scripts by interpolating `browserNormalize.toString()` / `browserXPath.toString()`; under the dev runtime (`pnpm dev:all` → `tsx watch`, esbuild with `keepNames: true`), the transformed source wraps nested arrows in esbuild's `__name(...)` helper, and the serialized text references `__name`, which the page never defines. Vitest's esbuild does not `keepNames`, so no offline test caught it. Fixed by prepending a `var __name = (fn) => fn;` shim (exported as `PAGE_SCRIPT_PRELUDE`) as the first statement of both `buildDomSearchScript`'s and `buildXPathProbeScript`'s IIFEs; covered by a unit check (both scripts contain the prelude) and a real-Chromium test proving the shim executes a `__name`-wrapped function. The pre-check also hit a separate environment gotcha, unrelated to the code bug: `turbo`'s default `envMode: "strict"` swallows an ad-hoc `ANTHROPIC_API_KEY=` shell override before it reaches the task process, so `pnpm dev:all` silently keeps using the real key from `.env`. Use `pnpm dev:all:noai` instead (added to root `package.json`: `cross-env ANTHROPIC_API_KEY= turbo dev --env-mode=loose`) to actually run with AI unavailable. The currys source (`currys-co-uk-1dvdva`, sourceId `f1e7ee0b-03cc-4f7f-90cf-1cc53140f5b5`) still exists in Scratch with the crashed rows from the pre-fix runs and, as of run 3, a completed mechanical-only verification: **5 of 8 fields certified with zero AI calls** (json-ld `name`, `offers.price`, `brand.name`, `image` via `first_of_list`, `aggregateRating.ratingValue`); red: `in_stock` (different_value/ambiguous), `product_code` (the visible code differs from the schema.org SKU), `processor` (not found on any page). Paid re-verify upper bound 3 × $0.05 = $0.15 — Step 2 stopped for Marko's go. Run 2 of that re-run found a second, unrelated crash in the same "searching" stage: `setContentEvaluate` (`packages/browser/src/playwright-browser.ts`) claimed to be offline but let Chromium fetch every real subresource in a captured page (trackers, ad tags, remote scripts), and one of those hung long enough to blow `page.setContent`'s 30s `"load"` timeout on a real currys.co.uk capture. It is now offline by construction — a `page.route('**/*', route => route.abort())` before `setContent` blocks every outgoing request, and `waitUntil` moved to `'domcontentloaded'` since `'load'` would otherwise wait forever on requests that are now aborted rather than merely slow.

**Deliberate spec deviation, recorded so it isn't rediscovered as a bug:** spec §4.2 asks the normalizer to "record the expected currency if present" on `money` fields. It doesn't — nothing downstream consumes a stored currency today (normalization strips it and compares magnitude only), so it's dropped rather than carried through as dead data. Ticketed: `docs/ideas.md` → "Store the expected currency on money fields".

**Cache hygiene:** the post-test hostname gate (`docs/handoff.md` → "Commands worth knowing" below) now also checks `shop.example`, home of the verify fixture triple.

**Dead column, deliberately left in place:** `sources.requested_fields` now has **no writer and no reader** anywhere in `packages/*/src` — the repair engine's "ask the customer for fields" loop is gone, replaced by the customer-authored schema grid. The column is not dropped, for the same reason the `chore/legacy-purge` tables weren't: a drop needs a migration and a history decision.

**Security, recorded as an open decision:** `httpUrl` (`packages/api/src/verify/http-url.ts`) blocks non-http(s) schemes only — `file:`, `javascript:`, `data:` and friends. **Private-network targets remain reachable**: `localhost`, RFC1918 addresses and cloud metadata endpoints (169.254.169.254) can still be handed to `sources.findProductPages` and `sources.verify`, which navigate a real browser to them. That matches the platform's pre-existing posture (every other URL-taking procedure has always done the same), so it is not a regression introduced here — but it IS an unresolved SSRF surface, and the decision to leave it open should be made deliberately rather than by omission. Fixing it means resolving the host and rejecting private/link-local ranges before every navigation, in one shared place.

Pointers: spec `docs/superpowers/specs/2026-09-04-customer-schema-verification-design.md`; plan under `.superpowers/sdd/2026-09-04-customer-schema-verification/`; the task-by-task SDD ledger (progress, controller rulings, per-task reports) at `.superpowers/sdd/2026-09-04-customer-schema-verification/progress.md` — git-ignored, this machine only, not something a fresh clone or a different machine will have.

## Pre-spend cleanup + cache-reputation repair (2026-09-02): three branches stacked on `feat/repair-engine`, all free

While API funding stays pending, three review-driven branches landed everything fixable without spend. Stack and merge order: `main` ← `feat/repair-engine` ← `chore/legacy-purge` ← `fix/cache-reputation` ← `chore/pre-spend-fixes`. All merge after `feat/repair-engine`'s paid proof (Task 12 Step 2). Full suite + `pnpm typecheck` green at every tip; **`pnpm typecheck` now covers all seven packages** (the dashboard had never been type-checked — it was clean on first check).

- **`chore/legacy-purge`** (5 commits, −888 LOC + ~15 MB): deleted the pre-Source "extractor" era — seven zero-caller routers (`orgs`/`extractors`/`inputs`/`credentials`/`overrides`/`captures`/`extractions`, which also closes the unauthenticated `orgs.delete`/`extractors.delete` cascade exposure), five dead `runs` procedures, the schema-drifted `migrate-cache.ts` (ran `DROP TABLE domain_intelligence CASCADE` — it was a loaded gun), the executed sandbox one-shot `backfill-transform.ts`, Next-era `cn()`/`slugify` + `clsx`/`tailwind-merge`, tracked `.next/` traces and 25 orphaned dashboard PNGs. Tables/columns were **NOT** dropped (needs a migration + history decision). The no-op `pnpm lint` was removed — wiring a real linter is an open decision.
- **`fix/cache-reputation`** (2 commits): the domain cache's feedback loop actually works now. Replayed paths finally earn hits (`ResolvedField.path`, `'xpath-cached'` mapped back to stored identity); attempted-but-failed cached paths take misses — **this lands the "record replay misses" half of the AbeBooks poisoned-titles RCA** (the corroboration half already existed), so the unchanged conservative prune can finally retire that poison; miss accounting is per-path, not per-run; every cache read-modify-write runs under `SELECT … FOR UPDATE` so a dashboard pin can't be lost mid-crawl (real-Postgres interleaving test proves it); the domain-lock double-waiter wake race is fixed. Policy untouched: never-overwrite, no auto-reset, same prune predicate, pin supremacy.
- **`chore/pre-spend-fixes`** (4 commits): `valuesMatch` compares structured values structurally (conflict detection was blind to objects — every pair stringified to `[object Object]`); xpath identity ignores cosmetic whitespace/quote variants (taxonomy class 5 mitigation; stored strings never rewritten); `apiEndpoints` enriches by union instead of freezing at first write; the dead `resolveFromCache` crawl pass is removed and `extraction-architecture.md`/`CLAUDE.md` now describe the real cross-validation; **`effectiveSchema`'s selectorsJson fallback no longer strips `candidate`/`origin`/`input_column`** (a Scratch source's candidate choice — the v2.5 serving order — used to be silently dropped behind an `as OriginField[]` cast; the casts are deleted); the backfill panel gets its checked-set preview from the server instead of a mirrored client derivation; pins are visible in the domain selector table; dead surface removed (`backfillPreview.itemIds`, `scraper.extract.captureId`, `validationResult`/`screenshotPath` reads, `sources.update`'s 15 legacy fields, `requestedFields[].addedAt`).

**Deferred with reasons, not forgotten:** jsonb `fieldPaths` versioning/Zod validation and persisted review flags (hardening features, not fixes); `lastValue` truncation (changes stored shape — decide with the versioning work); `run_items.parentId` FK (migration + delete-semantics decision); dead table/column drops (same); linter wiring (tooling decision); catalogue-tier reputation accounting (v2.5-adjacent design question — selection/displayed serving carries no hit/miss ledger).

**2026-09-02, later: Marko funded the API ($10) and the repair-engine PAID proof PASSED** — Task 12 Step 2 executed on the stack tip: healthy-trio backfill (run `3f094f9c`, 5/5, url+publisher → 40/40, 4 true ISBN absences confirmed-absent, re-preview $0.00) and repair-then-sweep on `listing_id` (guard 5 refused the run without an explicit `deadFieldStrategy`, then run `c96aa7de` completed 40/40 — `listing_id` 0/40 → 40/40 healthy, real ids). Total spend ≤$2.25 by preview upper bound. The cache-reputation fixes were observed working live: the swept json-ld path accrued 36 hits with 2026-09-02 timestamps. Full record: `docs/testing/2026-09-02-repair-engine-paid-proof.md`. **The stack was merged to `main` the same day** (fast-forward, full suite green post-merge).

**2026-09-02, later still: the whole paid queue was executed on Marko's go.** (1) **v2.5 live dogfood** — extractions on newegg/target/bn corpus URLs; catalogues passed hand review (Target's 5 price candidates cleanly labeled incl. a scoped `protection_plan_price`; Newegg gained 6 variant candidates); displayed-verification judged every 2+-candidate concept. One verdict corrected by hand review: Target `price`→`protection_plan_price` was an artifact of a Qty dropdown occluding the real price in the screenshot — cleared to none-displayed (stamp kept). Defects logged, not chased: B&N `rating_value` grabbed the review count; Newegg price extracted 399.99 vs judge-seen 439.50 (multiple-valid-values). (2) **Probe-confirm No-path demo (Step 3 — the MVP plan's last open box)**: an AbeBooks detail URL declared as listing → probe surfaced 1 item + pagination warning → "Something's wrong" → diagnosis panel offered Switch mode / Delete source, no spend past the probe. Demo source `abebooks-com-o8o14e` (run `f2bf8f8c`) left in Scratch; screenshots delivered to Marko. Finding (ticket, not fix): the panel says "no specific problem found" where "1 item on a listing probe" is a diagnosable wrong-mode signature. (3) **Five-domain measurement** — `docs/testing/results/2026-09-02T13-30-dogfood.md`: bhphoto 18/18 resolved (and B&H was Cloudflare-blocked at the 2026-08 corpus probe — capturable now), abebooks-listing 22/24 (the known title poison visible in the verdicts), zalando 17/18 (all three ai-vision material fields judged correct), currys 15/15, **uniqlo still Akamai-blocked** (site processing failed, $0). Verifiable-field accuracy on the four new sites: **36/59 = 61%** (correct / (correct+wrong+not-on-page)); combined with the 2026-08 baseline's 22/30 that puts the corpus at **~65% verifiable accuracy over 7 of 8 domains, with the 8th blocked**. Pipeline cost $1.44 for the 4 URLs (mostly warm), $2.06 with the judge. Anti-bot remains the binding constraint (uniqlo), and the largest error class is now judge-conservative "not-on-page" (14) rather than outright wrong (9).

## Repair engine (2026-08-28): built, review-clean, free-proven — paid proof parked on API funding

**Coverage + backfill shipped on `feat/repair-engine` (Tasks 1-11 of `docs/superpowers/plans/2026-08-28-repair-engine.md`, all review-gated).** What exists: per-run coverage (fill counts derived from `extractions.data[0]` key presence against `effectiveSchema` — deliberately no per-field status persisted), gap filters + row selection + "Re-extract selected" in the run view, the `backfill` run flavor (`inputLabel:'backfill'`, `parentRunId`, per-item `target_fields` focus through claim→extract, cell-level merge into the parent with the hard invariant that a filled cell is NEVER overwritten and `'done'` MEANS merged — a merge throw fails the item retryably), `absent_fields` marking so a true absence stops costing money (`confirmed-absent` cells are excluded from future derivations; a heal re-rolls-up the parent without ever un-cancelling it), dead-field repair-then-sweep (`<50%` fill → 3 dead-first-ordered samples → evaluate the PARENT's merged rows → sweep on ≥2/3 or an honest `repair_failed` warning; Stop and duplicate-backfill are re-checked before the sweep), persisted requested fields flowing into analyze (`name: hint` lines, earliest-delimiter split), per-field enable toggles, the add-fields control at Set-up and the confirm gate (save is free; re-analyze is always its own labeled costed click), and a checkbox-following cost preview that can only overstate. The final whole-branch review's money-seam audit passed: every Anthropic-reaching route traces to an explicit click, and the emptiness semantics (`== null || === ''`; 0/false/whitespace are FILLED) are byte-identical across coverage, merge, repair-sweep, and the UI. **Free live proof done** against the AbeBooks crawl `6c0a9463` (badges reproduce the known fill table; filter/select/clear verified; title/author/image_url/listing_id classified dead; add-fields round-trips) — record: `docs/testing/2026-08-28-repair-engine-free-proof.md`; final-review findings + fixes: `docs/testing/2026-08-28-repair-engine-final-review.md`. **NOT done: the paid live proof** (plan Task 12 Step 2 — backfill isbn/publisher/url, repair-then-sweep listing_id) — parked until Marko confirms the Anthropic account is funded. Known accepted gaps, ledger-ruled: spec §2.6's guided "field added → backfill history?" chain exists in no form (ticket); backfill runs' own export carries partial audit rows without a caveat (shaping initiative's export work); "Request more fields" is unavailable on a FAILED probe run (matches the plan literally — product call pending).

**Next initiative, approved and queued:** dataset shaping (`docs/superpowers/plans/2026-08-28-dataset-shaping.md`, all AI-free) — starts on a fresh branch after this merges.

## MVP simplification — Task 12 (2026-08-28): probe-confirm live-proven end to end; five defects found and fixed by the proof

**The declared-sources + probe-confirm flow works, live, on real money, with Marko clicking the gate.** Source `abebooks-com-353m8e` (Scratch project, listing mode, two AbeBooks SearchResults inputs) went through the whole lifecycle: quickCreate via the real home flow → explicit Analyze click (30 rows, `url-pattern` pagination, 19 fields with live examples) → probe run `f89905b1` (row plan **replayed from cache with zero AI**, terminal `partial`, 3 sample rows, gate rendered with evidence and no spend-capable controls) → Marko clicked Yes → `confirmed_at` set, full run `6c0a9463` (completed, 40/40 items, JSON+CSV export sane). **The proof was the point: each probe attempt flushed a real defect per-task reviews couldn't see.** Fixed in-branch, all TDD'd: (D1/final-review F1) a limit-stopped run finalised to `'extracting'` forever — now `limitReached` threads to a terminal `'partial'`, and `completed_at` is the one terminal marker; (D1) listing plans required a fresh `generateSelectors` AI call every time and a swallowed failure produced a silent 0-item `'planned'` run — the proven row plan is now persisted in `domain_intelligence.row_selector` (`source:'verified'`, hit/miss counted, human pins never overwritten) and replayed before AI, and 0-item walks warn; (D2) the duplicate-probe guard keyed on a status allowlist and permanently wedged a source whose probe found 0 items — guards now key on `completed_at IS NULL`; (D4) the crawl budget was spent as a source total, silently starving every listing input after the first — now per listing input with cross-input dedupe; (D5/F4 family) the synthetic `detail_url` planning field leaked into detail extraction, the results table, and the export — filtered at `effectiveSchema`, the dashboard table, and `build-run-export`. Residuals, parked with rulings in the ledger: the row-plan merge is positional (R10 — identity-based matching is future work), and **the garbled titles/authors (4/40) are pre-existing cache poisoning, NOT this flow** — AbeBooks' pricing API echoes normalized search keys as `bibliographicDetail`, the mechanical tier cached the echoes, and replay misses are never recorded so the prune can't retire them (full RCA: `docs/testing/2026-08-28-abebooks-poisoned-titles-rca.md`; the fix — corroborate API display-text against visible page text + record replay misses — is the cache-quality initiative). Step 3 of the live proof (the No-path diagnosis demo) is **deliberately unstarted**: the Anthropic API account is not funded as of 2026-08-28 and nothing that might reach the API runs until Marko confirms payment.

**Next work, specced and planned from Marko's post-proof feedback:** `docs/superpowers/specs/2026-08-28-repair-engine-design.md` (coverage reports, backfill runs, repair-then-sweep, schema add-fields — plan: `docs/superpowers/plans/2026-08-28-repair-engine.md`, Tasks 1-11 AI-free, Task 12 gated on funding) and `docs/superpowers/specs/2026-08-28-dataset-shaping-design.md` (non-destructive per-dataset output shaping; plan not yet written). The live crawl's fill-rate table (`title` 4/40, `image_url` 13/40, `listing_id` 0/40, most fields 36-40/40) is the repair engine's acceptance data — see `docs/testing/2026-08-28-probe-confirm-crawl-verification.md`.

## MVP simplification — Task 11 (2026-08-27): the sandbox/graduate world is deleted

`.superpowers/sdd/2026-08-26-mvp-simplification/`. Tasks 9-10 shipped the replacement world:
declared-mode home flow (paste URLs, pick a mode, land on a real Source under the Scratch
project — no more throwaway `/sandbox/{slug}` draft), the Source workspace
(`packages/dashboard/src/routes/source-setup.tsx`) with the ported schema-discovery wizard
(field table, provenance badges, mode-aware Extract), `sources.quickCreate` / `sources.analyze`
/ `sources.confirm`, and the probe-confirm gate (a listing Source runs a small probe, a human
confirms the schema looks right, only then does `confirm` kick off the full crawl). Task 11
(this entry) deleted the world that flow replaced: `packages/dashboard/src/routes/sandbox-index.tsx`,
`sandbox-detail.tsx`, `packages/dashboard/src/components/graduate-form.tsx`, their route
registrations and the header nav link; `packages/api/src/routers/sandbox.ts` + its test and
router-index registration; the `is_sandbox` filters that hid Scratch's sources from ordinary
project/domain views (`projects-list.tsx`'s `p.slug !== 'scratch'` filter, `domains.ts`'s
`isSandbox` where-clauses, `sources.ts`'s `sources.list` filter) — **Scratch is now a visible,
ordinary project**, and its sources appear in every list like any other project's. The
`is_sandbox` column, its migrations, and the CHECK constraint that uses it are untouched — kept
for the schema shape and for tests that still use `isSandbox: true` to satisfy
`sources_non_sandbox_requires_dataset` without a full dataset chain. `packages/db/src/scripts/seed-sandbox.ts`
(which seeds the always-present Scratch project) was renamed to `seed-scratch.ts`
(package.json script `seed:sandbox` → `seed:scratch`, root `db:seed` updated to match) since
the rename was trivial and the old name no longer matched what it does. `pnpm -r test` (all 7 packages),
`pnpm typecheck`, `pnpm --filter @robot/dashboard exec tsc --noEmit`, and the cache-hygiene gate
are all green as of this commit.

## v2.5 candidate labelling — Task 11 (2026-08-26): Tier 1 fixture gate landed; live dogfood run 2026-09-02 (see that entry — catalogues passed hand review)

Tasks 1-10 of `.superpowers/sdd/2026-08-25-candidate-labelling/` are built and merged into
`feat/candidate-labelling` (catalogue types/plumbing, `lastUrl` + narrowed conflicts, AI-native
catalogue discovery, the cold-catalogue trigger, selection/displayed serving through the real
extraction pipeline per ruling R5, the displayed-verification judge + `markDisplayed`, the API
surface, and the dashboard candidate picker). Task 11 Steps 1-3 (this entry) added the Tier 1
proof that selection and the displayed default actually survive the whole chain on a REAL captured
page, not just a hand-built `PageCapture`: `packages/scraper/src/__fixtures__/catalogue-serving.test.ts`
seeds a `DomainCache` whose `fieldPaths` **and** `candidateCatalogue` both carry two genuine XPath
price candidates from the `newegg-gpu-listing` fixture (`//div[@id="item_cell_..."]//li[@class="price-current"]/strong`,
resolving to two different real on-page prices, 1029 and 649) and calls `runExtraction` directly
(not `runFixtureReplay`, which builds its cache with `as DomainCache` and silently drops
`candidateCatalogue` — see the file's header comment) to prove: (a) no selection + a `displayed`
candidate → the displayed value is served; (b) an explicit selection of the other label → that
value overrides the displayed default. Both assertions were confirmed to bite for the right
reason — verified by temporarily stripping the selection from case (b) (fails: 649 received where
1029 was expected) and by temporarily zeroing `candidateCatalogue` entirely on both cases (fails:
falls back to whichever `xpath-cached` path STEP 1.5 ranks first, wrong value AND wrong source
`xpath-cached` instead of `xpath`), then reverting both. `pnpm -r test` (all 7 packages), the
cache-hygiene gate, `pnpm typecheck`, and `pnpm --filter @robot/dashboard exec tsc --noEmit` are
all green as of this commit.

**Step 4 (live dogfood) RAN on 2026-08-26 with Marko's go — twice, because the first run
found a real bug.** The branch was merged to main (`703c769`) first; then:

- **Run 1: all three extractions succeeded (94/92/95% confidence) and discovery wrote NOTHING,
  silently.** Root cause (`e6bc39d`): the `record_catalogue` tool schema declared
  `properties: {}` because a record with dynamic concept keys cannot be named in JSON schema —
  so the model invented its own output shapes and every response sanitized to `{}` with no log
  line. Diagnosed with a gate-instrumentation run plus a standalone discovery probe (which got
  a third shape — a flat `candidates` wrapper). Fixed by prescribing an explicit envelope
  (`{ concepts: [{ concept, candidates }] }`) the parser unwraps, keeping the bare record as a
  fallback, and warning loudly when discovery returns nothing valid — the silent-empty was the
  exact failure class the "no silent caps" rule exists for.
- **Run 2 (post-fix): Target 14 concepts, B&N 17 concepts, catalogued and saved.** The
  catalogues are good: Target's `price` concept holds five labelled candidates
  (`current_price` $269, `reg_price` $299, numeric twins, and `protection_plan_price` $50 —
  the wrong-entity class, now visible and labelled instead of silently pickable). **Newegg
  returned "no valid candidates" both runs** — the new warning surfaces it; likely the 30KB
  prompt slice truncating Newegg's huge API blobs so the model's paths fail the
  fabricated-path check. Needs its own look (entity-scoping the bodies per spec §4 is the
  probable fix); do NOT weaken the fabricated-path gate to make it pass.
- **Displayed-verification (`verify-displayed.ts` CLI) ran on Target and B&N and hand-review
  caught a real judge weakness:** it marked Target's `price` as
  `displayed: protection_plan_price` — the $50 warranty add-on IS visible on the page, and the
  judge prompt asks "what does the page show for price" without scoping to *the product's own
  price*. **The flag was cleared by hand (`markDisplayed(..., null)`) the same hour — nothing
  serves it.** B&N's verdicts were honest (description matched; NONE elsewhere). Before
  displayed-verification is trusted unattended, the prompt needs product-scoping (and a
  multi-visible-prices calibration case: the current calibration fixture never tests this).
  Until then, treat `displayed` flags as operator-confirmed only.

**Open items from the final-review fix wave (2026-08-26):** the results-table tooltip names the
selected candidate but not the actually-serving one (the displayed-default, when it wins, is
unannotated). Per-hostname selection scoping is a recorded follow-up from ruling R6 (today a
selection applies dataset-wide, not per contributing source hostname).

**Follow-up session, same day: Newegg discovery fixed, judge scoped, conflicts triaged (2026-08-26).**
- **Newegg discovery empty — root-caused and fixed (`1cccc60`), live-proven (5 concepts saved).**
  It was output-side truncation: the catalogue tool call ran at the 4096 default max_tokens, a
  rich page overran it, and a truncated tool_use parses as `{}`. `callWithTool` now throws on
  `stop_reason: max_tokens` (an absent answer must never impersonate an empty one — check this
  on every new tool), the catalogue call gets 8192, `sampleValue` is capped at 160 chars in the
  sanitizer, and API evidence is serialized per body (product-bearing first) instead of one
  30KB slice that used to cut Newegg's first 37KB body mid-JSON.
- **Displayed judge scoped to the main product (`1cccc60`).** The prompt now names the
  wrong-entity values that don't count even when visible (protection plans, accessories,
  bundles…); the calibration fixture carries a visible $9.99 protection-plan distractor and the
  gated case fails if the scoping regresses. `pnpm test:judge` in hand. Target/B&N `displayed`
  flags can be re-verified with `verify-displayed.ts` when screenshots are next in hand.
- **Conflict panels ("large red areas") triaged, 18 → 15 (`e6c3a79`).** Two mechanical rules
  landed: a conflict whose paths include a pinned/human path no longer reports (the pin IS the
  operator's ruling; unpinning re-arms it), and discovery is told to label every
  extraction-used path. Newegg listing `detail_url`'s junk XPaths were resolved by pinning
  `.//a[@class="item-title"]/@href`. **The remaining 15 are honest**: 1 stale cross-page
  artifact (AbeBooks `product_name`, self-heals on its next crawl once `lastUrl` stamps), and
  ~14 genuine same-page multi-valid disagreements (rating systems, granularities, phrasings)
  that stay red until their paths are labelled. **The structural gap, recorded as the next
  increment (do not drive-by):** discovery's evidence carries only each field's WINNING path,
  so the cache's other disagreeing paths cannot be labelled; and `parseCatalogueResponse`
  validates candidate paths only against api bodies + used paths, not against json-ld/meta
  evidence. Extending the evidence with the cached per-field paths (+ their lastValues) and
  teaching the validator to resolve json-ld/meta paths would let the labelled-different
  suppression clear most of the remaining panels.

## Quality/cost baseline

Unrelated to the v2 crawler, but it's the number that justifies "don't start another fix-and-dogfood cycle" above: **73% of *verifiable* fields correct across the three measured domains (22 of 30). 44% of all requested fields**, the difference being values a screenshot cannot check. **Cost ~$0.47 per cold URL, ~$0.20 warm**, pipeline only. The Tier 2 judge adds ~$0.14 per URL and is not a product cost.

**Updated 2026-09-02 — the corpus is now measured 7 of 8** (uniqlo Akamai-blocked): the four newly measured sites came in at 36/59 = 61% verifiable, putting the whole corpus at **~65% verifiable accuracy (58/89)**. The dominant non-correct class is the judge's conservative "not-on-page" (14), not outright wrong values (9). Report: `docs/testing/results/2026-09-02T13-30-dogfood.md`; per-site and defect notes in the 2026-09-02 handoff entry above. The "don't fix-and-dogfood" rule still stands — quality work goes through the cache-quality initiative, prioritized against dataset shaping.

### Corpus: 8 domains, 3 measured

`newegg`, `target`, `barnesandnoble` are measured (the numbers above). `bhphoto`, `abebooks`, `zalando`, `currys`, `uniqlo` were added 2026-08-19 and have never been run for extraction quality (`abebooks` has since been used live for the v2 crawler above, which is a different kind of run — pagination/plumbing, not a quality measurement). Only `newegg` has a Tier 1 fixture among the measured domains; two other fixtures (`ikea`, `nike`) exist but cover domains that aren't in the live corpus.

## What phase 1 and phase 2 actually do

- **Phase 1 — `crawl.plan`** (`packages/scraper/src/crawl/plan-run.ts`, `packages/api/src/routers/crawl.ts`'s `plan` procedure). Walks a Source's listing page(s) via the existing extraction chain (mechanical → cache → AI), detects pagination (`url-pattern` / `next-button` / `page-numbers`, heuristic first, AI fallback), and enumerates detail URLs into `run_items` — `kind: 'listing'` rows for pages walked (already `done`, they cost nothing further), `kind: 'detail'` rows `pending` and waiting for phase 2. It fetches nothing on the detail pages themselves and spends nothing per item. Budget (`max_pages` / `max_items` / `mode`) is enforced here, so a run never plans more than the Source allows.
- **Phase 2 — `crawl.execute`** (`packages/api/src/crawl/execute-run.ts`, `extract-item.ts`, `claim-item.ts`, `record-outcome.ts`, `roll-up-run.ts`; `crawl.execute`/`crawl.status`/`crawl.cancel` procedures). Claims one pending detail item at a time (`SKIP LOCKED`, so it's safe to call again after a crash — nothing double-claims), runs it through the same extraction chain the rest of the pipeline uses, merges input + listing + detail values into one row (`mergeRow`), and records the outcome per item: `done` with an extraction id, or `failed` with a reason. One blocked or erroring page is isolated — the loop keeps going and the run still reaches a terminal status (`completed` or `partial`, derived from the DB, not a local counter). `crawl.cancel` flips the run to `cancelling`; the loop checks between items (never mid-item) and stops cleanly, leaving the rest `pending` — calling `execute` again resumes it. **This stop-and-resume path is now proven live** (2026-08-21, run `aeaab1db-0f1f-4da5-8230-d59b3ef771af`): cancelled twice mid-run, each time the in-flight item finished, the run settled cleanly to `cancelled` with the rest of the items untouched at `pending`, and re-invoking `crawl-execute.ts` on the same run id resumed from the pending set rather than restarting or refusing. 8 of 33 detail items were extracted across both segments; 25 were deliberately left `pending` to avoid draining the run. See below for the full transcript. Runs it outside the HTTP request (deliberately not awaited, guarded so a failure can never take the api-server process down); state lives entirely in `run_items`, so an api-server restart pauses a run rather than losing it.

## How to drive them

- CLI, phase 1: `pnpm --filter @robot/api exec tsx src/crawl-plan.ts <sourceId|sourceSlug>` — prints the work list it produced and the run id.
- CLI, phase 2: `pnpm --filter @robot/api exec tsx src/crawl-execute.ts <runId>` — starts execution and polls `crawl.status` every 5s (240 ticks / 20 min cap) until the run leaves `extracting`/`cancelling`, then prints per-item final status. The crawl runs inside this CLI's own process, so hitting the poll cap while the run is still active exits non-zero with an explicit "still in progress" message rather than silently reporting success.
- Dashboard: the Source Runs page (`packages/dashboard/src/routes/source-runs.tsx`) has the button that calls `crawl.plan`. The Run detail page (`source-run-detail.tsx`) has **Extract N pending** / **Retry N failed** / **Stop**, wired to `crawl.execute`/`crawl.cancel`, with polling-based progress (`run-progress.ts`) — no live push yet, SSE/WebSocket is still future work. Which buttons appear is decided by `runControls` in `run-progress.ts`: Extract and Retry key off the item counts alone and are deliberately NOT hidden while the run is active, because a run can sit at `extracting` with no loop behind it and must stay recoverable from this page. Extract counts `running` as well as `pending` — an item abandoned mid-extraction is work a re-entered loop reclaims — and reads **Resume N stalled** (`extractButtonLabel`) when stalled items are all that is left.

## What the live runs demonstrated

Both runs used the same seeded Source, `abebooks-pagination` (budget `{mode: "first_n", max_items: 8, max_pages: 2}`), so the results are directly comparable:

- **Run 1** (`2f1b29b9-...`, pre-fix): phase 1 correctly enumerated 8 detail items, capped at page 1, never touching page 2. Phase 2 broke — item 1 succeeded, then `runExtraction` closed the shared browser it didn't own, and items 2-8 all failed with "Browser not launched." Run settled to `partial`, `result_count=1`. Left in the DB as the historical record; do not re-run it.
- **Run 2** (`bd44fa22-c667-4538-9a48-0e8066c8f444`, post-fix `376b7ac`): same plan shape, phase 2 completed 8/8 — `run_items` = 1 listing + 8 detail, all `done`; `result_count=8`; CSV export shows 8 data rows across 8 distinct `_url`s.
- Full step-by-step logs, the root-cause walkthrough, and verification queries: `.superpowers/sdd/2026-08-20-v2-crawler-phase2/task-9-report.md` (the bug run) and `task-9-fix-report.md` (the fix + reproof run).

## The fix, and its follow-up

**Ruling: whoever launches the browser closes it.** `runExtraction` (`extraction-orchestrator.ts`) no longer closes a browser it doesn't own, on any path — the invariant is documented directly on `ExtractionDeps.browser`. A review round found the identical pattern one file over: `runAnalysis` (`analysis-orchestrator.ts`) was still closing a browser it never launched, and `scraper.ts`'s `analyse` procedure had no `finally` at all, leaking a browser on its early-throw path. Both are fixed, and the rule is now structural rather than a convention each procedure has to remember: `@robot/api`'s `withBrowserSession` (`packages/api/src/browser-session.ts`) launches a browser, runs the caller's function, and always closes it in a `finally` — `extract` and `analyse` both route through it now. See `task-9-fix2-report.md` for the full fix.

## Pagination walk + caching — live proof (2026-08-21)

Tasks 1-5 of `.superpowers/sdd/2026-08-21-pagination-proof-and-caching/` built and fixture-gated: `planRun` walking listing pages 2..N, deduping detail URLs across them, writing the winning pagination strategy to `domain_intelligence.pagination_config` only once a walk verifies it produced new items, and re-detecting once (never twice) when a cached config goes stale. Task 6 is the live proof — the part fixtures cannot give. Full raw transcript, SQL, and run ids: `.superpowers/sdd/2026-08-21-pagination-proof-and-caching/task-6-report.md`.

**What worked, end to end.** Against `abebooks-pagination` (budget set to `{max_items: 60, max_pages: 3}` so `max_pages`, not `max_items`, would bind):
- `crawl-plan.ts` walked listing pages 1, 2 and 3 (run `4bf71da9-edf3-4155-8fdb-67b4cc30d7c2`) and enumerated 33 detail URLs spread across `page_number` 1 (30), 2 (2), 3 (1) — `run_items` confirms three `listing` rows and detail rows on all three page numbers.
- `domain_intelligence.pagination_config` was written for `(www.abebooks.com, listing)` — the first time this column has ever held a value in this repo's history.
- A second plan against the same Source (run `aeaab1db-0f1f-4da5-8230-d59b3ef771af`) produced the identical fan-out (30/2/1 across the same three page numbers) **without** re-detecting: the `[cache] pagination for ...` save-line that fires only on a fresh, non-cache detection was absent, which — combined with the identical result — is conclusive that the pagination `source` was `cache` on the replay. (The CLI has no direct `source: cache` print; this is inferred from the code path, precisely, not asserted from a log line saying the word.)
- `crawl.cancel` stop-and-resume, previously unit-tested only, is now live-proven (see above) — cancelled twice, resumed cleanly once, settled to `cancelled` both times, no item lost or double-run.

**What did NOT work: `deriveTemplate` picked the wrong page parameter for AbeBooks.** The three listing URLs actually fetched (identical on both plan runs):

```
page 1: https://www.abebooks.com/servlet/SearchResults?kn=python&sortby=17
page 2: https://www.abebooks.com/servlet/SearchResults?ds=2&dym=on&kn=python&p=1&rollup=on&sortby=17&sp=0&spo=30
page 3: https://www.abebooks.com/servlet/SearchResults?ds=3&dym=on&kn=python&p=1&rollup=on&sortby=17&sp=0&spo=30
```

`p=1` is pinned on every request; the template increments `ds` instead, which is not AbeBooks' page parameter. So pages 2 and 3 substantially re-fetched page 1. The 30/2/1 detail-URL split confirms it — a real second and third page of ~30 results would produce roughly 30 each, not 2 and 1; those are consistent with result-ordering jitter across near-duplicate requests slipping past cross-page dedupe, not with genuine additional inventory.

**The consequence: `gained > 0` is too weak a bar for "this config works."** `plan-run.ts` writes `pagination_config` whenever a walk yields at least one new item. 2 + 1 = 3 stray items were enough to pass that bar, so the broken `ds`-based template was certified and cached — a pre-existing gap in the Task 3/4 verification logic that this live run is what exposed it. It was purged by hand (`delete from domain_intelligence where domain='www.abebooks.com' and page_type='listing'`) rather than shipped; the row's exact contents before deletion are recorded in `task-6-report.md`. **Do not re-cache it** without first fixing `deriveTemplate` (in `@robot/browser`) or tightening the verification gate — ideally both. A candidate fix for the gate: treat a page yielding only a small fraction of page 1's item count as evidence of a broken pager, not a thin real page, rather than trusting `gained > 0` alone. **That ratio must not be implemented naively as a refusal.** `absorb` passes `remaining: cap - detailCount()` into `enumerateDetailUrls`, so a genuinely working pager legitimately gains only 1-2 new items on page 2 once the item budget is nearly full — which is this repo's own default `{max_items: 8, max_pages: 2}` shape. A bare ratio gate would refuse those correct configs, the cache would never warm, and the feature would deliver nothing. So as of 2026-08-21 the ratio shipped as a **warning only** (`THIN_WALK_SHARE` in `plan-run.ts`, suppressed whenever the walk was stopped by the item budget rather than by the pager). **UPDATE 2026-08-25: the budget-aware refusal is now implemented** — thin AND not-budget-stopped refuses to cache the config (planned items are kept; only cross-customer certification is withheld), while a budget-stopped thin walk still caches, so the default budget shape still warms the cache. Gated by tests including the AbeBooks 30-vs-3 shape.

**What this run does NOT prove.** Per-item detail extraction is not re-proven here — that is the earlier v2-crawler run (`bd44fa22-c667-4538-9a48-0e8066c8f444`, 8/8 AbeBooks detail items, described above). This run is plan-only for pages 1-3 (Steps 1-5) plus a bounded execute for the cancel/resume proof (Step 6, 8/33 items extracted, 25 left `pending` on purpose). Infinite scroll and load-more are unrelated to this bug and remain wholly unbuilt (see roadmap).

**Budget note:** `abebooks-pagination`'s budget was raised to `{max_items: 60, max_pages: 3}` for this proof and restored to its original `{max_items: 8, max_pages: 2}` afterward — confirmed by SQL in `task-6-report.md`.

## `api-param` pagination — live proof (2026-08-24)

Tasks 1-7 of `.superpowers/sdd/2026-08-22-api-param-pagination/` built and fixture-gated `api-param`: `planRun` finds the intercepted response that carries page 1's own detail URLs (`findListingApi`, requiring both `API_MATCH_MIN_COUNT = 3` matches and `API_MATCH_MIN_SHARE = 0.5` share, so a small widget or a recommendations blob can't qualify), ranks paging-parameter candidates from that endpoint's own URL, probes each one, and accepts a candidate only if its response's items overlap page 1's by at most `REPLAY_MAX_OVERLAP = 0.5` (`overlapShare` in `api-param-candidates.ts`) — a parameter is never used or cached until a probe has shown it returns genuinely different data. Detection is wrapped so it can never throw (`probeApiParam`/`detectApiParam` in `detect-api-param.ts`) and reached the case Task 5's review round added: when an endpoint was found but no candidate verified, `plan-run.ts` emits a warning naming the endpoint and every candidate tried. Task 8 (this entry) is the live proof — the part fixtures cannot give.

**Target and method.** `newegg-gpus-live` — the corpus entry recorded in `docs/roadmap.md` as exercising "JSON-LD + APIs" (P3b, 2026-08-18) — was chosen specifically because it is the only seeded source whose extraction chain touches intercepted APIs at all; AbeBooks was considered and rejected (its search results are server-rendered HTML, proven by the 2026-08-21 walk above, so it almost certainly exposes no JSON endpoint carrying detail URLs — running it would have spent money demonstrating a negative). Budget was raised from `{max_items: 5, max_pages: 1}` to `{max_items: 60, max_pages: 3}` (so `max_pages` would bind) for one plan run, then restored. Full transcript, SQL, and run id: `.superpowers/sdd/2026-08-22-api-param-pagination/task-8-report.md`.

**What happened: no anti-bot interstitial, a clean category-page capture, and `api-param` fell through.** `crawl-plan.ts` against `newegg-gpus-live` (run `c889faea-3417-4d36-97cd-1907e55653af`) planned 60 detail items across all 3 listing pages (12 / 36 / 12 by `page_number`) in 134s. `domain_intelligence.pagination_config` for `(www.newegg.com, listing)` is `{"strategy": "url-pattern", "urlTemplate": "https://www.newegg.com/p/pl?N=100006662&page={N}"}` — the pre-existing mechanical HTML pager, not `api-param`. **No warning was printed at the time of the run** — and that silence was a gap, not a finding. The warning as it then stood only fired when `findListingApi` had found a candidate *endpoint* and no parameter verified against it, so the "no endpoint at all" case said nothing, and the diagnosis below had to be reconstructed by hand from intercepted-request dumps. **That gap is now closed** (`apiParamReason` in `plan-run.ts`): an attempt carries a reason — `no-listing-api`, `no-candidates`, `none-verified` — plus how many GET/JSON/2xx responses were considered, and `planRun` emits one reason-specific warning whenever there was anything to consider at all. A future run in this situation will say so directly. **Re-running this same plan would now produce a warning where the transcript below shows none; the transcript is the record of what the code did on 2026-08-24, not of what it does today.** Here, `findListingApi` returned `null` outright — of the 34 intercepted requests (10 JSON-bearing), none had an array-of-objects overlapping page 1's 12 detail-URL identifiers at ≥3 matches / ≥50% share. The browser's own log line for the largest JSON response, `api/CountryApi` (1144 bytes), confirms it's a locale widget, not a product feed. Field extraction (a separate, independent code path) corroborates the same conclusion from the other direction: `detail_url` for this run was sourced from `json-ld`/`xpath` (`[extract] Sources: {"category_name":"json-ld","detail_url":"xpath"}`), never from an API path, meaning no listing API was visible to the AI-API extraction tier either. **This is the "no candidate endpoint at all" case — distinct from "endpoint found, every candidate rejected."** The `REPLAY_MAX_OVERLAP` overlap check in `api-param-candidates.ts` was never reached; the miss happened one gate earlier, at `findListingApi`'s multiplicity bar in `find-listing-api.ts`.

**What this means for the thresholds.** `API_MATCH_MIN_COUNT = 3`, `API_MATCH_MIN_SHARE = 0.5`, and `REPLAY_MAX_OVERLAP = 0.5` were all picked from reasoning, not traffic, when this feature was designed. This run is the first real data point, and what it shows is negative but specific: on this one real category page, the observed match count/share for every intercepted JSON response against page 1's 12 detail-URL identifiers was low enough that none crossed `API_MATCH_MIN_COUNT`/`API_MATCH_MIN_SHARE` (the exact matched/share numbers per candidate response were not logged — `findListingApi` returns only the best match or `null`, not a ranked list of near-misses — so "how close" is not knowable from this run without adding that instrumentation). No candidate ever reached the `overlapShare`/`REPLAY_MAX_OVERLAP` check, so this run says nothing about whether `0.5` is the right overlap bar — it only exercises the earlier gate. Newegg's category page renders its listing server-side (HTML + JSON-LD); the JSON it does expose over the wire on this page is unrelated widget/telemetry traffic, not the product grid. That is a fact about this one page, not a refutation of the `api-param` design — a listing that genuinely paginates by replaying its own JSON (the case this feature targets) would behave differently, and this corpus does not currently contain one that both (a) is known to load its grid from a same-origin JSON endpoint and (b) is safe to hit live without an anti-bot block.

**What this run does NOT prove.** `api-param`'s detection-and-probe machinery, its overlap guard, and its `planRun` JSON-walk integration remain proven only offline (unit tests + the Tier 1 fixture-server test, which fails if a fixture's page 2 re-serves page 1). No real site has yet been observed picking `source: api-param`. **Cursor-based APIs, POST/GraphQL endpoints, and DOM-driven infinite scroll remain wholly unsupported** — `api-param` only ever considers GET requests carrying a page-number-shaped query parameter (see `rankCandidates` in `api-param-candidates.ts`); none of the corpus's live sources have been shown to need those, and nothing in this task changes that gap. The (still unbuilt) DOM-scroll cycle referenced in the roadmap's v2 section is what would eventually cover infinite scroll and load-more — `api-param` does not and was never meant to.

## `api-param` pre-merge fix wave (2026-08-24)

A whole-branch review of `feat/api-param-pagination` returned DO NOT MERGE. Eight findings plus
minors, all fixed on the branch (`ec1b840`..`1820aaa`); full write-up with every teeth-check in
`.superpowers/sdd/2026-08-22-api-param-pagination/merge-fix-report.md`. The two that matter beyond
this feature:

**The walk fabricated detail URLs, and cached the config that did it** — the 2026-08-21 AbeBooks
failure class with a new trigger. `collectRowUrls` accepted any non-empty string at
`itemsPath[].urlPath`, and the walk resolved it against the API endpoint's own URL rather than the
listing page's. Two demonstrated failures: an API answering in bare slugs produced
`/java-in-depth` where the real URL is `/books/java-in-depth` (detection verifies a slug API
happily — identifiers compare as trailing path segments), and a cross-origin API host
(`api.<site>` fronting `www.<site>`) put every page-2+ URL on the wrong host. In both cases
`gained > 0`, nothing warned, and the config reached the cross-customer domain cache. Now resolved
against the listing page, and each value measured against the shape page 1 itself demonstrated —
same origin, inside the longest directory prefix page 1's own detail URLs agree on. A refusal stops
the walk, keeps page 1, names the value, and caches nothing (`api-row-urls.ts`). Spec §4 required
this and it had never been implemented.

**A credential that persists in the client cannot pin which document issued a request.** The Tier 1
cookie gate's comment claimed that verification succeeding "is itself the proof that the fetch ran
in the page". It was not: the browser's cookie jar outlives one `evaluate`, so the proof only held
because that test ran first in a freshly launched browser. Mutating the walk's navigation target
left all 192 tests green. Both gates now assert the `Referer` a same-origin fetch sets to the full
URL of the issuing document. Worth remembering the next time a fixture is built to prove where a
request came from.

Also corrected, because it is easy to believe otherwise: `fetch(credentials: 'include')` restores
cookies and HTTP Basic/Digest auth, **never** a JS-set `Authorization` or CSRF header. A site whose
listing XHRs carry a JS-set bearer token 401s every probe and correctly falls through — but a 401
there must not be read as "the parameter was wrong". Spec §3 had claimed the opposite.

## DOM-scroll pagination — live proof (2026-08-25)

Task 6 of `docs/superpowers/plans/2026-08-24-dom-scroll-pagination.md`. **Plan-only** — listing pages
only, no detail fetches.

**Target selection was evidence-first, and that is the transferable part.** The `api-param` live proof
failed because its target came from a roadmap note; Newegg renders its grid server-side, so the strategy
never got a candidate to try. This time nothing was spent until a free probe
(`packages/browser/scroll-probe.mts`) had shown the page actually grows. Three candidates, measured by
counting distinct product links across scroll rounds:

| Candidate | Series | Verdict |
|---|---|---|
| `uniqlo.com/us/en/men/tops` | 37 → 73 → 109 → 145 → 181 → 217 → **221** | grows, then tapers — a real finite scroll list |
| `target.com/c/laptops…` | 0, flat, empty `<title>` | anti-bot block page, not a listing |
| `currys.co.uk/…/laptops` | 116, flat | server-rendered, paginated |

The Uniqlo taper (+36 per round, then +4) is what made it the right target: it proves the list *ends*,
so the quiet-round rule could be exercised live rather than the budget simply binding.

**Budget rulings, both deliberate departures from the plan's text.** The plan's Step 2 says
`{max_items: 40, max_pages: 1}`. Both numbers were changed, for reasons worth keeping:

- **`max_items: 250`, not 40.** In plan-only mode item count does not drive spend — the AI cost is page-1
  schema discovery, identical either way. With 37 products on the first screen a cap of 40 binds after one
  round and proves little more than the fixtures already do. 250 let the walk run to natural exhaustion.
- **`max_pages: 3`, not 1.** `max_pages: 1` takes the short-circuit branch that (by follow-up 2 below)
  never consults the cache — so Step 4's warm-replay proof would have been untestable. `max_pages` is not
  consulted by this strategy anyway, so raising it changes nothing about the walk.

> **RESOLVED (same day, commit `5473e89`).** The walk now plans 220 of 220 on this
> listing, twice in a row. Root cause and the two wrong turns on the way to it are below;
> the run-by-run numbers in this section are kept because the *pattern* across them is the
> evidence, and because two confident diagnoses died here.
>
> | Run | page 1 saw | scroll rounds (rows→planned) | planned | verdict |
> |---|---|---|---|---|
> | `a2c67dc9` cold | 144 | *(no trail yet)* 36 / 36 / 4 | 220 | right by luck |
> | `03c5cc22` warm | 144 | *(no trail yet)* — gained 0 | 144 | lost 76 |
> | `4dd07799` warm | 72 | 36→36, 36→36, 4→4 | 148 | lost 72 |
> | `71af7d6b` **fixed** | 144 | **180→36**, 36→36, 4→4 | **220** | complete |
> | `3c007f3a` **fixed** | 108 | **180→72**, 36→36, 4→4 | **220** | complete |
>
> **Root cause.** `scrollPages` opens its OWN page, and how much a lazy listing has loaded
> by the time it starts is a race — 36, 108 and ~144 rows were observed on the same URL.
> Page 1's rows come from `capture`, a different navigation, which observed 144, 144 and 72.
> The generator stamped its whole initial view before the first scroll, reasoning it
> "belongs to page 1, which the caller already has". The two views overlap only by
> coincidence; everything in the gap was stamped unseen and never yielded, invisibly,
> because a stamped row is indistinguishable from one already reported.
>
> **The fix, and why it is the spec's own rule.** The generator now yields what it can see
> on the first round and lets `absorb` dedupe. Spec §4 already said correctness comes from
> the caller's `seen` set and that labels are only an optimisation — stamping the initial
> view had quietly promoted the label to load-bearing. The last two rows above are the
> proof: the round-2 `planned` count (36 vs 72) absorbs page 1's swing (144 vs 108) and the
> total lands on 220 either way. **The total is now invariant under the race that used to
> determine it.**
>
> **Coupled change.** Once the first round yields the initial view, that round is usually
> ALL duplicates of page 1 — which used to break the walk. Only `'budget'` is terminal now;
> a fully-duplicate round is the normal shape of a scroll round, and the generator's
> quiet-round rule is what decides the list has ended. That closes the old follow-up 1.
>
> **Two wrong diagnoses, kept because both were confidently written down.** First: "the
> warm path caches no row definition, so `row_xpath` drifts." Dead — `planned == rows` in
> every round, so nothing was being mis-scoped. Second: "the walk stops after three rounds
> and never exhausts the listing." Also dead — the walk reaches the end and stops correctly
> on two quiet rounds; it was the *start* that was wrong, not the end. Both survived because
> the totals were plausible. What killed them was instrumenting the generator
> (`SCROLL_DEBUG=1`) and watching it run.
>
> <details><summary>Superseded analysis, kept for the reasoning trail</summary>
>
> **CORRECTION (after the audit-trail fix `c029cc6`).** Everything from
> "Cold run" to the end of the warm-run analysis below was written before scroll rounds
> were observable, and two of its conclusions are wrong. A third plan run
> (`4dd07799-eacd-4eb7-8551-a59ae87ea1df`) with the trail in place shows:
>
> | Run | page 1 | scroll rounds (rows/planned) | total |
> |---|---|---|---|
> | cold `a2c67dc9` | 144 | 36 / 36 / 4 | 220 |
> | warm `03c5cc22` | 144 | *(no trail — not observable)* | 144 |
> | warm `4dd07799` | **72** | 36 / 36 / 4, every row planned | 148 |
>
> - **"Ended by the quiet-round rule at the list's end" is not supported.** The walk yields
>   exactly three rounds and stops, identically in both runs where it ran, on a page holding
>   ~221 products. 220 was page 1's 144 plus the walk's 76 — two partial views summing.
>   The budget never bound, but neither did the end of the list.
> - **The warm-path row-definition theory is dead.** `planned` equals `rows` in all three
>   rounds, so the walk plans everything it yields: nothing is being lost to a bad
>   `row_xpath`, and nothing is being lost to duplicates.
> - **Page-1 extraction is itself variable** (144, 144, 72) — capture scrolls the page while
>   tiling screenshots, so how much has loaded when page 1 is extracted is a race. That is a
>   second, independent source of variance and it is not the scroll walk's doing.
> - **The zero-gain warm run did NOT reproduce.** Run `4dd07799` gained 76. Whatever
>   happened in `03c5cc22` is still unexplained; it is now bounded to "no rounds yielded" vs
>   "rounds yielded, all duplicates", and the trail will say which if it recurs.
>
> **Open question for the next cycle:** why three rounds? The free probe walks the same page
> 37 → 73 → 109 → 145 → 181 → 217 → 221 with 2.5s pauses, so the content is there. The walk
> stopping at ~113 products points at the generator's growth wait
> (`GROWTH_TIMEOUT_MS = 3000`) or its quiet-round accounting, neither of which is observable
> from outside. Instrumenting the generator's per-round row counts is the next step — the
> trail records what was *yielded*, not what the generator *saw*.

**Cold run — as originally written (run `a2c67dc9-eeb2-442d-bea3-56e3f27bbcf9`, 173.2s).** 220 detail items, 220
distinct URLs, **zero duplicates**. Detail items by `page_number`, which for this strategy is the scroll
round: **144 / 36 / 36 / 4**. The budget of 250 never bound, so the walk was ended by two consecutive quiet
rounds — **the quiet-round rule, live**. The final +4 round matches the probe's taper exactly.
`domain_intelligence.pagination_config` for `(www.uniqlo.com, listing)` is `{"strategy": "dom-scroll"}`.
The reason-specific `api-param` warning added in the previous cycle also fired correctly and for the right
reason ("no intercepted JSON response carried page 1's detail URLs, 2 considered"), which is incidental
live confirmation that *that* fix works.

**Warm run — the defect (run `03c5cc22-57f0-4ece-a30e-934e591c9a62`, 176.8s).** `domain cache: warm`, so
the cached config was read. But: **144 detail items, `page_number` 1 only**, all 144 a subset of the cold
run's 220. The scroll walk gained nothing, and the only signal was
`pagination (cache: dom-scroll) produced no new items` — which reads as *"the list is finished"*, not
*"I stopped 76 products early"*.

**What is established, and what is inference.** Proven: both runs' numbers above; the page still grows on
scroll when re-probed *after* both runs, so this is not throttling and not a site change; `rowSelector` is
written in exactly one place in the codebase (`packages/api/src/routers/scraper.ts:130`, with
`source: 'human'`), so the automatic path **never** persists it; and the two runs recorded *different*
row-level `detail_url` xpaths (`.//@href` cold, `.//a[contains(@class,"product-tile__link")]/@href` warm).

Inferred, and needing its own cycle to confirm: **`dom-scroll` is the first cached strategy whose
behaviour depends on something the cache does not store.** `url-pattern` caches a self-contained template;
`{"strategy": "dom-scroll"}` caches nothing about *what a row is*, yet the walk's growth detection
(`rowCountScript`), its stamping, and its extraction scoping (`unseenXpath`) all key off `row_xpath`,
which is re-derived per run. A warm run can therefore scroll with a different row definition than the one
that was verified when the config was cached.

**One thing the run could NOT distinguish, and why.** "The generator yielded zero rounds" and "rounds were
yielded but every row was a duplicate" produce identical evidence — same item count, same warning, same
`page_number` distribution. The per-round `listing` rows would have told them apart, but scrolling never
changes the URL, so all of a run's per-round listing rows collapse to one under the unique index. That was
logged as a cosmetic follow-up on the branch; it is not cosmetic, it destroys the per-round audit trail,
and it is now the first thing to fix before re-running this.

</details>

**What these runs do NOT prove.** No detail page was fetched, so per-item extraction is untouched by them.
The load-more *button* trigger was never exercised — Uniqlo scrolls, and `findLoadMore` returned nothing,
so the cached config has no `loadMoreSelector`. Cursor APIs and POST/GraphQL remain uncovered by
`api-param`; this strategy covers them only incidentally, and nothing about those transports was tested.
No anti-bot interference on Uniqlo across four separate sessions; **Target blocked every request**, which
is a corpus fact.

**Corpus addition.** `uniqlo-scroll-live` is seeded (source `ffff6666-…-006`, input set
`eeee5555-…-005`) and is the corpus's only known infinite-scroll target. Its budget is left at the
conservative `{max_items: 40, max_pages: 3}`; the 250 used for the proof was a deliberate one-run raise.

## DOM-scroll pagination (2026-08-25)

The transport-agnostic last rung. Every other strategy needs a thing to act on — a URL template, a
next button, numbered links, a JSON endpoint with a page parameter. A listing that loads by scrolling
has none of them, and until now produced `no pagination detected … — planned page 1 only`.

**What it does.** `IBrowser.scrollPages` (`packages/browser/src/playwright-browser.ts`) is an async
generator that owns its page for the duration: it scrolls (or clicks a heuristic-matched load-more
button), waits for the row count to actually grow rather than sleeping a fixed delay, re-runs page 1's
own extraction plan scoped to unlabelled rows, stamps what it extracted, and yields the batch. It has
to live in the browser package: `IBrowser.evaluate(url, script)` navigates, so a Node-driven loop would
reload the page every round and destroy everything already loaded. `planRun` calls it from two places —
the give-up point where detection came back empty, and the `max_pages <= 1` branch, which is the one
rung such a config can actually use.

**Three things that are load-bearing and non-obvious, each established by measurement, not reasoning:**

- **The scroll trigger scrolls UP and then down.** `window.scrollTo(0, document.body.scrollHeight)`
  alone yields row counts `[1, 2, 2, 2]` — it stalls after one batch, because the page is already at the
  bottom and no new scroll event fires. `scrollTo(0, 0)` then `scrollTo(0, bottom)` yields `[1, 2, 3, 4]`.
  The comment in the source records both sequences; don't "simplify" it back.
- **`rowCountScript` deliberately counts ALL rows, stamped or not.** The growth wait is about the DOM
  growing, not about new *unseen* rows appearing; counting only unstamped rows makes a recycling list
  look permanently quiet.
- **The extraction script forces LISTING page-type.** `buildExtractionScript`'s `auto` heuristic flips to
  detail mode at 0-or-1 rows, and detail mode's fallback re-searches the whole document — which defeats
  the quiet-round check and produced five 60s timeouts before it was found. This was invisible to string
  assertions and to mutation testing; it only surfaced by running the built artifact in a real browser.

**Budgets.** `max_items` is the only budget consulted, and it counts **planned items, not yielded rows** —
`absorb`'s dedupe is what turns rows into items and it lives in Node, where the generator cannot see it.
`max_pages` is deliberately ignored so a Source configured for HTML pagination cannot silently cap a
scroll listing at two rounds. That makes `max_items`, `QUIET_ROUNDS = 2` and `MAX_SCROLL_ROUNDS = 50`
load-bearing rather than backstops, which is why the last exists.

**Labels are an optimisation, never correctness.** Rows are stamped `data-robot-seen` so round N extracts
only new cards — linear instead of quadratic over a 500-item scroll. When a virtualized list recycles a
node the stamp goes with it, the card is re-extracted, and the URL dedupe discards it. Nothing breaks.

**No AI fallback for the load-more selector, on purpose.** The spec allowed one; the cycle did not build it,
and the whole-branch review sharpened the reason: `gained > 0` does not verify a *button*. A "Show more
colours" facet toggle yields real, well-formed detail URLs and would satisfy that gate — so an AI-chosen
selector would be an unverified answer entering the cache tier, which is the failure this project has
been burned by twice (the AbeBooks `ds` template, the api-param fabricated URLs). If it is ever built, it
needs a verification that distinguishes "more of the same list" from "a different subset of the list".

**Quality of the gate.** The whole-branch review prescribed eight mutations and **all eight were killed** —
this repo's first clean mutation sweep, after a cycle that produced ten tests that ran fine and proved
nothing. Two worth remembering: `QUIET_ROUNDS 2 → 1` fails exactly one test *while making the suite
faster* (a mutation that looks like an improvement), and deleting the stamping script fails six tests, of
which only one fails on a **value** rather than a 60s timeout — the kind of coverage that quietly
evaporates during a timeout-tuning session.

**Pre-merge fix wave** (`c9f3105`, `41ed593`, `c1d4dbd`). The review returned DO NOT MERGE on one finding:
both scroll call sites sat **outside** the per-input try/catch that isolates a pagination failure, because
both `continue` before it. A throw from the live walk — `navigateWithFallback`, `dismissPopups`, any
`page.evaluate`, none of them `.catch`-guarded — therefore rejected `planRun` itself, so the run was marked
`failed` and `insert(runItems)` was never reached: **every already-planned input's detail URLs discarded.**
Verified with a throwing stub at both sites, not by reading. Fixed with a wrapper at each site, duplicated
rather than factored out precisely so one deletion cannot unguard both. Two more fixed in the same wave:
the item budget counting yielded rows (silent under-delivery on exactly the virtualized listings this
feature exists for), and the multi-round property having no teeth — every fixture used a single round, so
capping rounds at `max_pages` left the whole suite green.

**Open follow-ups, in rough priority order.** Reordered after the live proof: the warm-path defect it
found now leads, and the "duplicate listing row" item was promoted out of cosmetic because it is what
stopped the run from being self-diagnosing.

0. ~~The walk does not exhaust the listing.~~ **Fixed** in `5473e89` — root cause was the generator
   discarding its own initial view, not an early stop. 220 of 220, twice. See the RESOLVED block above.
0b. ~~Per-round `listing` rows collapse under the unique index.~~ **Fixed** in `c029cc6`: rounds are
   not pages, so the trail lives on page 1's row as `listing_values.scroll_rounds`, one entry per
   yielded round carrying `rows` and `planned`. Every diagnosis since came off that trail.
0c. ~~Page-1 extraction is racy.~~ **Fixed** in `914dd90`. It was not the screenshot tiling — `page.content()`
   is taken before the tiles. It was `expandHiddenContent`'s Phase 1 clicking its structural selectors
   (`[aria-expanded="false"]`, `details summary`) through a Playwright **locator**, which scrolls the
   element into view to click it; on a lazy listing that loads batches. Phase 1 now clicks in the page,
   as Phase 2 already did. Deliberately NOT fixed by skipping out-of-viewport elements — collapsed spec
   panels on a detail page are almost always below the fold, and that would have silently stopped
   expanding them. **Verified against a fixture only**: Uniqlo started returning Akamai "Access Denied"
   before it could be re-checked live, so the JS-click-vs-real-click change has no live confirmation yet.
   If detail-page extraction quality dips, this is the first place to look.
0d. **`uniqlo-scroll-live` is rate-limited.** Akamai "Access Denied" after roughly ten runs on
   2026-08-25 — plan runs, the free scroll probe and the generator harness combined. Not a code defect;
   the spec's risk table predicted repeated scrolling would be a visible bot signal, though cumulative
   request volume is the likelier cause. **Back off before using this source again**, and expect the
   first re-run to be a block rather than a regression.
0e. **The load-more button trigger has never run live.** Uniqlo scrolls, so `findLoadMore` returned
   nothing and the cached config carries no `loadMoreSelector`. That half of the strategy is still
   fixture-only.

1. **`walkScrollPages` breaks on any non-null `absorb` result, so `'all-duplicates'` ends a scroll walk
   after ONE quiet round** — bypassing `QUIET_ROUNDS` and contradicting the spec's own stop-signal
   decision ("a single slow round is not the end of a list; treating it as one is silent truncation").
   Reachable: the generator waits for *row-count* growth, and on a virtualized list growth can be pure
   recycling, so a window re-serving only seen cards reads as all-duplicates mid-list. Not fixed in the
   wave because the break is shared verbatim with the HTML and api-param walkers, where it IS
   load-bearing — diverging scroll from them is a design decision, not a three-line fix.
2. The `max_pages <= 1` branch never consults the cache before scrolling, so it can overwrite a proven
   config without the `replacing` warning the main path emits, and re-writes it once per input.
3. A domain with a stale **non-scroll** cached config can never reach the scroll rung — a site that
   replaces its pager with infinite scroll stays stuck on page 1 until someone clears the row by hand.
4. `[role=button]` is in the spec's load-more heuristic but in neither the code nor the tests.
5. A false-positive `loadMoreSelector` disables scrolling entirely, because the trigger is an if/else.
6. `ScrollOptions.maxItems` now has no production caller; only its doc comment stands between a future
   caller and the row-vs-item bug that was just fixed.

**What this does NOT prove.** No live site has exercised it. Cursor-based APIs, POST and GraphQL endpoints
remain uncovered by `api-param`, and are covered by this rung only insofar as they make the DOM grow —
which is the whole point of the design, but is untested against a real one.

## Cache-conflict triage (2026-08-25)

Marko's "cache conflicts / AI indecisive" complaint, triaged against the actual
`domain_intelligence` contents (15 conflicting fields across 4 domains). Every candidate value was
inspected; the classification below is from that evidence, not from the taxonomy that predicted it.

**The mechanisms actually present — five, not three:**

1. **Poisoned paths** (wrong-entity paths with perfect hit records). Confirmed instances:
   Newegg `product_name` ← api `Configs[0].name` (a feature-flag label — the motivating case
   already documented in `domain-cache.ts`); Newegg `image_url` ← json-ld `thumbnailUrl` (a
   YouTube review thumbnail, and it OUTRANKED the real og:image on hits 6-2); Newegg listing
   `detail_url` ← `.//a` / `.//a[@href]` (privacy-policy links, low-ranked but present); B&N
   `image_url` ← a Yotpo *customer review photo*. Two structural findings: **a poisoned path can
   never prune itself** — `hits` counts "returned non-empty", so garbage paths have 100% hit
   rates and the ≤10% prune bar never triggers; and **a sole poisoned path is invisible to
   conflict detection**, which needs ≥2 valued paths — Target `availability` (delivery date) is
   exactly this, so the worst case never appears in the conflicts UI.
2. **Multiple simultaneously valid values** — the biggest bucket, and exactly Open decision 1 /
   vision Pillar 1: Newegg `category` (breadcrumb "Internal SSDs" vs API "SSD"), `description`
   (json-ld long vs meta short), Target `review_count` (rating count 5 vs review count 3 — two
   different metrics), B&N `rating_value`/`review_count` (site's json-ld vs Yotpo — two different
   review systems). No fix exists at the extraction layer; needs labelling.
3. **Format-only disagreement**: Target `price` "$299.00" (api) vs `299` (api-ai) — same fact,
   `valuesMatch` sees a conflict. A normalization in `valuesMatch` would silence this class.
4. **Stale cross-page comparisons** (false conflicts): AbeBooks `product_name` api-vs-xpath and
   Newegg `product_name` json-ld-vs-og:title "conflicts" compare `lastValue`s captured on
   *different pages* (different products entirely). `detectPathConflicts` has no way to know two
   paths were last exercised on different URLs. **Cross-validation flip-flop, the third
   predicted mechanism, was NOT observed — what looks like it is this staleness artifact.**
5. **AI path-identity churn**: `ai-discovered-variants` uses the AI's prose *description* as the
   path key, so every re-discovery adds a "new" path (Newegg `variants`: 5 near-duplicate
   entries). Inflates conflicts and crowds the 5-path cap.

**Acted on (2026-08-25):** Newegg `product_name` pinned to json-ld `name`, Newegg `image_url`
pinned to meta `og:image` — via the real `pinFieldPath` machinery, verified in the DB (one pin per
field, losers kept with stats). The pin machinery itself is fully wired end to end (ranking,
prune protection, tRPC, domain-detail UI) — nothing needed building.

**Left for Marko:** Target `availability` (delete the sole poisoned path by hand + re-discover, or
wait for labelling); the low-ranked junk `detail_url` xpaths (harmless while outranked); classes
2-5, which are design work — class 2 is the candidate-labelling spec (v2.5), classes 3-5 are
small extraction-layer fixes worth folding into that same cycle.

## What NOT to redo

- **Don't reintroduce uppercase tracked labels, or cards outside dialogs and the websites list.** Both are spec decisions (§6 copy, §7 cards), both were removed screen by screen in phase 5, and both are the first thing a component copied from an older file will bring back. Secondary labels are `label-soft`; everything that is not a dialog or the websites list sits on the paper with rules.
- **Don't reach for `!important` to make an active state win.** TanStack Router's `Link` concatenates `activeProps.className` onto `className`, so an active override fights its own base class at equal specificity. Compute the active state with `useRouterState` and pick one non-overlapping class string — `sub-tab-nav.tsx` and `layout.tsx` both do it that way now.
- **Don't use `git add` followed by `git commit` when more than one agent shares the checkout.** The index is per-checkout: one agent's commit sweeps up whatever another agent has staged. `git commit -m … -- <paths>` is atomic and is the rule for multi-agent phases.
- **The API-side entity filter.** Tried and reverted (`c606a54`). Documented on `filterRequestsForPage` in `entity-match.ts`, captured as a test.
- **Don't chase the price/rating "wrong" verdicts as bugs.** Four of the eight remaining wrong verdicts are cases where the extractor returned a real value and nothing said which of several valid values was wanted. They need the labelling design (Open decision 1 below), not a fix.
- **Don't re-run the AbeBooks or Newegg live crawls to get a better-looking result.** The two v2 runs above (one broken, one fixed) are what happened; that task was authorised for exactly one planning + one execution run after the fix, and that budget is spent. Both runs stay in the DB as the record.
- **The shared-browser-close bug is fixed** (`376b7ac`, plus the `analysis-orchestrator.ts` half and the structural `withBrowserSession` fix from the review round) — don't reopen it or re-derive the root cause; read "The fix, and its follow-up" above instead.
- **Don't re-run the pagination-walk or cancel/resume proofs to get a better-looking result.** Runs `4bf71da9…`, `aeaab1db…` and the two cancel/resume cycles are the record; that budget is spent and restored. If `deriveTemplate`'s AbeBooks bug gets fixed, a fresh live run to reprove it is legitimate new work, not a re-run of this one.
- **Don't rebuild or "simplify" the three measured details in `scrollPages`** — the up-then-down scroll trigger, `rowCountScript` counting all rows, and the forced LISTING page-type. Each was established by watching real Chromium behave, each carries a comment saying why, and each looks like dead weight to a reader who wasn't there. See "DOM-scroll pagination (2026-08-25)" above.
- **The `deriveTemplate` wrong-page-parameter bug is FIXED (2026-08-25) — don't re-derive it.** The root cause was sharper than "wrong choice among plausible params": it templated the FIRST changed numeric param in URL order, which on AbeBooks was `ds` — the page-size constant — so the 2026-08-21 walk fetched pages sized 2 and 3 items (that is what the 2/1 stray yields were). The fix reads the page's own pager-link series: stride-1 param beats offset beats constant; known-name prior as tiebreak/fallback; old behaviour when no evidence exists. Gated against the real captured AbeBooks page (`p={N}` now). Remaining, recorded in the roadmap: `{N}` is the literal page number while AbeBooks' `p` is 0-indexed, so walks run one page offset until stride/base-aware template semantics exist.
- **Don't re-run the `api-param` live proof against `newegg-gpus-live` to get a better-looking result.** Run `c889faea-3417-4d36-97cd-1907e55653af` (2026-08-24) is the record; that budget is spent and the source's budget is restored to `{max_items: 5, max_pages: 1}`. It fell through to `mechanical` — see "`api-param` pagination — live proof (2026-08-24)" above. If a corpus site is added that is known to load its listing from a same-origin JSON endpoint, a fresh live run against *that* site is legitimate new work, not a re-run of this one.
- **Don't run the v2.5 candidate-labelling live dogfood (Task 11 Step 4) without Marko's explicit go.** It spends ~$0.15 + API budget and sets `ANTHROPIC_API_KEY`. Steps 1-3 (the Tier 1 fixture gate) landed 2026-08-26 — see "v2.5 candidate labelling — Task 11" above.

## Open decisions (need Marko, not code)

1. **Candidate labelling** (`docs/ideas.md` → "Label every candidate instead of picking one"). Premise confirmed: one Newegg page carries four simultaneously valid prices and the *displayed* price matches none of the API fields. Marko's direction — label all candidates, let the customer choose, per-domain catalogue and per-dataset selection — is recorded and deserves its own spec. Still open.
2. **Proxy budget.** Anti-bot remains the dominant schedule risk for the pipeline generally; unrelated to the v2 crawler work above.

## Suggested next work

1. ~~Fix `deriveTemplate`'s page-parameter choice~~ **Both halves done (2026-08-25):** the verification gate refuses thin non-budget-stopped walks, and `deriveTemplate` now chooses the pager by series evidence (see "What NOT to redo"). A fresh live AbeBooks run to re-prove the walk end to end is legitimate new work when a budget is approved for it.
2. **Live-prove DOM-scroll** (Task 6 of `docs/superpowers/plans/2026-08-24-dom-scroll-pagination.md`, unstarted and needing approval): find a corpus-safe site that genuinely infinite-scrolls, confirm with `HEADFUL=1` that scrolling adds products *before* spending anything, then plan-only with the budget shaped so `max_items` binds. Fix follow-up 1 above (the `'all-duplicates'` single-quiet-round stop) first or alongside — it is what a real virtualized listing would trigger.
3. From `docs/roadmap.md`'s v2 section: the progressive-confidence ladder (1 → 5 → 20 → 1000 URLs); a real job queue (an api-server restart still pauses a run — `run_items` survives so `execute` resumes it, but nothing resumes it automatically). `api-param` pagination detection and replay is now built and offline-gated (see above) but still wants a live site that actually exercises it — the corpus doesn't currently have a confirmed one.

## Cheap things worth doing whenever convenient

- **Never pick a live pagination target without `packages/browser/scroll-probe.mts` first.** It is free —
  no LLM, no database — navigates a candidate listing, scrolls it, and prints the distinct-product-link
  count per round. Two live proofs have now turned on this: `api-param`'s failed because its target was
  chosen from a roadmap note, and `dom-scroll`'s succeeded because three candidates were measured before
  anything was spent. Usage: `pnpm --filter @robot/browser exec tsx scroll-probe.mts "<url>" ["<url>"...]`,
  with `HEADFUL=1` to watch it.

- Measure the five unmeasured extraction-quality domains once (~$4): `bhphoto`, `abebooks`, `zalando`, `currys`, `uniqlo`.
- Capture Tier 1 fixtures for the corpus so the commit-time gate covers more than one eighth of it.
- `star_distribution` arrives as an object and is rejected as "not array".
- Target's `availability` returns a delivery date from a poisoned cached XPath — and **pinning cannot fix it**: it is the field's ONLY cached path, so there is nothing better to pin (see "Cache-conflict triage (2026-08-25)" below). It needs the path deleted by hand plus a re-discovery run, or the labelling design.

## Commands worth knowing

| Command | What it does |
|---|---|
| `docker start robot-platform-db` | Start Postgres first — the one non-obvious prerequisite on this machine. Everything below needs it running. |
| `pnpm -r test` | Free green gate. |
| `docker exec -e PGPASSWORD=postgres robot-platform-db psql -U postgres -d robot_platform -c "select domain, page_type from domain_intelligence where domain in ('example.com','listing.example','shop.example') or domain like 'test-%';"` | Cache-hygiene gate — run it **after** `pnpm -r test`, expect zero rows. The `test-%` prefix alone is not enough: the `planRun` unit fakes plan against `example.com` and `listing.example`, and an unstubbed `savePagination` in those fakes wrote real rows under those names for several commits without the prefix check noticing. `shop.example` joined the list 2026-09-07 — the customer-schema-verification fixture triple (`packages/scraper/src/__fixtures__/verify/`) is hosted under it. Add any new fake hostname to this list. |
| `pnpm typecheck` | **Not all packages.** Five turbo tasks: `tsc --noEmit` in `@robot/db` and `@robot/api`, plus the `build` (`tsc`) of `@robot/browser`, `@robot/agent` and `@robot/scraper`, which typecheck as a side effect of emitting. `@robot/api-server` and `@robot/dashboard` have no `typecheck` script at all and are **not** covered. |
| `pnpm --filter @robot/dashboard exec tsc --noEmit` | The dashboard type check, which `pnpm typecheck` does not run. Nothing equivalent exists for `@robot/api-server` — it is unchecked until someone adds the script. |
| `pnpm --filter @robot/api exec tsx src/crawl-plan.ts <sourceId\|slug>` | Phase 1 CLI — plan a crawl. |
| `pnpm --filter @robot/api exec tsx src/crawl-execute.ts <runId>` | Phase 2 CLI — execute a planned run, spends money. |
| `pnpm test:judge` | Calibrates both judges against known answers (live, paid). |
| `pnpm test:liveness` | Do the fixtures still match the pages they claim? (live, free) |
| `pnpm test:ui` | Dashboard route smoke tests; needs `pnpm dev:all`. |
