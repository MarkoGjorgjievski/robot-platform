// packages/app/src/components/verification/screenshot-crop.tsx
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { cn } from '../../lib/utils';
import { CROP_H, CROP_W, cropFrame, type Rect } from '../../lib/site/screenshot-crop-view';
import type { Segment } from '../../lib/site/verification-model';

const TONE_OUTLINE: Record<Segment, string> = {
  empty: 'outline-text',
  suggested: 'outline-warn',
  answered: 'outline-pass',
  failed: 'outline-fail',
};

/**
 * The detail bar's read-only crop of a product's screenshot around the
 * selected field's element (spec 2026-10-07 §4). A fixed 240×160 window over
 * the capture's tile stack, placed by `cropFrame`; the element outlined in
 * the cell's state colour. Clicking it is Fix — the only thing it does.
 * Presentational: tiles are resolved URLs, the box is resolved by the route.
 *
 * The page width is the first tile's natural width, measured the way
 * `PageViewer` measures it (a cached, already-complete image never fires
 * `onLoad`, so a ref callback catches that case).
 */
export function ScreenshotCrop({
  tiles,
  capturedHeight,
  status,
  error,
  box,
  tone,
  fieldName,
  disabled,
  onOpen,
}: {
  tiles: string[];
  capturedHeight: number;
  status: 'pending' | 'failed' | 'ready';
  error?: string;
  box: Rect | null;
  tone: Segment;
  fieldName: string;
  disabled: boolean;
  onOpen: () => void;
}) {
  const [pageWidth, setPageWidth] = useState(0);

  useEffect(() => {
    setPageWidth(0);
  }, [tiles]);

  const firstTileRef = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth > 0) setPageWidth(img.naturalWidth);
  }, []);

  const frame = cropFrame(box, { w: CROP_W, h: CROP_H }, { w: pageWidth, h: capturedHeight });
  const stackStyle: CSSProperties = { left: frame.left, top: frame.top, width: pageWidth * frame.scale };
  const boxStyle = (r: Rect): CSSProperties => ({ left: r.x * frame.scale, top: r.y * frame.scale, width: r.w * frame.scale, height: r.h * frame.scale });

  const shell = 'relative shrink-0 overflow-hidden rounded-[6px] border border-line bg-raised';
  const size: CSSProperties = { width: CROP_W, height: CROP_H };

  if (status === 'pending') {
    return (
      <div className={cn(shell, 'flex items-center justify-center')} style={size}>
        <span className="text-sm text-muted-foreground">Taking screenshot…</span>
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className={cn(shell, 'flex items-center justify-center px-3 text-center')} style={size}>
        <span className="text-sm text-warn">{error ?? 'The screenshot could not be taken'}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Open the screenshot to fix ${fieldName}`}
      title={disabled ? undefined : `Open the screenshot to fix ${fieldName}`}
      onClick={onOpen}
      className={cn(shell, 'block cursor-pointer text-left disabled:cursor-not-allowed')}
      style={size}
    >
      <div className="absolute" style={stackStyle}>
        {tiles.map((src, i) => (
          <img
            key={i}
            ref={i === 0 ? firstTileRef : undefined}
            src={src}
            alt={i === 0 ? `Screenshot around ${fieldName}` : ''}
            draggable={false}
            className="block w-full select-none"
            onLoad={i === 0 ? (e) => setPageWidth(e.currentTarget.naturalWidth) : undefined}
          />
        ))}
        {box && frame.scale > 0 ? <div className={cn('pointer-events-none absolute outline-2', TONE_OUTLINE[tone])} style={boxStyle(box)} /> : null}
      </div>
    </button>
  );
}
