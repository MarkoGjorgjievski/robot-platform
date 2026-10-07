import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, projects, sources, inputSets, datasets } from '@robot/db';
import { signedInCaller } from '../test-helpers/identity.js';

// A throwaway signed-in identity: every customer procedure needs a session
// and works in its org only, so nothing here touches the seeded `default` org.
const me = await signedInCaller('sources-project');
const caller = me.caller;
afterAll(async () => { await me.cleanup(); });
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

/** A fresh project whose contract already has the `price` field `updateBinding` needs. */
async function freshProjectWithPriceField(name = 'Proj') {
  const p = await freshProject(name);
  await caller.datasets.addField({ datasetId: p.datasetId, name: 'price', type: 'money' });
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
  it('seeds a new website\'s binding with the contract field\'s description as its default hint', async () => {
    const p = await freshProject();
    const f = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money', description: 'The price the customer pays now' });
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: 'https://a.example/' });
    const s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId) });
    expect((s?.schemaDefinition as Array<{ key: string; description: string }>).find((d) => d.key === f.key)?.description).toBe('The price the customer pays now');
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

describe('sources.updateBinding keeps the input set in step', () => {
  const host = 'shop.example';
  const urls = [`https://${host}/p/1`, `https://${host}/p/2`, `https://${host}/p/3`];
  const descriptions = { price: 'the price' };
  const expected = { price: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' } };

  it('creates a detail input set from the three product urls when there is no listing url', async () => {
    const p = await freshProjectWithPriceField();
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: `https://${host}/` });
    await caller.sources.updateBinding({ sourceId: r.sourceId, urls, descriptions, expected });
    const s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId), with: { inputSet: true } });
    expect(s?.listingMode).toBe('detail');
    expect(s?.inputSet?.rows).toEqual(urls.map((url) => ({ url })));
  });
  it('switches to one listing row and listing mode when a listing url is given, and back', async () => {
    const p = await freshProjectWithPriceField();
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: `https://${host}/` });
    await caller.sources.updateBinding({ sourceId: r.sourceId, urls, descriptions, expected, listingUrl: `https://${host}/all` });
    let s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId), with: { inputSet: true } });
    expect(s?.listingMode).toBe('listing_to_detail');
    expect(s?.inputSet?.rows).toEqual([{ url: `https://${host}/all` }]);
    const firstInputSetId = s?.inputSetId;

    await caller.sources.updateBinding({ sourceId: r.sourceId, urls, descriptions, expected });
    s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId), with: { inputSet: true } });
    expect(s?.listingMode).toBe('detail');
    expect(s?.inputSetId).toBe(firstInputSetId); // updated in place, not recreated
    expect(s?.inputSet?.rows).toEqual(urls.map((url) => ({ url })));
  });

  it('refuses to flip the listing mode of a confirmed source, and leaves the schema untouched (fix round 1, finding 1 + 3)', async () => {
    const p = await freshProjectWithPriceField();
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: `https://${host}/` });
    await caller.sources.updateBinding({ sourceId: r.sourceId, urls, descriptions, expected, listingUrl: `https://${host}/all` });
    await db.update(sources).set({ confirmedAt: new Date() }).where(eq(sources.id, r.sourceId));

    const changedDescriptions = { price: 'a changed description' };
    let caught: unknown;
    try {
      await caller.sources.updateBinding({ sourceId: r.sourceId, urls, descriptions: changedDescriptions, expected });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('PRECONDITION_FAILED');

    // The refused request must not have partially committed the schema write
    // (fix round 1, finding 1: the schema update and the lock check now run
    // in the same transaction).
    const s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId) });
    const persistedFields = s?.schemaDefinition as Array<{ description: string }>;
    expect(persistedFields[0]!.description).toBe('the price');
    expect(s?.listingMode).toBe('listing_to_detail');
  });

  it('does not replace a legacy input set the schema flow did not author (final review, finding 1)', async () => {
    const p = await freshProjectWithPriceField();
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: `https://${host}/` });

    const legacyRows = Array.from({ length: 5 }, (_, i) => ({ url: `https://${host}/legacy/${i + 1}` }));
    const [legacyInputSet] = await db
      .insert(inputSets)
      .values({ projectId: p.id, type: 'direct', name: 'legacy', columns: [{ name: 'url', primary: true }], rows: legacyRows })
      .returning({ id: inputSets.id });
    await db.update(sources).set({ inputSetId: legacyInputSet!.id, listingMode: 'detail' }).where(eq(sources.id, r.sourceId));

    await caller.sources.updateBinding({ sourceId: r.sourceId, urls, descriptions, expected });

    const s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId), with: { inputSet: true } });
    expect(s?.inputSetId).toBe(legacyInputSet!.id);
    expect(s?.inputSet?.rows).toEqual(legacyRows);
    expect(s?.listingMode).toBe('detail');
  });

  it('resets the budget on a mode change: {} in detail, the listing default in listing_to_detail (fix round 1, finding 2)', async () => {
    const p = await freshProjectWithPriceField();
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: `https://${host}/` });

    await caller.sources.updateBinding({ sourceId: r.sourceId, urls, descriptions, expected });
    let s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId) });
    expect(s?.listingMode).toBe('detail');
    expect(s?.budget).toEqual({});

    await caller.sources.updateBinding({ sourceId: r.sourceId, urls, descriptions, expected, listingUrl: `https://${host}/all` });
    s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId) });
    expect(s?.listingMode).toBe('listing_to_detail');
    expect(s?.budget).toEqual({ max_items: 40, max_pages: 3, mode: 'first_n' });

    await caller.sources.updateBinding({ sourceId: r.sourceId, urls, descriptions, expected });
    s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId) });
    expect(s?.listingMode).toBe('detail');
    expect(s?.budget).toEqual({});
  });

  it('leaves the Extract tab\'s listing page, mode, and budget alone on the next binding save (phase 4, task 3, fix round 1a)', async () => {
    const p = await freshProjectWithPriceField();
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: `https://${host}/` });
    const listingUrl = `https://${host}/all`;

    // The binding flow owns the input set at this point: updateBinding
    // created it (one listing row, this same URL) itself. This is the
    // scenario that actually exercises the fix — the old ownership check
    // (`flowOwnsInputSet`) would ALSO think it still owns this row (it's
    // still exactly what a fresh binding save with this same listingUrl
    // would write), so re-using the same URL, not a different one, is what
    // makes `parameters.inputMode` — not the pre-existing heuristic — the
    // thing actually protecting it below.
    await caller.sources.updateBinding({ sourceId: r.sourceId, urls, descriptions, expected, listingUrl });

    // The Extract tab now explicitly takes ownership of that same page.
    await caller.sources.setListingPages({ sourceId: r.sourceId, urls: [listingUrl] });
    const afterSetListingPages = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId) });

    // A later binding (schema) save without repeating the listing URL must
    // not fall back to derived detail-mode rows, flip the mode, or reset the
    // budget — the Extract tab's page owns the input now.
    await caller.sources.updateBinding({ sourceId: r.sourceId, urls, descriptions, expected });

    const s = await db.query.sources.findFirst({ where: eq(sources.id, r.sourceId), with: { inputSet: true } });
    expect(s?.inputSet?.rows).toEqual([{ url: listingUrl }]);
    expect(s?.listingMode).toBe('listing_to_detail');
    expect(s?.budget).toEqual(afterSetListingPages?.budget);
    expect(s?.budget).not.toEqual({});
    expect((s?.schemaDefinition as Array<{ description: string }>)[0]!.description).toBe('the price');
  });

  it('skips the confirmed-mode lock too once the Extract tab owns the input (phase 4, task 3, fix round 1b)', async () => {
    const p = await freshProjectWithPriceField();
    const r = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: `https://${host}/` });
    await caller.sources.setListingPages({ sourceId: r.sourceId, urls: [`https://${host}/c/1`] });
    await db.update(sources).set({ confirmedAt: new Date() }).where(eq(sources.id, r.sourceId));

    // Without a listing URL this binding save would derive `detail` mode —
    // which would normally be refused as a mode flip on a confirmed source.
    // Since the Extract tab owns the input, that derived-mode precondition
    // is skipped and the schema write must go through.
    const s = await caller.sources.updateBinding({ sourceId: r.sourceId, urls, descriptions, expected });
    expect((s?.schemaDefinition as Array<{ description: string }> | null)?.[0]?.description).toBe('the price');
    expect(s?.verificationSet).toEqual({ urls, expected });
  });
});
