// packages/scraper/src/verify/box-map.ts
// The box map: every visible element a customer could click on a proof-page
// screenshot, with the XPaths the DOM search would give it. Built inside the
// page (annotate hook, after the expand rounds, before the screenshot) so the
// rects line up with the tiles.
import { PAGE_SCRIPT_PRELUDE, browserXPaths, looksVolatile } from './dom-scripts.js';

export type Box = {
  xpaths: string[];
  text: string;
  rect: { x: number; y: number; w: number; h: number };
  tag: string;
  kind: 'text' | 'image' | 'link';
  src?: string;
  href?: string;
};

/** Enough for a long product page; past this the map is cut in document order, as the tiles are. */
export const BOX_MAP_LIMIT = 3000;
const TEXT_LIMIT = 500;

/** Runs INSIDE the page. Dependency-free: it is stringified into the script. */
function browserBoxes(xpathsOf: (el: Element) => string[], limit: number, textLimit: number) {
  const out: Array<Record<string, unknown>> = [];
  const sx = window.scrollX, sy = window.scrollY;
  const ownText = (el: Element): string => {
    let t = '';
    for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) t += n.textContent ?? '';
    return t.replace(/\s+/g, ' ').trim().slice(0, textLimit);
  };
  const all = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of Array.from(all)) {
    if (out.length >= limit) break;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') continue;
    const kind = tag === 'img' ? 'image' : tag === 'a' ? 'link' : 'text';
    const text = ownText(el);
    if (kind === 'text' && text === '') continue;
    const cs = window.getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const box: Record<string, unknown> = {
      xpaths: xpathsOf(el), text, tag, kind,
      rect: { x: Math.round(r.left + sx), y: Math.round(r.top + sy), w: Math.round(r.width), h: Math.round(r.height) },
    };
    if (kind === 'image') { const src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src; if (!src) continue; box.src = src; }
    if (kind === 'link') { const href = (el as HTMLAnchorElement).href; if (href) box.href = href; }
    out.push(box);
  }
  return out;
}

export function buildBoxMapScript(): string {
  return `(() => {
    ${PAGE_SCRIPT_PRELUDE}
    const looksVolatile = ${looksVolatile.toString()};
    const xpathsOf = ${browserXPaths.toString()};
    const boxes = ${browserBoxes.toString()};
    return boxes(xpathsOf, ${BOX_MAP_LIMIT}, ${TEXT_LIMIT});
  })()`;
}

function isBox(v: unknown): v is Box {
  if (!v || typeof v !== 'object') return false;
  const b = v as Partial<Box>;
  return Array.isArray(b.xpaths) && typeof b.text === 'string' && typeof b.tag === 'string'
    && (b.kind === 'text' || b.kind === 'image' || b.kind === 'link')
    && !!b.rect && typeof b.rect.x === 'number' && typeof b.rect.y === 'number' && typeof b.rect.w === 'number' && typeof b.rect.h === 'number';
}

/** Narrow a capture's `annotation` to a box map; [] when it is not one. */
export function boxesFromAnnotation(annotation: unknown): Box[] {
  return Array.isArray(annotation) && annotation.every(isBox) ? annotation : [];
}
