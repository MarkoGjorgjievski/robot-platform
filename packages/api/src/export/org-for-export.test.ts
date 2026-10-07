import { describe, it, expect } from 'vitest';
import { db, runs } from '@robot/db';
import { orgIdForRun, orgIdForProject } from './org-for-export.js';
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
