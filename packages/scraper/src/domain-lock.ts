/**
 * Simple in-memory per-domain concurrency lock.
 * Prevents multiple simultaneous browser launches for the same domain.
 *
 * If a capture is already in-flight for a domain, subsequent requests
 * wait for it to complete rather than launching a second browser.
 */

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
 * Acquire a lock for a domain. If another request is in-flight,
 * this will wait until it completes.
 *
 * Returns a release function that MUST be called when done.
 */
export async function acquireDomainLock(domain: string): Promise<() => void> {
  // Wait for any existing lock on this domain
  const existing = activeLocks.get(domain);
  if (existing) {
    console.log(`[lock] Waiting for in-flight request to ${domain}...`);
    await existing.promise;
  }

  // Politeness delay — don't hammer the same domain
  const lastTime = lastRequestTime.get(domain);
  if (lastTime) {
    const elapsed = Date.now() - lastTime;
    if (elapsed < POLITENESS_DELAY_MS) {
      const wait = POLITENESS_DELAY_MS - elapsed;
      console.log(`[lock] Politeness delay: waiting ${wait}ms before hitting ${domain}`);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  // Create new lock
  let resolve: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  const entry: LockEntry = { promise, resolve: resolve!, domain, startedAt: Date.now() };
  activeLocks.set(domain, entry);

  // Return release function
  return () => {
    lastRequestTime.set(domain, Date.now());
    activeLocks.delete(domain);
    entry.resolve();
  };
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
  const now = Date.now();
  return [...activeLocks.values()].map(l => ({
    domain: l.domain,
    durationMs: now - l.startedAt,
  }));
}
