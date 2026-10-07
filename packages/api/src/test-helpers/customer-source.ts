// packages/api/src/test-helpers/customer-source.ts
// The one way tests build a project + website with a contract and, optionally,
// a binding. Replaces the wizard-era `createWithSchema`/`quickCreate` setup.
import { eq } from 'drizzle-orm';
import { db, projects, inputSets } from '@robot/db';
import type { CustomerFieldType } from '@robot/scraper';

// The real appRouter caller's own type (`ReturnType<ReturnType<typeof
// createCallerFactory<typeof appRouter>>>`) is a deep tRPC-internal type that
// `tsc` refuses to write into this package's declaration output ("cannot be
// named without a reference to .../unstable-core-do-not-import-*.mjs" —
// TS2742, since `declaration: true` is on repo-wide). This narrow, hand-written
// structural type only names the handful of procedures this helper actually
// calls; every real caller (`createCallerFactory(appRouter)({ db, session: null })`) is
// structurally assignable to it.
type Caller = {
  projects: {
    create(input: { name: string; orgSlug?: string }): Promise<{ id: string; slug: string; name: string; datasetId: string }>;
  };
  datasets: {
    addField(input: { datasetId: string; name: string; type: CustomerFieldType }): Promise<{ key: string }>;
  };
  sources: {
    createInProject(input: { projectSlug: string; name: string; url: string }): Promise<{ sourceId: string; projectSlug: string; sourceSlug: string }>;
    updateBinding(input: {
      sourceId: string;
      urls: string[];
      listingUrl?: string;
      descriptions: Record<string, string>;
      expected: Record<string, Record<string, string>>;
      marks?: Record<string, Record<string, { xpaths: string[]; text: string; rect: { x: number; y: number; w: number; h: number } }>>;
    }): Promise<unknown>;
  };
};

export async function createProjectWithSource(caller: Caller, opts: {
  tag: string;
  fields: Array<{ name: string; type: CustomerFieldType; description?: string }>;
  urls?: string[];
  listingUrl?: string;
  expected?: Record<string, Record<string, string>>;
  marks?: Record<string, Record<string, { xpaths: string[]; text: string; rect: { x: number; y: number; w: number; h: number } }>>;
}) {
  const host = `test-${opts.tag}.example.com`;
  const urls = opts.urls ?? [`https://${host}/p/1`, `https://${host}/p/2`, `https://${host}/p/3`];
  // `orgSlug: 'default'` is explicit, not the removed implicit shim (cut-over
  // Task 5): a session-bearing caller (e.g. ops.test.ts's signed-in users)
  // ignores it entirely — the session always wins in `resolveOrg` — so this
  // only matters for the many session-less callers across this suite, which
  // keep landing in the seeded `default` org exactly as before.
  const p = await caller.projects.create({ name: `Test ${opts.tag}`, orgSlug: 'default' });
  const keys: Record<string, string> = {};
  for (const f of opts.fields) {
    const r = await caller.datasets.addField({ datasetId: p.datasetId, name: f.name, type: f.type });
    keys[f.name] = r.key;
  }
  const s = await caller.sources.createInProject({ projectSlug: p.slug, name: `Site ${opts.tag}`, url: urls[0]! });
  if (opts.expected) {
    await caller.sources.updateBinding({
      sourceId: s.sourceId,
      urls,
      ...(opts.listingUrl ? { listingUrl: opts.listingUrl } : {}),
      descriptions: Object.fromEntries(opts.fields.map((f) => [keys[f.name]!, f.description ?? `where ${f.name} is`])),
      expected: Object.fromEntries(Object.entries(opts.expected).map(([name, cells]) => [keys[name] ?? name, cells])),
      ...(opts.marks ? { marks: Object.fromEntries(Object.entries(opts.marks).map(([name, cells]) => [keys[name] ?? name, cells])) } : {}),
    });
  }
  return {
    projectId: p.id, datasetId: p.datasetId, projectSlug: p.slug, sourceId: s.sourceId, sourceSlug: s.sourceSlug, urls, keys,
    cleanup: async () => {
      await db.delete(inputSets).where(eq(inputSets.projectId, p.id));
      await db.delete(projects).where(eq(projects.id, p.id));
    },
  };
}
