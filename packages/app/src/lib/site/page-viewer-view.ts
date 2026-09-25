// Hit-testing for the Verification tab's screenshot. Rects are page pixels (the box map's own); the viewer scales tiles to its column.
import type { Box } from './verification-model';

const area = (x: Box) => x.rect.w * x.rect.h;
const holds = (r: Box['rect'], x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const within = (a: Box['rect'], o: Box['rect']) => a.x >= o.x && a.y >= o.y && a.x + a.w <= o.x + o.w && a.y + a.h <= o.y + o.h;

export function boxAt(boxes: Box[], x: number, y: number): number | null {
  let best: number | null = null;
  boxes.forEach((bx, i) => {
    if (area(bx) <= 0 || !holds(bx.rect, x, y)) return;
    if (best === null || area(bx) < area(boxes[best]!)) best = i;
  });
  return best;
}

export function enclosing(boxes: Box[], i: number): number | null {
  const self = boxes[i];
  if (!self) return null;
  let best: number | null = null;
  boxes.forEach((bx, j) => {
    if (j === i || area(bx) <= area(self) || !within(self.rect, bx.rect)) return;
    if (best === null || area(bx) < area(boxes[best]!)) best = j;
  });
  return best;
}

export function toPage(clientX: number, clientY: number, f: { left: number; top: number; scale: number }) {
  return { x: (clientX - f.left) / f.scale, y: (clientY - f.top) / f.scale };
}
