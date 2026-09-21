# App redesign — design

**Date:** 2026-09-21. **Status:** approved in conversation, spec for review.
**Supersedes** the visual system of `2026-09-08-mvp-flow-and-workspace-design.md`
§7 and its route shell (§3, §5.x) for the customer surface. The engine, the
tRPC routers and the schema-stepper design (`2026-09-18-schema-stepper-with-marks-design.md`)
stand; the stepper's steps 2 and 3 are built in the new app.

## 1. Why

The warm-paper "proof sheet" look was rejected outright on 2026-09-21: the
customer surface is what Marko looks at every day and a design he dislikes
blocks the product. The product is sold to organisations, not individuals, so
the app also needs an org and user model, a login, and a base that will carry
the next years (TanStack Start). Direction: the register of aistudio.google.com
and vercel.com — a dark, monochrome tech console.

## 2. Architecture

- **`@robot/app`**, new package: TanStack Start (file-based routes, SSR, server
  functions), on `:3000`. Talks to `@robot/api-server` over tRPC-HTTP with
  superjson, as the old dashboard does. `@robot/dashboard` keeps running on
  `:3456` untouched until parity (§7), then is deleted with its visual system.
- **Identity** in `@robot/db` + `@robot/api`:
  - `users` (id, email unique, name, avatar_colour, theme `dark | light |
    system`, created_at)
  - `orgs` (existing) gains `personal boolean` and `owner_user_id`
  - `memberships` (user_id, org_id, role `owner | admin | member`, unique pair)
  - `sessions` (token, user_id, org_id = the current org, expires_at)
- **`auth` router**: `signIn({ email, password })` — any password is accepted
  for now; creates the user on first sight with a personal org named after
  them; sets an httpOnly, SameSite=Lax session cookie (30 days). `signOut`.
  `me` → `{ user, orgs: [{ id, slug, name, role, personal }], currentOrg }`.
  `switchOrg({ orgId })` (membership required). `orgs.create({ name })`,
  `orgs.rename`, `orgs.members.list / setRole / remove`, `orgs.delete`
  (`owner` only; a personal org cannot be deleted).
- **Context**: the tRPC context reads the session cookie and exposes
  `ctx.user` and `ctx.org` (nullable). A customer procedure resolves its org
  from `ctx.org` when a session exists and otherwise from the `orgSlug` input
  it takes today (the shim keeps the old dashboard working); a project outside
  the resolved org is `NOT_FOUND`. `requireSession` throws `UNAUTHORIZED`
  without a session; the app redirects to `/login`.
- **Adopting the seeded org is an explicit script, never automatic** (amended
  2026-09-21 after an agent's ad-hoc sign-in adopted and cascade-deleted
  `default` with every project in it): `pnpm db:adopt-default -- --email
  <email>` makes that user the `owner` of the existing `default` org and marks
  it personal, keeping its slug, so existing projects stay visible. `signIn`
  always creates a fresh personal org for a new user.
- **Roles**, for now: `member` cannot rename or delete the org or manage
  members; `admin` can manage members but not delete; `owner` can do
  everything. Everyone in an org can do everything to its projects.
  Per-project permissions are a later layer.

## 3. Information architecture

- **Sidebar** on every screen after login. Top: org switcher (avatar, name,
  personal/team tag; switch, "Create organisation"). Nav: **Projects**,
  **Runs** (org-wide), **Usage**, **Settings** (org). Bottom: ⌘K search
  (projects, websites), user menu (theme, account, sign out).
- **Inside a project** the sidebar shows a project section under the nav:
  its websites, **Fields**, **Output**. Header breadcrumbs: org / project /
  website.
- **A website** uses top tabs: **Schema** (the stepper), **Extract**,
  **Runs**, **Settings**.
- **Settings**: org settings (general, members, danger zone) at `/settings`;
  account settings (name, email, appearance) at `/account`.
- **Mobile** (≤ 768 px): the sidebar becomes a sheet behind a menu button; tables
  scroll horizontally in their own container.

## 4. Visual system

Direction: industrial minimal — the console of a machine that does expensive
work quietly. Monochrome; chroma only where it carries state.

- **Type**: Geist Sans (UI) and Geist Mono (keys, URLs, values, counts,
  timestamps), self-hosted. Body 13 px, secondary 12 px, page title 20 px
  semibold, one 28 px figure where a screen has a headline number. Sentence
  case everywhere; no uppercase labels.
- **Colour (dark, default)**: background `#0a0a0a`, panel `#111111`, raised
  `#171717`, border `#262626` (hover `#333333`), text `#ededed`, secondary
  `#a1a1a1`, muted `#666666`. Light theme is the inverse ramp (`#ffffff`,
  `#fafafa`, `#f4f4f4`, `#e5e5e5` / `#d4d4d4`, `#171717`, `#666666`,
  `#a1a1a1`). State: pass `#3ddc84` (dark) / `#0f7b3d` (light), fail
  `#ff5c5c` / `#c62828`, warn `#f5a623` / `#a26000`, link `#52a8ff` / `#0b6bcb`.
  State colour appears as a dot, a 2 px rail or a badge, never a background
  wash. Every text-on-surface pair holds ≥ 4.5:1 (asserted in a token test).
