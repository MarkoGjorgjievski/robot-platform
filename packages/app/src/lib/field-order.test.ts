import { describe, expect, it } from 'vitest';
import { moveKey, orderedFields } from './field-order';

describe('moveKey', () => {
  it('moves a key up, down, to either end, and clamps past the ends', () => {
    expect(moveKey(['a', 'b', 'c', 'd'], 'c', 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveKey(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveKey(['a', 'b', 'c', 'd'], 'b', 3)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveKey(['a', 'b'], 'a', 9)).toEqual(['b', 'a']);
    expect(moveKey(['a', 'b'], 'b', -1)).toEqual(['b', 'a']);
    expect(moveKey(['a', 'b'], 'x', 0)).toEqual(['a', 'b']);
  });
});

describe('orderedFields', () => {
  const f = (key: string) => ({ key });
  it('follows the arranged order; the server order when none', () => {
    expect(orderedFields([f('a'), f('b'), f('c')], ['c', 'a', 'b']).map((x) => x.key)).toEqual(['c', 'a', 'b']);
    expect(orderedFields([f('a'), f('b')], null).map((x) => x.key)).toEqual(['a', 'b']);
  });
  it('a field added meanwhile goes last; one deleted meanwhile is dropped', () => {
    expect(orderedFields([f('a'), f('b'), f('new')], ['b', 'gone', 'a']).map((x) => x.key)).toEqual(['b', 'a', 'new']);
  });
});
