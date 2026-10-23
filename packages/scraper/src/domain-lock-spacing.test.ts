// Politeness, start to start (spec 2026-10-23 run speed §3.6): one page at a time per host, page starts at least
// 2 s apart — a page that took longer than 2 s is followed at once.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { acquireDomainLock, _setClockForTests, _resetBackoffForTests } from './domain-lock.js';

let t = 1_000_000;
const waits: number[] = [];
_setClockForTests(() => t, async (ms) => { waits.push(ms); t += ms; });
afterAll(() => { _setClockForTests(() => Date.now(), (ms) => new Promise<void>((r) => setTimeout(r, ms))); });
beforeEach(() => { _resetBackoffForTests(); waits.length = 0; });

describe('acquireDomainLock — spacing from start to start', () => {
  it('a page that took longer than 2 s is followed at once', async () => {
    const first = await acquireDomainLock('spacing-a.example');
    t += 5000;
    first();
    (await acquireDomainLock('spacing-a.example'))();
    expect(waits).toEqual([]);
  });

  it('a fast page is followed 2 s after it started', async () => {
    const first = await acquireDomainLock('spacing-b.example');
    t += 500;
    first();
    (await acquireDomainLock('spacing-b.example'))();
    expect(waits).toEqual([1500]);
  });

  it('spacing is per host', async () => {
    (await acquireDomainLock('spacing-c.example'))();
    (await acquireDomainLock('spacing-d.example'))();
    expect(waits).toEqual([]);
  });
});
