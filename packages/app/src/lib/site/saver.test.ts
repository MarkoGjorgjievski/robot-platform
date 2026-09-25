import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSaver } from './saver';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createSaver', () => {
  it('waits for a quiet moment and saves only the latest value', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const s = createSaver<number>({ delay: 600, save });
    s.push(1); s.push(2); s.push(3);
    await vi.advanceTimersByTimeAsync(599);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(3);
  });
  it('never runs two saves at once, and saves what arrived meanwhile after the first lands', async () => {
    let release!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => { release = r; })).mockResolvedValue(undefined);
    const s = createSaver<number>({ delay: 10, save });
    s.push(1);
    await vi.advanceTimersByTimeAsync(10);
    s.push(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(save).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenLastCalledWith(2);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('flush saves now and resolves when it has landed; an error is reported and the next push retries', async () => {
    const states: string[] = [];
    const save = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined);
    const s = createSaver<number>({ delay: 600, save, onState: (x) => states.push(x) });
    s.push(1);
    await s.flush().catch(() => {});
    expect(states).toContain('error');
    s.push(2);
    await s.flush();
    expect(save).toHaveBeenLastCalledWith(2);
    expect(states.at(-1)).toBe('idle');
  });
  // Fix round 1: a failed autosave (fired by the timer, not by flush) must not
  // lose the value — the next flush() retries it with the same value and
  // resolves once the retry lands.
  it('an autosave that fails is retried by the next flush, which resolves once the retry lands', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined);
    const s = createSaver<number>({ delay: 10, save });
    s.push(1);
    await vi.advanceTimersByTimeAsync(10); // the scheduled autosave fires and fails
    expect(save).toHaveBeenCalledTimes(1);
    await s.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(1);
  });
  // Fix round 1: flush() called while a save is already in flight must reject
  // when that save fails — not swallow the error and resolve.
  it('flush rejects when the save already in flight, that it is waiting on, fails', async () => {
    let reject!: (e: Error) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((_, rej) => { reject = rej; }));
    const s = createSaver<number>({ delay: 10, save });
    s.push(1);
    await vi.advanceTimersByTimeAsync(10); // save(1) is now in flight
    const p = s.flush();
    reject(new Error('down'));
    await expect(p).rejects.toThrow('down');
  });
  // Fix round 1 (minor, folded in): two flush() calls during one in-flight
  // save both resolve only once that save actually lands, not one early.
  it('two concurrent flushes both resolve only after the save lands', async () => {
    let release!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => { release = r; })).mockResolvedValue(undefined);
    const s = createSaver<number>({ delay: 10, save });
    s.push(1);
    const p1 = s.flush();
    const p2 = s.flush();
    let settled = false;
    void Promise.allSettled([p1, p2]).then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    release();
    await p1;
    await p2;
    expect(save).toHaveBeenCalledTimes(1);
  });
});
