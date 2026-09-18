import { describe, it, expect } from 'vitest';
import { computeTileClips, TILE_HEIGHT, MAX_TILES } from './screenshot-tiles.js';

describe('computeTileClips', () => {
  it('returns one clip for a short page', () => {
    expect(computeTileClips(500)).toEqual([{ x: 0, y: 0, width: 1280, height: 500 }]);
  });
  it('splits a tall page into legible tiles, last clipped to remaining height', () => {
    expect(computeTileClips(1600)).toEqual([
      { x: 0, y: 0, width: 1280, height: TILE_HEIGHT },
      { x: 0, y: TILE_HEIGHT, width: 1280, height: 1600 - TILE_HEIGHT },
    ]);
  });
  it('caps at MAX_TILES even for very tall pages', () => {
    const clips = computeTileClips(100000);
    expect(clips.length).toBe(MAX_TILES);
    expect(clips[0].y).toBe(0);
    expect(clips[MAX_TILES - 1].y).toBe((MAX_TILES - 1) * TILE_HEIGHT);
    expect(clips.every(c => c.height === TILE_HEIGHT)).toBe(true);
  });
  it('handles zero/negative height as a single minimal tile', () => {
    expect(computeTileClips(0)).toEqual([{ x: 0, y: 0, width: 1280, height: 1 }]);
  });
  it('takes a caller-chosen tile cap', () => {
    expect(computeTileClips(TILE_HEIGHT * 10, 6)).toHaveLength(6);
    expect(computeTileClips(TILE_HEIGHT * 2, 6)).toHaveLength(2);
    expect(computeTileClips(TILE_HEIGHT * 10)).toHaveLength(MAX_TILES);
  });
});
