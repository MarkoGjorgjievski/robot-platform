import { describe, it, expect, afterEach, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';
import { eq } from 'drizzle-orm';
import { db, sources, inputSets } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';

// `sources.confirm` calls the real `planSource` — stubbed here per the task
// brief ("confirm sets confirmedAt and plans full (stub planSource)") so this
// file tests confirm's OWN behaviour (confirmedAt, the args passed through),
// not planning itself — planSource has its own regression net in crawl.test.ts.
const { planSourceMock } = vi.hoisted(() => ({ planSourceMock: vi.fn() }));
vi.mock('../crawl/plan-source.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crawl/plan-source.js')>();
  return { ...actual, planSource: planSourceMock };
});

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db, session: null });

function expectZodValidationError(err: unknown): asserts err is TRPCError {
  if (!(err instanceof TRPCError)) throw new Error(`expected TRPCError, got ${err}`);
  if (!(err.cause instanceof ZodError)) throw new Error(`expected ZodError cause, got ${err.cause}`);
}

afterEach(() => {
  planSourceMock.mockReset();
});

// Finding 5 / ruling R7 (final-review-findings.md): the minimal REAL
// switch-mode. Source Config's toggle is the only caller today. These
// sources carry no contract fields (`fields: []`), so `confirm`'s
// certification gate never engages — the tests below are exercising
// `update`'s own listingMode guard, not certification.
describe('sources.update — listingMode', () => {
  it('switches a listing Source to detail mode', async () => {
    const f = await createProjectWithSource(caller, { tag: 'update-mode-a', fields: [] });
    try {
      await db.update(sources).set({ listingMode: 'listing_to_detail' }).where(eq(sources.id, f.sourceId));
      const before = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect(before!.listingMode).toBe('listing_to_detail');

      const updated = await caller.sources.update({ id: f.sourceId, listingMode: 'detail' });
      expect(updated.listingMode).toBe('detail');

      const after = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect(after!.listingMode).toBe('detail');
    } finally {
      await f.cleanup();
    }
  });

  it('switches a detail Source to listing mode', async () => {
    const f = await createProjectWithSource(caller, { tag: 'update-mode-b', fields: [] });
    try {
      const updated = await caller.sources.update({ id: f.sourceId, listingMode: 'listing_to_detail' });
      expect(updated.listingMode).toBe('listing_to_detail');
    } finally {
      await f.cleanup();
    }
  });

  it('rejects a value outside the two known modes', async () => {
    const f = await createProjectWithSource(caller, { tag: 'update-mode-c', fields: [] });
    try {
      await expect(
        caller.sources.update({ id: f.sourceId, listingMode: 'not-a-mode' as never }),
      ).rejects.toThrow();
    } finally {
      await f.cleanup();
    }
  });

  it('leaves listingMode untouched when the update omits it', async () => {
    const f = await createProjectWithSource(caller, { tag: 'update-mode-d', fields: [] });
    try {
      await db.update(sources).set({ listingMode: 'listing_to_detail' }).where(eq(sources.id, f.sourceId));
      await caller.sources.update({ id: f.sourceId, isActive: false });
      const after = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect(after!.listingMode).toBe('listing_to_detail');
    } finally {
      await f.cleanup();
    }
  });

  // Re-review residual #1 (fix-wave-report.md): `...rest` applied
  // listingMode unconditionally, so a confirmed Source's mode could be
  // flipped silently, misrouting source-setup.tsx's Extract branch.
  it('refuses to change listingMode on a confirmed Source', async () => {
    const f = await createProjectWithSource(caller, { tag: 'update-mode-locked-a', fields: [] });
    try {
      await db.update(sources).set({ listingMode: 'listing_to_detail' }).where(eq(sources.id, f.sourceId));
      planSourceMock.mockResolvedValue({
        runId: '22222222-2222-2222-2222-222222222222',
        status: 'planned',
        itemCount: 1,
        listingPages: 0,
        warnings: [],
        errors: [],
        inputs: [],
        cacheWarm: false,
      });
      await caller.sources.confirm({ sourceId: f.sourceId });

      await expect(
        caller.sources.update({ id: f.sourceId, listingMode: 'detail' }),
      ).rejects.toThrow(/confirmed.*locked/i);

      const after = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect(after!.listingMode).toBe('listing_to_detail');
    } finally {
      await f.cleanup();
    }
  });

  it('still allows updating a confirmed Source when the update does not touch listingMode', async () => {
    const f = await createProjectWithSource(caller, { tag: 'update-mode-locked-b', fields: [] });
    try {
      await db.update(sources).set({ listingMode: 'listing_to_detail' }).where(eq(sources.id, f.sourceId));
      planSourceMock.mockResolvedValue({
        runId: '33333333-3333-3333-3333-333333333333',
        status: 'planned',
        itemCount: 1,
        listingPages: 0,
        warnings: [],
        errors: [],
        inputs: [],
        cacheWarm: false,
      });
      await caller.sources.confirm({ sourceId: f.sourceId });

      const updated = await caller.sources.update({ id: f.sourceId, isActive: false });
      expect(updated.isActive).toBe(false);
      expect(updated.listingMode).toBe('listing_to_detail');
    } finally {
      await f.cleanup();
    }
  });

  it('allows "changing" listingMode on a confirmed Source when the value is actually unchanged', async () => {
    const f = await createProjectWithSource(caller, { tag: 'update-mode-locked-c', fields: [] });
    try {
      await db.update(sources).set({ listingMode: 'listing_to_detail' }).where(eq(sources.id, f.sourceId));
      planSourceMock.mockResolvedValue({
        runId: '44444444-4444-4444-4444-444444444444',
        status: 'planned',
        itemCount: 1,
        listingPages: 0,
        warnings: [],
        errors: [],
        inputs: [],
        cacheWarm: false,
      });
      await caller.sources.confirm({ sourceId: f.sourceId });

      const updated = await caller.sources.update({ id: f.sourceId, listingMode: 'listing_to_detail' });
      expect(updated.listingMode).toBe('listing_to_detail');
    } finally {
      await f.cleanup();
    }
  });
});

