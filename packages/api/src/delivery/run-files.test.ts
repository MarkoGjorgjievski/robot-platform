// The two reads the api-server's snapshot route needs (spec 2026-10-24 §3.3).
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll, vi } from 'vitest';
import { db, runs } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { loadRunFile, webhookSecretForRun, writeRunFiles } from './run-files.js';

const me = await signedInCaller('run-files');
afterAll(async () => { await me.cleanup(); });

describe('run files', () => {
  it('webhookSecretForRun: the run’s website’s secret; null without one or without a run', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'run-files', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const [run] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'completed' }).returning({ id: runs.id });
      expect(await webhookSecretForRun(db, run!.id)).toBeNull();
      vi.stubEnv('WEBHOOK_ALLOW_PRIVATE', 'on');
      try { await me.caller.sources.update({ id: f.sourceId, webhookUrl: 'http://127.0.0.1:9/hook' }); } finally { vi.unstubAllEnvs(); }
      expect(await webhookSecretForRun(db, run!.id)).toMatch(/^[0-9a-f]{64}$/);
      expect(await webhookSecretForRun(db, randomUUID())).toBeNull();
    } finally { await f.cleanup(); }
  });
  it('loadRunFile: null before the files are written, the bytes after', async () => {
    const f = await createProjectWithSource(me.caller, { tag: 'run-files-load', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const [run] = await db.insert(runs).values({ sourceId: f.sourceId, status: 'completed' }).returning({ id: runs.id });
      expect(await loadRunFile(db, run!.id, 'csv')).toBeNull();
      await writeRunFiles(db, run!.id);
      const csv = await loadRunFile(db, run!.id, 'csv');
      expect(csv!.bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      expect(csv!.filename).toMatch(/\.csv$/);
    } finally { await f.cleanup(); }
  });
});
