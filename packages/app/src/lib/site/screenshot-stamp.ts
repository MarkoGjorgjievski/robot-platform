// The stamp on a product's screenshot (Marko 2026-11-13): when the picture was
// taken and which page it shows, as a band under the page — never over it, so
// nothing the page shows is hidden. The viewer shows the band's first line; a
// download draws both lines into the picture itself, so the stamp stays with
// the file. Stored tiles are untouched: Verify reads them as captured.
import { dateTime, zoneOffset } from '../when';

/** "Screenshot taken 13 Nov 2026, 20:32 UTC+1", or null with no readable date. */
export function stampText(takenAt: string | Date | null | undefined, offsetMin?: number): string | null {
  const when = dateTime(takenAt);
  if (!when || !takenAt) return null;
  return `Screenshot taken ${when} ${zoneOffset(new Date(takenAt), offsetMin)}`;
}

/** `screenshot-product-2-2026-11-13-2032.png`, in the viewer's time like the stamp. */
export function stampedFilename(product: number, takenAt: string | Date): string {
  const d = new Date(takenAt);
  const two = (n: number) => String(n).padStart(2, '0');
  return `screenshot-product-${product}-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}.png`;
}

/** The band's size for a picture `width` px wide: 72 px at the 1280 px the tiles are taken at. */
export function bandFor(width: number): { height: number; font: number; pad: number } {
  const k = Math.max(0.5, width / 1280);
  return { height: Math.round(72 * k), font: Math.round(20 * k), pad: Math.round(20 * k) };
}

/** `text` cut with "…" until `fits` says it does. */
export function cutToFit(text: string, fits: (t: string) => boolean): string {
  if (fits(text)) return text;
  let cut = text;
  while (cut.length > 1 && !fits(`${cut}…`)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * The whole screenshot as one PNG with the stamp drawn under it, saved by the
 * browser. Tiles are fetched with the session (they are gated per
 * organisation). Throws when a tile cannot be read; the caller says so.
 */
export async function downloadStamped(args: { tiles: string[]; stamp: string; url: string; filename: string }): Promise<void> {
  const bitmaps = await Promise.all(
    args.tiles.map(async (src) => {
      const res = await fetch(src, { credentials: 'include' });
      if (!res.ok) throw new Error(`tile ${res.status}`);
      return createImageBitmap(await res.blob());
    }),
  );
  const first = bitmaps[0];
  if (!first) throw new Error('no tiles');
  const width = first.width;
  const band = bandFor(width);
  const pageHeight = bitmaps.reduce((h, b) => h + b.height, 0);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = pageHeight + band.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  let y = 0;
  for (const b of bitmaps) {
    ctx.drawImage(b, 0, y);
    y += b.height;
    b.close();
  }
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, pageHeight, width, band.height);
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${band.font}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(args.stamp, band.pad, pageHeight + band.height * 0.32);
  ctx.font = `${Math.round(band.font * 0.8)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.fillStyle = '#b5b5b5';
  ctx.fillText(cutToFit(args.url, (t) => ctx.measureText(t).width <= width - band.pad * 2), band.pad, pageHeight + band.height * 0.7);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('no picture');
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = args.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
