/**
 * Simple in-memory per-domain concurrency lock.
 * Prevents multiple simultaneous browser launches for the same domain.
 *
 * If a capture is already in-flight for a domain, subsequent requests
 * wait for it to complete rather than launching a second browser.
 *
 * It also paces each host: a 2 s politeness gap between requests, and a
 * backoff after the host answers with a challenge or a refusal (see
 * `reportVerdict`).
 */

import { verdictSentence, type CaptureErrorKind, type CaptureVerdict } from '@robot/browser';

type LockEntry = {
  promise: Promise<void>;
  resolve: () => void;
  domain: string;
  startedAt: number;
};

const activeLocks = new Map<string, LockEntry>();

// Minimum delay between requests to the same domain (politeness)
const POLITENESS_DELAY_MS = 2000;
const lastRequestTime = new Map<string, number>();

/**
 * Backoff after a challenge or refusal: the first step, then doubling per
 * further one in a row, capped at BACKOFF_MAX_MS. The first step can be
 * overridden with the ROBOT_BACKOFF_FIRST_MS environment variable (read once,
 * at module load) for an isolated api-server. The route smoke does NOT set it:
 * its wall step asserts the "Waiting 2 min" answer, which a shortened backoff
 * would turn into a real capture of the human check.
 */
export const BACKOFF_FIRST_MS = Number(process.env.ROBOT_BACKOFF_FIRST_MS ?? 120_000);
export const BACKOFF_MAX_MS = Math.max(480_000, BACKOFF_FIRST_MS);

/** Per host: when the backoff ends, how many walls in a row set it, and the last wall's verdict. */
const backoff = new Map<string, { until: number; strikes: number; verdict: CaptureVerdict }>();

// The clock the politeness delay and the backoff share. `Date.now` and
// `setTimeout` are looked up at call time, so vitest's fake timers
// (domain-lock.test.ts) still apply by default.
let now: () => number = () => Date.now();
let sleep: (ms: number) => Promise<void> = (ms) => new Promise<void>((r) => setTimeout(r, ms));

/** Tests only: a fake clock and a fake sleep so backoff tests run instantly. */
export function _setClockForTests(nowFn: () => number, sleepFn: (ms: number) => Promise<void>): void {
  now = nowFn;
  sleep = sleepFn;
}

/** Tests only: forget every host's backoff and last-request time. */
export function _resetBackoffForTests(): void {
  backoff.clear();
  lastRequestTime.clear();
}

/**
 * Feed a capture's verdict back to the host's pacing (spec 2026-10-09 §A3).
 * A challenge or refusal starts or doubles the backoff; an ok clears it; the
 * other kinds (not-found, a crash, a timeout, ...) say nothing about the
 * host's tolerance and change nothing.
 */
export function reportVerdict(
  domain: string,
  verdictOrKind: CaptureVerdict | CaptureVerdict['kind'] | CaptureErrorKind,
  nowFn: () => number = now,
): void {
  const kind = typeof verdictOrKind === 'string' ? verdictOrKind : verdictOrKind.kind;
  if (kind === 'ok') {
    backoff.delete(domain);
    return;
  }
  if (kind !== 'challenge' && kind !== 'refused') return;
  const strikes = (backoff.get(domain)?.strikes ?? 0) + 1;
  const ms = Math.min(BACKOFF_FIRST_MS * 2 ** (strikes - 1), BACKOFF_MAX_MS);
  // A bare kind (no response to read a status from) is kept as a status-0 verdict.
  const verdict: CaptureVerdict = typeof verdictOrKind === 'string' ? { kind, status: 0 } : verdictOrKind;
  backoff.set(domain, { until: nowFn() + ms, strikes, verdict });
  console.log(`[lock] ${domain} ${kind}: backing off ${Math.round(ms / 1000)}s`);
}

/** How long the host's backoff still has to run; 0 when there is none. */
export function backoffRemainingMs(domain: string, nowFn: () => number = now): number {
  const b = backoff.get(domain);
  if (!b) return 0;
  return Math.max(0, b.until - nowFn());
}

