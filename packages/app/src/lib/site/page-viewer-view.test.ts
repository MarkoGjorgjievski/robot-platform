import { describe, it, expect } from 'vitest';
import { boxAt, enclosing, toPage, targetAt } from './page-viewer-view';
import type { Box } from './verification-model';

const b = (x: number, y: number, w: number, h: number): Box => ({ xpaths: ['//x'], text: 't', rect: { x, y, w, h }, tag: 'div', kind: 'text' });
const boxes = [b(0, 0, 1000, 1000), b(100, 100, 300, 100), b(120, 120, 50, 20), b(500, 500, 0, 0)];

describe('the viewer geometry', () => {
  it('picks the innermost box under the point, never an empty one', () => {
    expect(boxAt(boxes, 130, 125)).toBe(2);
    expect(boxAt(boxes, 300, 150)).toBe(1);
    expect(boxAt(boxes, 500, 500)).toBe(0);
    expect(boxAt(boxes, 2000, 10)).toBeNull();
  });
  it('widens to the enclosing box', () => {
    expect(enclosing(boxes, 2)).toBe(1);
    expect(enclosing(boxes, 1)).toBe(0);
    expect(enclosing(boxes, 0)).toBeNull();
  });
  it('maps a pointer to page pixels through the scale', () => {
    expect(toPage(150, 60, { left: 50, top: 10, scale: 0.5 })).toEqual({ x: 200, y: 100 });
  });
});

describe('targetAt', () => {
  it('is the plain innermost box without Alt', () => {
    expect(targetAt(boxes, new Set(), 130, 125, false)).toBe(2);
  });
  it('widens to the enclosing box with Alt', () => {
    expect(targetAt(boxes, new Set(), 130, 125, true)).toBe(1);
  });
  it('never widens off a box that already carries its own overlay, Alt or not', () => {
    expect(targetAt(boxes, new Set([2]), 130, 125, true)).toBe(2);
    expect(targetAt(boxes, new Set([2]), 130, 125, false)).toBe(2);
  });
  it('still widens when the innermost box is not the one overlaid', () => {
    expect(targetAt(boxes, new Set([1]), 130, 125, true)).toBe(1);
  });
  it('is null off every box, overlaid or not', () => {
    expect(targetAt(boxes, new Set([0, 1, 2]), 2000, 10, true)).toBeNull();
  });
});
