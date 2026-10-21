import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, driftChecks, sources, sourceVerifications } from '@robot/db';
import type { DriftCheckResults, VerificationSet } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { enterAsStaff, signedInCaller } from '../test-helpers/identity.js';
import { seedAttention } from '../test-helpers/seed-attention.js';
import { currentVariantHash } from '../verify/variant-check.js';

const me = await signedInCaller('sources-attention');
const staffUser = await signedInCaller('sources-attention-staff');
afterAll(async () => { await me.cleanup(); await staffUser.cleanup(); });

async function website(tag: string) {
  const f = await createProjectWithSource(me.caller, { tag, fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }] });
  await me.caller.sources.updateBinding({
    sourceId: f.sourceId, urls: f.urls, descriptions: { price: 'x', title: 'x' },
    expected: { price: Object.fromEntries(f.urls.map((u, i) => [u, `${i + 1}.00`])), title: Object.fromEntries(f.urls.map((u, i) => [u, `T${i}`])) },
  });
  return f;
}

describe('what the app reads about a website that changed (spec 2026-10-21 §5)', () => {
  it('attention, refreshes, held fields and runnable, through the routers', async () => {
    const f = await website('srcattn');
    try {
      const { heldSince } = await seedAttention(f.sourceId, { heldKey: 'title', refreshedKey: 'price' });
      const a = await me.caller.sources.attention({ sourceId: f.sourceId });
      expect(a.fields).toEqual(['title']);
      expect(a.runnable).toBe(true);
      expect(a.refreshes.map((r) => r.key)).toEqual(['price']);
      const status = await me.caller.sources.verificationStatus({ sourceId: f.sourceId });
      expect(status!.heldKeys).toEqual(['title']);
      expect(status!.held.title!.verifiedAt.toISOString()).toBe(heldSince.toISOString());
      expect(status!.runnable).toBe(true);
      const site = await me.caller.sources.get({ projectSlug: f.projectSlug, sourceSlug: f.sourceSlug });
      expect(site.needsAttention).toBe(true);
      const project = await me.caller.projects.get({ projectSlug: f.projectSlug });
      expect(project.websites[0]!.needsAttention).toBe(true);
    } finally { await f.cleanup(); }
  });

  it('a customer never receives a refresh reason or a path in a refresh; staff inside the org do', async () => {
    const f = await website('srcattn-staff');
    const savedOps = process.env.OPS_EMAILS;
    try {
      await seedAttention(f.sourceId, { heldKey: 'title', refreshedKey: 'price' });
      // The newest check also refused to refresh Title, with a staff-only reason.
      const check = (await db.query.driftChecks.findFirst({ where: eq(driftChecks.sourceId, f.sourceId) }))!;
      const results = check.results as DriftCheckResults;
      results.fields.title!.refresh = { applied: false, reason: 'not-shown' };
      await db.update(driftChecks).set({ results }).where(eq(driftChecks.id, check.id));

      const a = await me.caller.sources.attention({ sourceId: f.sourceId });
      expect(a.findings.title!.refresh).toEqual({ applied: false });
      expect(Object.values(a.refreshes[0]!.pages)).toEqual([{ was: '1.00', now: '1.10' }]);
      const drift = await me.caller.sources.driftCheck({ sourceId: f.sourceId });
      expect(drift!.results!.fields.title!.refresh).toEqual({ applied: false });

      // A staff session exists only for an operator (OPS_EMAILS) inside the customer's org.
      process.env.OPS_EMAILS = staffUser.user.email;
      const staff = await enterAsStaff(staffUser, me.org.id);
      const s = await staff.caller.sources.attention({ sourceId: f.sourceId });
      expect(s.findings.title!.refresh).toEqual({ applied: false, reason: 'not-shown' });
      expect(Object.values(s.refreshes[0]!.pages)[0]).toMatchObject({ path: { source: 'json-ld', path: 'name' } });
      expect((await staff.caller.sources.driftCheck({ sourceId: f.sourceId }))!.results!.fields.title!.refresh).toEqual({ applied: false, reason: 'not-shown' });
    } finally {
      if (savedOps === undefined) delete process.env.OPS_EMAILS; else process.env.OPS_EMAILS = savedOps;
      await f.cleanup();
    }
  });

  it('a website with nothing to say: no attention, and not runnable before any Verify', async () => {
    const f = await website('srcattn-none');
    try {
      const a = await me.caller.sources.attention({ sourceId: f.sourceId });
      expect(a).toEqual({ fields: [], heldSince: null, goneProducts: [], findings: {}, refreshes: [], runnable: false });
      expect((await me.caller.sources.get({ projectSlug: f.projectSlug, sourceSlug: f.sourceSlug })).needsAttention).toBe(false);
    } finally { await f.cleanup(); }
  });
});

