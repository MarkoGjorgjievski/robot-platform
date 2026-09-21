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
