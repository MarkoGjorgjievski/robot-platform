import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, driftChecks } from '@robot/db';
import type { DriftCheckResults } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { enterAsStaff, signedInCaller } from '../test-helpers/identity.js';
import { seedAttention } from '../test-helpers/seed-attention.js';

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
