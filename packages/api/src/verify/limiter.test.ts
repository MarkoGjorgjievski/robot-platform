import { describe, it, expect } from 'vitest';
import { createLimiter } from './limiter.js';

describe('createLimiter', () => {
  it('never runs more than max jobs at once, and runs them all', async () => {
    const limit = createLimiter(3);
    let running = 0, peak = 0;
    const job = () => limit(async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 10)); running--; return 1; });
    const out = await Promise.all(Array.from({ length: 7 }, job));
    expect(out).toHaveLength(7);
    expect(peak).toBe(3);
  });
  it('frees a slot when a job throws', async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => { throw new Error('x'); })).rejects.toThrow('x');
    await expect(limit(async () => 2)).resolves.toBe(2);
  });
});
