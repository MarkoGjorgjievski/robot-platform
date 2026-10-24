// `projects.list` read every organisation's websites and runs (spec 2026-10-24 tenant isolation §3): its answer was
// filtered by project, so nothing leaked, but each call certified every website in the database. It reads the
// caller's org only.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTwoOrgs, type TwoOrgs } from './two-orgs.js';

const { seen } = vi.hoisted(() => ({ seen: new Set<string>() }));
vi.mock('../verify/current-certification.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../verify/current-certification.js')>();
  return {
    ...real,
    loadCurrentCertification: async (...args: Parameters<typeof real.loadCurrentCertification>) => {
      seen.add(args[1]);
      return real.loadCurrentCertification(...args);
    },
  };
});

process.env.CAPTURES_DIR = join(tmpdir(), 'robot-isolation-captures');
let t: TwoOrgs;
beforeAll(async () => { t = await buildTwoOrgs({ tag: 'iso-list' }); }, 120_000);
afterAll(async () => { await t?.cleanup(); });

describe('projects.list (spec 2026-10-24 tenant isolation §3)', () => {
  it("certifies the caller's websites only, and gives the caller's own last run", async () => {
    seen.clear();
    const list = await t.a.owner.caller.projects.list();
    expect([...seen]).toEqual([t.a.sourceId]);
    expect(list.map((p) => p.id)).toEqual([t.a.projectId]);
    expect(list[0]).toMatchObject({ sourceCount: 1, verifiedSourceCount: 1, lastRun: { status: 'completed' } });
  });
});
