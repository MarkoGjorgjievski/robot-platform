import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import type { Box } from '../../lib/site/verification-model';
import { labelBelow, targetAt, toPage } from '../../lib/site/page-viewer-view';

export type Overlay = { box: number; label: string; tone: 'answered' | 'suggested' | 'failed'; key: string };

const TONE_OUTLINE: Record<Overlay['tone'], string> = {
  answered: 'outline-2 outline-pass',
  suggested: 'outline-2 outline-warn',
  failed: 'outline-2 outline-fail',
};

/**
 * The selected product's screenshot (spec §2.3): stacked capture tiles
 * scaled to the column, the element under the pointer outlined (Alt widens
 * to its parent), labelled rectangles for answers and suggestions, and a
 * click reporting which element was hit. Presentational only — no tRPC, no
 * board mutation; the route decides what a pick or an overlay click means.
 *
 * `tiles` are already-resolved URLs — the route calls `tileHref` before
 * handing them in, so this component never needs the trpc/API_URL import
 * chain `use-proof-captures.ts` carries.
 */
export function PageViewer({
  tiles,
  boxes,
  pageHeight,
  capturedHeight,
  overlays,
  highlight,
  locked,
  onPick,
  onOverlay,
}: {
  tiles: string[];
  boxes: Box[];
  pageHeight: number;
  capturedHeight: number;
  overlays: Overlay[];
  highlight: number | null;
  locked: boolean;
  onPick: (box: number, at: { x: number; y: number }) => void;
  onOverlay: (o: Overlay, at: { x: number; y: number }) => void;
}) {
  const stackRef = useRef<HTMLDivElement>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [renderedWidth, setRenderedWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  // A cached-and-already-complete first tile never fires `onLoad`, so a ref
  // callback catches that case; `onLoad` covers the normal, not-yet-loaded one.
  const firstTileRef = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth > 0) setNaturalWidth(img.naturalWidth);
  }, []);

  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setRenderedWidth(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (locked) setHover(null);
  }, [locked]);

  // A new product (fresh `tiles`/`boxes`) invalidates both the old hover
  // index (it would otherwise be drawn against the new product's boxes until
  // the pointer next moves) and the measured scale — the new first tile has
  // its own natural size, and until it reports one the overlay layer stays
  // hidden (`scale <= 0`) rather than drawing at the previous product's scale.
  useEffect(() => {
    setHover(null);
    setNaturalWidth(0);
  }, [tiles, boxes]);

  const overlaid = useMemo(() => new Set(overlays.map((o) => o.box)), [overlays]);

  const scale = naturalWidth > 0 && renderedWidth > 0 ? renderedWidth / naturalWidth : 0;

  function resolveIndex(e: ReactMouseEvent<HTMLDivElement>): number | null {
    const el = stackRef.current;
    if (!el || scale <= 0) return null;
    const r = el.getBoundingClientRect();
    const p = toPage(e.clientX, e.clientY, { left: r.left, top: r.top, scale });
    return targetAt(boxes, overlaid, p.x, p.y, e.altKey);
  }

  function handleMove(e: ReactMouseEvent<HTMLDivElement>) {
    if (locked) return;
    setHover(resolveIndex(e));
  }

  function handleLeave() {
    setHover(null);
  }

  function handleClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (locked) return;
    const i = resolveIndex(e);
    if (i === null) return;
    const at = { x: e.clientX, y: e.clientY };
    const hit = overlays.find((o) => o.box === i);
    if (hit) onOverlay(hit, at);
    else onPick(i, at);
  }

  function rectStyle(rect: Box['rect']): CSSProperties {
    return { left: rect.x * scale, top: rect.y * scale, width: rect.w * scale, height: rect.h * scale };
  }

  return (
    <div>
      <div className="max-h-[calc(100vh-260px)] overflow-auto rounded-[6px] border border-line bg-raised">
        <div ref={stackRef} className="relative">
          {tiles.map((src, i) => (
            <img
              key={i}
              ref={i === 0 ? firstTileRef : undefined}
              src={src}
              alt={i === 0 ? 'Screenshot of this product' : ''}
              draggable={false}
              className="block w-full select-none"
              onLoad={i === 0 ? (e) => setNaturalWidth(e.currentTarget.naturalWidth) : undefined}
            />
          ))}

          {scale > 0 ? (
            <div
              className="absolute inset-0"
              onMouseMove={handleMove}
              onMouseLeave={handleLeave}
              onClick={handleClick}
            >
              {hover !== null && boxes[hover] ? (
                <div className="pointer-events-none absolute outline outline-1 outline-text" style={rectStyle(boxes[hover]!.rect)} />
              ) : null}

              {overlays.map((o) => {
                const box = boxes[o.box];
                if (!box) return null;
                return (
                  <div key={o.key} className={`pointer-events-none absolute ${TONE_OUTLINE[o.tone]}`} style={rectStyle(box.rect)}>
                    <span
                      className={`absolute left-0 border border-current bg-panel px-1 text-sm whitespace-nowrap ${
                        labelBelow(box.rect.y * scale) ? 'top-full' : 'top-0 -translate-y-full'
                      }`}
                    >
                      {o.tone === 'suggested' ? `${o.label}?` : o.label}
                    </span>
                  </div>
                );
              })}

              {highlight !== null && boxes[highlight] ? (
                <div className="pointer-events-none absolute outline-2 outline-text" style={rectStyle(boxes[highlight]!.rect)} />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {pageHeight > capturedHeight && pageHeight > 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          Page cut at <span className="font-mono">{capturedHeight}</span> px
        </p>
      ) : null}
    </div>
  );
}