describe('seedAttention on a website with variants (final review I3)', () => {
  async function withVariants(tag: string) {
    const f = await website(tag);
    const src = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId), columns: { datasetId: true } });
    await me.caller.datasets.setVariantMode({ datasetId: src!.datasetId!, mode: 'row_per_variant' });
    const setup = await me.caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'list', axes: [{ from: 'color', newAxisName: 'Colour' }] });
    const colour = setup.axes[0]!.axisKey;
    const list = { source: 'json-ld' as const, path: 'hasVariant' };
    await me.caller.sources.saveVariantAnswer({ sourceId: f.sourceId, url: f.urls[0]!, answer: { count: 2, labels: ['Black', 'Red'], list, links: [f.urls[0]!, `${f.urls[0]!}-red`], spot: { index: 0, expected: { price: '1.00', [colour]: 'Black' } } } });
    for (const u of f.urls.slice(1)) await me.caller.sources.saveVariantAnswer({ sourceId: f.sourceId, url: u, answer: { count: 0, labels: [] } });
    return f;
  }

  it('with no earlier run, the seeded runs pass variants for the setup as it stands: held, and still runnable', async () => {
    const f = await withVariants('srcattn-variants');
    try {
      await seedAttention(f.sourceId, { heldKey: 'title', refreshedKey: 'price' });
      const status = await me.caller.sources.verificationStatus({ sourceId: f.sourceId });
      expect(status!.heldKeys).toEqual(['title']);
      expect(status!.runnable).toBe(true);
    } finally { await f.cleanup(); }
  });

  const oldRun = (sourceId: string, variantResults: unknown) => db.insert(sourceVerifications).values({
    sourceId, definitionHash: 'x', startedAt: new Date(Date.now() - 5 * 86_400_000), completedAt: new Date(Date.now() - 5 * 86_400_000), allPassed: true, results: {}, variantResults,
  }).returning({ id: sourceVerifications.id });

  it('an earlier clean run\'s current, passing variant result is carried into both seeded runs', async () => {
    const f = await withVariants('srcattn-variants-prev');
    try {
      const fresh = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId), with: { dataset: { columns: { schema: true } } } }))!;
      const hash = currentVariantHash({ set: fresh.verificationSet as VerificationSet, setup: fresh.variantSetup as never, datasetSchema: fresh.dataset?.schema });
      const prev = { method: 'list', hash, passed: true, pages: { [f.urls[0]!]: { passed: true } } };
      const [old] = await oldRun(f.sourceId, prev);
      await seedAttention(f.sourceId, { heldKey: 'title', refreshedKey: 'price' });
      const rows = await db.query.sourceVerifications.findMany({ where: eq(sourceVerifications.sourceId, f.sourceId) });
      expect(rows.filter((r) => r.id !== old!.id)).toHaveLength(2);
      for (const r of rows) expect(r.variantResults).toEqual(prev);
      expect((await me.caller.sources.verificationStatus({ sourceId: f.sourceId }))!.runnable).toBe(true);
    } finally { await f.cleanup(); }
  });

  it('an earlier result for another setup, or a failed one, is not carried: the seeded runs pass the setup as it stands', async () => {
    const f = await withVariants('srcattn-variants-stale');
    try {
      const [old] = await oldRun(f.sourceId, { method: 'list', hash: 'an-old-setup', passed: false, problem: 'x', pages: {} });
      await seedAttention(f.sourceId, { heldKey: 'title', refreshedKey: 'price' });
      const rows = await db.query.sourceVerifications.findMany({ where: eq(sourceVerifications.sourceId, f.sourceId) });
      for (const r of rows.filter((x) => x.id !== old!.id)) expect(r.variantResults).toMatchObject({ method: 'list', passed: true });
      expect((await me.caller.sources.verificationStatus({ sourceId: f.sourceId }))!.runnable).toBe(true);
    } finally { await f.cleanup(); }
  });
});
