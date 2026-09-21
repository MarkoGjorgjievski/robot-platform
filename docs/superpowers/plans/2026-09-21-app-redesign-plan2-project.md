# App Redesign — Plan 2, the Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project in the new app has a home (its websites, "Add website"), a Fields screen (the contract editor with the catalogue) and an Output screen (the rows the certified websites produced, exportable) — and the project rows on `/projects` link to it.

**Architecture:** Three new API procedures (`projects.get`, `projects.output`, and a project-level export route) give each screen one round trip; the procedures these screens call are moved onto the session's org through `resolveOrg`, keeping the `'default'` shim for the old dashboard (spec §6 as restated on 2026-09-21: each screen's procedures migrate as its screen is rebuilt). In the app, `/projects` becomes a directory of routes with a `$project` layout that loads the project once, feeds the breadcrumb and the sidebar's project section, and renders home / fields / output beneath it. Pure view logic lives in `lib/*-view.ts` with unit tests; the screens are components under `components/project`, `components/fields`, `components/output`.

**Tech Stack:** TanStack Start + Router + Query (React 19), Tailwind v4, shadcn/ui (adds `select`), tRPC v11 + superjson, Drizzle + Postgres, Hono, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-app-redesign-design.md` — §3 (sidebar's project section, breadcrumbs), §4 (visual system), §5 rows `/projects/:project`, `/projects/:project/fields`, `/projects/:project/output`, §6 (API, as restated), §7 plan (2), §8 (testing). The catalogue and the contract mutations are specified in `docs/superpowers/specs/2026-09-18-schema-stepper-with-marks-design.md` §2.1 and the spec it cites (`2026-09-08-mvp-flow-and-workspace-design.md` §4.1–4.3).

## Global Constraints

- ESM everywhere; `.js` import suffixes in `packages/api`, `packages/db`, `packages/api-server`; none in the app.
- Run one package's tests at a time: `pnpm --filter <pkg> exec vitest run --maxWorkers=1 <name>`; `@robot/api` and `@robot/db` tests need Postgres. Never `pnpm -r test` from a task.
- Commit with explicit paths only (`git add <paths>` then `git commit -m "…" -- <paths>`).
- **The dev database is the customer's only data.** No ad-hoc sign-ins, deletes or cleanup against it from an implementer; tests create their own rows under a throwaway identity and delete only those; the org whose slug is `default` and the user `markodjordjievski@gmail.com` are never touched. Browser checks sign in through `/login` only, as `<task>-<timestamp>@example.com`, and report the address for the controller to remove.
- Spec §4 verbatim: dark tokens background `#0a0a0a`, panel `#111111`, raised `#171717`, border `#262626` (hover `#333333`), text `#ededed`, secondary `#a1a1a1`, muted `#666666` (never a text colour); light `#ffffff`, `#fafafa`, `#f4f4f4`, `#e5e5e5` / `#d4d4d4`, `#171717`, `#666666`, `#a1a1a1`; pass `#3ddc84` / `#0f7b3d`, fail `#ff5c5c` / `#c62828`, warn `#f5a623` / `#a26000`, link `#52a8ff` / `#0b6bcb`. State colour is a dot, a 2 px rail or a badge, never a background wash. 13 px body, 12 px secondary, 20 px semibold page title. Sentence case, no uppercase labels. 6 px radius, 1 px borders, no shadow in dark. Motion: the `.rise` stagger on page load, 150 ms hover transitions, the running dot; nothing else moves; all off under `prefers-reduced-motion`. Tailwind spacing is 0.8125× nominal under the 13 px root — spec pixel values are written as literals (`w-[240px]`, `size-[8px]`).
- Copy: customer wording only — "website", "field", "page", "run", "organisation"; never "source", "binding", "dataset", "schema" in anything the customer reads.
- Spec §6 (restated 2026-09-21): a procedure a rebuilt screen calls resolves its org with `resolveOrg(ctx, orgSlug ?? 'default')` — the session wins; the `'default'` fallback exists only for the old dashboard and carries the `TODO(cut-over, spec 2026-09-21 §2)` comment. A project, dataset or website outside the resolved org is `NOT_FOUND`.
- Spec §7: the old dashboard on `:3456` keeps working throughout; nothing in `@robot/dashboard` changes. Its tests (`packages/dashboard`) must still pass after the API changes — they call these procedures session-less with `orgSlug: 'default'` or no org at all.
- Rows that have no destination yet are plain text, not links, and carry no tooltip about our schedule: website rows become links in plan 3.
- The frontend-design skill's rules apply to every screen: intentional, restrained, industrial-minimal; tables are the primary object (hairline rows, mono values right-aligned, sticky header from `md`, hover raises to `raised`).

---

## File map

| File | Responsibility |
|---|---|
| `packages/api/src/routers/projects.ts` | `get` (home data: project, fields, websites with verified counts and last run), `output`; `getBySlug`/`getWithStats` scoped |
| `packages/api/src/routers/sources.ts` | `listByProject`, `createInProject` scoped |
| `packages/api/src/routers/datasets.ts` | `loadDatasetInOrg`; the six contract procedures scoped |
| `packages/api/src/export/load-project-export.ts` (new) | the latest completed run per website, merged with a "Website" column |
| `packages/api/src/export/index.ts` | exports `loadProjectExport`, `projectExportFilename`, `ProjectExport` |
| `packages/api-server/src/routes/export.ts`, `app.ts` | `GET /export/projects/:file` |
| `packages/app/src/routes/_app/projects/index.tsx` | the list (moved from `projects.tsx`); rows link |
| `packages/app/src/routes/_app/projects/$project.tsx` | layout: loads the project, breadcrumb, `<Outlet>` |
| `packages/app/src/routes/_app/projects/$project/index.tsx` | project home |
| `packages/app/src/routes/_app/projects/$project/fields.tsx` | Fields |
| `packages/app/src/routes/_app/projects/$project/output.tsx` | Output |
| `packages/app/src/components/shell/sidebar.tsx`, `project-section.tsx` (new) | the project section under the nav (spec §3) |
| `packages/app/src/routes/_app.tsx` | breadcrumb shows org / project |
| `packages/app/src/components/shell/command-menu.tsx` | project rows go to the project |
| `packages/app/src/lib/websites-view.ts` (+test) | website rows: hostname, verified label and state, last run |
| `packages/app/src/lib/site-name.ts` (+test) | "https://shop.currys.co.uk/x" → "Currys" |
| `packages/app/src/lib/fields-view.ts` (+test) | field rows: type label, "verified on n of m", retype lock, notes |
| `packages/app/src/lib/output-view.ts` (+test) | columns and cell text for the output table |
| `packages/app/src/components/project/{websites-table,add-website-dialog}.tsx` | home panels |
| `packages/app/src/components/fields/{fields-table,field-catalogue,add-custom-field-dialog,delete-field-dialog}.tsx` | Fields panels |
| `packages/app/src/components/output/output-table.tsx` | Output panel |
| `packages/app/src/components/ui/select.tsx` (shadcn) | the type select |
| `packages/app/src/routes-smoke.test.ts`, `docs/testing/ui-check-app-project.mts` | smoke and look-only check |
| `docs/handoff.md`, `docs/testing/screens/README.md`, `CLAUDE.md` | the record |

---

### Task 1: `projects.get` and the scoped project/website procedures

**Files:**
- Modify: `packages/api/src/routers/projects.ts` (add `get`; scope `getBySlug`, `getWithStats`)
- Modify: `packages/api/src/routers/sources.ts:291-350` (`listByProject`), `:443-485` (`createInProject`)
- Test: `packages/api/src/routers/projects-get.test.ts` (new), `packages/api/src/routers/sources-project.test.ts` (add two cases)

**Interfaces:**
- Consumes: `resolveOrg(ctx, orgSlug?)` from `../auth/session.js`; `contractFields` from `../contract.js`; `loadFieldCurrency(db, sourceId)` from `../verify/current-certification.js`.
- Produces:
  ```ts
  // projects.get
  input:  { projectSlug: string; orgSlug?: string }
  output: {
    id: string; name: string; slug: string; datasetId: string; createdAt: Date;
    fields: ContractField[];                       // schema order
    websites: Array<{
      id: string; slug: string; name: string; url: string | null;   // url = sources.urlTemplate
      verifiedFields: number;                      // currentKeys.length for that website
      lastRun: { status: string; createdAt: Date; completedAt: Date | null; resultCount: number | null } | null;
    }>;                                            // ordered by name
  }
  // throws NOT_FOUND when the project is not in the resolved org
  ```
  `getBySlug` / `getWithStats` inputs become `{ projectSlug: string; orgSlug?: string }` (the old dashboard still passes `orgSlug: 'default'`). `sources.listByProject` likewise. `sources.createInProject` input is unchanged; the project lookup gains the org.

- [ ] **Step 1: Write the failing tests**

