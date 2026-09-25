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
});
