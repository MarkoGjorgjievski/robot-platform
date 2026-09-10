import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, orgs, projects, datasets, sources } from '../index.js';
import { liftContracts } from './lift-contracts.js';

const created: string[] = [];
afterEach(async () => { for (const id of created.splice(0)) await db.delete(projects).where(eq(projects.id, id)); });

describe('liftContracts', () => {
  it('lifts per-source fields into the dataset, flags type disagreements, and gives dataset-less projects one', async () => {
    const org = await db.query.orgs.findFirst({ where: eq(orgs.slug, 'default') });
    const [p] = await db.insert(projects).values({ orgId: org!.id, name: 'Lift', slug: `lift-${Date.now()}` }).returning();
    created.push(p!.id);
    const [ds] = await db.insert(datasets).values({ projectId: p!.id, name: 'Lift', slug: `lift-${Date.now()}`, schema: [{ name: 'Title', type: 'text', origin: 'listing' }] }).returning();
    const field = (key: string, name: string, type: string) => ({ key, name, type, description: 'x', concept: key });
    // Two separate inserts so `a` and `b` get distinct createdAt timestamps —
    // liftContracts orders sources by createdAt, and the test relies on `a` being earliest.
    await db.insert(sources).values({ datasetId: ds!.id, name: 'a', slug: 'a', country: 'us', schemaDefinition: [field('price', 'Price', 'money'), field('title', 'Title', 'text')] });
    await db.insert(sources).values({ datasetId: ds!.id, name: 'b', slug: 'b', country: 'us', schemaDefinition: [field('price', 'Price', 'number')] });
    const [bare] = await db.insert(projects).values({ orgId: org!.id, name: 'Bare', slug: `bare-${Date.now()}` }).returning();
    created.push(bare!.id);

    const r = await liftContracts(db, { projectIds: [p!.id, bare!.id] });
    const lifted = await db.query.datasets.findFirst({ where: eq(datasets.id, ds!.id) });
    expect(lifted?.schema).toEqual([
      { name: 'Title', type: 'text', origin: 'listing', key: 'title', concept: 'title' },
      { key: 'price', name: 'Price', type: 'money', concept: 'price' },
    ]);
    expect(r.conflicts).toEqual([{ datasetId: ds!.id, key: 'price', kept: 'money', ignored: 'number', sourceId: expect.any(String) }]);
    const bareDs = await db.query.datasets.findMany({ where: eq(datasets.projectId, bare!.id) });
    expect(bareDs.map((d) => d.name)).toEqual(['Bare']);
  });
});
