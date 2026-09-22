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

For plan 2 the same run builds a project of its own — a project, a website
(`https://www.example.com/`) and one catalogue field, each through the dialog a customer
uses — and walks its three screens in both themes as `app-project-<screen>-<theme>.png`.
Those show a *new* project: one unverified website, one field, no rows.

Captures are taken with Playwright's `animations: 'disabled'`. Without it the page-load
`.rise` (`opacity: 0`, `animation-fill-mode: both`) has not started in the frame the
screenshot provokes, and the picture is a blank page.

| File | Shows |
|---|---|
| `app-login.png` | `/login` signed out — the 360 px form, dark |
| `app-projects-dark.png` / `-light.png` | `/projects` — the projects table, run dot, "New project" |
| `app-runs-dark.png` / `-light.png` | `/runs` — the org-wide runs screen (placeholder until plan 4) |
| `app-usage-dark.png` / `-light.png` | `/usage` — placeholder until plan 4 |
| `app-settings-dark.png` / `-light.png` | `/settings` — org settings, placeholder until plan 4 |
| `app-account-dark.png` / `-light.png` | `/account` — account settings, placeholder until plan 4 |
| `app-project-home-dark.png` / `-light.png` | a new project's home — one website, not verified, no run |
| `app-project-fields-dark.png` / `-light.png` | Fields on a new project — one field beside the catalogue |
| `app-project-output-dark.png` / `-light.png` | Output on a project with no run — the empty state, downloads off |

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

The last five come from `docs/testing/ui-check-schema-step1.mts` (1440×1000, full page; its
header says how to run it). It creates its own throwaway project and website, walks step 1,
and deletes the project again — it never touches a customer's real website.

## States with no current capture

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
