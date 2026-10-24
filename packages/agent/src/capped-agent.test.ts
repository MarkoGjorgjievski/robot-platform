// The monthly AI limit at the call (spec 2026-10-24 metering §2.3): calls × the estimate against what was left, before
// the call is made; an org's open jobs in one process share what is left (§3.1).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapReachedError, capLedgerOf, cappedAgent, capJobsOpen, isCapReached, openCapLedger, resetCapLedgers } from './capped-agent.js';

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

  it('RF1: a job that takes its slot before reading the database sees a sibling that records and closes during the read', async () => {
    const a = cappedAgent(fake(), { remainingUsd: 0.54, perCallUsd: 0.18, orgId: 'org-1' });
    await a.proposePaths('1');
    const slot = openCapLedger('org-1'); // b takes its slot …
    capLedgerOf(a)!.close();             // … a records its cost and closes while b's read is in flight …
    const b = cappedAgent(fake(), { remainingUsd: 0.54, perCallUsd: 0.18, ledger: slot }); // … so b's remainder is stale
    expect(capLedgerOf(b)).toBe(slot);
    await b.proposePaths('1');
    await b.proposePaths('2');
    await expect(b.proposePaths('3')).rejects.toBeInstanceOf(CapReachedError); // a's call still counts
  });

  it('a slot refuses every call until an agent adopts it, takes the org from the slot, and is adopted once', async () => {
    const slot = openCapLedger('org-1');
    expect(() => slot.reserve()).toThrow(CapReachedError);
    const b = cappedAgent(fake(), { remainingUsd: 0.18, perCallUsd: 0.18, orgId: 'org-2', ledger: slot });
    await b.proposePaths('1');
    // the slot's org (org-1), not the option's: org-1 has nothing left for a second job opened now
    const c = cappedAgent(fake(), { remainingUsd: 0.18, perCallUsd: 0.18, orgId: 'org-1' });
    await expect(c.proposePaths('1')).rejects.toBeInstanceOf(CapReachedError);
    expect(() => cappedAgent(fake(), { remainingUsd: 1, perCallUsd: 0.18, ledger: slot })).toThrow(/once/);
    expect(() => cappedAgent(fake(), { remainingUsd: 1, perCallUsd: 0.18, ledger: { calls: 0, refused: 0, projectedUsd: 0, reserve() {}, close() {} } })).toThrow(/openCapLedger/);
  });

  it('a slot closed without an agent (the read failed) leaves nothing behind', () => {
    openCapLedger('org-9').close();
    expect(capJobsOpen()).toBe(0);
  });

  it('many orgs and jobs leave nothing behind once each job closes; a closed job stays only while an older one is open', async () => {
    const old = cappedAgent(fake(), { remainingUsd: 1, perCallUsd: 0.18, orgId: 'org-0' });
    for (let i = 0; i < 500; i++) {
      const j = cappedAgent(fake(), { remainingUsd: 1, perCallUsd: 0.18, orgId: `org-${i % 50}` });
      await j.proposePaths('x');
      capLedgerOf(j)!.close();
    }
    expect(capJobsOpen()).toBeGreaterThan(1); // org-0's closed jobs are kept: `old` started before they closed
    capLedgerOf(old)!.close();
    capLedgerOf(old)!.close(); // twice is harmless
    expect(capJobsOpen()).toBe(0);
  });
});

describe('final review M7: the free local model is never counted against the limit', () => {
  it('an agent on the free provider makes its calls at nothing left, and its calls are not counted', async () => {
    const inner = { provider: 'ollama' as const, proposePaths: vi.fn(async (_text: string) => [] as unknown[]) };
    const capped = cappedAgent(inner, { remainingUsd: 0, perCallUsd: 0.05, orgId: 'org-free' });
    await capped.proposePaths('a');
    await capped.proposePaths('b');
    expect(inner.proposePaths).toHaveBeenCalledTimes(2);
    expect(capLedgerOf(capped)).toMatchObject({ calls: 0, refused: 0, projectedUsd: 0 });
    // A paid sibling of the same org is not charged for the free job's calls.
    const paid = cappedAgent(fake(), { remainingUsd: 0.05, perCallUsd: 0.05, orgId: 'org-free' });
    await expect(paid.proposePaths('c')).resolves.toEqual([]);
  });

  it('SchemaAgent says which provider it uses: the local one is free, Anthropic is paid', async () => {
    const { SchemaAgent } = await import('./schema-agent.js');
    expect(new SchemaAgent({ provider: 'ollama' }).provider).toBe('ollama');
    expect(new SchemaAgent({ provider: 'anthropic', apiKey: 'test-key' }).provider).toBe('anthropic');
    const local = cappedAgent(new SchemaAgent({ provider: 'ollama' }), { remainingUsd: 0, perCallUsd: 0.05 });
    expect(local.provider).toBe('ollama');
  });
});
