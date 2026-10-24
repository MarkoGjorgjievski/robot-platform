// The two-organisation fixture is itself proven (spec 2026-10-24 tenant isolation §2.1): each org holds one of
// everything, its own; no needle of one org appears in the other's rows (the deep scans rely on it); a snapshot is
// stable while nothing changes; and cleanup leaves no row and no file behind.
import { describe, expect, it } from 'vitest';
import { rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, like } from 'drizzle-orm';
import { db, emailMessages, jevReadings, orgs, projects, runFiles, sources, users } from '@robot/db';
import { captureInOrg, runInOrg, sourceInOrg } from '../auth/scope.js';
import { buildTwoOrgs, needlesOf, queuedJobCount, snapshotOrg } from './two-orgs.js';

const dir = join(tmpdir(), 'robot-isolation-captures');

describe('two throwaway organisations (spec 2026-10-24 tenant isolation §2.1)', () => {
  it('each holds one of everything, its own; cleanup leaves nothing', async () => {
    const jobsBefore = await queuedJobCount();
    const t = await buildTwoOrgs({ tag: 'iso-fixture', capturesDir: dir });
    process.env.CAPTURES_DIR = dir;
    try {
      for (const f of [t.a, t.b]) {
        const ctx = { db, session: f.owner.session };
        expect((await sourceInOrg(ctx, f.sourceId)).orgId).toBe(f.org.id);
        await runInOrg(ctx, f.runId);
        await captureInOrg(ctx, f.captureId);
        const c = f.owner.caller;
        expect((await c.runs.getWithDetails({ id: f.runId }))!.run.status).toBe('completed');
        expect((await c.crawl.items({ runId: f.runId })).items.map((i) => i.id).sort()).toEqual([...f.itemIds].sort());
        expect(await c.sources.proofPageCapture({ captureId: f.captureId })).toMatchObject({ status: 'captured', tiles: [`/captures/${f.tileFile}`] });
        expect((await c.sources.suggestMarks({ captureId: f.captureId })).captureId).toBe(f.captureId);
        expect((await c.sources.verificationStatus({ sourceId: f.sourceId }))!.id).toBe(f.verificationId);
        expect((await c.sources.driftCheck({ sourceId: f.sourceId }))!.id).toBe(f.driftCheckId);
        expect((await c.sources.coverage({ sourceId: f.sourceId }))!.id).toBe(f.coverageCheckId);
        expect((await c.orgs.members.list()).map((m) => m.userId).sort()).toEqual([f.owner.user.id, f.member.id].sort());
        expect((await c.orgs.staffActivity({ page: 0 })).entries.map((e) => e.id)).toEqual([f.staffActionId]);
        expect((await c.datasets.variants({ datasetId: f.datasetId })).axes.map((a) => a.key)).toEqual([f.axisKey]);
        const site = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId), columns: { webhookSecret: true, variantSetup: true } }))!;
        expect(site.webhookSecret).toBe(f.webhookSecret);
        expect(site.variantSetup).toMatchObject({ method: 'none', axes: [] });
        expect((await db.select().from(runFiles).where(eq(runFiles.runId, f.runId))).map((r) => r.format).sort()).toEqual(['csv', 'json', 'xlsx']);
        expect((await db.query.emailMessages.findFirst({ where: eq(emailMessages.id, f.emailMessageId) }))!.orgId).toBe(f.org.id);
        expect((await db.query.jevReadings.findFirst({ where: eq(jevReadings.id, f.jevReadingId) }))!.sourceId).toBe(f.sourceId);
        await stat(join(dir, f.tileFile));
        await stat(join(dir, `${f.captureId}.capture.json`));
      }
      // The deep scans look for one org's needles in the other's answers: none may already sit in the other's rows.
      const aRows = await snapshotOrg(t.a);
      const bRows = await snapshotOrg(t.b);
      for (const n of needlesOf(t.b)) expect(aRows.includes(n), `B's ${n} is in A's rows`).toBe(false);
      for (const n of needlesOf(t.a)) expect(bRows.includes(n), `A's ${n} is in B's rows`).toBe(false);
      for (const n of needlesOf(t.b)) expect(bRows.includes(n), `B's ${n} is not in B's own rows`).toBe(true);
      expect(await snapshotOrg(t.b)).toBe(bRows);
      // Built without queueing any work.
      expect(await queuedJobCount()).toBe(jobsBefore);
    } finally {
      await t.cleanup();
    }
    for (const f of [t.a, t.b]) {
      expect(await db.query.orgs.findFirst({ where: eq(orgs.id, f.org.id) })).toBeUndefined();
      expect(await db.query.users.findFirst({ where: eq(users.id, f.owner.user.id) })).toBeUndefined();
      expect(await db.query.users.findFirst({ where: eq(users.id, f.member.id) })).toBeUndefined();
      await expect(stat(join(dir, f.tileFile))).rejects.toThrow();
      await expect(stat(join(dir, `${f.captureId}.capture.json`))).rejects.toThrow();
    }
  }, 120_000);
});

describe('a build that fails halfway', () => {
  it('leaves no row and no file behind', async () => {
    // The captures directory sits under a file, so the build fails after A's org, project, run and capture rows exist.
    const blocker = join(tmpdir(), `robot-isolation-blocker-${Date.now()}`);
    await writeFile(blocker, 'not a directory');
    const tag = `iso-broken-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await expect(buildTwoOrgs({ tag, capturesDir: join(blocker, 'captures') })).rejects.toThrow();
      expect(await db.select({ id: users.id }).from(users).where(like(users.email, `${tag}-%`))).toEqual([]);
      expect(await db.select({ id: projects.id }).from(projects).where(like(projects.name, `Test ${tag}-%`))).toEqual([]);
    } finally {
      await rm(blocker, { force: true });
    }
  }, 60_000);
});
