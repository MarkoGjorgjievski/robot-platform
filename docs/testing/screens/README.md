# Screens

One screenshot per screen state, for hand review (spec section 10). **Nothing here is
asserted on** — a screenshot cannot say whether a page is right, only show it to someone
who can.

Three things fill this directory:

- **The new app's smoke run** (`pnpm test:ui:app`) — `app-*.png`, one per screen per theme.
  See its own section below.
- **The smoke run.** `RUN_UI_SMOKE=1 pnpm --filter @robot/dashboard test` (or `pnpm test:ui`,
  with `pnpm dev:all` up) drives every route in spec 3.1 in a 1280×900 browser and writes a
  full-page screenshot per route. The file is the route path with each `/` turned into a `-`
  and the leading one dropped; `/` itself is `index`. These files are overwritten on every
  run, so they always show the app as it is now.
- **By hand.** States the smoke run cannot reach without spending money or clicking a
  destructive control — a verification in flight, a sample that has actually run, a delete
  dialog. Each was captured against the live dev servers by the task that built the screen
  and refreshed by the task that restyled it.

A few screens therefore exist under two names: the smoke run's slug name and an older
hand-captured name for the same route on richer data (`/projects/scratch` has no websites;
`project-home.png` is Acne, which does). Both are kept — the slug ones prove the route still
renders, the hand ones show the state worth looking at.

## The new app (`@robot/app`, :3000) — `app-*.png`

Written by `pnpm test:ui:app` (`packages/app/src/routes-smoke.test.ts`) with `pnpm dev:all`
up: a 1440×900 browser signs in through `/login` as a throwaway address, then walks every
screen of plan 1 once per theme, flipping the theme through the user menu in between. The
file is `app-<route>-<theme>.png`; `/login` is captured signed out, before the sign-in, and
is always dark (§4's open question — a signed-out visitor has no preference yet).

For plan 2 the same run builds a project of its own — a project, a website and three
catalogue fields (Title, Price, Rating; Rating since 2026-09-28), each through the dialog a
customer uses — and walks its three screens in both themes as
`app-project-<screen>-<theme>.png`. Those show a *new* project: one unverified website,
three fields, no rows. Since plan 5 (2026-09-25) the website
is the run's own shop: a `node:http` server on `127.0.0.1` serving a listing and the three
shop-example product pages with their JSON-LD, so the Verification tab has real pages to
capture without touching the outside network. Its address is `http://127.0.0.1:<port>/`,
and the name the Add website dialog derives from that is "0" — which is what the website is
called in every capture below.

For plans 3 and 5 it then sets that website up the way a customer does, on its Verification
tab — since 2026-09-28 one table, a row per field and a column per product: pastes the
listing, waits for the three screenshots, reads each row's status (Title and Price "agreed",
Rating "missing on product 1"), clicks **Accept all agreed (2)**, opens Rating's cell on
product 1 and marks the rating on the screenshot, accepts the row once the mark is carried to
products 2 and 3, closes the screenshot with ×, and reloads. All of it is free (captures, page
data and transfers use no model). It never clicks Verify, Sample, Extract or Check. So
`app-site-<tab>-<theme>.png` shows a website that is ready to verify and not yet verified —
every cell accepted, a locked Extract tab, an empty Runs tab and the settings rows — and
`app-site-verification-<state>-<theme>.png` shows the tab on its way there. The state pairs are
the viewport (1440×900), not the full page, so each theme's pair is taken without a reload
(a carried suggestion is never saved).

Captures are taken with Playwright's `animations: 'disabled'`. Without it the page-load
`.rise` (`opacity: 0`, `animation-fill-mode: both`) has not started in the frame the
screenshot provokes, and the picture is a blank page.

| File | Shows |
|---|---|
| `app-login.png` | `/login` signed out — the 360 px form, dark |
| `app-projects-dark.png` / `-light.png` | `/projects` — the projects table, run dot, "New project" |
| `app-runs-dark.png` / `-light.png` | `/runs` — the org-wide runs screen, empty (nothing has run) |
| `app-usage-dark.png` / `-light.png` | `/usage` — the org's spend this month at $0.00, one row for the throwaway's project |
| `app-settings-dark.png` / `-light.png` | `/settings` — the personal organisation's name, its one member marked "you", Delete organisation refused |
| `app-account-dark.png` / `-light.png` | `/account` — the signed-in throwaway's name and email, the checked theme |
| `app-project-home-dark.png` / `-light.png` | a new project's home — one website ("0", on 127.0.0.1), not verified, no run |
| `app-project-fields-dark.png` / `-light.png` | Fields on a new project — Title, Price and Rating beside the catalogue |
| `app-project-output-dark.png` / `-light.png` | Output on a project with no run — the empty state, downloads off |
| `app-site-verification-empty-dark.png` / `-light.png` | the Verification tab before anything — the listing bar, "Find products from a listing page…", Verify off with "Add at least three products" (viewport) |
| `app-site-verification-table-dark.png` / `-light.png` | the table before any click — three column heads ready, Title and Price orange with "agreed · Accept", Rating empty with "missing on product 1", "Accept all agreed (2)", Verify off with its reason (viewport) |
| `app-site-verification-dark.png` / `-light.png` | the website walk's first stop, after the reload — every cell accepted (green rail), "Nothing agreed to accept", "saved", Verify enabled and priced, not clicked (full page) |
| `app-site-extract-dark.png` / `-light.png` | Extract on an unverified website — the locked strip, the three sections out of reach |
| `app-site-runs-dark.png` / `-light.png` | Runs with nothing extracted — the empty state |
| `app-site-settings-dark.png` / `-light.png` | Settings — name, address, listing mode, budget, Active, the Danger zone |

