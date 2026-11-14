import { describe, expect, it } from 'vitest';
import { availableMemoryMb, parseVmStat } from './free-memory.js';

// The shape of a real `vm_stat` on an 18 GB Mac where os.freemem() read 102 MB (2026-11-11).
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     4403.
Pages active:                                 179409.
Pages inactive:                               175947.
Pages speculative:                              2589.
Pages throttled:                                   0.
Pages wired down:                             278136.
Pages purgeable:                                   2.
`;

describe('free memory', () => {
  it('counts free, inactive and speculative pages on macOS', () => {
    expect(Math.round(parseVmStat(VM_STAT)!)).toBe(Math.round(((4403 + 175947 + 2589) * 16384) / 1_048_576));
  });

  it('answers null for output it cannot read', () => {
    expect(parseVmStat('')).toBeNull();
    expect(parseVmStat('Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 10.\n')).toBeNull();
  });

  it('reads a positive number on this machine', () => {
    expect(availableMemoryMb()).toBeGreaterThan(0);
  });
});
