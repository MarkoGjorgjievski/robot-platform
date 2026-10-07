import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs } from '@robot/db';
import { sourceInOrg, runInOrg, captureInOrg } from './scope.js';
import { signIn } from '../test-helpers/identity.js';

const tag = `scope-${Date.now()}`;
const MISSING = '00000000-0000-0000-0000-000000000000';

const dropIdentity = (r: { cleanup: () => Promise<void> }) => r.cleanup();

describe('sourceInOrg / runInOrg', () => {
  it('are UNAUTHORIZED without a session, even for an id that exists', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-n@example.com`);
      const p = await a.caller.projects.create({ name: 'Scoped' });
      const w = await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'Site', url: 'https://scope.example.com/' });
      const [run] = await db.insert(runs).values({ sourceId: w.sourceId, status: 'completed' }).returning({ id: runs.id });
      const anon = { db, session: null };
      await expect(sourceInOrg(anon, w.sourceId)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await expect(runInOrg(anon, run!.id)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await expect(captureInOrg(anon, MISSING)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    } finally {
      if (a) await dropIdentity(a);
    }
  });

  it('resolve inside the session org, and are NOT_FOUND outside it or for an id that does not exist', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    let b: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-a@example.com`);
      b = await signIn(`${tag}-b@example.com`);
      const p = await a.caller.projects.create({ name: 'Scoped' });
      const w = await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'Site', url: 'https://scope.example.com/' });
      const [run] = await db.insert(runs).values({ sourceId: w.sourceId, status: 'completed' }).returning({ id: runs.id });

      const ctxA = { db, session: a.session };
      const ctxB = { db, session: b.session };

      await expect(sourceInOrg(ctxA, w.sourceId)).resolves.toMatchObject({ id: w.sourceId, projectId: p.id, orgId: a.session.org.id });
      await expect(sourceInOrg(ctxB, w.sourceId)).rejects.toMatchObject({ code: 'NOT_FOUND' });

      await expect(runInOrg(ctxA, run!.id)).resolves.toMatchObject({ id: run!.id, sourceId: w.sourceId });
      await expect(runInOrg(ctxB, run!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });

      await expect(sourceInOrg(ctxA, MISSING)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(runInOrg(ctxA, MISSING)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      if (a) await dropIdentity(a);
      if (b) await dropIdentity(b);
    }
  });

  it('a legacy run with no source is NOT_FOUND, even in the org that owns everything else', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-c@example.com`);
      const [orphan] = await db.insert(runs).values({ sourceId: null, status: 'completed' }).returning({ id: runs.id });
      try {
        await expect(runInOrg({ db, session: a.session }, orphan!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      } finally {
        await db.delete(runs).where(eq(runs.id, orphan!.id));
      }
    } finally {
      if (a) await dropIdentity(a);
    }
  });
});
