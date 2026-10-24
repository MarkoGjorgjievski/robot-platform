// packages/agent/src/capped-agent.ts
// An organisation's monthly AI limit, at the call (spec 2026-10-24 metering §2.3). `cappedAgent` wraps an agent: before
// each method call — every method of an agent here is a model call — it projects this job's calls × a per-call
// estimate, plus what the org's other jobs in this process projected that this job's remainder could not see, and
// refuses the call (CapReachedError) when that would pass what was left when the job started. Projections, never the
// process-wide usage counter (usage.ts): that counter is shared by every job in flight.
//
// One process only: several worker processes do not see each other's open jobs (spec §3.1 holds per process).

export class CapReachedError extends Error {
  constructor(message = "This organisation's monthly limit is reached.") {
    super(message);
    this.name = 'CapReachedError';
  }
}

export function isCapReached(err: unknown): boolean {
  return err instanceof CapReachedError || (err instanceof Error && err.name === 'CapReachedError');
}

export type CapOptions = {
  /** What was left of the month's limit when the job started; null = no limit (counted, never refused). */
  remainingUsd: number | null;
  /** What one call is projected at. */
  perCallUsd: number;
  /** The org the job works for: its open jobs in this process share the remainder (spec §3.1). */
  orgId?: string | null;
  /** A slot taken with `openCapLedger` before the remainder was read: the agent adopts it (and its org). A sibling job
   *  that records its cost and closes while the remainder is being read is then seen by the read or by the slot. */
  ledger?: CapLedger;
};

export type CapLedger = {
  readonly calls: number;
  readonly refused: number;
  /** calls × perCallUsd */
  readonly projectedUsd: number;
  /** One more call made outside the agent (catalogue discovery); throws CapReachedError when refused. */
  reserve(): void;
  /** The job's cost is recorded — call it after writing the cost. */
  close(): void;
};

const SCALE = 10_000;
const units = (usd: number) => Math.round(usd * SCALE);

type Entry = { ledger: Ledger; openedAt: number; closedAt: number | null };
let tick = 0;
const byOrg = new Map<string, Entry[]>();

class Ledger implements CapLedger {
  calls = 0;
  refused = 0;
  private readonly entry: Entry | null;
  /** Until an agent adopts a slot, nothing is left: a slot alone never lets a call through. */
  private opts: { remainingUsd: number | null; perCallUsd: number } = { remainingUsd: 0, perCallUsd: 0 };
  private adopted = false;

  constructor(readonly orgId: string | null) {
    this.entry = orgId ? { ledger: this, openedAt: ++tick, closedAt: null } : null;
    if (this.entry) byOrg.set(orgId!, [...(byOrg.get(orgId!) ?? []), this.entry]);
  }

  adopt(opts: { remainingUsd: number | null; perCallUsd: number }): void {
    if (this.adopted) throw new Error('a cap ledger is adopted by one agent once');
    this.adopted = true;
    this.opts = { remainingUsd: opts.remainingUsd, perCallUsd: opts.perCallUsd };
  }

  get projectedUsd(): number {
    return (this.calls * units(this.opts.perCallUsd)) / SCALE;
  }

  /** The org's other jobs this job's remainder did not see: still open, or closed after this one started. */
  private othersUnits(): number {
    if (!this.entry) return 0;
    let sum = 0;
    for (const e of byOrg.get(this.orgId!) ?? []) {
      if (e === this.entry) continue;
      if (e.closedAt === null || e.closedAt > this.entry.openedAt) sum += e.ledger.calls * units(e.ledger.opts.perCallUsd);
    }
    return sum;
  }

  reserve(): void {
    const { remainingUsd, perCallUsd } = this.opts;
    if (remainingUsd !== null) {
      const left = units(remainingUsd);
      const projected = (this.calls + 1) * units(perCallUsd) + this.othersUnits();
      if (left <= 0 || projected > left) {
        this.refused++;
        throw new CapReachedError();
      }
    }
    this.calls++;
  }

  close(): void {
    if (!this.entry || this.entry.closedAt !== null) return;
    this.entry.closedAt = ++tick;
    prune(this.orgId!);
  }
}

/** A closed job is kept only while a job that started before it closed is still open. */
function prune(orgId: string): void {
  const list = byOrg.get(orgId) ?? [];
  // `Math.min()` of nothing is Infinity: with no open job every closed entry goes.
  const oldestOpen = Math.min(...list.filter((e) => e.closedAt === null).map((e) => e.openedAt));
  const kept = list.filter((e) => e.closedAt === null || e.closedAt > oldestOpen);
  if (kept.length > 0) byOrg.set(orgId, kept);
  else byOrg.delete(orgId);
}

const ledgers = new WeakMap<object, CapLedger>();

/**
 * Take an org's slot now, before reading what is left of its limit (metering review I1): a sibling job that records
 * its cost and closes after this moment counts against this job; one that closed before it is in the read. Close it
 * on every exit; an agent adopts it through `cappedAgent(agent, { …, ledger })`.
 */
export function openCapLedger(orgId: string | null | undefined): CapLedger {
  return new Ledger(orgId ?? null);
}

export function cappedAgent<T extends object>(agent: T, opts: CapOptions): T {
  if (opts.ledger && !(opts.ledger instanceof Ledger)) throw new Error('cappedAgent adopts only a ledger from openCapLedger');
  const ledger = (opts.ledger as Ledger | undefined) ?? new Ledger(opts.orgId ?? null);
  ledger.adopt(opts);
  const proxy = new Proxy(agent, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || prop === 'constructor') return value;
      return (...args: unknown[]) => {
        // A rejected promise, never a synchronous throw: `agent.x().catch(…)` must see the refusal.
        try { ledger.reserve(); } catch (err) { return Promise.reject(err); }
        // `this` is the proxy, so a method that calls another (generateSelectors → locateResults) is two calls.
        return (value as (...a: unknown[]) => unknown).apply(receiver, args);
      };
    },
  });
  ledgers.set(proxy, ledger);
  return proxy;
}

export function capLedgerOf(agent: object): CapLedger | undefined {
  return ledgers.get(agent);
}

/** Tests only: how many jobs the registry holds, open or kept closed, across every org. */
export function capJobsOpen(): number {
  let n = 0;
  for (const list of byOrg.values()) n += list.length;
  return n;
}

/** Tests only: forget every open job. */
export function resetCapLedgers(): void {
  byOrg.clear();
  tick = 0;
}
