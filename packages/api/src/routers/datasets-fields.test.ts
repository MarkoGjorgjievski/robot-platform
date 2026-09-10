import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, projects, datasets, sources, inputSets, sourceVerifications } from '@robot/db';
import { fieldHash, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const caller = createCallerFactory(appRouter)({ db });
const projectIds: string[] = [];
afterEach(async () => {
  for (const id of projectIds.splice(0)) {
    await db.delete(inputSets).where(eq(inputSets.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
});

async function project(name = 'Fields') {
  const p = await caller.projects.create({ name });
  projectIds.push(p.id);
  return p;
}

describe('datasets.addField', () => {
  it('mints a key and concept, appends to the contract, and gives every website the field with an empty description and empty cells', async () => {
    const p = await project();
    const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'A', url: 'https://a.example/' });
    const r = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
    expect(r).toMatchObject({ key: 'price', name: 'Price', type: 'money', concept: 'price' });
    expect(r.affectedSourceIds).toEqual([a.sourceId]);
    const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, p.datasetId) });
    expect(ds?.schema).toEqual([{ key: 'price', name: 'Price', type: 'money', concept: 'price' }]);
    const s = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
    expect(s?.schemaDefinition).toEqual([{ key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' }]);
  });
  it('rejects a duplicate name, case-insensitively, and the reserved detail_url name', async () => {
    const p = await project();
    await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
    await expect(caller.datasets.addField({ datasetId: p.datasetId, name: 'price', type: 'text' })).rejects.toThrow(/already/i);
    await expect(caller.datasets.addField({ datasetId: p.datasetId, name: 'detail_url', type: 'url' })).rejects.toThrow(/reserved/i);
  });
  it('keeps legacy unkeyed entries in the dataset schema', async () => {
    const p = await project();
    await db.update(datasets).set({ schema: [{ name: 'legacy', type: 'text', origin: 'listing' }] }).where(eq(datasets.id, p.datasetId));
    await caller.datasets.addField({ datasetId: p.datasetId, name: 'Title', type: 'text' });
    const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, p.datasetId) });
    expect((ds?.schema as unknown[]).length).toBe(2);
    expect((ds?.schema as Array<{ name: string }>)[0]!.name).toBe('legacy');
  });
});

describe('datasets.renameField / retypeField / deleteField', () => {
  async function seeded() {
    const p = await project();
    const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'A', url: 'https://a.example/' });
    const f = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
    return { p, a, f };
  }
  it('rename copies to every website and never touches the key', async () => {
    const { p, a, f } = await seeded();
    await caller.datasets.renameField({ datasetId: p.datasetId, key: f.key, name: 'Cost' });
    const s = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
    expect((s?.schemaDefinition as SchemaDefinitionField[])[0]).toMatchObject({ key: 'price', name: 'Cost' });
  });
  it('retype is refused while a website has a current certification for the field', async () => {
    const { p, a, f } = await seeded();
    const urls = ['https://a.example/p/1', 'https://a.example/p/2', 'https://a.example/p/3'];
    await caller.sources.updateBinding({ sourceId: a.sourceId, urls, descriptions: { price: 'green' }, expected: { price: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' } } });
    const s = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
    const field = (s!.schemaDefinition as SchemaDefinitionField[])[0]!;
    const set = s!.verificationSet as VerificationSet;
    await db.insert(sourceVerifications).values({
      sourceId: a.sourceId, definitionHash: 'x', allPassed: true, completedAt: new Date(),
      results: { price: { key: 'price', fieldHash: fieldHash(field, set), certified: [{ source: 'meta', path: 'p', transform: 'identity' }], weakEvidence: false, aiCalled: false, incomplete: false,
        cells: Object.fromEntries(urls.map((u) => [u, { status: 'pass', found: '1', path: { source: 'meta', path: 'p', transform: 'identity' } }])) } },
    });
    await expect(caller.datasets.retypeField({ datasetId: p.datasetId, key: f.key, type: 'text' })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
  it('retype propagates when nothing is certified', async () => {
    const { p, a, f } = await seeded();
    await caller.datasets.retypeField({ datasetId: p.datasetId, key: f.key, type: 'text' });
    const s = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
    expect((s?.schemaDefinition as SchemaDefinitionField[])[0]!.type).toBe('text');
  });
  it('delete removes the field from the contract, every binding and every verification set', async () => {
    const { p, a, f } = await seeded();
    const urls = ['https://a.example/p/1', 'https://a.example/p/2', 'https://a.example/p/3'];
    await caller.sources.updateBinding({ sourceId: a.sourceId, urls, descriptions: { price: 'green' }, expected: { price: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' } } });
    const r = await caller.datasets.deleteField({ datasetId: p.datasetId, key: f.key });
    expect(r.affectedSourceIds).toEqual([a.sourceId]);
    const s = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
    expect(s?.schemaDefinition).toEqual([]);
    expect((s?.verificationSet as VerificationSet).expected).toEqual({});
  });
});

describe('datasets.getContract', () => {
  it('returns the added field', async () => {
    const p = await project();
    const f = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
    expect(await caller.datasets.getContract({ datasetId: p.datasetId })).toEqual([{ key: f.key, name: 'Price', type: 'money', concept: 'price' }]);
  });
});

describe('datasets.fieldStatus', () => {
  it('reports verified-on counts per field', async () => {
    const p = await project();
    const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'A', url: 'https://a.example/' });
    await caller.sources.createInProject({ projectSlug: p.slug, name: 'B', url: 'https://b.example/' });
    const f = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
    const status = await caller.datasets.fieldStatus({ datasetId: p.datasetId });
    expect(status[f.key]).toMatchObject({ verified: 0, total: 2 });
    expect(status[f.key]!.websites.map((w) => w.sourceId)).toContain(a.sourceId);
  });
});

describe('datasets.updateSchema keeps keys', () => {
  it('does not drop key or concept when an operator saves origins', async () => {
    const p = await project();
    const f = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
    await caller.datasets.updateSchema({ datasetId: p.datasetId, schema: [{ key: f.key, name: 'Price', type: 'money', concept: 'price', origin: 'detail' }] });
    const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, p.datasetId) });
    expect((ds?.schema as Array<Record<string, unknown>>)[0]).toMatchObject({ key: 'price', concept: 'price', origin: 'detail' });
  });
});
