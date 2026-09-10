# Screens

One screenshot per screen state, for hand review (spec section 10). **Nothing here is
asserted on** — a screenshot cannot say whether a page is right, only show it to someone
who can.

Two things fill this directory:

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
| `schema-tab-verifying.png` | Schema tab mid-verification: the strip counts down, cells shimmer |
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
