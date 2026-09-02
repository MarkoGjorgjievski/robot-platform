// The per-domain lock's waiters used to `if (existing) await existing.promise`
// once: a single release woke every waiter queued on that promise and ALL of
// them proceeded into their own critical section at once (cache-reputation
// fixes W4, 2026-09-02). The acquire path must re-check after every wake and
// claim the lock synchronously with the emptiness check — any await between
// "no lock" and "set" reopens the race.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { acquireDomainLock } from './domain-lock.js';

describe('acquireDomainLock — one waiter per release', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('two waiters woken by the same release acquire one at a time', async () => {
    vi.useFakeTimers();
    const domain = 'lock-race.example';

    const releaseFirst = await acquireDomainLock(domain);

    const acquired: string[] = [];
    const waiterB = acquireDomainLock(domain).then((release) => {
      acquired.push('B');
      return release;
    });
    const waiterC = acquireDomainLock(domain).then((release) => {
      acquired.push('C');
      return release;
    });

    releaseFirst();
    // Enough fake time for the politeness delay; both waiters were woken by
    // the same release, so before the fix both landed here.
    await vi.advanceTimersByTimeAsync(5000);
    expect(acquired).toHaveLength(1);

    const releaseSecond = await (acquired[0] === 'B' ? waiterB : waiterC);
    releaseSecond();
    await vi.advanceTimersByTimeAsync(5000);
    expect(acquired).toHaveLength(2);

    const releaseThird = await (acquired[0] === 'B' ? waiterC : waiterB);
    releaseThird();
  });
});
