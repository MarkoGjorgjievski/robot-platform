import { describe, expect, test } from 'vitest';
import { CROP_H, CROP_W, cropFrame } from './screenshot-crop-view';

const crop = { w: CROP_W, h: CROP_H };
const page = { w: 1280, h: 4000 };

describe('cropFrame', () => {
  test('a page with no measured width draws nothing', () => {
    expect(cropFrame({ x: 10, y: 10, w: 50, h: 20 }, crop, { w: 0, h: 0 })).toEqual({ scale: 0, left: 0, top: 0 });
  });

  test('no box: the top of the page, fitted to the crop width', () => {
    expect(cropFrame(null, crop, page)).toEqual({ scale: CROP_W / 1280, left: 0, top: 0 });
  });

  test('a small box in the middle of a long page is centred at scale 1', () => {
    const box = { x: 600, y: 2000, w: 100, h: 20 };
    const f = cropFrame(box, crop, page);
    expect(f.scale).toBe(1);
    // The box centre (650, 2010) lands on the crop centre (120, 80).
    expect(f.left).toBe(-(650 - CROP_W / 2));
    expect(f.top).toBe(-(2010 - CROP_H / 2));
  });

  test('the scale shrinks for a wide box and never below 0.25', () => {
    expect(cropFrame({ x: 100, y: 100, w: 432, h: 40 }, crop, page).scale).toBeCloseTo(CROP_W / 480, 6);
    expect(cropFrame({ x: 0, y: 100, w: 5000, h: 40 }, crop, page).scale).toBe(0.25);
  });

  test('a box at the top-left corner is clamped so the page edge meets the crop edge', () => {
    const f = cropFrame({ x: 5, y: 5, w: 40, h: 10 }, crop, page);
    expect(f.left).toBe(0);
    expect(f.top).toBe(0);
  });

  test('a box at the bottom-right corner is clamped so no blank space shows past the page', () => {
    const f = cropFrame({ x: 1230, y: 3980, w: 40, h: 10 }, crop, page);
    expect(f.scale).toBe(1);
    expect(f.left).toBe(CROP_W - 1280);
    expect(f.top).toBe(CROP_H - 4000);
  });

  test('a box below the captured height (page cut) clamps to the bottom of what was captured', () => {
    const f = cropFrame({ x: 600, y: 5000, w: 100, h: 20 }, crop, { w: 1280, h: 4000 });
    expect(f.top).toBe(CROP_H - 4000);
  });

  test('a page shorter than the crop is pinned to the top', () => {
    const f = cropFrame({ x: 600, y: 50, w: 100, h: 20 }, crop, { w: 1280, h: 100 });
    expect(f.top).toBe(0);
  });
});
