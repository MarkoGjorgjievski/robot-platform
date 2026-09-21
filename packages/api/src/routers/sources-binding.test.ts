import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, sources, inputSets, sourceVerifications } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

const caller = createCallerFactory(appRouter)({ db, session: null });
const projectIds: string[] = [];
afterEach(async () => {
  for (const id of projectIds.splice(0)) {
    await db.delete(inputSets).where(eq(inputSets.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
});
const U = ['https://shop.example/p/1', 'https://shop.example/p/2', 'https://shop.example/p/3'];

async function seeded() {
  const p = await caller.projects.create({ name: 'Binding' });
  projectIds.push(p.id);
  await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
  const s = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: 'https://shop.example/' });
  return { p, s };
}

describe('sources.createInProject seeds the contract', () => {
  it('gives a new website every contract field with an empty description', async () => {
    const { s } = await seeded();
    const row = await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId) });
    expect(row?.schemaDefinition).toEqual([{ key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' }]);
    expect(row?.verificationSet).toBeNull();
  });
});

describe('sources.updateBinding', () => {
  it('writes descriptions, pages and expected values keyed by contract key, and creates the detail input set', async () => {
    const { s } = await seeded();
    await caller.sources.updateBinding({ sourceId: s.sourceId, urls: U, descriptions: { price: 'green' }, expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } } });
    const row = await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId), with: { inputSet: true } });
    expect(row?.schemaDefinition).toEqual([{ key: 'price', name: 'Price', type: 'money', description: 'green', concept: 'price' }]);
    expect(row?.verificationSet).toEqual({ urls: U, expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } } });
    expect(row?.listingMode).toBe('detail');
    expect(row?.inputSet?.rows).toEqual(U.map((url) => ({ url })));
  });
  it('rejects a binding that leaves a contract field without a description or a cell', async () => {
    const { s } = await seeded();
    await expect(caller.sources.updateBinding({ sourceId: s.sourceId, urls: U, descriptions: {}, expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } } })).rejects.toThrow(/say where it is/);
  });
  it('cannot change name or type: the contract wins on every save', async () => {
    const { s, p } = await seeded();
    await caller.sources.updateBinding({ sourceId: s.sourceId, urls: U, descriptions: { price: 'green' }, expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } } });
    await caller.datasets.renameField({ datasetId: p.datasetId, key: 'price', name: 'Cost' });
    await caller.sources.updateBinding({ sourceId: s.sourceId, urls: U, descriptions: { price: 'green!' }, expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } } });
    const row = await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId) });
    expect((row?.schemaDefinition as Array<{ name: string; description: string }>)[0]).toMatchObject({ name: 'Cost', description: 'green!' });
  });
  it('carries marks into verificationSet, and drops them when the save omits marks', async () => {
    const { s } = await seeded();
    const mark = { xpaths: ['//*[@id="p"]'], text: '$1', rect: { x: 0, y: 0, w: 1, h: 1 } };
    await caller.sources.updateBinding({ sourceId: s.sourceId, urls: U, descriptions: { price: 'green' }, expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } }, marks: { price: { [U[0]!]: mark } } });
    const withMark = await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId) });
    expect(withMark?.verificationSet).toMatchObject({ marks: { price: { [U[0]!]: mark } } });

    await caller.sources.updateBinding({ sourceId: s.sourceId, urls: U, descriptions: { price: 'green' }, expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } } });
    const withoutMark = await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId) });
    expect(withoutMark?.verificationSet).not.toHaveProperty('marks');
  });
});

describe('sources.verificationStatus.currentKeys', () => {
  it('is empty for a never-verified website and current is false', async () => {
    const { s } = await seeded();
    await caller.sources.updateBinding({ sourceId: s.sourceId, urls: U, descriptions: { price: 'green' }, expected: { price: { [U[0]!]: '1', [U[1]!]: '2', [U[2]!]: '3' } } });
    await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: new Date(), results: {} });
    const st = await caller.sources.verificationStatus({ sourceId: s.sourceId });
    expect(st?.currentKeys).toEqual([]);
    expect(st?.current).toBe(false);
  });
});
