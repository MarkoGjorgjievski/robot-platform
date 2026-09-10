import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, datasets, sources, inputSets, sourceVerifications } from '@robot/db';
import { fieldHash, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { loadFieldCurrency } from '../verify/current-certification.js';

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
  // Propagation used to write back `ds.sources` — read by `loadDataset`
  // outside any transaction — wholesale inside the mutation's transaction.
  // A concurrent `updateBinding` commit in between would be silently
  // reverted. `propagate` now writes from a fresh, row-locked read taken
  // inside the same transaction (`lockSources`), so a binding save made
  // before a rename or retype survives it. Sequential calls already
  // preserved this (the patch merge only ever touches `name`/`type`), so
  // this pins that behavior through the read-inside-transaction change.
  it('renameField and retypeField leave a binding description and expected cells set by updateBinding intact', async () => {
    const { p, a, f } = await seeded();
    const urls = ['https://a.example/p/1', 'https://a.example/p/2', 'https://a.example/p/3'];
    await caller.sources.updateBinding({
      sourceId: a.sourceId,
      urls,
      descriptions: { price: 'green' },
      expected: { price: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' } },
    });

    await caller.datasets.renameField({ datasetId: p.datasetId, key: f.key, name: 'Cost' });
    let s = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
    let field = (s!.schemaDefinition as SchemaDefinitionField[]).find((x) => x.key === f.key)!;
    expect(field.description).toBe('green');
    expect((s!.verificationSet as VerificationSet).expected[f.key]).toEqual({ [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' });

    await caller.datasets.retypeField({ datasetId: p.datasetId, key: f.key, type: 'text' });
    s = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
    field = (s!.schemaDefinition as SchemaDefinitionField[]).find((x) => x.key === f.key)!;
    expect(field.description).toBe('green');
    expect((s!.verificationSet as VerificationSet).expected[f.key]).toEqual({ [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' });
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

// End-to-end proof (spec 4.3/4.4): adding a field must not disturb another
// field's current certification, and must seed the new field into a
// website's EXISTING verification set (not just a source that has none yet).
describe('datasets.addField keeps other fields certified', () => {
  it('adding a field leaves an existing field current and seeds the new field into the existing verification set', async () => {
    const p = await project();
    const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'A', url: 'https://a.example/' });
    const priceField = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });

    const urls = ['https://a.example/p/1', 'https://a.example/p/2', 'https://a.example/p/3'];
    await caller.sources.updateBinding({
      sourceId: a.sourceId,
      urls,
      descriptions: { [priceField.key]: 'green' },
      expected: { [priceField.key]: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' } },
    });

    const bound = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
    const field = (bound!.schemaDefinition as SchemaDefinitionField[]).find((f) => f.key === priceField.key)!;
    const set = bound!.verificationSet as VerificationSet;

    await db.insert(sourceVerifications).values({
      sourceId: a.sourceId,
      definitionHash: 'x',
      allPassed: true,
      completedAt: new Date(),
      results: {
        [priceField.key]: {
          key: priceField.key,
          fieldHash: fieldHash(field, set),
          certified: [{ source: 'meta', path: 'p', transform: 'identity' }],
          weakEvidence: false,
          aiCalled: false,
          incomplete: false,
          cells: Object.fromEntries(urls.map((u) => [u, { status: 'pass', found: '1', path: { source: 'meta', path: 'p', transform: 'identity' } }])),
        },
      },
    });

    await caller.datasets.addField({ datasetId: p.datasetId, name: 'Title', type: 'text' });

    const { currentKeys } = await loadFieldCurrency(db, a.sourceId);
    expect(currentKeys).toEqual([priceField.key]);

    const after = await db.query.sources.findFirst({ where: eq(sources.id, a.sourceId) });
    expect((after!.schemaDefinition as SchemaDefinitionField[]).length).toBe(2);
    expect((after!.verificationSet as VerificationSet).expected.title).toEqual(Object.fromEntries(urls.map((u) => [u, ''])));
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

  // updateSchema is a bulk save for the non-contract parts of the dataset
  // schema. A keyed entry's name/type are the contract (spec 4.1/4.3) and
  // are changed exclusively via renameField/retypeField/addField/deleteField
  // — retypeField in particular refuses while a website has a current
  // certification (loadFieldCurrency). Without this guard, updateSchema
  // could bulk-save past that lock.
  it('refuses a keyed type change', async () => {
    const p = await project();
    const f = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
    await expect(
      caller.datasets.updateSchema({ datasetId: p.datasetId, schema: [{ key: f.key, name: 'Price', type: 'text', concept: 'price' }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a keyed name change', async () => {
    const p = await project();
    const f = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
    await expect(
      caller.datasets.updateSchema({ datasetId: p.datasetId, schema: [{ key: f.key, name: 'Cost', type: 'money', concept: 'price' }] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses dropping a keyed entry', async () => {
    const p = await project();
    await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
    await expect(
      caller.datasets.updateSchema({ datasetId: p.datasetId, schema: [] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
