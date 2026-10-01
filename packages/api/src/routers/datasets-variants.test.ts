import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, datasets, sources, inputSets, sourceVerifications, users } from '@robot/db';
import { fieldHash, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { loadFieldCurrency } from '../verify/current-certification.js';
import { loadSession } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';

const caller = createCallerFactory(appRouter)({ db, session: null });
const tag = `variants-${Date.now()}`;
const projectIds: string[] = [];
afterEach(async () => {
  for (const id of projectIds.splice(0)) {
    await db.delete(inputSets).where(eq(inputSets.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
});

async function project(name: string) {
  const p = await caller.projects.create({ name });
  projectIds.push(p.id);
  return p;
}

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

describe('variants on the contract', () => {
  it('turns variants on and off without losing axes or levels', async () => {
    const p = await project(`${tag} v`);
    await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money', concept: 'price' });
    const a = await caller.datasets.addAxis({ datasetId: p.datasetId, name: 'Colour' });
    await caller.datasets.setVariantMode({ datasetId: p.datasetId, mode: 'row_per_variant' });
    await caller.datasets.setVariantMode({ datasetId: p.datasetId, mode: 'ignore' });
    const v = await caller.datasets.variants({ datasetId: p.datasetId });
    expect(v.mode).toBe('ignore');
    expect(v.axes).toEqual([a]);
    expect(v.fields.find((f) => f.name === 'Price')).toMatchObject({ level: 'variant', levelIsDefault: true });
  });

  it('a field level can be set and reset to its default', async () => {
    const p = await project(`${tag} level`);
    const f = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Brand', type: 'text', concept: 'brand' });

    const set = await caller.datasets.setFieldLevel({ datasetId: p.datasetId, key: f.key, level: 'product' });
    expect(set).toEqual({ key: f.key, level: 'product' });
    let v = await caller.datasets.variants({ datasetId: p.datasetId });
    expect(v.fields.find((x) => x.key === f.key)).toMatchObject({ level: 'product', levelIsDefault: false });

    const reset = await caller.datasets.setFieldLevel({ datasetId: p.datasetId, key: f.key, level: null });
    expect(reset.level).toBe('product'); // brand has no variant concept: defaults to product
    v = await caller.datasets.variants({ datasetId: p.datasetId });
    expect(v.fields.find((x) => x.key === f.key)).toMatchObject({ level: 'product', levelIsDefault: true });
  });

  it('an axis name may not repeat a field or another axis', async () => {
    const p = await project(`${tag} dup`);
    await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
    await expect(caller.datasets.addAxis({ datasetId: p.datasetId, name: 'Price' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await caller.datasets.addAxis({ datasetId: p.datasetId, name: 'Colour' });
    await expect(caller.datasets.addAxis({ datasetId: p.datasetId, name: 'Colour' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(caller.datasets.addField({ datasetId: p.datasetId, name: 'Colour', type: 'text' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses to delete an axis a website maps to, naming the website', async () => {
    const p = await project(`${tag} del`);
    const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Acme Site', url: `https://${tag}-a.example/` });
    const axis = await caller.datasets.addAxis({ datasetId: p.datasetId, name: 'Colour' });
    await db
      .update(sources)
      .set({ variantSetup: { method: 'list', axes: [{ from: 'color', axisKey: axis.key }], confirmedAt: new Date().toISOString() } })
      .where(eq(sources.id, a.sourceId));
    await expect(caller.datasets.deleteAxis({ datasetId: p.datasetId, key: axis.key })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('Acme Site'),
    });
  });

  it('is invisible from another organisation', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    let b: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-a@example.com`);
      b = await signIn(`${tag}-b@example.com`);
      const p = await a.caller.projects.create({ name: 'Mine' });
      const f = await a.caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
      const axis = await a.caller.datasets.addAxis({ datasetId: p.datasetId, name: 'Colour' });

      const nf = { code: 'NOT_FOUND' };
      await expect(b.caller.datasets.variants({ datasetId: p.datasetId })).rejects.toMatchObject(nf);
      await expect(b.caller.datasets.setVariantMode({ datasetId: p.datasetId, mode: 'row_per_variant' })).rejects.toMatchObject(nf);
      await expect(b.caller.datasets.setFieldLevel({ datasetId: p.datasetId, key: f.key, level: 'product' })).rejects.toMatchObject(nf);
      await expect(b.caller.datasets.addAxis({ datasetId: p.datasetId, name: 'Size' })).rejects.toMatchObject(nf);
      await expect(b.caller.datasets.renameAxis({ datasetId: p.datasetId, key: axis.key, name: 'Hue' })).rejects.toMatchObject(nf);
      await expect(b.caller.datasets.deleteAxis({ datasetId: p.datasetId, key: axis.key })).rejects.toMatchObject(nf);
    } finally {
      if (a) await dropIdentity(a);
      if (b) await dropIdentity(b);
    }
  });
});

describe('datasets.updateSchema preserves axes and levels it does not know about', () => {
  it('keeps axis entries and a field level through a bulk save of origins', async () => {
    const p = await project(`${tag} preserve`);
    const f = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money', concept: 'price' });
    const axis = await caller.datasets.addAxis({ datasetId: p.datasetId, name: 'Colour' });
    await caller.datasets.setFieldLevel({ datasetId: p.datasetId, key: f.key, level: 'product' });

    await caller.datasets.updateSchema({
      datasetId: p.datasetId,
      schema: [{ key: f.key, name: 'Price', type: 'money', concept: 'price', origin: 'detail' }],
    });

    const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, p.datasetId) });
    const schema = ds?.schema as Array<Record<string, unknown>>;
    expect(schema.find((e) => e.key === f.key)).toMatchObject({ key: f.key, level: 'product', origin: 'detail' });
    expect(schema.find((e) => e.key === axis.key)).toEqual(axis);
  });
});

describe('level changes never disturb verification currency', () => {
  it('a verified field stays current after its level is set and reset', async () => {
    const urls = [
      `https://test-${tag}-currency.example.com/p/1`,
      `https://test-${tag}-currency.example.com/p/2`,
      `https://test-${tag}-currency.example.com/p/3`,
    ];
    const f = await createProjectWithSource(caller, {
      tag: `variants-currency-${tag}`,
      urls,
      fields: [{ name: 'Price', type: 'money', description: 'x' }],
      expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
    });
    try {
      const src = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      const def = (src!.schemaDefinition as SchemaDefinitionField[]).find((d) => d.key === f.keys.Price)!;
      const set = src!.verificationSet as VerificationSet;
      const hash = fieldHash(def, set);
      const certifiedPath = { source: 'json-ld', path: '$.price', transform: 'identity' };
      await db.insert(sourceVerifications).values({
        sourceId: f.sourceId,
        definitionHash: 'x',
        allPassed: true,
        completedAt: new Date(),
        results: {
          [f.keys.Price!]: {
            key: f.keys.Price,
            fieldHash: hash,
            certified: [certifiedPath],
            weakEvidence: false,
            aiCalled: false,
            incomplete: false,
            cells: Object.fromEntries(urls.map((u) => [u, { status: 'pass', found: '1', path: certifiedPath }])),
          },
        },
      });

      expect((await loadFieldCurrency(db, f.sourceId)).currentKeys).toEqual([f.keys.Price]);

      await caller.datasets.setFieldLevel({ datasetId: f.datasetId, key: f.keys.Price!, level: 'product' });
      expect((await loadFieldCurrency(db, f.sourceId)).currentKeys).toEqual([f.keys.Price]);

      await caller.datasets.setFieldLevel({ datasetId: f.datasetId, key: f.keys.Price!, level: null });
      expect((await loadFieldCurrency(db, f.sourceId)).currentKeys).toEqual([f.keys.Price]);
    } finally {
      await f.cleanup();
    }
  });
});
