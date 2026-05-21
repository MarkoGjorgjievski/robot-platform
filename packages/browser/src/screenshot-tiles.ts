export const TILE_WIDTH = 1280;
// Under Claude's ~1568px long-edge downscale threshold, so tiles stay sharp.
export const TILE_HEIGHT = 1536;
// Cap total tiles to bound capture work and worst-case AI image cost (~4608px coverage).
export const MAX_TILES = 3;

export type TileClip = { x: number; y: number; width: number; height: number };

/** Slice a page of the given pixel height into legible, non-overlapping vertical tiles. */
export function computeTileClips(pageHeight: number): TileClip[] {
  const h = Math.max(1, Math.floor(pageHeight) || 1);
  const clips: TileClip[] = [];
  for (let i = 0; i < MAX_TILES; i++) {
    const y = i * TILE_HEIGHT;
    if (y >= h) break;
    clips.push({ x: 0, y, width: TILE_WIDTH, height: Math.min(TILE_HEIGHT, h - y) });
  }
  return clips;
}