`packages/api/src/routers/projects-get.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, users, runs } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { loadSession } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';

const tag = `get-${Date.now()}`;

async function signIn(email: string) {
  const cookies: Record<string, string | null> = {};
  const c = createCallerFactory(appRouter)({ db, session: null, setCookie: (n, v) => { cookies[n] = v; }, clearCookie: () => {} });
  const r = await c.auth.signIn({ email, password: 'x' });
  const session = (await loadSession(db, cookies['robot_session']!))!;
  return { ...r, session, caller: createCallerFactory(appRouter)({ db, session }) };
}

async function dropIdentity(r: { org: { id: string }; user: { id: string } }) {
  await db.delete(projects).where(eq(projects.orgId, r.org.id));
  await deleteOwnOrg(r.org.id);
  await db.delete(users).where(eq(users.id, r.user.id));
}

describe('projects.get', () => {
  it('returns the project, its fields and its websites with verified counts and last run, in the session org', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-a@example.com`);
      const p = await a.caller.projects.create({ name: 'Acme prices' });
      await a.caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
      await a.caller.datasets.addField({ datasetId: p.datasetId, name: 'Title', type: 'text' });
      const w = await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'Zed shop', url: 'https://zed.example.com/x' });
      await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'Alpha shop', url: 'https://alpha.example.com/x' });
      await db.insert(runs).values({ sourceId: w.sourceId, status: 'completed', completedAt: new Date(), resultCount: 3 });

      const got = await a.caller.projects.get({ projectSlug: p.slug });
      expect(got.id).toBe(p.id);
      expect(got.datasetId).toBe(p.datasetId);
      expect(got.fields.map((f) => f.name)).toEqual(['Price', 'Title']);
      expect(got.websites.map((s) => s.name)).toEqual(['Alpha shop', 'Zed shop']);
      const zed = got.websites.find((s) => s.id === w.sourceId)!;
      expect(zed.url).toBe('https://zed.example.com/x');
      expect(zed.verifiedFields).toBe(0);
      expect(zed.lastRun?.status).toBe('completed');
      expect(zed.lastRun?.resultCount).toBe(3);
      expect(got.websites.find((s) => s.name === 'Alpha shop')!.lastRun).toBeNull();
    } finally {
      if (a) await dropIdentity(a);
    }
  });

  it('is NOT_FOUND for a project in another org, even with the right slug', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    let b: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-b1@example.com`);
      b = await signIn(`${tag}-b2@example.com`);
      const p = await a.caller.projects.create({ name: 'Private' });
      await expect(b.caller.projects.get({ projectSlug: p.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(b.caller.projects.getWithStats({ projectSlug: p.slug })).resolves.toBeNull();
      await expect(b.caller.sources.listByProject({ projectSlug: p.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(b.caller.sources.createInProject({ projectSlug: p.slug, name: 'X', url: 'https://x.example.com/' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      if (a) await dropIdentity(a);
      if (b) await dropIdentity(b);
    }
  });

  it('still answers a session-less caller that names the org, the way the old dashboard does', async () => {
    const bare = createCallerFactory(appRouter)({ db, session: null });
    const p = await bare.projects.create({ name: `Shim ${tag}` });
    try {
      const got = await bare.projects.get({ projectSlug: p.slug, orgSlug: 'default' });
      expect(got.id).toBe(p.id);
      const stats = await bare.projects.getWithStats({ orgSlug: 'default', projectSlug: p.slug });
      expect(stats?.project.id).toBe(p.id);
    } finally {
      await db.delete(projects).where(eq(projects.id, p.id));
    }
  });
});
```

Add to `packages/api/src/routers/sources-project.test.ts` (inside its existing describe, using its existing project helper) nothing new beyond what the file already covers — the cross-org cases live in the file above.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run --maxWorkers=1 projects-get`
Expected: FAIL — `projects.get` is not a procedure (`TypeError: … get is not a function`).

- [ ] **Step 3: Implement `get` and scope the four procedures**

In `packages/api/src/routers/projects.ts`, add the import `import { loadFieldCurrency } from '../verify/current-certification.js';` and `import { contractFields } from '../contract.js';`, then a shared lookup and the procedure:

```ts
/**
 * The project by slug, inside the resolved org (spec 2026-09-21 §6 as restated:
 * the procedures a rebuilt screen calls take the org from the session; the old
 * dashboard still names it). Null when it is not there — callers decide between
 * NOT_FOUND and a null answer.
 * TODO(cut-over, spec 2026-09-21 §2): drop the `'default'` fallback with the old dashboard.
 */
async function findProjectInOrg(ctx: Context, projectSlug: string, orgSlug?: string) {
  const org = await resolveOrg(ctx, orgSlug ?? 'default');
  return ctx.db.query.projects.findFirst({ where: and(eq(projects.orgId, org.id), eq(projects.slug, projectSlug)) });
}
```

(`Context` is imported from `../trpc`.) Then:

```ts
  /**
   * The project home in one round trip (spec 2026-09-21 §5): the project, its
   * contract, and every website with how many fields are verified on it and
   * its last run. "Verified" is per-field currency — `loadFieldCurrency` — so
   * a website that has certified 3 of 8 fields says so, rather than reading as
   * unverified until every field is.
   */
  get: publicProcedure
    .input(z.object({ projectSlug: z.string().min(1), orgSlug: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const project = await findProjectInOrg(ctx, input.projectSlug, input.orgSlug);
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.projectSlug} not found` });

      const dataset = await ctx.db.query.datasets.findFirst({
        where: eq(datasets.projectId, project.id),
        orderBy: (d, { asc }) => [asc(d.createdAt)],
        columns: { id: true, schema: true },
      });
      // `projects.create` always makes the dataset; a project without one is a
      // legacy row, and the home reads as empty rather than failing.
      const fields = dataset ? contractFields(dataset.schema) : [];

      const siteRows = dataset
        ? await ctx.db
            .select({ id: sources.id, slug: sources.slug, name: sources.name, url: sources.urlTemplate })
            .from(sources)
            .where(eq(sources.datasetId, dataset.id))
            .orderBy(sources.name)
        : [];

      const lastRuns = siteRows.length
        ? await ctx.db
            .selectDistinctOn([runs.sourceId], {
              sourceId: runs.sourceId,
              status: runs.status,
              createdAt: runs.createdAt,
              completedAt: runs.completedAt,
              resultCount: runs.resultCount,
            })
            .from(runs)
            .where(inArray(runs.sourceId, siteRows.map((s) => s.id)))
            .orderBy(runs.sourceId, desc(runs.createdAt), desc(runs.id))
        : [];
      const lastRunBySource = new Map(lastRuns.map((r) => [r.sourceId!, { status: r.status, createdAt: r.createdAt, completedAt: r.completedAt, resultCount: r.resultCount }]));

      const websites = await Promise.all(
        siteRows.map(async (s) => ({
          ...s,
          verifiedFields: (await loadFieldCurrency(ctx.db, s.id)).currentKeys.length,
          lastRun: lastRunBySource.get(s.id) ?? null,
        })),
      );

      return { id: project.id, name: project.name, slug: project.slug, datasetId: dataset?.id ?? null, createdAt: project.createdAt, fields, websites };
    }),
```

Add `inArray` to the drizzle import. `datasetId` is `string | null` in the output type (the legacy case) — the app treats null as "no fields yet, nothing to add to" and the Fields screen says so.

Rewrite `getBySlug` and `getWithStats` to take `z.object({ projectSlug: z.string(), orgSlug: z.string().optional() })` and start with `const project = await findProjectInOrg(ctx, input.projectSlug, input.orgSlug);` — `getBySlug` throws `new TRPCError({ code: 'NOT_FOUND', … })` (not a bare `Error`) when null and then loads `with: { datasets: true }` by `project.id`; `getWithStats` returns `null` when null and keeps its four counts unchanged. Delete the `orgs` inner-join blocks they had.

In `packages/api/src/routers/sources.ts`: import `resolveOrg` from `'../auth/session.js'`; in `listByProject` change the input to `z.object({ projectSlug: z.string(), orgSlug: z.string().optional() })`, resolve `const org = await resolveOrg(ctx, input.orgSlug ?? 'default');` and replace the `eq(orgs.slug, input.orgSlug)` condition with `eq(projects.orgId, org.id)`; if the project is not found throw `NOT_FOUND` (today it returns an empty list — an empty list for a project that does not exist hides a wrong URL). In `createInProject`, resolve the org the same way (no `orgSlug` input; `resolveOrg(ctx, 'default')` with the cut-over TODO) and add `eq(projects.orgId, org.id)` to the project `where`. Put the `TODO(cut-over, spec 2026-09-21 §2)` comment on each.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @robot/api exec vitest run --maxWorkers=1 projects-get sources-project projects.test`
Expected: PASS. Then `pnpm --filter @robot/api typecheck` and `pnpm --filter @robot/dashboard typecheck` (the old app's call sites still pass `orgSlug`, now optional — no change needed, but the typecheck proves it).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routers/projects.ts packages/api/src/routers/sources.ts packages/api/src/routers/projects-get.test.ts
git commit -m "feat(api): projects.get for the project home; project and website lookups take the org from the session" -- packages/api/src/routers/projects.ts packages/api/src/routers/sources.ts packages/api/src/routers/projects-get.test.ts
```

---

### Task 2: The contract procedures take the org from the session

**Files:**
- Modify: `packages/api/src/routers/datasets.ts` (`loadDataset` callers: `getContract`, `addField`, `renameField`, `retypeField`, `deleteField`, `fieldStatus`)
- Test: `packages/api/src/routers/datasets-org.test.ts` (new)

**Interfaces:**
- Consumes: `resolveOrg`.
- Produces: the six procedures' inputs are unchanged; each is `NOT_FOUND` when the dataset's project is outside the resolved org. `loadDatasetInOrg(ctx, datasetId)` is file-local.

- [ ] **Step 1: Write the failing test**

`packages/api/src/routers/datasets-org.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, users } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { loadSession } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';

const tag = `dsorg-${Date.now()}`;

async function signIn(email: string) {
  const cookies: Record<string, string | null> = {};
  const c = createCallerFactory(appRouter)({ db, session: null, setCookie: (n, v) => { cookies[n] = v; }, clearCookie: () => {} });
  const r = await c.auth.signIn({ email, password: 'x' });
  const session = (await loadSession(db, cookies['robot_session']!))!;
  return { ...r, session, caller: createCallerFactory(appRouter)({ db, session }) };
}

async function dropIdentity(r: { org: { id: string }; user: { id: string } }) {
  await db.delete(projects).where(eq(projects.orgId, r.org.id));
  await deleteOwnOrg(r.org.id);
  await db.delete(users).where(eq(users.id, r.user.id));
}

describe('contract procedures are org-scoped', () => {
  it('another org cannot read or change a project\'s fields, and the owner still can', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    let b: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-a@example.com`);
      b = await signIn(`${tag}-b@example.com`);
      const p = await a.caller.projects.create({ name: 'Mine' });
      const f = await a.caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });

      const nf = { code: 'NOT_FOUND' };
      await expect(b.caller.datasets.getContract({ datasetId: p.datasetId })).rejects.toMatchObject(nf);
      await expect(b.caller.datasets.fieldStatus({ datasetId: p.datasetId })).rejects.toMatchObject(nf);
      await expect(b.caller.datasets.addField({ datasetId: p.datasetId, name: 'Title', type: 'text' })).rejects.toMatchObject(nf);
      await expect(b.caller.datasets.renameField({ datasetId: p.datasetId, key: f.key, name: 'Cost' })).rejects.toMatchObject(nf);
      await expect(b.caller.datasets.retypeField({ datasetId: p.datasetId, key: f.key, type: 'text' })).rejects.toMatchObject(nf);
      await expect(b.caller.datasets.deleteField({ datasetId: p.datasetId, key: f.key })).rejects.toMatchObject(nf);

      expect((await a.caller.datasets.getContract({ datasetId: p.datasetId })).map((x) => x.name)).toEqual(['Price']);
      await a.caller.datasets.renameField({ datasetId: p.datasetId, key: f.key, name: 'Cost' });
      expect((await a.caller.datasets.getContract({ datasetId: p.datasetId })).map((x) => x.name)).toEqual(['Cost']);
    } finally {
      if (a) await dropIdentity(a);
      if (b) await dropIdentity(b);
    }
  });

  it('a session-less caller still reaches the default org\'s datasets (the old dashboard)', async () => {
    const bare = createCallerFactory(appRouter)({ db, session: null });
    const p = await bare.projects.create({ name: `Shim ${tag}` });
    try {
      await bare.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
      expect((await bare.datasets.getContract({ datasetId: p.datasetId })).length).toBe(1);
    } finally {
      await db.delete(projects).where(eq(projects.id, p.id));
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @robot/api exec vitest run --maxWorkers=1 datasets-org`
Expected: FAIL — the `rejects.toMatchObject({ code: 'NOT_FOUND' })` assertions fail because `b` can read `a`'s contract.

- [ ] **Step 3: Implement**

In `packages/api/src/routers/datasets.ts`, import `resolveOrg` from `'../auth/session.js'` and `type Context` from `'../trpc'`, and add beside `loadDataset`:

```ts
/**
 * `loadDataset`, inside the resolved org (spec 2026-09-21 §6 as restated). A
 * dataset whose project belongs to another org is NOT_FOUND — the same word as
 * for one that does not exist, so a guessed id learns nothing.
 * TODO(cut-over, spec 2026-09-21 §2): the `'default'` fallback exists only for the
 * old dashboard, which calls these with no session; drop it when it is retired.
 */
async function loadDatasetInOrg(ctx: Context, datasetId: string) {
  const org = await resolveOrg(ctx, 'default');
  const ds = await loadDataset(ctx.db, datasetId);
  const project = await ctx.db.query.projects.findFirst({ where: eq(projects.id, ds.projectId), columns: { orgId: true } });
  if (!project || project.orgId !== org.id) throw new TRPCError({ code: 'NOT_FOUND', message: `Dataset ${datasetId} not found` });
  return ds;
}
```

Replace `loadDataset(ctx.db, input.datasetId)` with `loadDatasetInOrg(ctx, input.datasetId)` in exactly `getContract`, `addField`, `renameField`, `retypeField`, `deleteField`, `fieldStatus`. Leave `listByProject`, `getBySlug`, `create`, `updateSchema` as they are (their screens are not rebuilt in this plan; the handoff lists them).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @robot/api exec vitest run --maxWorkers=1 datasets-org datasets-fields datasets-schema-field sources-binding sources-marks`
Expected: PASS — the existing field tests run session-less under `default` and still pass through the shim.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routers/datasets.ts packages/api/src/routers/datasets-org.test.ts
git commit -m "feat(api): the contract procedures take the org from the session" -- packages/api/src/routers/datasets.ts packages/api/src/routers/datasets-org.test.ts
```

---

### Task 3: `projects.output` and the project export

**Files:**
- Create: `packages/api/src/export/load-project-export.ts`, `packages/api/src/export/load-project-export.test.ts`
- Modify: `packages/api/src/export/index.ts`, `packages/api/src/routers/projects.ts` (add `output`), `packages/api-server/src/routes/export.ts`, `packages/api-server/src/app.ts:20-28,64`
- Test: `packages/api-server/src/routes/export-project.test.ts` (new)

**Interfaces:**
- Consumes: `loadRunExport(db, runId)` and `RunExport` from `./load-run-export.js` / `./build-run-export.js`; `toCsv`, `toJson` from `./serialize.js`.
- Produces:
  ```ts
  export type ProjectExport = {
    project: { id: string; name: string; slug: string };
    /** "Website" first, then the contract's names in schema order, then any extra column a website produced. */
    fields: string[];
    rows: Record<string, unknown>[];              // each row carries Website: <website name>
    websites: Array<{ id: string; name: string; slug: string; runId: string | null; completedAt: string | null; rowCount: number }>;
    rowCount: number;
    generatedAt: string;                          // ISO
  };
  export async function loadProjectExport(db, projectId: string): Promise<ProjectExport | null>;
  export function projectExportFilename(x: ProjectExport, extension: 'csv' | 'json'): string;  // `${slug}-${date}.${ext}`
  // projects.output
  input:  { projectSlug: string; orgSlug?: string }
  output: ProjectExport with rows capped at 500 (rowCount stays the true total) — throws NOT_FOUND outside the org
  // api-server
  GET /export/projects/<projectUuid>.csv | .json   (404 otherwise; unauthenticated like /export/runs — noted for cut-over)
  ```

- [ ] **Step 1: Write the failing tests**

`packages/api/src/export/load-project-export.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, runs, captures, extractions } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from '../routers/index.js';
import { loadProjectExport, projectExportFilename } from './load-project-export.js';

const caller = createCallerFactory(appRouter)({ db, session: null });

describe('loadProjectExport', () => {
  it('returns null for an unknown project', async () => {
    expect(await loadProjectExport(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('merges the latest completed run of every website under a Website column, in contract order', async () => {
    const p = await caller.projects.create({ name: `Export ${Date.now()}` });
    try {
      await caller.datasets.addField({ datasetId: p.datasetId, name: 'Title', type: 'text' });
      const price = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
      const title = (await caller.datasets.getContract({ datasetId: p.datasetId })).find((f) => f.name === 'Title')!;
      const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Alpha', url: 'https://alpha.example.com/' });
      const b = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Beta', url: 'https://beta.example.com/' });

      async function run(sourceId: string, rows: Record<string, unknown>[], createdAt: Date, status = 'completed') {
        const [r] = await db.insert(runs).values({ sourceId, status, createdAt, startedAt: createdAt, completedAt: status === 'completed' ? createdAt : null, resultCount: rows.length }).returning({ id: runs.id });
        const [c] = await db.insert(captures).values({ sourceId, runId: r!.id, url: 'https://x.example.com/', html: '<html></html>' }).returning({ id: captures.id });
        await db.insert(extractions).values({ sourceId, captureId: c!.id, runId: r!.id, data: rows, rowCount: rows.length });
        return r!.id;
      }
      const old = new Date('2026-09-01T00:00:00Z');
      const newer = new Date('2026-09-02T00:00:00Z');
      await run(a.sourceId, [{ [title.key]: 'Old', [price.key]: '1' }], old);
      const latestA = await run(a.sourceId, [{ [title.key]: 'Chair', [price.key]: '10', _url: 'https://alpha.example.com/chair' }], newer);
      await run(b.sourceId, [{ [title.key]: 'Never', [price.key]: '0' }], newer, 'failed'); // not completed: ignored
      const latestB = await run(b.sourceId, [{ [title.key]: 'Table', [price.key]: '20' }], old);

      const x = (await loadProjectExport(db, p.id))!;
      expect(x.project.slug).toBe(p.slug);
      expect(x.fields).toEqual(['Website', 'Title', 'Price', '_url']);
      expect(x.rows).toEqual([
        { Website: 'Alpha', Title: 'Chair', Price: '10', _url: 'https://alpha.example.com/chair' },
        { Website: 'Beta', Title: 'Table', Price: '20' },
      ]);
      expect(x.rowCount).toBe(2);
      expect(x.websites).toEqual([
        { id: a.sourceId, name: 'Alpha', slug: a.sourceSlug, runId: latestA, completedAt: newer.toISOString(), rowCount: 1 },
        { id: b.sourceId, name: 'Beta', slug: b.sourceSlug, runId: latestB, completedAt: old.toISOString(), rowCount: 1 },
      ]);
      expect(projectExportFilename(x, 'csv')).toBe(`${p.slug}-${x.generatedAt.slice(0, 10)}.csv`);
    } finally {
      await db.delete(projects).where(eq(projects.id, p.id));
    }
  });

  it('lists a website with no completed run with a null run and no rows', async () => {
    const p = await caller.projects.create({ name: `Export empty ${Date.now()}` });
    try {
      const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Alpha', url: 'https://alpha.example.com/' });
      const x = (await loadProjectExport(db, p.id))!;
      expect(x.fields).toEqual(['Website']);
      expect(x.rows).toEqual([]);
      expect(x.websites).toEqual([{ id: a.sourceId, name: 'Alpha', slug: a.sourceSlug, runId: null, completedAt: null, rowCount: 0 }]);
    } finally {
      await db.delete(projects).where(eq(projects.id, p.id));
    }
  });
});
```

Check `captures`' required columns in `packages/db/src/schema.ts` before running (the insert above names `sourceId, runId, url, html`; add whatever else is `notNull` without a default, as `load-run-export-aggregate.test.ts` does).

`packages/api-server/src/routes/export-project.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createExportRoutes } from './export.js';
import type { ProjectExport } from '@robot/api/export';

const sample: ProjectExport = {
  project: { id: '11111111-1111-1111-1111-111111111111', name: 'Acme', slug: 'acme' },
  fields: ['Website', 'Title', 'Price'],
  rows: [{ Website: 'Alpha', Title: 'Chair, oak', Price: '10' }],
  websites: [{ id: 'a', name: 'Alpha', slug: 'alpha', runId: 'r', completedAt: '2026-09-02T00:00:00.000Z', rowCount: 1 }],
  rowCount: 1,
  generatedAt: '2026-09-21T10:00:00.000Z',
};
const app = createExportRoutes({
  loadRunExport: async () => null,
  loadProjectExport: async (id) => (id === sample.project.id ? sample : null),
});

describe('GET /export/projects/:file', () => {
  it('serves CSV with the project filename', async () => {
    const res = await app.request(`/projects/${sample.project.id}.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="acme-2026-09-21.csv"');
    const text = await res.text();
    expect(text).toContain('Website,Title,Price');
    expect(text).toContain('Alpha,"Chair, oak",10');
  });

  it('serves JSON', async () => {
    const res = await app.request(`/projects/${sample.project.id}.json`);
    expect(res.status).toBe(200);
    expect((await res.json()).rowCount).toBe(1);
  });

  it('404s an unknown project, a malformed id and an unknown format', async () => {
    expect((await app.request('/projects/22222222-2222-2222-2222-222222222222.csv')).status).toBe(404);
    expect((await app.request('/projects/not-a-uuid.csv')).status).toBe(404);
    expect((await app.request(`/projects/${sample.project.id}.xlsx`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @robot/api exec vitest run --maxWorkers=1 load-project-export` and `pnpm --filter @robot/api-server exec vitest run export-project`
Expected: FAIL — module not found / `loadProjectExport` is not a dep.

- [ ] **Step 3: Implement**

`packages/api/src/export/load-project-export.ts`:

```ts
// The project's output (spec 2026-09-21 §5): every website's latest completed
// run, side by side under one header. Built from `loadRunExport` per website so
// a project file and a run file can never disagree about a row.
import { and, desc, eq, isNotNull, inArray } from 'drizzle-orm';
import { datasets, projects, runs, sources } from '@robot/db';
import type { db as Database } from '@robot/db';
import { contractFields } from '../contract.js';
import { loadRunExport } from './load-run-export.js';

export type ProjectExport = {
  project: { id: string; name: string; slug: string };
  /** "Website" first, then the contract's names in schema order, then any extra column a website produced. */
  fields: string[];
  rows: Record<string, unknown>[];
  websites: Array<{ id: string; name: string; slug: string; runId: string | null; completedAt: string | null; rowCount: number }>;
  rowCount: number;
  generatedAt: string;
};

export const WEBSITE_COLUMN = 'Website';

export async function loadProjectExport(db: typeof Database, projectId: string): Promise<ProjectExport | null> {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId), columns: { id: true, name: true, slug: true } });
  if (!project) return null;

  const dataset = await db.query.datasets.findFirst({
    where: eq(datasets.projectId, project.id),
    orderBy: (d, { asc }) => [asc(d.createdAt)],
    columns: { id: true, schema: true },
  });
  const contractNames = dataset ? contractFields(dataset.schema).map((f) => f.name) : [];

  const sites = dataset
    ? await db.select({ id: sources.id, name: sources.name, slug: sources.slug }).from(sources).where(eq(sources.datasetId, dataset.id)).orderBy(sources.name)
    : [];

  // The latest COMPLETED run per website. A failed or cancelled run is not
  // output; a run still going has nothing to export yet.
  const latest = sites.length
    ? await db
        .selectDistinctOn([runs.sourceId], { sourceId: runs.sourceId, id: runs.id, completedAt: runs.completedAt })
        .from(runs)
        .where(and(inArray(runs.sourceId, sites.map((s) => s.id)), eq(runs.status, 'completed'), isNotNull(runs.completedAt)))
        .orderBy(runs.sourceId, desc(runs.completedAt), desc(runs.id))
    : [];
  const latestBySource = new Map(latest.map((r) => [r.sourceId!, r]));

  const rows: Record<string, unknown>[] = [];
  const extras: string[] = [];
  const websites: ProjectExport['websites'] = [];
  for (const site of sites) {
    const run = latestBySource.get(site.id);
    const runExport = run ? await loadRunExport(db, run.id) : null;
    const siteRows = runExport?.rows ?? [];
    for (const r of siteRows) rows.push({ [WEBSITE_COLUMN]: site.name, ...r });
    for (const f of runExport?.fields ?? []) if (!contractNames.includes(f) && !extras.includes(f)) extras.push(f);
    websites.push({ id: site.id, name: site.name, slug: site.slug, runId: run?.id ?? null, completedAt: run?.completedAt?.toISOString() ?? null, rowCount: siteRows.length });
  }

  return {
    project,
    fields: [WEBSITE_COLUMN, ...contractNames, ...extras],
    rows,
    websites,
    rowCount: rows.length,
    generatedAt: new Date().toISOString(),
  };
}

export function projectExportFilename(x: ProjectExport, extension: 'csv' | 'json'): string {
  return `${x.project.slug}-${x.generatedAt.slice(0, 10)}.${extension}`;
}
```

Add to `packages/api/src/export/index.ts`: `export { loadProjectExport, projectExportFilename, WEBSITE_COLUMN, type ProjectExport } from './load-project-export.js';`.

In `projects.ts`, import `loadProjectExport` from `'../export/load-project-export.js'` and add:

```ts
  /** The Output screen (spec 2026-09-21 §5): the project export, capped for the browser. The file has everything. */
  output: publicProcedure
    .input(z.object({ projectSlug: z.string().min(1), orgSlug: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const project = await findProjectInOrg(ctx, input.projectSlug, input.orgSlug);
      if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: `Project ${input.projectSlug} not found` });
      const x = (await loadProjectExport(ctx.db, project.id))!;
      return { ...x, rows: x.rows.slice(0, OUTPUT_ROW_CAP) };
    }),
```

with `const OUTPUT_ROW_CAP = 500;` at the top of the file (the same number `runs.getWithDetails` uses, for the same reason).

In `packages/api-server/src/routes/export.ts`: `ExportDeps` gains `loadProjectExport: (projectId: string) => Promise<ProjectExport | null>`; factor the `<uuid>.<csv|json>` parsing into a local `parseFile(file): { id, format } | null`; add:

```ts
  app.get('/projects/:file', async (c) => {
    const parsed = parseFile(c.req.param('file'));
    if (!parsed) return c.notFound();
    const x = await deps.loadProjectExport(parsed.id);
    if (!x) return c.json({ error: 'Project not found' }, 404);
    const body = parsed.format === 'csv' ? toCsv(x.fields, x.rows) : toJson(x);
    return c.body(body, 200, {
      'content-type': parsed.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${projectExportFilename(x, parsed.format)}"`,
    });
  });
```

Check `toJson`'s signature in `serialize.ts` — if it takes a `RunExport`, widen it to `unknown` (it is `JSON.stringify` with indentation) or add `toJsonValue`. In `app.ts`, `AppDeps` gains `loadProjectExport`, defaulted to `(id) => loadProjectExport(db, id)`, and the route mount passes both. Extend the header comment on `export.ts`: the project route is unauthenticated by the project UUID exactly like the run route, and cut-over (spec 2026-09-21 §7 plan 6) puts both behind the session.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @robot/api exec vitest run --maxWorkers=1 load-project-export projects-get` ; `pnpm --filter @robot/api-server exec vitest run` ; both typechecks.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/export/load-project-export.ts packages/api/src/export/load-project-export.test.ts packages/api/src/export/index.ts packages/api/src/export/serialize.ts packages/api/src/routers/projects.ts packages/api-server/src/routes/export.ts packages/api-server/src/routes/export-project.test.ts packages/api-server/src/app.ts
git commit -m "feat(api): projects.output and a project-level CSV/JSON export" -- packages/api/src/export packages/api/src/routers/projects.ts packages/api-server/src/routes packages/api-server/src/app.ts
```

---

### Task 4: The project routes, breadcrumb, sidebar section and ⌘K

**Files:**
- Move: `packages/app/src/routes/_app/projects.tsx` → `packages/app/src/routes/_app/projects/index.tsx` (`git mv`; the route id becomes `/_app/projects/`)
- Create: `packages/app/src/routes/_app/projects/$project.tsx`, `packages/app/src/routes/_app/projects/$project/index.tsx`, `…/$project/fields.tsx`, `…/$project/output.tsx` (the last three as `ComingLater`-style placeholders that Tasks 5–7 fill), `packages/app/src/components/shell/project-section.tsx`
- Modify: `packages/app/src/routes/_app.tsx` (breadcrumb), `packages/app/src/components/shell/sidebar.tsx`, `packages/app/src/components/shell/command-menu.tsx`, `packages/app/src/routes/__root.tsx` (mount `<Toaster />` from `components/ui/sonner`)
- Test: `packages/app/src/lib/project-nav-view.test.ts` with `packages/app/src/lib/project-nav-view.ts`

**Interfaces:**
- Consumes: `trpc.projects.get` (Task 1).
- Produces:
  ```ts
  // lib/project-nav-view.ts
  export type ProjectNavItem = { to: '/projects/$project' | '/projects/$project/fields' | '/projects/$project/output'; label: string; exact: boolean };
  export const PROJECT_NAV: readonly ProjectNavItem[];   // Websites (exact, the home), Fields, Output
  export function crumbs(org: string, project: { name: string; slug: string } | null): Array<{ label: string; to?: '/projects/$project'; params?: { project: string } }>;
  // routes/_app/projects/$project.tsx
  export const Route: createFileRoute('/_app/projects/$project') — component renders <Outlet/>; child routes call
  export function useProject(): UseTRPCQueryResult<projects.get output>   // one hook, one cache key, shared by the layout, the sidebar and every child
  ```
  The `useProject` hook reads the `project` param with `Route.useParams()` from the layout route and returns `trpc.projects.get.useQuery({ projectSlug })`.

- [ ] **Step 1: Write the failing test**

`packages/app/src/lib/project-nav-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PROJECT_NAV, crumbs } from './project-nav-view';

describe('project navigation', () => {
  it('has the three project screens, the home exact', () => {
    expect(PROJECT_NAV.map((i) => [i.label, i.exact])).toEqual([['Websites', true], ['Fields', false], ['Output', false]]);
  });

  it('crumbs are org alone outside a project, org then project inside one', () => {
    expect(crumbs('Acme', null)).toEqual([{ label: 'Acme' }]);
    expect(crumbs('Acme', { name: 'Prices', slug: 'prices' })).toEqual([{ label: 'Acme' }, { label: 'Prices', to: '/projects/$project', params: { project: 'prices' } }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @robot/app exec vitest run project-nav-view`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`lib/project-nav-view.ts`:

```ts
/** The project section of the sidebar and the breadcrumb (spec 2026-09-21 §3). Pure. */
export type ProjectNavItem = {
  to: '/projects/$project' | '/projects/$project/fields' | '/projects/$project/output';
  label: string;
  /** The home is the section's index: active only on its own path, or every child would light it too. */
  exact: boolean;
};

export const PROJECT_NAV: readonly ProjectNavItem[] = [
  { to: '/projects/$project', label: 'Websites', exact: true },
  { to: '/projects/$project/fields', label: 'Fields', exact: false },
  { to: '/projects/$project/output', label: 'Output', exact: false },
];

export type Crumb = { label: string; to?: '/projects/$project'; params?: { project: string } };

export function crumbs(org: string, project: { name: string; slug: string } | null): Crumb[] {
  const out: Crumb[] = [{ label: org }];
  if (project) out.push({ label: project.name, to: '/projects/$project', params: { project: project.slug } });
  return out;
}
```

`routes/_app/projects/$project.tsx`:

```tsx
import { Outlet, createFileRoute } from '@tanstack/react-router';
import { trpc } from '../../../lib/trpc';

/**
 * The project layout: everything under /projects/:project. It renders only the
 * outlet — the shell's header and sidebar read the project through `useProject`
 * — so the one query is shared by the breadcrumb, the sidebar's project section
 * and whichever screen is open, under one cache key.
 */
export const Route = createFileRoute('/_app/projects/$project')({
  component: () => <Outlet />,
});

export function useProject() {
  const { project } = Route.useParams();
  return trpc.projects.get.useQuery({ projectSlug: project });
}
```

The sidebar and header are rendered by `_app.tsx`, outside this route, so they cannot call `Route.useParams()` — they use `useParams({ strict: false })` from `@tanstack/react-router` and read `params.project` (undefined outside a project). Put that in `components/shell/project-section.tsx`:

```tsx
import { Link, useParams } from '@tanstack/react-router';
import { RunDot } from '../run-dot';
import { runDotState } from '../../lib/run-dot-view';
import { PROJECT_NAV } from '../../lib/project-nav-view';
import { trpc } from '../../lib/trpc';

/** Reads the current project's slug from the URL anywhere in the shell; undefined outside a project. */
export function useProjectSlug(): string | undefined {
  const params = useParams({ strict: false }) as { project?: string };
  return params.project;
}

/**
 * The sidebar's project section (spec §3): under the org-wide nav, the project
 * the customer is in — its websites, then Fields and Output. Rendered only
 * inside a project; the query is the same one the screen runs.
 */
export function ProjectSection({ onNavigate }: { onNavigate?: () => void }) {
  const slug = useProjectSlug();
  const project = trpc.projects.get.useQuery({ projectSlug: slug! }, { enabled: !!slug });
  if (!slug || !project.data) return null;

  return (
    <div className="border-t border-line p-2">
      <p className="truncate px-2 pt-1 pb-1.5 text-sm text-muted-foreground">{project.data.name}</p>
      {PROJECT_NAV.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          params={{ project: slug }}
          activeOptions={{ exact: item.exact }}
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-base text-muted-foreground hover:text-text"
          activeProps={{ className: 'bg-raised font-medium text-text!' }}
        >
          {item.label}
        </Link>
      ))}
      {/* The websites, one line each with the run dot — the "is anything running" glance (spec §4).
          Plain rows until plan 3 gives a website its page. */}
      {project.data.websites.length > 0 ? (
        <ul className="mt-1 border-t border-line pt-1">
          {project.data.websites.map((w) => (
            <li key={w.id} className="flex items-center gap-2.5 px-2 py-1 text-sm text-muted-foreground">
              <RunDot status={runDotState(w.lastRun)} />
              <span className="truncate">{w.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

In `sidebar.tsx`, render `<ProjectSection onNavigate={onNavigate} />` directly after the `<nav>` (inside the flex column, before the bottom block). The `<nav>` loses `flex-1`; wrap nav + section in a `<div className="flex flex-1 flex-col overflow-y-auto">` so a long website list scrolls inside the rail.

In `_app.tsx`, the breadcrumb becomes a component in the same file:

```tsx
function Breadcrumb({ org }: { org: string }) {
  const slug = useProjectSlug();
  const project = trpc.projects.get.useQuery({ projectSlug: slug! }, { enabled: !!slug });
  const items = crumbs(org, project.data ? { name: project.data.name, slug: project.data.slug } : null);
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      {items.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-2">
          {i > 0 ? <span aria-hidden className="text-faint">/</span> : null}
          {c.to ? (
            <Link to={c.to} params={c.params} className="truncate hover:text-text">{c.label}</Link>
          ) : (
            <span className="truncate">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
```

(`text-faint` exists if `--faint` is a token in `tokens.css`; if the divider colour token is named differently, use the token the sidebar's dividers use — never `--muted` as text; a `/` is a glyph, so the divider token is right for it.)

Rows on `/projects` (now `projects/index.tsx`): the name cell becomes `<Link to="/projects/$project" params={{ project: project.slug }} className="text-text hover:underline underline-offset-4">{project.name}</Link>` and the whole row gets `onClick` navigation? No — one link per row, the name; clicking elsewhere on a row does nothing (a row that navigates on any click swallows text selection). Remove the "Plan 2 gives a project its own page" comment.

`command-menu.tsx`: project rows `onSelect={() => { onOpenChange(false); void navigate({ to: '/projects/$project', params: { project: project.slug } }); }}`; remove the "until it lands" comment. Add the three project pages to the palette only when inside a project? No — keep the palette as it is; plan 3 adds websites to it.

`__root.tsx`: render `<Toaster />` (from `../components/ui/sonner`) once inside the body, after the outlet — Task 6 uses it.

Placeholders for the three child routes:

```tsx
// routes/_app/projects/$project/index.tsx
import { createFileRoute } from '@tanstack/react-router';
import { ComingLater } from '../../../../components/page';
export const Route = createFileRoute('/_app/projects/$project/')({ component: () => <ComingLater title="Websites" /> });
```

and the same for `fields.tsx` (`'/_app/projects/$project/fields'`, title "Fields") and `output.tsx` (`'/_app/projects/$project/output'`, title "Output"). Run `pnpm --filter @robot/app dev` once (or `vite build`) so `routeTree.gen.ts` regenerates, and commit the regenerated file.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @robot/app exec vitest run` and `pnpm --filter @robot/app typecheck`. With the api-server and app running, sign in through `/login` as `nav-<timestamp>@example.com`, create a project through the dialog, click its name: the URL is `/projects/<slug>`, the breadcrumb reads `<org> / <project>`, the sidebar shows the project section with Websites active, Fields and Output navigate, ⌘K → the project goes there too, and the browser console is clean. Report the throwaway address.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/routes packages/app/src/routeTree.gen.ts packages/app/src/components/shell packages/app/src/lib/project-nav-view.ts packages/app/src/lib/project-nav-view.test.ts
git commit -m "feat(app): the project routes — layout, breadcrumb, sidebar project section, rows that link" -- packages/app/src/routes packages/app/src/routeTree.gen.ts packages/app/src/components/shell packages/app/src/lib/project-nav-view.ts packages/app/src/lib/project-nav-view.test.ts
```

---

### Task 5: Project home — the websites table and "Add website"

**Files:**
- Create: `packages/app/src/lib/site-name.ts` (+ `site-name.test.ts`), `packages/app/src/lib/websites-view.ts` (+ `websites-view.test.ts`), `packages/app/src/components/project/websites-table.tsx`, `packages/app/src/components/project/add-website-dialog.tsx`
- Modify: `packages/app/src/routes/_app/projects/$project/index.tsx`

**Interfaces:**
- Consumes: `useProject()` (Task 4); `trpc.sources.createInProject({ projectSlug, name, url })`; `runDotState`, `relativeTime`, `isoDate`.
- Produces:
  ```ts
  // lib/site-name.ts
  export function siteNameFromUrl(url: string): string;      // "https://shop.currys.co.uk/x" → "Currys"; '' when unparseable
  export function hostnameOf(url: string | null): string;    // "shop.currys.co.uk"; '' when null/unparseable
  // lib/websites-view.ts
  export type WebsiteRow = { id: string; slug: string; name: string; url: string | null; verifiedFields: number;
    lastRun: { status: string; createdAt: Date; completedAt: Date | null; resultCount: number | null } | null };
  export type VerifiedState = 'none' | 'partial' | 'all' | 'no-fields';
  export type WebsiteView = { id: string; slug: string; name: string; hostname: string; verifiedLabel: string; verifiedState: VerifiedState;
    lastRunState: RunDotStatus; lastRunLabel: string | null; rowsLabel: string | null };
  export function verifiedLabel(verified: number, total: number): { label: string; state: VerifiedState };
  export function websitesView(rows: readonly WebsiteRow[], totalFields: number, now?: Date): WebsiteView[];
  ```

- [ ] **Step 1: Write the failing tests**

`lib/site-name.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { siteNameFromUrl, hostnameOf } from './site-name';

describe('siteNameFromUrl', () => {
  const cases: Array<[string, string]> = [
    ['https://www.ikea.com/my/en/', 'Ikea'],
    ['https://shop.currys.co.uk/x', 'Currys'],
    ['https://example.org', 'Example'],
    ['http://localhost:3000', ''],
    ['not a url', ''],
  ];
  for (const [url, name] of cases) it(`${url} → "${name}"`, () => expect(siteNameFromUrl(url)).toBe(name));
});

describe('hostnameOf', () => {
  it('gives the hostname, and nothing for nothing', () => {
    expect(hostnameOf('https://shop.currys.co.uk/x?y=1')).toBe('shop.currys.co.uk');
    expect(hostnameOf(null)).toBe('');
    expect(hostnameOf('nope')).toBe('');
  });
});
```

`lib/websites-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { verifiedLabel, websitesView, type WebsiteRow } from './websites-view';

const NOW = new Date('2026-09-21T12:00:00Z');
function row(over: Partial<WebsiteRow> & { name: string }): WebsiteRow {
  return { id: over.name, slug: over.name.toLowerCase(), url: `https://${over.name.toLowerCase()}.example.com/`, verifiedFields: 0, lastRun: null, ...over };
}

describe('verifiedLabel', () => {
  it('reads as the customer would say it', () => {
    expect(verifiedLabel(0, 0)).toEqual({ label: 'No fields yet', state: 'no-fields' });
    expect(verifiedLabel(0, 8)).toEqual({ label: 'Not verified', state: 'none' });
    expect(verifiedLabel(3, 8)).toEqual({ label: '3 of 8 verified', state: 'partial' });
    expect(verifiedLabel(8, 8)).toEqual({ label: 'All 8 verified', state: 'all' });
    expect(verifiedLabel(1, 1)).toEqual({ label: 'All 1 verified', state: 'all' });
  });
});

describe('websitesView', () => {
  it('formats hostname, verification, the run dot and the row count; sorted by name', () => {
    const views = websitesView(
      [
        row({ name: 'Zed', verifiedFields: 8, lastRun: { status: 'completed', createdAt: new Date('2026-09-21T09:00:00Z'), completedAt: new Date('2026-09-21T09:05:00Z'), resultCount: 120 } }),
        row({ name: 'Alpha', url: 'https://shop.alpha.co.uk/p/1' }),
      ],
      8,
      NOW,
    );
    expect(views.map((v) => v.name)).toEqual(['Alpha', 'Zed']);
    expect(views[0]).toMatchObject({ hostname: 'shop.alpha.co.uk', verifiedLabel: 'Not verified', verifiedState: 'none', lastRunState: 'idle', lastRunLabel: null, rowsLabel: null });
    expect(views[1]).toMatchObject({ hostname: 'zed.example.com', verifiedLabel: 'All 8 verified', verifiedState: 'all', lastRunState: 'done', lastRunLabel: '3 h ago', rowsLabel: '120 rows' });
  });

  it('one row is "1 row"', () => {
    const [v] = websitesView([row({ name: 'A', lastRun: { status: 'completed', createdAt: NOW, completedAt: NOW, resultCount: 1 } })], 2, NOW);
    expect(v!.rowsLabel).toBe('1 row');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @robot/app exec vitest run site-name websites-view`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the view modules**

`lib/site-name.ts` — copy `siteNameFromUrl` verbatim from `packages/dashboard/src/lib/site-name.ts` (it is the same rule; the old package is deleted at cut-over) and add:

```ts
export function hostnameOf(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
```

`lib/websites-view.ts`:

```ts
import { runDotState, type RunDotStatus } from './run-dot-view';
import { relativeTime } from './projects-view';
import { hostnameOf } from './site-name';

export type WebsiteRow = {
  id: string; slug: string; name: string; url: string | null; verifiedFields: number;
  lastRun: { status: string; createdAt: Date; completedAt: Date | null; resultCount: number | null } | null;
};

/** How far a website's certification has got — drawn as a 2 px rail, never a wash (spec §4). */
export type VerifiedState = 'none' | 'partial' | 'all' | 'no-fields';

export type WebsiteView = {
  id: string; slug: string; name: string; hostname: string;
  verifiedLabel: string; verifiedState: VerifiedState;
  lastRunState: RunDotStatus; lastRunLabel: string | null;
  /** "120 rows" from the last run, or null when it produced no count. */
  rowsLabel: string | null;
};

export function verifiedLabel(verified: number, total: number): { label: string; state: VerifiedState } {
  if (total === 0) return { label: 'No fields yet', state: 'no-fields' };
  if (verified === 0) return { label: 'Not verified', state: 'none' };
  if (verified === total) return { label: `All ${total} verified`, state: 'all' };
  return { label: `${verified} of ${total} verified`, state: 'partial' };
}

export function websitesView(rows: readonly WebsiteRow[], totalFields: number, now: Date = new Date()): WebsiteView[] {
  return [...rows]
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
    .map((w) => {
      const v = verifiedLabel(w.verifiedFields, totalFields);
      const count = w.lastRun?.resultCount;
      return {
        id: w.id, slug: w.slug, name: w.name, hostname: hostnameOf(w.url),
        verifiedLabel: v.label, verifiedState: v.state,
        lastRunState: runDotState(w.lastRun),
        lastRunLabel: w.lastRun ? relativeTime(w.lastRun.createdAt, now) : null,
        rowsLabel: count == null ? null : `${count} ${count === 1 ? 'row' : 'rows'}`,
      };
    });
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @robot/app exec vitest run site-name websites-view`
Expected: PASS.

- [ ] **Step 5: The screen**

`components/project/websites-table.tsx` — the same table grammar as `projects/index.tsx` (outer `rise` panel, `colgroup`, sticky head from `md`, hover raises): columns **Name** (name in `text-text`, hostname under it in `font-mono text-sm text-muted-foreground`), **Verified** (the label, with a 2 px left rail on the cell: `all` → `border-l-2 border-pass`, `partial` → `border-warn`, `none` → `border-fail`, `no-fields` → `border-line`; the rail is the state colour, the text stays `--text`), **Last run** (`RunDot` + relative label, as on `/projects`), **Rows** (mono, right). Props: `{ websites: WebsiteView[]; loading: boolean }`. Loading rows are three `Skeleton` rows as on `/projects`. Rows are not links (plan 3).

`components/project/add-website-dialog.tsx` — the `NewProjectDialog` pattern: fields **Address** (`type="url"`, placeholder `https://www.example.com/products/…`, autofocus, "Any page on the website will do") and **Name** (prefilled from `siteNameFromUrl(url)` on every URL change until the customer edits the name — track `nameTouched`). Submit → `trpc.sources.createInProject.mutateAsync({ projectSlug, name: name.trim(), url: url.trim() })`, then `utils.projects.get.invalidate({ projectSlug })` and `utils.projects.list.invalidate()`, close. Error copy: "That website could not be added. Try again." Props `{ projectSlug: string; open; onOpenChange }`.

`routes/_app/projects/$project/index.tsx`:

```tsx
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Page } from '../../../../components/page';
import { Button } from '../../../../components/ui/button';
import { WebsitesTable } from '../../../../components/project/websites-table';
import { AddWebsiteDialog } from '../../../../components/project/add-website-dialog';
import { websitesView } from '../../../../lib/websites-view';
import { useProject } from '../$project';

export const Route = createFileRoute('/_app/projects/$project/')({ component: ProjectHome });

function ProjectHome() {
  const { project: slug } = Route.useParams();
  const project = useProject();
  const [adding, setAdding] = useState(false);
  const websites = websitesView(project.data?.websites ?? [], project.data?.fields.length ?? 0);
  const empty = !!project.data && websites.length === 0;

  return (
    <Page title={project.data?.name ?? ' '} actions={empty ? undefined : <Button onClick={() => setAdding(true)}>Add website</Button>}>
      {project.isError ? (
        /* NOT_FOUND → a sentence, not a table: "This project does not exist in <org>." with a link back to /projects; any other error → "Could not load the project." + Retry, as on /projects */
        …
      ) : empty ? (
        <div className="rise flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-panel px-4 py-5 [box-shadow:var(--shadow)]">
          <p className="text-base text-muted-foreground">No websites yet. Add the first one to start collecting {project.data!.fields.length > 0 ? 'its fields' : 'data'}.</p>
          <Button onClick={() => setAdding(true)}>Add website</Button>
        </div>
      ) : (
        <WebsitesTable websites={websites} loading={project.isPending} />
      )}
      <AddWebsiteDialog projectSlug={slug} open={adding} onOpenChange={setAdding} />
    </Page>
  );
}
```

The `…` in the error branch is written out in full by the implementer using the `/projects` error block as the model (cause-neutral copy, Retry, `role="alert"`); the NOT_FOUND branch reads `project.error.data?.code === 'NOT_FOUND'`. Write the `title` as the project name once loaded; while pending render the title row with a `Skeleton` in place of the name rather than a blank string (adjust `Page` to accept `title: ReactNode` if it is typed `string`).

Under the table, when the project has no fields yet, one line in `text-muted-foreground`: "This project has no fields yet — add them on the Fields page." with a `Link` to `/projects/$project/fields`.

- [ ] **Step 6: Verify in the browser**

`pnpm --filter @robot/app typecheck`; sign in as `home-<timestamp>@example.com`, create a project, add a website through the dialog (`https://www.ikea.com/my/en/` → name prefilled "Ikea"), assert the row shows `www.ikea.com`, "No fields yet" (grey rail), an idle dot and no rows; the sidebar section lists it. Console clean. Report the address.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/lib/site-name.ts packages/app/src/lib/site-name.test.ts packages/app/src/lib/websites-view.ts packages/app/src/lib/websites-view.test.ts packages/app/src/components/project packages/app/src/components/page.tsx packages/app/src/routes/_app/projects/\$project/index.tsx
git commit -m "feat(app): the project home — websites table and Add website" -- packages/app/src/lib/site-name.ts packages/app/src/lib/site-name.test.ts packages/app/src/lib/websites-view.ts packages/app/src/lib/websites-view.test.ts packages/app/src/components/project packages/app/src/components/page.tsx "packages/app/src/routes/_app/projects/\$project/index.tsx"
```

---

### Task 6: The Fields screen — contract editor with the catalogue

**Files:**
- Create: `packages/app/src/lib/fields-view.ts` (+ `fields-view.test.ts`), `packages/app/src/components/fields/fields-table.tsx`, `field-catalogue.tsx`, `add-custom-field-dialog.tsx`, `delete-field-dialog.tsx`; `packages/app/src/components/ui/select.tsx` via `pnpm dlx shadcn@latest add select` from `packages/app` (relative imports, as the other ui files were adapted — see `task-5-report.md` of plan 1 in the handoff for the pattern)
- Modify: `packages/app/src/routes/_app/projects/$project/fields.tsx`

**Interfaces:**
- Consumes: `useProject()`; `trpc.datasets.getContract/fieldStatus/catalogue/addField/renameField/retypeField/deleteField`; `CUSTOMER_FIELD_TYPES` — import the **type** `CustomerFieldType` from `@robot/scraper` is a value-free import? No: `CUSTOMER_FIELD_TYPES` is a value. The app must not pull `@robot/scraper` into the browser bundle; declare the list in `fields-view.ts` and assert it equals the API's in the test by importing `CUSTOMER_FIELD_TYPES` from `@robot/scraper` **in the test only** (add `@robot/scraper` to the app's `devDependencies`).
- Produces:
  ```ts
  // lib/fields-view.ts
  export const FIELD_TYPES = ['text', 'number', 'money', 'boolean', 'date', 'url', 'image', 'text_list'] as const;
  export type FieldType = (typeof FIELD_TYPES)[number];
  export const TYPE_LABELS: Record<FieldType, string>;   // text→Text, number→Number, money→Money, boolean→Yes / no, date→Date, url→Link, image→Image, text_list→List
  export type ContractRow = { key: string; name: string; type: FieldType; concept: string; description?: string };
  export type FieldStatusRow = { verified: number; total: number; websites: Array<{ sourceId: string; slug: string; name: string; verified: boolean }> };
  export type FieldView = { key: string; name: string; type: FieldType; typeLabel: string; verifiedLabel: string; /* "2 of 3 websites" | "Not yet" | "—" (no websites) */ retypeLocked: boolean; verifiedOn: string[] /* website names */ };
  export function fieldsView(contract: readonly ContractRow[], status: Record<string, FieldStatusRow> | undefined, websiteCount: number): FieldView[];
  export function sharedNote(websiteCount: number): string | null;   // "Shared with 3 websites" when > 1, else null
  export function addNote(websiteCount: number): string | null;      // "This adds the field to 3 websites" when > 1
  export function deleteNote(view: FieldView, websiteCount: number): string; // "Removes it from 3 websites; 2 of them had verified it." / "Removes it from 1 website." / "Removes the field." (0 websites)
  ```

- [ ] **Step 1: Write the failing test**

`lib/fields-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CUSTOMER_FIELD_TYPES } from '@robot/scraper';
import { FIELD_TYPES, TYPE_LABELS, fieldsView, sharedNote, addNote, deleteNote, type ContractRow } from './fields-view';

const contract: ContractRow[] = [
  { key: 'price', name: 'Price', type: 'money', concept: 'price' },
  { key: 'title', name: 'Title', type: 'text', concept: 'product_name' },
];
const status = {
  price: { verified: 2, total: 3, websites: [{ sourceId: 'a', slug: 'a', name: 'Alpha', verified: true }, { sourceId: 'b', slug: 'b', name: 'Beta', verified: true }, { sourceId: 'c', slug: 'c', name: 'Gamma', verified: false }] },
  title: { verified: 0, total: 3, websites: [] },
};

describe('fields view', () => {
  it('the type list is the API\'s, with a label for each', () => {
    expect([...FIELD_TYPES]).toEqual([...CUSTOMER_FIELD_TYPES]);
    for (const t of FIELD_TYPES) expect(TYPE_LABELS[t]).toBeTruthy();
  });

  it('keeps contract order and says where each field is verified', () => {
    const v = fieldsView(contract, status, 3);
    expect(v.map((f) => f.name)).toEqual(['Price', 'Title']);
    expect(v[0]).toMatchObject({ typeLabel: 'Money', verifiedLabel: '2 of 3 websites', retypeLocked: true, verifiedOn: ['Alpha', 'Beta'] });
    expect(v[1]).toMatchObject({ typeLabel: 'Text', verifiedLabel: 'Not yet', retypeLocked: false, verifiedOn: [] });
  });

  it('with no websites the verified column is a dash, and before status loads nothing is locked', () => {
    expect(fieldsView(contract, undefined, 0)[0]).toMatchObject({ verifiedLabel: '—', retypeLocked: false });
  });

  it('notes', () => {
    expect(sharedNote(1)).toBeNull();
    expect(sharedNote(3)).toBe('Shared with 3 websites');
    expect(addNote(2)).toBe('This adds the field to 2 websites');
    expect(addNote(1)).toBeNull();
    const [price] = fieldsView(contract, status, 3);
    expect(deleteNote(price!, 3)).toBe('Removes it from 3 websites; 2 of them had verified it.');
    expect(deleteNote(fieldsView(contract, status, 1)[1]!, 1)).toBe('Removes it from 1 website.');
    expect(deleteNote(fieldsView(contract, undefined, 0)[1]!, 0)).toBe('Removes the field.');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @robot/app exec vitest run fields-view`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `fields-view.ts`**

```ts
/** The Fields screen's view logic (spec 2026-09-21 §5; the contract, spec 2026-09-08 §4.1–4.3). Pure. */
export const FIELD_TYPES = ['text', 'number', 'money', 'boolean', 'date', 'url', 'image', 'text_list'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Customer words for the engine's types. */
export const TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text', number: 'Number', money: 'Money', boolean: 'Yes / no', date: 'Date', url: 'Link', image: 'Image', text_list: 'List',
};

export type ContractRow = { key: string; name: string; type: FieldType; concept: string; description?: string };
export type FieldStatusRow = { verified: number; total: number; websites: Array<{ sourceId: string; slug: string; name: string; verified: boolean }> };
export type FieldView = { key: string; name: string; type: FieldType; typeLabel: string; verifiedLabel: string; retypeLocked: boolean; verifiedOn: string[] };

export function fieldsView(contract: readonly ContractRow[], status: Record<string, FieldStatusRow> | undefined, websiteCount: number): FieldView[] {
  return contract.map((f) => {
    const s = status?.[f.key];
    const verifiedOn = s ? s.websites.filter((w) => w.verified).map((w) => w.name) : [];
    const verified = s?.verified ?? 0;
    return {
      key: f.key, name: f.name, type: f.type, typeLabel: TYPE_LABELS[f.type],
      verifiedLabel: websiteCount === 0 ? '—' : verified === 0 ? 'Not yet' : `${verified} of ${websiteCount} websites`,
      // A verified field cannot change type (the API refuses); before status loads nothing is locked, and the API is the backstop.
      retypeLocked: verified > 0,
      verifiedOn,
    };
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function sharedNote(websiteCount: number): string | null {
  return websiteCount > 1 ? `Shared with ${plural(websiteCount, 'website')}` : null;
}

export function addNote(websiteCount: number): string | null {
  return websiteCount > 1 ? `This adds the field to ${plural(websiteCount, 'website')}` : null;
}

export function deleteNote(view: FieldView, websiteCount: number): string {
  if (websiteCount === 0) return 'Removes the field.';
  const verified = view.verifiedOn.length;
  return verified > 0
    ? `Removes it from ${plural(websiteCount, 'website')}; ${verified} of them had verified it.`
    : `Removes it from ${plural(websiteCount, 'website')}.`;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @robot/app exec vitest run fields-view` — PASS.

- [ ] **Step 5: The screen**

Layout (spec: "the contract editor with the catalogue"): the `Page` title is "Fields", its action is "Add your own" (opens `AddCustomFieldDialog`). Below, two panels stacked (they stagger in): **the fields table**, then **the catalogue** headed "Add from the catalogue". At `lg` and up they sit side by side in a `grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4`, the table first.

`components/fields/fields-table.tsx` — columns **Name** (an inline text input styled as text: borderless until focus, `font-medium`; commits on blur/Enter when changed via `datasets.renameField`; Escape restores), **Type** (`Select` from `ui/select` with `TYPE_LABELS`; disabled when `retypeLocked`, with a `Tooltip` "Verified on <names>. Delete and re-add it to change its type."; change → `datasets.retypeField`), **Verified on** (the label; when `verifiedOn.length > 0` a tooltip lists the names), and a trailing cell with a ghost icon button (`Trash2`, `aria-label="Delete <name>"`) → `DeleteFieldDialog`. Under the table's header, when `sharedNote` is non-null, one `text-sm text-muted-foreground` line with it. Empty state (no fields): one sentence "No fields yet. Pick them from the catalogue, or add your own." — no table furniture. A mutation failure sets a `role="alert"` line under the table: "That change could not be saved." (cause-neutral, as on `/projects`); a `PRECONDITION_FAILED` on retype shows the API's message, which is written for the customer ("<website> has verified this field; delete and re-add it to change its type").

`components/fields/field-catalogue.tsx` — `trpc.datasets.catalogue.useQuery()`; a row of type tabs (`Tabs` from `ui/tabs`, labels from the catalogue: Product, Listing item, …, Custom; default `product`), then the selected type's groups, each a label (`text-sm text-muted-foreground`) and a wrap of chips. A chip is a `Button variant="outline" size="sm"` with the entry's name and, in mono `text-sm text-muted-foreground`, its type label; a chip whose `key` is already in the contract (compare by `concept` + `name`? no — by `name`, case-insensitive, which is what `assertNameFree` refuses) renders disabled with a `Check` icon; clicking calls `datasets.addField({ datasetId, name, type, description, concept })`, then invalidates `getContract`, `fieldStatus`, `projects.get` and shows `toast(addNote(websiteCount) ?? 'Field added')` via sonner. Props: `{ datasetId: string; existingNames: string[]; websiteCount: number }`. The `custom` type has no groups — its tab shows one sentence and the "Add your own" button.

`components/fields/add-custom-field-dialog.tsx` — Name (autofocus) + Type (`Select`, default `text`) → `datasets.addField({ datasetId, name, type })`; the same note under the form when `addNote` is non-null. Error copy "That field could not be added. Try again."; a `CONFLICT`/`BAD_REQUEST` from `assertNameFree` shows "There is already a field called <name>." (check the code the API throws in `assertNameFree` and match it).

`components/fields/delete-field-dialog.tsx` — title "Delete <name>?", description `deleteNote(view, websiteCount)`, destructive confirm (`Button` — add a `variant: 'destructive'` to `ui/button.tsx` if missing: `bg-fail text-bg hover:bg-fail/90` — check contrast of `#0a0a0a` on `#ff5c5c` (≥ 4.5:1) and `#ffffff` on `#c62828` for light; use the pair that passes per theme via tokens, not a hard-coded colour) → `datasets.deleteField`.

`routes/_app/projects/$project/fields.tsx`: reads `useProject()` for `datasetId`, `websites.length` and the contract; `datasets.fieldStatus` with `enabled: !!datasetId`. When `datasetId` is null (legacy project) the page says "This project has no field list yet." and nothing else.

- [ ] **Step 6: Verify in the browser**

Typecheck + unit tests; sign in as `fields-<timestamp>@example.com`, create a project, open Fields, click Price and Title in the catalogue (chips go disabled, toast reads "Field added", rows appear), rename Title to Name inline, change its type to Link, add a custom field "Colour" of type Text, delete it (dialog says "Removes the field."), then add a website on the home and come back: the shared note is absent (1 website), "Verified on" reads "Not yet". Console clean. Report the address.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/lib/fields-view.ts packages/app/src/lib/fields-view.test.ts packages/app/src/components/fields packages/app/src/components/ui/select.tsx packages/app/src/components/ui/button.tsx packages/app/src/routes/_app/projects/\$project/fields.tsx packages/app/package.json pnpm-lock.yaml
git commit -m "feat(app): the Fields screen — the contract editor with the catalogue" -- packages/app/src/lib/fields-view.ts packages/app/src/lib/fields-view.test.ts packages/app/src/components/fields packages/app/src/components/ui/select.tsx packages/app/src/components/ui/button.tsx "packages/app/src/routes/_app/projects/\$project/fields.tsx" packages/app/package.json pnpm-lock.yaml
```

---

### Task 7: The Output screen

**Files:**
- Create: `packages/app/src/lib/output-view.ts` (+ `output-view.test.ts`), `packages/app/src/components/output/output-table.tsx`
- Modify: `packages/app/src/routes/_app/projects/$project/output.tsx`, `packages/app/src/lib/trpc.ts` (export `exportUrl`)

**Interfaces:**
- Consumes: `trpc.projects.output({ projectSlug })` (Task 3), `API_URL`.
- Produces:
  ```ts
  // lib/output-view.ts
  export type OutputInput = { fields: string[]; rows: Record<string, unknown>[]; rowCount: number; websites: Array<{ id: string; name: string; runId: string | null; completedAt: string | null; rowCount: number }> };
  export type OutputView = { columns: string[] /* fields without _-prefixed keys */; rows: string[][] /* cellText per column */; shown: number; total: number; truncated: boolean; summary: string /* "2 websites · 240 rows · latest 3 h ago" | "No rows yet" */ };
  export function cellText(value: unknown): string;   // null/undefined → '', string → itself, number/boolean → String, array → items joined ', ', object → JSON
  export function outputView(x: OutputInput, now?: Date): OutputView;
  // lib/trpc.ts
  export function exportUrl(kind: 'projects' | 'runs', id: string, format: 'csv' | 'json'): string;   // `${API_URL}/export/${kind}/${id}.${format}`
  ```

- [ ] **Step 1: Write the failing test**

`lib/output-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cellText, outputView } from './output-view';

const NOW = new Date('2026-09-21T12:00:00Z');

describe('cellText', () => {
  it('renders every value as the customer would read it', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
    expect(cellText('Chair')).toBe('Chair');
    expect(cellText(12.5)).toBe('12.5');
    expect(cellText(true)).toBe('true');
    expect(cellText(['a', 'b'])).toBe('a, b');
    expect(cellText({ x: 1 })).toBe('{"x":1}');
  });
});

describe('outputView', () => {
  it('hides provenance columns, stringifies cells, and summarises', () => {
    const v = outputView(
      {
        fields: ['Website', 'Title', 'Price', '_url'],
        rows: [{ Website: 'Alpha', Title: 'Chair', Price: 10, _url: 'https://a/1' }, { Website: 'Beta', Title: null, Price: '20' }],
        rowCount: 2,
        websites: [
          { id: 'a', name: 'Alpha', runId: 'r1', completedAt: '2026-09-21T09:00:00Z', rowCount: 1 },
          { id: 'b', name: 'Beta', runId: 'r2', completedAt: '2026-09-20T09:00:00Z', rowCount: 1 },
        ],
      },
      NOW,
    );
    expect(v.columns).toEqual(['Website', 'Title', 'Price']);
    expect(v.rows).toEqual([['Alpha', 'Chair', '10'], ['Beta', '', '20']]);
    expect(v).toMatchObject({ shown: 2, total: 2, truncated: false, summary: '2 websites · 2 rows · latest 3 h ago' });
  });

  it('says when the browser shows fewer rows than the file has', () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ Website: 'A', Title: `t${i}` }));
    const v = outputView({ fields: ['Website', 'Title'], rows, rowCount: 1200, websites: [{ id: 'a', name: 'A', runId: 'r', completedAt: '2026-09-21T11:00:00Z', rowCount: 1200 }] }, NOW);
    expect(v).toMatchObject({ shown: 500, total: 1200, truncated: true, summary: '1 website · 1200 rows · latest 1 h ago' });
  });

  it('with nothing run yet', () => {
    expect(outputView({ fields: ['Website'], rows: [], rowCount: 0, websites: [{ id: 'a', name: 'A', runId: null, completedAt: null, rowCount: 0 }] }, NOW).summary).toBe('No rows yet');
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `pnpm --filter @robot/app exec vitest run output-view` → FAIL, module not found.

- [ ] **Step 3: Implement**

`lib/output-view.ts`:

```ts
import { relativeTime } from './projects-view';

export type OutputInput = {
  fields: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  websites: Array<{ id: string; name: string; runId: string | null; completedAt: string | null; rowCount: number }>;
};

export type OutputView = { columns: string[]; rows: string[][]; shown: number; total: number; truncated: boolean; summary: string };

export function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(cellText).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `_`-prefixed columns are provenance (`_url`) — in the file, not on the screen. */
export function outputView(x: OutputInput, now: Date = new Date()): OutputView {
  const columns = x.fields.filter((f) => !f.startsWith('_'));
  const rows = x.rows.map((r) => columns.map((c) => cellText(r[c])));
  const latest = x.websites.map((w) => w.completedAt).filter((d): d is string => !!d).sort().at(-1);
  const summary = x.rowCount === 0
    ? 'No rows yet'
    : `${plural(x.websites.length, 'website')} · ${plural(x.rowCount, 'row')} · latest ${relativeTime(new Date(latest!), now)}`;
  return { columns, rows, shown: rows.length, total: x.rowCount, truncated: rows.length < x.rowCount, summary };
}
```

`lib/trpc.ts`: add `export function exportUrl(kind: 'projects' | 'runs', id: string, format: 'csv' | 'json') { return `${API_URL}/export/${kind}/${id}.${format}`; }`.

`components/output/output-table.tsx` — props `{ view: OutputView; loading: boolean }`. The panel: a header row inside it (`px-4 py-2.5 border-b border-line`) with the summary on the left in `text-sm text-muted-foreground` and, when `truncated`, "Showing the first 500 of <total> — the file has all of them." Then the table in an `overflow-x-auto` container (many columns; this is the one table allowed to be wider than the page), `min-w-max`, sticky head from `md`, the Website column `font-medium`, every other cell `max-w-[320px] truncate` with `title={text}` so a long description is readable on hover; numeric-looking cells are not right-aligned (values are strings of unknown type — consistency beats guessing). Empty (`total === 0`): one sentence "No rows yet. Run a website from its Extract page once it is verified." (plan 3 gives that page; the sentence stays true).

`routes/_app/projects/$project/output.tsx`: `Page` title "Output"; actions: two `Button variant="outline"` rendered as `<a href={exportUrl('projects', project.data.id, 'csv')} download>` — "Download CSV" and "Download JSON" — disabled (rendered as buttons, not anchors) while `output.data?.rowCount === 0`. Query `trpc.projects.output.useQuery({ projectSlug })`, error handling as on `/projects`.

- [ ] **Step 4: Verify**

Unit tests + typecheck. In the browser, as `output-<timestamp>@example.com`, a fresh project's Output shows "No rows yet" and the download buttons disabled. **Do not run an extraction** (it costs money and needs a certified website); the populated state is verified by the api test in Task 3 and by the look-only check in Task 8 against Marko's Acne project, read-only.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/lib/output-view.ts packages/app/src/lib/output-view.test.ts packages/app/src/lib/trpc.ts packages/app/src/components/output packages/app/src/routes/_app/projects/\$project/output.tsx
git commit -m "feat(app): the Output screen — every website's latest rows, and the file" -- packages/app/src/lib/output-view.ts packages/app/src/lib/output-view.test.ts packages/app/src/lib/trpc.ts packages/app/src/components/output "packages/app/src/routes/_app/projects/\$project/output.tsx"
```

---

### Task 8: Smoke, look-only check, screenshots, handoff

**Files:**
- Modify: `packages/app/src/routes-smoke.test.ts`, `docs/testing/screens/README.md`, `docs/handoff.md`, `CLAUDE.md`
- Create: `docs/testing/ui-check-app-project.mts`

- [ ] **Step 1: Smoke** — after the existing walk, with the throwaway project the run creates: add a website through the dialog (`https://www.example.com/`), open Fields, click one catalogue chip and assert a row, open Output and assert "No rows yet"; screenshot `app-project-home-{dark,light}.png`, `app-project-fields-{dark,light}.png`, `app-project-output-{dark,light}.png` (both themes, via `chooseTheme`); assert no console errors on each; cleanup unchanged (`projects.delete` over the run's cookie cascades the website).

- [ ] **Step 2: Look-only check** — `docs/testing/ui-check-app-project.mts`, run from `packages/browser` like `ui-check-app-shell.mts` (copy its sign-in, theme and measurement scaffolding; restore the theme it found). Given `--email markodjordjievski@gmail.com` it walks **read-only** through Acne (`/projects/acne`, `/fields`, `/output`): PASS/FAIL lines for: the breadcrumb reads "Markodjordjievski / Acne"; the sidebar project section shows "Ikea" with a dot; the websites table's Verified cell reads "All 8 verified" with a `border-left-color` equal to the pass token; Fields lists 8 rows with "Verified on" = "1 of 1 websites" and every type select disabled; Output's table has the Website column first and at least one row, the download links point at `/export/projects/<uuid>.csv`, and a `HEAD`/`GET` of the CSV returns 200 with `content-disposition` naming `acne-`. Plus the shell's measurements (13 px body, 20 px title, no uppercase, no shadow in dark) on each screen. **It clicks nothing that writes** — no chip, no rename, no dialog submit — on Marko's account. Screenshots of Acne's three screens in both themes to `docs/testing/screens/app-project-{home,fields,output}-acne-{dark,light}.png` — these are the ones Marko reviews. Then LOOK at every screenshot and fix what a designer would (rail weights, column widths, the catalogue's chip rhythm, the inline-edit affordance, the empty states); re-run after each fix.

- [ ] **Step 3: Docs** — screens README rows for the new files; `docs/handoff.md` section "App redesign, plan 2: the project (2026-09-21)": what landed per task with SHAs, the API changes (`projects.get`, `projects.output`, `/export/projects`, the procedures moved onto the session — and the list of those still shim-only: `projects.listByOrg`, `datasets.listByProject/getBySlug/create/updateSchema`, `sources.*` except `listByProject`/`createInProject`, `domains.*`, `runs.*`), what the old Output screen had that was not rebuilt (the field-origin / candidate editor — a decision for cut-over, recorded as open), what the check found and fixed, the screenshot set, open decisions, next plan (plan 3: the website — schema step 1, extract, runs, run detail, settings; website rows and the sidebar's website lines become links). `CLAUDE.md`: nothing new unless a command changed.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/routes-smoke.test.ts docs/testing/ui-check-app-project.mts docs/testing/screens docs/handoff.md CLAUDE.md
git commit -m "docs: project screens smoke, look-only check, and the handoff" -- packages/app/src/routes-smoke.test.ts docs/testing/ui-check-app-project.mts docs/testing/screens docs/handoff.md CLAUDE.md
```

---

## Self-review

- **Spec coverage.** §3 sidebar project section (Task 4), breadcrumbs org / project (Task 4; the website crumb is plan 3). §5 rows `/projects/:project` (Task 5: websites table with name, domain, verified n of m, last run; Add website with name + any page URL; sidebar shows Fields and Output), `/projects/:project/fields` (Task 6), `/projects/:project/output` (Task 7: table, export). §6 additive API (Tasks 1–3) with the restated migration rule. §8: API isolation tests per migrated procedure (Tasks 1–2), pure view logic with unit tests (Tasks 4–7), Playwright smoke per route per theme and the look-only check (Task 8). The mobile rule (tables scroll in their own container) is carried by the table grammar copied from `/projects` and by Output's explicit container.
- **Placeholders.** The one elided block (Task 5's error branch, marked `…`) names its model (`/projects`' error block) and its two cases; everything else is written out.
- **Type consistency.** `projects.get` returns `datasetId: string | null` (Task 1) and Tasks 5–6 handle null. `WebsiteRow` (Task 5) matches `projects.get`'s `websites[]` element. `OutputInput` (Task 7) is a subset of `ProjectExport` (Task 3). `crumbs`/`PROJECT_NAV` route literals match the file routes created in Task 4. `useProject` is exported from `$project.tsx` and imported as `'../$project'` by its children.
- **Decisions this plan makes** (the executor's ledger should carry them): directory-form file routes; one shared `projects.get` query instead of route loaders; `FIELD_TYPES` re-declared in the app and asserted equal to `@robot/scraper`'s in a test (the app must not bundle the scraper); the old Output screen's origin/candidate editor is not rebuilt; the project export is unauthenticated by UUID like the run export, until cut-over.
