// Geometry for the detail bar's screenshot crop (spec 2026-10-07 §4): where
// to put the tile stack, at what scale, so the field's element sits in the
// middle of a fixed-size window without the window ever showing past the
// page's edges. Rects are page pixels, as the capture's box map gives them.

export type Rect = { x: number; y: number; w: number; h: number };
export type CropFrame = { scale: number; left: number; top: number };

export const CROP_W = 240;
export const CROP_H = 160;

/** Breathing room around the element when the scale is chosen to fit it. */
const PAD = 48;
const MIN_SCALE = 0.25;
const MAX_SCALE = 1;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export function cropFrame(box: Rect | null, crop: { w: number; h: number }, page: { w: number; h: number }): CropFrame {
  if (page.w <= 0) return { scale: 0, left: 0, top: 0 };
  if (!box) return { scale: crop.w / page.w, left: 0, top: 0 };

  const scale = clamp(crop.w / (box.w + PAD), MIN_SCALE, MAX_SCALE);
  const cx = (box.x + box.w / 2) * scale;
  const cy = (box.y + box.h / 2) * scale;
  // Centre the element, then keep the window inside the scaled page: the
  // offset can go no further left/up than "right/bottom edge meets the
  // window's", and never past 0 (which would show blank space on the left/top).
  const minLeft = Math.min(0, crop.w - page.w * scale);
  const minTop = Math.min(0, crop.h - page.h * scale);
  return {
    scale,
    left: clamp(crop.w / 2 - cx, minLeft, 0),
    top: clamp(crop.h / 2 - cy, minTop, 0),
  };
}
