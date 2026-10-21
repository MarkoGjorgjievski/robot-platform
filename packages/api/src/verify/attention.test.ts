import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, driftChecks, fieldHolds, sources, sourceVerifications, valueRefreshes } from '@robot/db';
import { fieldHash, type CertifiedPath, type DriftCheckResults, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { latestRefreshes, needsAttention, opsRefreshes, websiteAttention } from './attention.js';

const me = await signedInCaller('attention');
afterAll(async () => { await me.cleanup(); });
const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };

async function twoFields(tag: string) {
  const f = await createProjectWithSource(me.caller, { tag: `attn-${tag}`, fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }] });
  await me.caller.sources.updateBinding({
    sourceId: f.sourceId, urls: f.urls, descriptions: { price: 'x', title: 'x' },
    expected: { price: Object.fromEntries(f.urls.map((u, i) => [u, `${i + 1}.00`])), title: Object.fromEntries(f.urls.map((u, i) => [u, `T${i}`])) },
  });
  const src = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
  const fields = src.schemaDefinition as SchemaDefinitionField[];
  const set = src.verificationSet as VerificationSet;
  const pass = (key: string) => ({ key, cells: Object.fromEntries(f.urls.map((u) => [u, { status: 'pass', found: 'x', path: LD }])), certified: [LD], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: fieldHash(fields.find((x) => x.key === key)!, set) });
  return { ...f, fields, set, pass };
}

describe('websiteAttention (spec 2026-10-21 §3.5)', () => {
  it('nothing needs attention on a current website with no check', async () => {
    const s = await twoFields('none');
    try {
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true, results: { price: s.pass('price'), title: s.pass('title') } });
      const a = await websiteAttention(db, s.sourceId);
      expect(a).toEqual({ fields: [], heldSince: null, goneProducts: [], findings: {} });
      expect(needsAttention(a)).toBe(false);
    } finally { await s.cleanup(); }
  });

  it('a held field, a check’s unrefreshed change and a gone page need attention; a refreshed change does not', async () => {
    const s = await twoFields('mixed');
    try {
      const verifiedAt = new Date(Date.now() - 2 * 86_400_000);
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: verifiedAt, allPassed: true, results: { price: s.pass('price'), title: s.pass('title') } });
      const failedTitle = { ...s.pass('title'), certified: [], cells: { [s.urls[0]!]: { status: 'fail', reason: 'different_value' } } };
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: new Date(Date.now() - 86_400_000), allPassed: false, results: { price: s.pass('price'), title: failedTitle } });
      await db.insert(fieldHolds).values({ sourceId: s.sourceId, fieldKey: 'title', result: s.pass('title'), verifiedAt, fieldHashes: [s.pass('title').fieldHash] });
      const results: DriftCheckResults = {
        runId: null, trigger: 'schedule',
        fields: {
          title: { key: 'title', result: 'changed', pages: { [s.urls[0]!]: { status: 'ok', value: 'New', changed: true, was: 'T0' } } },
          price: { key: 'price', result: 'changed', pages: { [s.urls[1]!]: { status: 'page-gone' } }, refresh: { applied: true } },
        },
      };
      await db.insert(driftChecks).values({ sourceId: s.sourceId, status: 'done', trigger: 'schedule', results, completedAt: new Date() });
      const a = await websiteAttention(db, s.sourceId);
      expect(a.fields).toEqual(['title']);
      expect(a.heldSince!.toISOString()).toBe(verifiedAt.toISOString());
      expect(a.goneProducts).toEqual([2]);
      expect(Object.keys(a.findings)).toEqual(['title']);
      expect(needsAttention(a)).toBe(true);
    } finally { await s.cleanup(); }
  });

  it('a current field’s finding older than the latest Verify does not count', async () => {
    const s = await twoFields('old-check');
    try {
      await db.insert(driftChecks).values({ sourceId: s.sourceId, status: 'done', trigger: 'schedule', completedAt: new Date(), results: { runId: null, fields: { price: { key: 'price', result: 'lost', pages: {} } } } });
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: new Date(Date.now() + 1000), allPassed: true, results: { price: s.pass('price'), title: s.pass('title') } });
      expect((await websiteAttention(db, s.sourceId)).fields).toEqual([]);
    } finally { await s.cleanup(); }
  });

  it('a running check’s up-front shares and a failed check say nothing', async () => {
    const s = await twoFields('running');
    try {
      await db.insert(driftChecks).values({ sourceId: s.sourceId, status: 'running', trigger: 'schedule', results: { runId: null, fields: { price: { key: 'price', emptyShare: 0.5 } } } });
      await db.insert(driftChecks).values({ sourceId: s.sourceId, status: 'failed', trigger: 'schedule', completedAt: new Date(), results: { runId: null, fields: { price: { key: 'price', result: 'lost', pages: {} } } } });
      expect(needsAttention(await websiteAttention(db, s.sourceId))).toBe(false);
    } finally { await s.cleanup(); }
  });
});

describe('latestRefreshes / opsRefreshes', () => {
  it('gives each field’s newest refresh while it still describes the field; ops lists every one', async () => {
    const s = await twoFields('refreshes');
    try {
      const pages = { [s.urls[0]!]: { was: '1.00', now: '1.10', path: LD } };
      await db.insert(valueRefreshes).values({ sourceId: s.sourceId, fieldKey: 'price', pages, fromHash: 'a', toHash: s.pass('price').fieldHash, at: new Date() });
      await db.insert(valueRefreshes).values({ sourceId: s.sourceId, fieldKey: 'title', pages, fromHash: 'a', toHash: 'stale' });
      const out = await latestRefreshes(db, s.sourceId);
      expect(out.map((r) => r.key)).toEqual(['price']);
      expect(out[0]!.pages).toEqual(pages);
      expect((await opsRefreshes(db, s.sourceId)).map((r) => r.key).sort()).toEqual(['price', 'title']);
    } finally { await s.cleanup(); }
  });
});