The two `app-projects-*.png` committed for the plan-1 design review were retaken against the
real dev database (the projects **Acne** and **Scratch**) after the `default`-org adoption, so
they show data rather than a throwaway project's empty state. A smoke run overwrites them with
whatever that run's throwaway organisation holds — which is the empty state — so
`ui-check-app-project.mts` (below) retakes them as the real account on its way past. **Run the
look-only check after the smoke, not before**, or the committed pair shows a smoke run's
furniture. The same is true of `app-login.png` and the four placeholder pairs, which no check
retakes: restore them with `git checkout --` if a smoke run has changed them.

`docs/testing/ui-check-app-shell.mts` is the look-only companion: the same walk with PASS/FAIL
lines and the measurements spec §3/§4 can be held to (sidebar 240, body 13 px, title 20 px,
row ≤ 40 px, nothing uppercased, nothing shadowed in dark, the running dot's animation). Its
screenshots go to whatever directory it is given — a scratch directory, not this one.

### The project screens on real data — `app-project-*-acne-*.png`

`docs/testing/ui-check-app-project.mts` is plan 2's look-only check: given
`--email <address>` it signs in as that account and walks **Acne** read-only — it clicks no
chip, submits no dialog, renames nothing, deletes nothing — printing PASS/FAIL lines for the
breadcrumb, the sidebar's project section, the Verified rail's colour against the pass token,
the eight fields and their locked types, the Output state and the CSV's headers, plus the
shell measurements on each screen. Its six captures are the ones worth reviewing: a project
that is fully verified is a state no throwaway project can reach.

| File | Shows |
|---|---|
| `app-project-home-acne-dark.png` / `-light.png` | Acne's home — Ikea, "All 8 verified" with the green rail |
| `app-project-fields-acne-dark.png` / `-light.png` | Acne's eight fields, every type locked, beside the catalogue |
| `app-project-output-acne-dark.png` / `-light.png` | Acne's Output — still the empty state: no run has ever been made |

How to run it:

```
cp docs/testing/ui-check-app-project.mts packages/browser/src/__ui-check.mts \
  && cd packages/browser && pnpm exec tsx src/__ui-check.mts --email <address> ; rm src/__ui-check.mts
```

### The Verification tab live on Ikea — `app-site-verification-ikea-*.png`

`docs/testing/ui-check-app-verification.mts` (plan 5; the table since 2026-09-28) runs the tab end to end on Ikea as a
throwaway `check-*@example.com`, against a keyless api-server on :4100 and an app on :3100,
Verify included — it refuses to click unless the button reads "free".
Numbers and findings: `docs/testing/2026-09-28-table-first-live.md` (the table, 24 clicks to
Verify) and `docs/testing/2026-09-25-verification-live.md` (plan 5's run before it, 43 clicks).

| File | Shows |
|---|---|
| `app-site-verification-ikea-agreed-dark.png` / `-light.png` | Ikea, eight fields, before any click — four rows "agreed", Brand "same on every product — check it", Price and In stock "comes from different places", SKU "found in 2 places on product 1", "Accept all agreed (4)" (full page) |
| `app-site-verification-ikea-verified-dark.png` / `-light.png` | after a free Verify — 8 of 8 "verified" in the status column, "Everything is verified", Go to Extract live (full page) |

### The website screens on real data — `app-site-*-acne-*.png`

`docs/testing/ui-check-app-site.mts` is plan 3's look-only check: given `--email <address>`
it signs in as that account and walks **Acne / Ikea** read-only — it clicks no Verify /
Sample / Extract / Check / Save / Delete, opens no popover and types nothing. That claim is
enforced rather than promised: every tRPC request the page makes is watched against an
allow-list of the reads these screens issue on load, and anything else — a mutation, or a
read a new tab adds — fails the run and is printed. It prints PASS/FAIL lines for the breadcrumb, the
strip's "8 of 8 fields verified", the 8 × 3 grid with every cell's rail compared against the
resolved `pass` token, the Verify button's label, the Extract link, the Extract tab's three
strip cells, the Runs branch and the Settings rows against what `sources.get` returns, plus
the shell measurements on each tab. `--project <slug>` and `--site <slug>` point it
somewhere else; the expectations live in one `EXPECTED` object at the top.

Its captures are the set worth reviewing: a website where every field is certified is
a state no throwaway website can reach. **Plan 5 rewrote its first stop** for the
Verification tab — full batteries, a "verified" badge on every row, "Everything is verified",
Go to Extract live — and dropped the grid and step 1; on 2026-09-28 that stop was edited for
the table (a row per field, every cell "accepted", "verified" in the status column), still
not run; the new walk writes
`app-site-verification-acne-{dark,light}.png` and has **not been run yet** (it is run
against Marko's account by the controller, never by an implementer). Opening the
Verification tab takes a free screenshot of any proof page with none fresh
(`sources.captureProofPage`), so the allow-list names that call and the check is read-only
but for captures.

| File | Shows |
|---|---|
| `app-site-schema-acne-dark.png` / `-light.png` | **retired** — Ikea's old Schema tab, 8 fields × 3 pages, 24 green cells (the grid is gone since plan 5; kept until the check is rerun) |
| `app-site-schema-step1-acne-dark.png` / `-light.png` | **retired** — the old stepper's step 1 |
| `app-site-extract-acne-dark.png` / `-light.png` | Extract unlocked — the saved listing page, Sample current, Run waiting on it |
| `app-site-runs-acne-dark.png` / `-light.png` | Runs — still the empty state: nothing has ever been extracted here |
| `app-site-settings-acne-dark.png` / `-light.png` | Settings on a real website — listing mode, the all/all budget, the Danger zone |

The two `app-site-schema-step1-acne-*.png` are the walk's newest stop, taken on the first
run after the fix wave added them (2026-09-23). That run also confirmed the allow-list: the
only call it caught that the routes had not predicted was `projects.list`, from the
`/projects` page sign-in lands on — the inverted check working as intended on its first
outing.

Two things this set cannot show, for the same reason plan 2's Output cannot: **the Runs
table with rows in it and the run detail page have never been seen with real data.** No
website in this database has ever been extracted, so the check says SKIP rather than passing
a test that proves nothing, and every state of `components/runs/*` was proven against
fixtures (tasks 7 and 8). Capture them the first time an Extract runs.

The Verify button on a fully verified website reads **"Everything is verified"**, disabled —
`verifyButton`'s `reverifyCount === 0` branch. "Re-verify n fields · …" only appears once a
page, a value or a hint has changed, which is a state this check must not create.

How to run it:

```
cp docs/testing/ui-check-app-site.mts packages/browser/src/__ui-check.mts \
  && cd packages/browser && pnpm exec tsx src/__ui-check.mts --email <address> ; rm src/__ui-check.mts
```

### The organisation screens on real data — `app-org-*.png`

`docs/testing/ui-check-app-org.mts` is plan 4's look-only check: given `--email <address>` it
signs in as that account and walks its own organisation's `/runs`, `/usage`, `/settings` and
`/account`, read-only — it clicks no Save, Remove or Delete organisation, and opens no dialog.
As with the site check, that claim is enforced rather than promised: every tRPC request is
watched against a seven-name allow-list (`auth.me`, `auth.signIn`, `auth.setTheme`,
`projects.list`, `runs.listByOrg`, `usage.byProject`, `orgs.members.list`), and anything else —
in particular `orgs.rename`, `orgs.delete`, `orgs.members.setRole`, `orgs.members.remove` or
`auth.updateName` — fails the run.

Unlike the site check there is no fixed `EXPECTED` object: an organisation's members, spend and
runs are whichever account is given, not a designed-for state, so every screen is compared
against what the API itself returns (`auth.me`, `orgs.members.list`, `runs.listByOrg`,
`usage.byProject`) rather than against numbers written into the script. `/runs` is the one
branch that matters: an organisation with nothing ever run says SKIP rather than passing a test
that proves nothing, the same shape as the Runs branch of `ui-check-app-site.mts`.

| File | Shows |
|---|---|
| `app-org-runs-dark.png` / `-light.png` | `/runs` on a real account |
| `app-org-usage-dark.png` / `-light.png` | `/usage` on a real account — real spend, real projects |
| `app-org-settings-dark.png` / `-light.png` | `/settings` — the real organisation's name and members |
| `app-org-account-dark.png` / `-light.png` | `/account` — the real account's name, email and theme |

How to run it:

```
cp docs/testing/ui-check-app-org.mts packages/browser/src/__ui-check.mts \
  && cd packages/browser && pnpm exec tsx src/__ui-check.mts --email <address> ; rm src/__ui-check.mts
```

## Captured by the smoke run

| File | Shows |
|---|---|
| `index.png` | `/` — the projects list, which `/` resolves to |
| `projects.png` | `/projects` — the projects list as a sheet |
| `projects-scratch.png` | `/projects/scratch` — project home, Scratch (no websites yet) |
| `projects-scratch-output.png` | `/projects/scratch/output` — the project's Output page |
| `projects-scratch-domains.png` | `/projects/scratch/domains` — the project's cached domain intelligence |
| `projects-scratch-sources.png` | `/projects/scratch/sources` — the websites list |
| `ops-domains.png` | `/ops/domains` — the operator domain list |
| `ops-domains-www.newegg.com.png` | `/ops/domains/www.newegg.com` — one domain's selectors and candidates |
| `p-scratch.png` | legacy `/p/scratch` after it redirects to `/projects/scratch` |
| `p-scratch-sources.png` | legacy `/p/scratch/sources` after it redirects |
| `domains.png` | legacy `/domains` after it redirects to `/ops/domains` |

The run also screenshots the throwaway project it creates (`projects-smoke-<timestamp>*.png`:
project home, a brand-new website's Schema tab, and that website's locked Extract tab). Those
names change every run, so they are gitignored — read them on disk, do not commit them.

## Captured by hand

| File | Shows |
|---|---|
| `schema-tab-editing.png` | Schema tab, expected values being typed, nothing verified yet |
| `schema-tab-popover.png` | Schema tab, a page-header URL popover open for editing |
| `schema-tab-results.png` | Schema tab after a verification — cells painted, rails and second lines |
| `extract-pages.png` | Extract step 1, Pages, under the three-cell stepper strip |
| `extract-checked.png` | Extract step 1 after Check ran on a saved listing page |
| `extract-sample.png` | Extract step 2, Sample — the four facts and the sample sheet |
| `extract-run.png` | Extract step 3, the run sentence with its budget boxes |
| `project-home.png` | `/projects/acne` — a project home with a website and an Output block |
| `project-output.png` | Acne's Output page with fields and websites |
| `runs.png` | The Runs tab of a website with runs |
| `settings.png` | The Settings tab, including the delete block |
| `settings-delete.png` | Settings with the Delete website dialog open (never confirmed) |
| `run-detail.png` | A run detail page: facts row, work list, probe gate, results sheet |
| `schema-step1-empty.png` | Schema tab, step 1, a project with no fields: the catalogue and a dimmed step 2 |
| `schema-step1-added.png` | Step 1 after three Product chips (Title, Price, Main image) were clicked |
| `schema-step1-article.png` | Step 1 on the Article schema type — the chips swap, the field list does not |
| `schema-step2-interim.png` | Step 2, the interim proof sheet, with each hint pre-filled from the catalogue |
| `project-home-catalogue.png` | The project home's field list with the same catalogue under it |

The last five came from `docs/testing/ui-check-schema-step1.mts` (1440×1000, full page), which
created its own throwaway project and website, walked step 1, and deleted the project again —
it never touched a customer's real website. The script is **deleted**, with the rest of the
old dashboard it checked (cut-over, plan 6); the screenshots above are kept as a historical
record of a stepper that no longer exists.

## States with no current capture

- **The new app's Runs table with rows in it, and its run detail page.** Same cause as the
  Output sheet below: nothing in this database has ever been extracted, so both the smoke
  and the Acne check photograph the empty state. Every populated state of the run page —
  the facts, the controls, the work list, the results sheet, the misses list, the repair
  panel, the sample gate — was built and proven against client-side fixtures (tasks 7 and
  8). Capture them the first time an Extract runs.
- **The new app's Output sheet with rows in it.** No project website in this database has
  ever completed an extraction — the only two rows in `runs` are August newegg runs on
  `sources` that predate datasets, so they belong to no project — and both Output captures,
  the smoke run's and Acne's, show the empty state. The populated layout has only ever been
  seen against a mocked `projects.output` (task 7). Capture it the first time an Extract runs.
- **Schema tab mid-verification** (the strip counting down, cells shimmering). The file that
  claimed to be it, `schema-tab-verifying.png`, showed the retired visual system — cool grey
  paper, IBM Plex Sans, the old wordmark, and an "Overview" tab that no longer exists — so it
  has been deleted rather than left to mislead. Recapturing it means running a verification, and
  a verification that would be free is also one that cannot be started: the only fully verified
  website on this machine (Acne / Ikea) offers a Verify button reading **"Everything is verified"**,
  disabled, because nothing has changed since the last run. Any website where the button is live
  carries a dollar estimate. Capture this state the next time a paid verification is run for
  another reason.
