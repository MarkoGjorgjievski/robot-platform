// Spec 2026-10-24 §3.2: the worker's timer — off sets none; on sweeps 10 s after start, then every 60 s, never two at once.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { startRecurringRuns } from './sweep.js';

afterEach(() => { vi.useRealTimers(); });

describe('startRecurringRuns', () => {
  it('off: no timer, no sweep', () => {
    vi.useFakeTimers();
    const sweep = vi.fn(async () => []);
    const stop = startRecurringRuns({ enabled: false, sweep });
    vi.advanceTimersByTime(10 * 60_000);
    expect(sweep).not.toHaveBeenCalled();
    stop();
  });
  it('on: a first sweep after 10 s, then one a minute, never two at once; stop ends it', async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    const sweep = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const stop = startRecurringRuns({ enabled: true, sweep });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(sweep).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(1); // the first is still running
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(2);
    stop();
    release();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(sweep).toHaveBeenCalledTimes(2);
  });
  it('a sweep that throws is logged and the next one still runs', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sweep = vi.fn(async () => { throw new Error('db down'); });
    const stop = startRecurringRuns({ enabled: true, sweep, firstDelayMs: 10, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(220);
    expect(sweep.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(errors).toHaveBeenCalled();
    stop();
    errors.mockRestore();
  });
});
