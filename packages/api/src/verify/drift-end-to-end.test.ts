// packages/api/src/verify/drift-end-to-end.test.ts
// End to end on a local site whose layout changes (drift repair Task 5):
// real Chromium, real proof-page captures against `drift-site.ts`'s own
// `127.0.0.1` server, zero AI. This never calls `runVerification` or
// anything that could reach a model, even with a key in `.env` — the
// certification `runDriftCheck` needs is seeded directly, the clean,
// current `source_verifications` row `sources-verify.test.ts`'s and
// `require-certification-variants.test.ts`'s own `hashOf` build.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, count } from 'drizzle-orm';
import { db, captures, driftChecks, sources, sourceVerifications } from '@robot/db';
import type { CertifiedPath, SchemaDefinitionField, VerificationSet } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { startDriftSite, type DriftSite } from '../test-helpers/drift-site.js';
import { signedInCaller } from '../test-helpers/identity.js';

// No agent, ever (Global Constraints): both ways a model could be reached are
// spied on, the same `run-drift-check.test.ts` already does for Task 2 —
// belt and suspenders, since neither `drift-classify.ts` nor
// `run-drift-check.ts` imports either module at all.
const { agentCtor, proposeSpy } = vi.hoisted(() => ({ agentCtor: vi.fn(), proposeSpy: vi.fn() }));
vi.mock('@robot/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robot/agent')>();
  class SpySchemaAgent { constructor() { agentCtor(); } }
  return { ...actual, SchemaAgent: SpySchemaAgent };
});
vi.mock('../../../scraper/src/verify/ai-fallback.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, proposeWithAi: proposeSpy };
});

const scraper = await import('@robot/scraper');
const { startDriftCheck, runDriftCheck } = await import('./run-drift-check.js');

// A throwaway signed-in identity: every customer procedure needs a session
// and works in its org only, so nothing here touches the seeded `default` org.
const me = await signedInCaller('drift-end-to-end');
const caller = me.caller;
afterAll(async () => { await me.cleanup(); });

/** The current per-field hash of a source's field, as the server computes it (sources-verify.test.ts's own `hashOf`). */
async function hashOf(sourceId: string, key: string): Promise<string> {
  const src = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  const def = (src!.schemaDefinition as SchemaDefinitionField[]).find((d) => d.key === key)!;
  return scraper.fieldHash(def, src!.verificationSet as VerificationSet);
}

let dir: string;
let site: DriftSite;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'captures-drift-e2e-'));
  process.env.CAPTURES_DIR = dir;
  site = await startDriftSite();
}, 30_000);
afterAll(async () => {
  await site.close();
  delete process.env.CAPTURES_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('drift repair: end to end on a local site whose layout changes', () => {
  it('finds price moved to the .amount element, title unaffected (other-layout), with no AI call and no write outside drift_checks/captures', async () => {
    const f = await createProjectWithSource(caller, {
      tag: 'drift-e2e',
      urls: site.urls,
      fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }],
      expected: {
        Price: { [site.urls[0]!]: '129.99', [site.urls[1]!]: '219.99', [site.urls[2]!]: '149.00' },
        Title: { [site.urls[0]!]: 'Widget A', [site.urls[1]!]: 'Widget B', [site.urls[2]!]: 'Widget C' },
      },
    });
    try {
      const priceKey = f.keys.Price!;
      const titleKey = f.keys.Title!;
      // Layout A's own certified paths: price from the JSON-LD, title from it
      // too — both still read in layout A, which is what makes this a clean,
      // current certification to seed (never a real `runVerification`).
      const priceCertified: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };
      const titleCertified: CertifiedPath = { source: 'json-ld', path: 'name', transform: 'identity' };
      const cellsFor = (certified: CertifiedPath) => Object.fromEntries(site.urls.map((u) => [u, { status: 'pass' as const, found: 'x', path: certified }]));
      await db.insert(sourceVerifications).values({
        sourceId: f.sourceId,
        definitionHash: 'x',
        completedAt: new Date(),
        allPassed: true,
        results: {
          [priceKey]: { key: priceKey, cells: cellsFor(priceCertified), certified: [priceCertified], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: await hashOf(f.sourceId, priceKey) },
          [titleKey]: { key: titleKey, cells: cellsFor(titleCertified), certified: [titleCertified], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: await hashOf(f.sourceId, titleKey) },
        },
      });
      await db.update(sources).set({ driftedFields: [priceKey, titleKey] }).where(eq(sources.id, f.sourceId));

      const before = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
      expect((await db.select({ n: count() }).from(captures).where(eq(captures.sourceId, f.sourceId)))[0]!.n).toBe(0);

      type Results = { fields: Record<string, { result: string; path?: { source: string; path: string }; pages: Record<string, { status: string; mark?: { xpaths: string[] } }> }> };
      /** One check, start to finish, with the real default capture function (`defaultCaptureProofPages`), real Chromium, against `site`'s own `127.0.0.1` address — never stubbed. */
      const check = async () => {
        const { checkId, status } = await startDriftCheck(f.sourceId, null, { fire: false });
        expect(status).toBe('started');
        await runDriftCheck(checkId);
        const row = await db.query.driftChecks.findFirst({ where: eq(driftChecks.id, checkId) });
        expect(row?.status).toBe('done');
        expect(row?.error).toBeNull();
        return row!.results as Results;
      };

      // Layout A is what the seeded certification was proven on: both fields
      // still read every expected value (final review M6).
      site.setLayout('A');
      const underA = await check();
      expect(underA.fields[priceKey]).toMatchObject({ result: 'other-layout' });
      expect(underA.fields[titleKey]).toMatchObject({ result: 'other-layout' });

      // The layout changes under the certified paths above: price drops out
      // of the JSON-LD and moves into `.amount`; title is untouched. A second
      // start after a `done` row starts a new check.
      site.setLayout('B');
      const results = await check();
      expect(results.fields[priceKey]).toMatchObject({ result: 'moved' });
      expect(results.fields[priceKey]?.path?.source).toBe('xpath');
      expect(results.fields[priceKey]?.path?.path.toLowerCase()).toContain('amount');
      // Every page carries the new element's mark, so "Accept new location" has something to write (final review M5).
      for (const u of site.urls) {
        const page = results.fields[priceKey]!.pages[u]!;
        expect(page.status).toBe('ok');
        expect(page.mark?.xpaths).toContain(results.fields[priceKey]!.path!.path);
      }
      expect(results.fields[titleKey]).toMatchObject({ result: 'other-layout' });

      // The check is free and changes nothing by itself (Global Constraints):
      // only its own `drift_checks` row and the proof-page `captures` it took.
      const after = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
      expect(after.verificationSet).toEqual(before.verificationSet);
      expect(after.schemaDefinition).toEqual(before.schemaDefinition);
      expect(after.driftedFields).toEqual(before.driftedFields);
      expect((await db.select({ n: count() }).from(sourceVerifications).where(eq(sourceVerifications.sourceId, f.sourceId)))[0]!.n).toBe(1);
      expect((await db.select({ n: count() }).from(captures).where(eq(captures.sourceId, f.sourceId)))[0]!.n).toBe(2 * site.urls.length); // two checks, three pages each

      expect(agentCtor).not.toHaveBeenCalled();
      expect(proposeSpy).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  }, 120_000);
});