- **Surfaces**: 1 px-bordered panels, 6 px radius, no shadow in dark (the
  hairline is the depth), a soft 0 1px 2px shadow in light. Tables are the
  primary object: hairline rows, mono values right-aligned, sticky header,
  row hover raises to `raised`.
- **Motion**: one staggered fade-up on page load (60 ms per panel, 200 ms
  each), 150 ms colour transitions on hover/focus, the running-run dot pulses
  (1.6 s). Nothing else moves. `prefers-reduced-motion` disables all three.
- **Components**: shadcn/ui on Tailwind v4 — sidebar, button, input, select,
  table, tabs, dialog, dropdown-menu, command, badge, sonner (toast),
  skeleton, tooltip, sheet. Tokens are CSS variables per theme on
  `:root[data-theme]`; the attribute is rendered server-side from the user's
  preference (`system` resolves on the client before first paint via a tiny
  inline script) so there is no flash.
- **The one memorable thing**: the run status dot — grey idle, pulsing white
  running, green done, red failed, amber partial — carried everywhere a run is
  mentioned (sidebar, tables, tabs, headers, the org-wide Runs page), so "is
  anything running" is answerable from any screen at a glance.
- **Copy**: customer wording only ("website", "field", "page", "run", "organisation"); no "source", "binding", "dataset".

## 5. Screens

| Route | Replaces | Content |
|---|---|---|
| `/login` | — | email + password, theme-aware; error inline |
| `/` → `/projects` | `/projects` | table: name, websites, fields, last run (dot), created; "New project" dialog |
| `/projects/:project` | project home | websites table (name, domain, verified n of m fields, last run); "Add website" dialog (name + any page URL); sidebar shows Fields and Output |
| `/projects/:project/fields` | project home's field list | the contract editor with the catalogue |
| `/projects/:project/output` | `/output` | output table, export |
| `/projects/:project/sites/:site` | Schema tab | the stepper: step 1 Fields; step 2 Pages and values = today's grid restyled, until the pages and mark screens land |
| `…/extract` | Extract tab | pages, sample, run |
| `…/runs`, `…/runs/:run` | Runs tab, run detail | runs table; run page with results, misses, "Use as proof page" |
| `…/settings` | Settings tab | listing mode, budget, delete website |
| `/runs` | new | every run in the org, newest first, dot + status + project/website + rows + duration |
| `/usage` | new | this month: spend (`source_verifications.cost_usd` + run costs) and pages captured, per project; a 28 px total |
| `/settings` | new | org: general (name), members (list, role, remove), danger zone (delete, owner only) |
| `/account` | new | name, email (read-only for now), appearance (dark / light / system) |

Not rebuilt: `/ops/*` (stays in the old package until decided); the `/p/*`
and `/domains/*` redirects (dropped with the old package).

## 6. API changes (additive)

| Change | Purpose |
|---|---|
| `auth.signIn / signOut / me / switchOrg` | session |
| `orgs.create / rename / delete / members.list / members.setRole / members.remove` | org management |
| context `ctx.user`, `ctx.org`; `requireSession`, `requireRole` | gating |
| every customer procedure: org from `ctx.org` when a session exists, else `orgSlug` (shim) | isolation without breaking the old app |
| `runs.listByOrg`, `usage.byProject({ month })` | the two new screens |
| migration: `users`, `memberships`, `sessions`; `orgs.personal`, `orgs.owner_user_id` | identity |

`DEFAULT_ORG_SLUG` and the `orgSlug` shim are removed at cut-over (§7).

## 7. Coexistence, order of work, cut-over

- Both apps run during the rebuild; `pnpm dev:all` starts api-server and both.
  No further change goes into `@robot/dashboard`.
- Plans, each shippable: (1) shell — package, tokens, theme, login, identity,
  sidebar, projects list; a dark and light screenshot set reviewed by Marko
  before plan 2; (2) project home, fields, output; (3) website — schema step 1,
  extract, runs, run detail, settings; (4) org-wide runs, usage, org and account
  settings; (5) stepper step 2 and step 3 (their own designs already exist);
  (6) cut-over: delete `@robot/dashboard`, the shim and `DEFAULT_ORG_SLUG`,
  move `/ops` or decide its fate, update CLAUDE.md and the handoff.
- Parity gate for cut-over: every row of §5 works in the new app; the
  Playwright smoke passes there in both themes.

## 8. Testing

- API: `auth` (sign-in creates user + personal org; first sign-in adopts
  `default`; cookie round-trip; `member` refused on org delete and member
  management; `switchOrg` without membership refused); per migrated procedure,
  a project in another org is `NOT_FOUND`.
- App: pure view logic in `lib/*-view.ts` with unit tests; a Playwright route
  smoke (render, no console errors, screenshot per route per theme); the
  look-only browser check after each plan; a token contrast test.
- Design review with Marko after plan 1 (the shell) and after plan 3 (the
  website screens).

## 9. Not in this design

- Real authentication (passwords, OAuth, invitations by email) — the session
  and user tables are shaped for it; sign-in is a stub.
- Per-project permissions.
- Billing.
- The ops screens' redesign.
