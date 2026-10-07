import { describe, it, expect } from 'vitest';
import { db, runs, captures } from '@robot/db';
import { orgIdForRun, orgIdForProject, orgIdForCaptureFile } from './org-for-export.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';

const MISSING = '00000000-0000-0000-0000-000000000000';

describe('orgIdForRun / orgIdForProject', () => {
  it('returns null for a run/project id that does not exist', async () => {
    expect(await orgIdForRun(db, MISSING)).toBeNull();
    expect(await orgIdForProject(db, MISSING)).toBeNull();
  });

  it("resolves the owning org through the website's dataset/project chain", async () => {
    const me = await signedInCaller('org-for-export');
    const site = await createProjectWithSource(me.caller, { tag: 'org-for-export', fields: [{ name: 'Title', type: 'text' }] });
    const [run] = await db.insert(runs).values({ sourceId: site.sourceId, status: 'completed' }).returning();
    try {
      expect(await orgIdForProject(db, site.projectId)).toBe(me.org.id);
      expect(await orgIdForRun(db, run!.id)).toBe(me.org.id);
    } finally {
      await site.cleanup();
      await me.cleanup();
    }
  });
});

describe('orgIdForCaptureFile', () => {
  it('returns null for a filename no capture row references', async () => {
    expect(await orgIdForCaptureFile(db, 'nonexistent.png')).toBeNull();
  });

  it("resolves a verification screenshot's org via screenshot_path", async () => {
    const me = await signedInCaller('org-for-capture-full');
    const site = await createProjectWithSource(me.caller, { tag: 'org-for-capture-full', fields: [{ name: 'Title', type: 'text' }] });
    // `captures.source_id` cascades from the project, so `site.cleanup()` alone clears this row too.
    await db.insert(captures).values({
      sourceId: site.sourceId,
      url: site.urls[0]!,
      screenshotPath: '/captures/full-shot.png',
      metadata: { kind: 'verification' },
    });
    try {
      expect(await orgIdForCaptureFile(db, 'full-shot.png')).toBe(me.org.id);
    } finally {
      await site.cleanup();
      await me.cleanup();
    }
  });

  it("resolves a proof-page tile's org via metadata.tiles, including a tile past the first", async () => {
    const me = await signedInCaller('org-for-capture-tile');
    const site = await createProjectWithSource(me.caller, { tag: 'org-for-capture-tile', fields: [{ name: 'Title', type: 'text' }] });
    const now = new Date().toISOString();
    await db.insert(captures).values({
      sourceId: site.sourceId,
      url: site.urls[0]!,
      screenshotPath: '/captures/tile-0.png',
      metadata: {
        kind: 'proof-page', status: 'captured', url: site.urls[0]!, startedAt: now, capturedAt: now,
        tiles: ['/captures/tile-0.png', '/captures/tile-1.png'], boxes: [], pageHeight: 900, capturedHeight: 900, contentHeight: 900,
      },
    });
    try {
      expect(await orgIdForCaptureFile(db, 'tile-0.png')).toBe(me.org.id);
      expect(await orgIdForCaptureFile(db, 'tile-1.png')).toBe(me.org.id);
    } finally {
      await site.cleanup();
      await me.cleanup();
    }
  });

  it('keeps two orgs’ capture files distinct', async () => {
    const a = await signedInCaller('org-for-capture-a');
    const b = await signedInCaller('org-for-capture-b');
    const siteA = await createProjectWithSource(a.caller, { tag: 'org-for-capture-a', fields: [{ name: 'Title', type: 'text' }] });
    const siteB = await createProjectWithSource(b.caller, { tag: 'org-for-capture-b', fields: [{ name: 'Title', type: 'text' }] });
    await db.insert(captures).values({ sourceId: siteA.sourceId, url: siteA.urls[0]!, screenshotPath: '/captures/a-shot.png', metadata: { kind: 'verification' } });
    await db.insert(captures).values({ sourceId: siteB.sourceId, url: siteB.urls[0]!, screenshotPath: '/captures/b-shot.png', metadata: { kind: 'verification' } });
    try {
      expect(await orgIdForCaptureFile(db, 'a-shot.png')).toBe(a.org.id);
      expect(await orgIdForCaptureFile(db, 'b-shot.png')).toBe(b.org.id);
    } finally {
      await siteA.cleanup();
      await siteB.cleanup();
      await a.cleanup();
      await b.cleanup();
    }
  });
});
