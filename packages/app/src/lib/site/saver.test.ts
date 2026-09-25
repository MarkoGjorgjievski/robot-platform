import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSaver, saveErrorReason } from './saver';

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
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((_, rej) => { reject = rej; })).mockResolvedValue(undefined);
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
  // Fix round 2 (Important): the earlier fix scheduled its own retry on every
  // failure, which against a down server saves every `delay` ms forever with
  // no user action. A failure must sit still; only a later push or flush
  // tries again.
  it('a save that keeps failing is never retried on its own; a later push tries again', async () => {
    const save = vi.fn().mockRejectedValue(new Error('down'));
    const s = createSaver<number>({ delay: 10, save });
    s.push(1);
    await vi.advanceTimersByTimeAsync(10); // the scheduled autosave fires and fails
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000); // however long we wait, nothing retries on its own
    expect(save).toHaveBeenCalledTimes(1);
    s.push(2);
    await vi.advanceTimersByTimeAsync(10);
    expect(save).toHaveBeenCalledTimes(2); // the next push is what tries again
    expect(save).toHaveBeenLastCalledWith(2);
  });
  // Fix round 2 (Important): a save already in flight when `dispose()` runs
  // must not bring an unmounted saver back to life if it goes on to fail —
  // no restored value, no schedule, no further `onState`.
  it('dispose stops autosave; a save already in flight that then fails reports nothing and schedules nothing', async () => {
    let reject!: (e: Error) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((_, rej) => { reject = rej; })).mockResolvedValue(undefined);
    const states: string[] = [];
    const s = createSaver<number>({ delay: 10, save, onState: (x) => states.push(x) });
    s.push(1);
    await vi.advanceTimersByTimeAsync(10); // save(1) is now in flight
    s.dispose();
    const before = states.length;
    reject(new Error('down'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(states.slice(before)).toEqual([]);
  });
});

describe('saveErrorReason (final review R1)', () => {
  it('keeps the first line of the server’s refusal', () => {
    expect(saveErrorReason(new Error('All URLs must be on the same website\nPrice @ https://s.example/p/1: Not a money amount'))).toBe('All URLs must be on the same website');
  });
  it('reads the first message out of a validation error’s JSON', () => {
    const zod = JSON.stringify([{ code: 'too_small', message: 'Array must contain at least 3 element(s)', path: ['urls'] }], null, 2);
    expect(saveErrorReason(new Error(zod))).toBe('Array must contain at least 3 element(s)');
  });
  it('says something when there is nothing to read', () => {
    expect(saveErrorReason(new Error(''))).toBe('the server did not say why');
    expect(saveErrorReason('boom')).toBe('boom');
    expect(saveErrorReason(new Error('   \n  second'))).toBe('second');
  });
});
