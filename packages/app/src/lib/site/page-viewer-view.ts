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

/**
 * The box index a pointer currently targets: the innermost box under it,
 * widened once to its enclosing box when `alt` is held — except when the
 * innermost box already carries its own overlay (a labelled rectangle),
 * which always wins. Without this, an Alt-held click on a suggestion or
 * answer would resolve to its parent and land on `onPick` instead of the
 * rectangle's own `onOverlay`. Used for both the hover outline and click
 * routing, so what's outlined is always what a click there hits.
 *
 * A labelled rectangle also wins over the elements inside it: a price whose
 * "$" is its own element would otherwise send a click on the rectangle to
 * the "$" (found in the browser walk of plan 5 Task 8). The innermost
 * rectangle under the pointer is the target; elements inside one are reached
 * by removing it first.
 */
export function targetAt(boxes: Box[], overlaid: ReadonlySet<number>, x: number, y: number, alt: boolean): number | null {
  const i = boxAt(boxes, x, y);
  if (i === null || overlaid.has(i)) return i;
  const rectangle = boxAt(
    boxes.map((bx, j) => (overlaid.has(j) ? bx : { ...bx, rect: { x: 0, y: 0, w: 0, h: 0 } })),
    x,
    y,
  );
  if (rectangle !== null) return rectangle;
  if (!alt) return i;
  const wider = enclosing(boxes, i);
  return wider !== null ? wider : i;
}
