// The monthly AI limit at the call (spec 2026-10-24 metering §2.3): calls × the estimate against what was left, before
// the call is made; an org's open jobs in one process share what is left (§3.1).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapReachedError, capLedgerOf, cappedAgent, isCapReached, resetCapLedgers } from './capped-agent.js';

afterEach(() => resetCapLedgers());
const fake = () => ({ proposePaths: vi.fn(async (_text: string) => [] as unknown[]) });

describe('cappedAgent (spec §2.3)', () => {
  it('lets calls through while calls × the estimate fits what is left, and refuses the one that would pass it', async () => {
    const inner = fake();
    const capped = cappedAgent(inner, { remainingUsd: 0.36, perCallUsd: 0.18 });
    await capped.proposePaths('a');
    await capped.proposePaths('b');
    await expect(capped.proposePaths('c')).rejects.toBeInstanceOf(CapReachedError);
    expect(inner.proposePaths).toHaveBeenCalledTimes(2);
    expect(capLedgerOf(capped)).toMatchObject({ calls: 2, refused: 1, projectedUsd: 0.36 });
  });

  it('at the edge, in cents: three $0.05 calls fit $0.15, the fourth does not', async () => {
    const capped = cappedAgent(fake(), { remainingUsd: 0.15, perCallUsd: 0.05 });
    for (const t of ['1', '2', '3']) await capped.proposePaths(t);
    await expect(capped.proposePaths('4')).rejects.toBeInstanceOf(CapReachedError);
  });

  it('nothing left: no call is made at all; no limit: every call goes through and is counted', async () => {
    const none = fake();
    await expect(cappedAgent(none, { remainingUsd: 0, perCallUsd: 0.18 }).proposePaths('x')).rejects.toBeInstanceOf(CapReachedError);
    expect(none.proposePaths).not.toHaveBeenCalled();
    const free = cappedAgent(fake(), { remainingUsd: null, perCallUsd: 0.18 });
    for (let i = 0; i < 10; i++) await free.proposePaths(String(i));
    expect(capLedgerOf(free)).toMatchObject({ calls: 10, refused: 0 });
  });

  it('a method that calls another is two calls', async () => {
    class Fake {
      async locateResults() { return 'landmark'; }
      async generateSelectors() { await this.locateResults(); return 'plan'; }
    }
    const capped = cappedAgent(new Fake(), { remainingUsd: 0.1, perCallUsd: 0.05 });
    expect(await capped.generateSelectors()).toBe('plan');
    expect(capLedgerOf(capped)!.calls).toBe(2);
    await expect(capped.locateResults()).rejects.toBeInstanceOf(CapReachedError);
  });

  it('a refusal is a rejected promise, so `.catch` sees it; reserve() counts a call made outside the agent', async () => {
    const capped = cappedAgent(fake(), { remainingUsd: 0.18, perCallUsd: 0.18 });
    capLedgerOf(capped)!.reserve();
    const err = await capped.proposePaths('x').catch((e: unknown) => e);
    expect(isCapReached(err)).toBe(true);
    expect(() => capLedgerOf(capped)!.reserve()).toThrow(CapReachedError);
    expect(capLedgerOf(capped)).toMatchObject({ calls: 1, refused: 2 });
  });

  it('isCapReached knows the error by its name too', () => {
    const copy = new Error('x');
    copy.name = 'CapReachedError';
    expect(isCapReached(copy)).toBe(true);
    expect(isCapReached(new Error('x'))).toBe(false);
    expect(isCapReached('CapReachedError')).toBe(false);
  });
});

describe('RF1: two jobs of one org share what is left', () => {
  it('RF1: two jobs started on the same remainder spend it once between them; another org is apart', async () => {
    const opts = { remainingUsd: 0.36, perCallUsd: 0.18 };
    const a = cappedAgent(fake(), { ...opts, orgId: 'org-1' });
    const b = cappedAgent(fake(), { ...opts, orgId: 'org-1' });
    const other = cappedAgent(fake(), { ...opts, orgId: 'org-2' });
    await a.proposePaths('1');
    await b.proposePaths('1');
    await expect(a.proposePaths('2')).rejects.toBeInstanceOf(CapReachedError);
    await expect(b.proposePaths('2')).rejects.toBeInstanceOf(CapReachedError);
    await other.proposePaths('1');
    await other.proposePaths('2');
  });

  it('RF1: a job closed before another started is in that job’s remainder; one that closes later still counts', async () => {
    const a = cappedAgent(fake(), { remainingUsd: 0.54, perCallUsd: 0.18, orgId: 'org-1' });
    await a.proposePaths('1');
    // b starts while a's call is not yet recorded: b's remainder (read from the database) does not include it.
    const b = cappedAgent(fake(), { remainingUsd: 0.54, perCallUsd: 0.18, orgId: 'org-1' });
    capLedgerOf(a)!.close(); // a records its cost after b started: it still counts against b
    await b.proposePaths('1');
    await b.proposePaths('2');
    await expect(b.proposePaths('3')).rejects.toBeInstanceOf(CapReachedError);
    capLedgerOf(b)!.close();
    // c starts after both recorded: the database says nothing is left, and closed jobs are not counted twice.
    await expect(cappedAgent(fake(), { remainingUsd: 0, perCallUsd: 0.18, orgId: 'org-1' }).proposePaths('1')).rejects.toBeInstanceOf(CapReachedError);
    await cappedAgent(fake(), { remainingUsd: 0.18, perCallUsd: 0.18, orgId: 'org-1' }).proposePaths('1');
  });
});
