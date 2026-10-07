import { describe, it, expect } from 'vitest';
import { db } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { signIn } from '../test-helpers/identity.js';

const tag = `dsorg-${Date.now()}`;

const dropIdentity = (r: { cleanup: () => Promise<void> }) => r.cleanup();

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
      await expect(b.caller.datasets.variants({ datasetId: p.datasetId })).rejects.toMatchObject(nf);
      await expect(b.caller.datasets.fieldStatus({ datasetId: p.datasetId })).rejects.toMatchObject(nf);
      await expect(b.caller.datasets.addField({ datasetId: p.datasetId, name: 'Title', type: 'text' })).rejects.toMatchObject(nf);
      await expect(b.caller.datasets.renameField({ datasetId: p.datasetId, key: f.key, name: 'Cost' })).rejects.toMatchObject(nf);
      await expect(b.caller.datasets.retypeField({ datasetId: p.datasetId, key: f.key, type: 'text' })).rejects.toMatchObject(nf);
      await expect(b.caller.datasets.deleteField({ datasetId: p.datasetId, key: f.key })).rejects.toMatchObject(nf);

      expect((await a.caller.datasets.variants({ datasetId: p.datasetId })).fields.map((x) => x.name)).toEqual(['Price']);
      await a.caller.datasets.renameField({ datasetId: p.datasetId, key: f.key, name: 'Cost' });
      expect((await a.caller.datasets.variants({ datasetId: p.datasetId })).fields.map((x) => x.name)).toEqual(['Cost']);
    } finally {
      if (a) await dropIdentity(a);
      if (b) await dropIdentity(b);
    }
  });

  it('a session-less caller is UNAUTHORIZED, even with a real dataset id', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-n@example.com`);
      const p = await a.caller.projects.create({ name: 'Mine' });
      const f = await a.caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
      const bare = createCallerFactory(appRouter)({ db, session: null });
      const unauth = { code: 'UNAUTHORIZED' };
      await expect(bare.datasets.variants({ datasetId: p.datasetId })).rejects.toMatchObject(unauth);
      await expect(bare.datasets.addField({ datasetId: p.datasetId, name: 'Title', type: 'text' })).rejects.toMatchObject(unauth);
      await expect(bare.datasets.deleteField({ datasetId: p.datasetId, key: f.key })).rejects.toMatchObject(unauth);
      expect((await a.caller.datasets.variants({ datasetId: p.datasetId })).fields.map((x) => x.name)).toEqual(['Price']);
    } finally {
      if (a) await dropIdentity(a);
    }
  });
});
