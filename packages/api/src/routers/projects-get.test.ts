import { describe, it, expect } from 'vitest';
import { db, runs } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { signIn } from '../test-helpers/identity.js';

const tag = `get-${Date.now()}`;

const dropIdentity = (r: { cleanup: () => Promise<void> }) => r.cleanup();

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
      // No drift check has ever run on it (plan 2026-10-05 Task 3).
      expect(zed.driftedFields).toBeNull();
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
      await expect(b.caller.sources.createInProject({ projectSlug: p.slug, name: 'X', url: 'https://x.example.com/' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      if (a) await dropIdentity(a);
      if (b) await dropIdentity(b);
    }
  });

  it('a session-less caller is UNAUTHORIZED, never a project of any org', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-n@example.com`);
      const p = await a.caller.projects.create({ name: 'Private' });
      const bare = createCallerFactory(appRouter)({ db, session: null });
      await expect(bare.projects.get({ projectSlug: p.slug })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await expect(bare.projects.output({ projectSlug: p.slug })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    } finally {
      if (a) await dropIdentity(a);
    }
  });
});
