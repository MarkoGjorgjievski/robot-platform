import { describe, it, expect } from 'vitest';
import { parsePathProposals } from './propose-paths.js';

describe('parsePathProposals', () => {
  it('keeps well-formed proposals, defaults transform to identity, drops junk', () => {
    expect(parsePathProposals({ proposals: [
      { source: 'api', path: 'item.price' },
      { source: 'xpath', path: '//span[@class="now"]', transform: 'cents_to_units' },
      { source: 'magic', path: 'x' },
      { source: 'api' },
    ] })).toEqual([
      { source: 'api', path: 'item.price', transform: 'identity' },
      { source: 'xpath', path: '//span[@class="now"]', transform: 'cents_to_units' },
    ]);
  });
  it('returns [] for an empty or malformed envelope', () => {
    expect(parsePathProposals({})).toEqual([]);
    expect(parsePathProposals(null)).toEqual([]);
  });
});