describe('sources.confirm', () => {
  it('sets confirmedAt and plans at full budget (probe: false), returning { runId }', async () => {
    const f = await createProjectWithSource(caller, { tag: 'confirm-a', fields: [] });
    try {
      planSourceMock.mockResolvedValue({
        runId: '11111111-1111-1111-1111-111111111111',
        status: 'planned',
        itemCount: 1,
        listingPages: 0,
        warnings: [],
        errors: [],
        inputs: [],
        cacheWarm: false,
      });

      const before = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect(before!.confirmedAt).toBeNull();

      const result = await caller.sources.confirm({ sourceId: f.sourceId });
      expect(result).toEqual({ runId: '11111111-1111-1111-1111-111111111111' });

      expect(planSourceMock).toHaveBeenCalledTimes(1);
      const call = planSourceMock.mock.calls[0]!;
      expect(call[1]).toBe(f.sourceId);
      expect(call[2]).toEqual({ probe: false });

      const after = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect(after!.confirmedAt).toBeInstanceOf(Date);
    } finally {
      await f.cleanup();
    }
  });

  // M3 (final-review-findings.md): `confirmedAt` used to be written BEFORE
  // `planSource`, so a throw there left a confirmed Source with no run, and a
  // repeat confirm on an already-confirmed Source silently planned another
  // full-budget run every time.
  it('refuses a repeat confirm on an already-confirmed Source, without planning again', async () => {
    const f = await createProjectWithSource(caller, { tag: 'confirm-b', fields: [] });
    try {
      planSourceMock.mockResolvedValue({
        runId: '11111111-1111-1111-1111-111111111111',
        status: 'planned',
        itemCount: 1,
        listingPages: 0,
        warnings: [],
        errors: [],
        inputs: [],
        cacheWarm: false,
      });

      await caller.sources.confirm({ sourceId: f.sourceId });
      expect(planSourceMock).toHaveBeenCalledTimes(1);

      await expect(caller.sources.confirm({ sourceId: f.sourceId }))
        .rejects.toThrow(/already confirmed/i);
      // The second call must not have planned a second full-budget run.
      expect(planSourceMock).toHaveBeenCalledTimes(1);
    } finally {
      await f.cleanup();
    }
  });

  it('does not set confirmedAt when planSource throws', async () => {
    const f = await createProjectWithSource(caller, { tag: 'confirm-c', fields: [] });
    try {
      planSourceMock.mockRejectedValue(new Error('planning blew up'));

      await expect(caller.sources.confirm({ sourceId: f.sourceId }))
        .rejects.toThrow('planning blew up');

      const after = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect(after!.confirmedAt).toBeNull();
    } finally {
      await f.cleanup();
    }
  });

  it('throws NOT_FOUND for an unknown sourceId', async () => {
    await expect(
      caller.sources.confirm({ sourceId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects a non-uuid sourceId', async () => {
    try {
      await caller.sources.confirm({ sourceId: 'not-a-uuid' });
      throw new Error('should have thrown');
    } catch (err) {
      expectZodValidationError(err);
    }
  });

  // Task 13: the certification gate — a customer schema Source must be
  // verified before it can be confirmed into a real, paid crawl.
  it('refuses to confirm a customer-schema Source with no current certification', async () => {
    const urls = [
      'https://test-confirm-cert.example.com/p/1',
      'https://test-confirm-cert.example.com/p/2',
      'https://test-confirm-cert.example.com/p/3',
    ];
    const f = await createProjectWithSource(caller, {
      tag: 'confirm-cert',
      urls,
      fields: [{ name: 'Price', type: 'money', description: 'x' }],
      expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
    });
    try {
      await expect(caller.sources.confirm({ sourceId: f.sourceId }))
        .rejects.toThrow(/Verify the schema before extracting/);
      expect(planSourceMock).not.toHaveBeenCalled();

      const after = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect(after!.confirmedAt).toBeNull();
    } finally {
      await f.cleanup();
    }
  });
});

describe('sources.delete', () => {
  it('deletes an UNCONFIRMED Source and its own InputSet', async () => {
    const urls = [
      'https://test-qc-delete.example.com/p/1',
      'https://test-qc-delete.example.com/p/2',
      'https://test-qc-delete.example.com/p/3',
    ];
    const f = await createProjectWithSource(caller, {
      tag: 'qc-delete',
      urls,
      fields: [{ name: 'Price', type: 'money' }],
      expected: { Price: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' } },
    });
    try {
      const inputSetId = (await db.query.sources.findFirst({
        where: eq(sources.id, f.sourceId),
        columns: { inputSetId: true },
      }))!.inputSetId!;

      const result = await caller.sources.delete({ sourceId: f.sourceId });
      expect(result).toEqual({ deleted: true });

      const source = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect(source).toBeUndefined();
      const inputSet = await db.query.inputSets.findFirst({ where: eq(inputSets.id, inputSetId) });
      expect(inputSet).toBeUndefined();
    } finally {
      await f.cleanup();
    }
  });

  it('refuses to delete a CONFIRMED Source (ruling R5) — throws PRECONDITION_FAILED and leaves it in place', async () => {
    const f = await createProjectWithSource(caller, { tag: 'qc-delete-confirmed', fields: [] });
    try {
      planSourceMock.mockResolvedValue({
        runId: '33333333-3333-3333-3333-333333333333',
        status: 'planned', itemCount: 1, listingPages: 0,
        warnings: [], errors: [], inputs: [], cacheWarm: false,
      });
      await caller.sources.confirm({ sourceId: f.sourceId });

      await expect(
        caller.sources.delete({ sourceId: f.sourceId }),
      ).rejects.toThrow(/confirmed sources cannot be deleted/i);

      const source = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect(source).toBeDefined();
      expect(source!.confirmedAt).toBeInstanceOf(Date);
    } finally {
      await f.cleanup();
    }
  });

  it('throws NOT_FOUND for an unknown sourceId', async () => {
    await expect(
      caller.sources.delete({ sourceId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects a non-uuid sourceId', async () => {
    try {
      await caller.sources.delete({ sourceId: 'not-a-uuid' });
      throw new Error('should have thrown');
    } catch (err) {
      expectZodValidationError(err);
    }
  });
});

describe('appRouter shape', () => {
  it('exposes confirm/delete on sources', () => {
    expect(typeof caller.sources.confirm).toBe('function');
    expect(typeof caller.sources.delete).toBe('function');
  });
});
