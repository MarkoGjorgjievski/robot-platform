import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, sources, inputSets, datasets } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const caller = createCallerFactory(appRouter)({ db });
const projectIds: string[] = [];

afterEach(async () => {
  for (const id of projectIds.splice(0)) {
    // input sets belong to the project and do not cascade from sources
    await db.delete(inputSets).where(eq(inputSets.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
});

async function freshProject(name = 'Proj') {
  const p = await caller.projects.create({ name });
  projectIds.push(p.id);
  return p;
}

describe('sources.createInProject', () => {
  it('creates a website in the project dataset with the given name and a slug from it', async () => {
    const p = await freshProject();
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'AbeBooks', url: 'https://www.abebooks.com/' });
    expect(r.projectSlug).toBe(p.slug);
    expect(r.sourceSlug).toBe('abebooks');
    const s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId) });
    expect(s?.datasetId).toBe(p.datasetId);
    expect(s?.name).toBe('AbeBooks');
    expect(s?.urlTemplate).toBe('https://www.abebooks.com/');
    expect(s?.schemaDefinition).toBeNull();
    expect(s?.inputSetId).toBeNull();
  });
  it('numbers a second website with the same name', async () => {
    const p = await freshProject();
    await caller.sources.createInProject({ projectSlug: p.slug, name: 'Same', url: 'https://a.example/' });
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Same', url: 'https://b.example/' });
    expect(r.sourceSlug).toBe('same-2');
  });
  it('rejects a non-http url', async () => {
    const p = await freshProject();
    await expect(caller.sources.createInProject({ projectSlug: p.slug, name: 'x', url: 'file:///etc/passwd' })).rejects.toThrow();
  });
  it('404s an unknown project', async () => {
    await expect(caller.sources.createInProject({ projectSlug: 'nope-nope', name: 'x', url: 'https://a.example/' })).rejects.toThrow(/not found/i);
  });
});

describe('sources.rename', () => {
  it('changes the name only', async () => {
    const p = await freshProject();
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Old', url: 'https://a.example/' });
    const out = await caller.sources.rename({ sourceId: r.sourceId, name: 'New' });
    expect(out.name).toBe('New');
    const s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId) });
    expect(s?.slug).toBe('old');
  });
});

describe('sources.updateSchema keeps the input set in step', () => {
  const host = 'shop.example';
  const urls = [`https://${host}/p/1`, `https://${host}/p/2`, `https://${host}/p/3`];
  const fields = [{ name: 'price', type: 'money' as const, description: 'the price' }];
  const expected = { price: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' } };

  it('creates a detail input set from the three product urls when there is no listing url', async () => {
    const p = await freshProject();
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: `https://${host}/` });
    await caller.sources.updateSchema({ sourceId: r.sourceId, urls, fields, expected });
    const s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId), with: { inputSet: true } });
    expect(s?.listingMode).toBe('detail');
    expect(s?.inputSet?.rows).toEqual(urls.map((url) => ({ url })));
  });
  it('switches to one listing row and listing mode when a listing url is given, and back', async () => {
    const p = await freshProject();
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: `https://${host}/` });
    await caller.sources.updateSchema({ sourceId: r.sourceId, urls, fields, expected, listingUrl: `https://${host}/all` });
    let s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId), with: { inputSet: true } });
    expect(s?.listingMode).toBe('listing_to_detail');
    expect(s?.inputSet?.rows).toEqual([{ url: `https://${host}/all` }]);
    const firstInputSetId = s?.inputSetId;

    await caller.sources.updateSchema({ sourceId: r.sourceId, urls, fields, expected });
    s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId), with: { inputSet: true } });
    expect(s?.listingMode).toBe('detail');
    expect(s?.inputSetId).toBe(firstInputSetId); // updated in place, not recreated
    expect(s?.inputSet?.rows).toEqual(urls.map((url) => ({ url })));
  });
});
