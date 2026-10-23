import { describe, it, expect, vi } from 'vitest';
import type { IBrowser } from '@robot/browser';
import { createBrowserGate } from './browser-gate.js';
import { runInJob, type JobContext } from './context.js';

const ctx = (jobId: string, lane: JobContext['lane']): JobContext => ({ jobId, type: 't', lane, attempt: 1, signal: new AbortController().signal, progress: () => {} });
const fake = () => ({ close: vi.fn(async () => {}) }) as unknown as IBrowser;
const tick = () => new Promise((r) => setTimeout(r, 10));

describe('createBrowserGate', () => {
  it('never more than max at once; a waiting interactive job goes before a waiting run', async () => {
    const gate = createBrowserGate({ max: 1 });
    const releaseFirst = await runInJob(ctx('a', 'background'), () => gate.acquire());
    const order: string[] = [];
    const run = runInJob(ctx('r', 'runs'), async () => { const rel = await gate.acquire(); order.push('run'); rel(); });
    const inter = runInJob(ctx('i', 'interactive'), async () => { const rel = await gate.acquire(); order.push('interactive'); rel(); });
    await tick();
    expect(order).toEqual([]);
    releaseFirst();
    await Promise.all([run, inter]);
    expect(order).toEqual(['interactive', 'run']);
  });

  it('waits for free memory, but not forever', async () => {
    let free = 100;
    const gate = createBrowserGate({ max: 2, minFreeMb: 500, freeMb: () => free, memoryWaitMs: 1000, pollMs: 10 });
    let got = false;
    const p = gate.acquire().then((rel) => { got = true; return rel; });
    await tick();
    expect(got).toBe(false);
    free = 900;
    (await p)();
    expect(got).toBe(true);
    free = 100;
    const t0 = Date.now();
    (await gate.acquire())();               // gives up waiting after memoryWaitMs and launches anyway
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  });

  it('closes one job\'s browsers, or all of them', async () => {
    const gate = createBrowserGate({ max: 3 });
    const a = fake(); const b = fake(); const c = fake();
    await runInJob(ctx('j1', 'background'), async () => { gate.track(a); gate.track(b); });
    await runInJob(ctx('j2', 'background'), async () => { gate.track(c); });
    expect(gate.open()).toBe(3);
    await gate.closeJob('j1');
    expect(a.close).toHaveBeenCalled(); expect(b.close).toHaveBeenCalled(); expect(c.close).not.toHaveBeenCalled();
    await gate.closeAll();
    expect(c.close).toHaveBeenCalled();
    expect(gate.open()).toBe(0);
  });

  it('an aborted job waiting for a browser gets none', async () => {
    const gate = createBrowserGate({ max: 1 });
    const hold = await gate.acquire();
    const controller = new AbortController();
    const waiting = runInJob({ ...ctx('x', 'background'), signal: controller.signal }, () => gate.acquire());
    controller.abort('stuck');
    hold();
    await expect(waiting).rejects.toThrow(/stopped/);
  });
});

describe('createBrowserGate — stopped or failing jobs give their place back', () => {
  it('a job stopped while waiting for free memory gets no browser, and frees its slot', async () => {
    let free = 100;
    const gate = createBrowserGate({ max: 1, minFreeMb: 500, freeMb: () => free, memoryWaitMs: 5000, pollMs: 10 });
    const controller = new AbortController();
    const waiting = runInJob({ ...ctx('m', 'background'), signal: controller.signal }, () => gate.acquire());
    await tick();
    controller.abort('stuck');
    await expect(waiting).rejects.toThrow(/stopped/);
    free = 900;
    const t0 = Date.now();
    (await gate.acquire())(); // the one slot is free again
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