/**
 * The wall that put the host in backoff, while the backoff still runs; null
 * when there is none. Interactive paths (the listing finder, a plan, a proof
 * page, reachability) answer from this instead of sleeping inside a request
 * or opening a browser on a host that just walled us (review I4, 2026-10-09).
 */
export function backoffVerdict(domain: string, nowFn: () => number = now): CaptureVerdict | null {
  const b = backoff.get(domain);
  if (!b || b.until - nowFn() <= 0) return null;
  return b.verdict;
}

/**
 * What an interactive path says instead of waiting: the wall's own sentence
 * and how long the wait still is. Null when the host is not backing off.
 */
export function backoffAnswer(url: string, nowFn: () => number = now): { verdict: CaptureVerdict; waitMs: number; message: string } | null {
  let host: string;
  try { host = new URL(url).hostname; } catch { return null; }
  const verdict = backoffVerdict(host, nowFn);
  if (!verdict) return null;
  const waitMs = backoffRemainingMs(host, nowFn);
  return { verdict, waitMs, message: `${verdictSentence(verdict, url)} Waiting ${Math.ceil(waitMs / 60_000)} min before trying again.` };
}

/**
 * Acquire a lock for a domain. If another request is in-flight,
 * this will wait until it completes.
 *
 * Returns a release function that MUST be called when done.
 *
 * `onBackoff: 'skip'` is for callers inside an HTTP request (a plan): when the
 * host is backing off, the lock is handed back at once, without the sleep and
 * with the backoff untouched, so the caller can release it and answer from the
 * backoff instead of napping for up to 8 minutes. The default waits it out.
 */
export async function acquireDomainLock(domain: string, options: { onBackoff?: 'wait' | 'skip' } = {}): Promise<() => void> {
  // Wait for any existing lock on this domain. One release wakes EVERY waiter
  // queued on that promise, so each must re-check on wake — a single `if`
  // let all of them proceed into their critical sections at once.
  for (;;) {
    const existing = activeLocks.get(domain);
    if (!existing) break;
    console.log(`[lock] Waiting for in-flight request to ${domain}...`);
    await existing.promise;
  }

  // Claim synchronously with the emptiness check above: any await between
  // "no lock" and this `set` reopens the race for the other woken waiters.
  let resolve: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  const entry: LockEntry = { promise, resolve: resolve!, domain, startedAt: now() };
  activeLocks.set(domain, entry);

  const release = () => {
    lastRequestTime.set(domain, now());
    activeLocks.delete(domain);
    entry.resolve();
  };

  // Backoff — the host recently challenged or refused us. Wait it out (never
  // fail), under the lock so whoever is queued behind waits too.
  const backoffWait = backoffRemainingMs(domain);
  if (backoffWait > 0) {
    if (options.onBackoff === 'skip') return release;
    console.log(`[lock] Backoff: waiting ${Math.round(backoffWait / 1000)}s before hitting ${domain}`);
    await sleep(backoffWait);
    // The wait is the penalty; the next verdict decides whether it grows
    // (the strikes are kept) or clears.
    const b = backoff.get(domain);
    if (b) backoff.set(domain, { ...b, until: now() });
  }

  // Politeness delay — don't hammer the same domain. Under the lock, so the
  // spacing also holds back whoever is queued behind this request.
  const lastTime = lastRequestTime.get(domain);
  if (lastTime) {
    const elapsed = now() - lastTime;
    if (elapsed < POLITENESS_DELAY_MS) {
      const wait = POLITENESS_DELAY_MS - elapsed;
      console.log(`[lock] Politeness delay: waiting ${wait}ms before hitting ${domain}`);
      await sleep(wait);
    }
  }

  return release;
}

/**
 * Check if a domain currently has an active lock.
 */
export function isDomainLocked(domain: string): boolean {
  return activeLocks.has(domain);
}

/**
 * Get all currently locked domains (for monitoring).
 */
export function getActiveLocks(): Array<{ domain: string; durationMs: number }> {
  const at = now();
  return [...activeLocks.values()].map(l => ({
    domain: l.domain,
    durationMs: at - l.startedAt,
  }));
}
