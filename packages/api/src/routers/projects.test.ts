import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, datasets } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const caller = createCallerFactory(appRouter)({ db });
const created: string[] = [];

afterEach(async () => {
  for (const id of created.splice(0)) await db.delete(projects).where(eq(projects.id, id)); // datasets cascade
});

describe('projects.create', () => {
  it('creates the project under the default org with one dataset named after it', async () => {
    const p = await caller.projects.create({ name: 'AbeBooks Q3', description: 'books' });
    created.push(p.id);
    expect(p.slug).toBe('abebooks-q3');
    const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, p.datasetId) });
    expect(ds?.name).toBe('AbeBooks Q3');
    expect(ds?.projectId).toBe(p.id);
    expect(ds?.schema).toEqual([]);
  });
  it('gives a second project with the same name a numbered slug', async () => {
    const a = await caller.projects.create({ name: 'Twice' });
    const b = await caller.projects.create({ name: 'Twice' });
    created.push(a.id, b.id);
    expect(b.slug).toBe('twice-2');
  });
  it('rejects an empty name', async () => {
    await expect(caller.projects.create({ name: '   ' })).rejects.toThrow();
  });
});

describe('projects.rename', () => {
  it('changes the name and keeps the slug', async () => {
    const p = await caller.projects.create({ name: 'Before' });
    created.push(p.id);
    const r = await caller.projects.rename({ projectId: p.id, name: 'After' });
    expect(r.name).toBe('After');
    const row = await db.query.projects.findFirst({ where: eq(projects.id, p.id) });
    expect(row?.slug).toBe('before');
  });
});

describe('projects.list stats', () => {
  it('counts websites, verified websites, fields, and reports the last run', async () => {
    const p = await caller.projects.create({ name: 'Stats' });
    created.push(p.id);
    await caller.sources.createInProject({ projectSlug: p.slug, name: 'A', url: 'https://a.example/' });
    await caller.sources.createInProject({ projectSlug: p.slug, name: 'B', url: 'https://b.example/' });
    await db.update(datasets).set({ schema: [{ key: 'price', name: 'price', type: 'money' }, { key: 'title', name: 'title', type: 'text' }] }).where(eq(datasets.id, p.datasetId));

    const row = (await caller.projects.list()).find((r) => r.id === p.id)!;
    expect(row.sourceCount).toBe(2);
    expect(row.verifiedSourceCount).toBe(0);
    expect(row.fieldCount).toBe(2);
    expect(row.lastRun).toBeNull();
  });
});
