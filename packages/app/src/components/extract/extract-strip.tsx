import { Check } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import type { StripCell } from '../../lib/site/extract-screen-view';

/**
 * The Extract tab's three steps, side by side above the sections (spec §5.7):
 * 1 px border in every state, the current one wearing the text colour, a check
 * beside a finished number, monochrome throughout. Unlike the old (now
 * deleted) Schema tab's equivalent strip, these cells are not links — all
 * three sections are on the page at once, one under the other, so there is
 * nowhere for a cell to go: it is a status, and a link that scrolled you
 * 200 px would be a control pretending to be navigation.
 */
export function ExtractStrip({ cells }: { cells: [StripCell, StripCell, StripCell] }) {
  return (
    <div role="list" className="rise mb-4 flex flex-col gap-2 sm:flex-row">
      {cells.map((cell) => {
        const current = cell.state === 'current';
        const done = cell.state === 'done';
        // `later` is out of reach and says why instead of what it knows;
        // `locked` (the whole tab, schema not green) is simply quieter — the
        // strip above it is already carrying the reason for all three.
        const out = cell.state === 'later';
        const quiet = out || cell.state === 'locked';

        return (
          <div
            key={cell.title}
            role="listitem"
            aria-current={current ? 'step' : undefined}
            className={`flex min-h-[54px] min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-[6px] border px-3 py-2 [box-shadow:var(--shadow)] ${
              current ? 'border-text bg-panel' : 'border-line bg-panel'
            }`}
          >
            <span
              className={`flex items-center gap-1.5 text-base ${
                current ? 'font-medium text-text' : quiet ? 'text-muted-foreground' : 'text-text'
              }`}
            >
              <span className="font-mono text-sm">{cell.n}</span>
              <span aria-hidden className="text-faint">
                ·
              </span>
              <span className="truncate">{cell.title}</span>
              {done ? <Check aria-label="done" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
            </span>
            <span className="truncate text-sm text-muted-foreground" title={out && cell.reason ? cell.reason : cell.detail}>
              {out && cell.reason ? cell.reason : cell.detail}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The locked tab's one sentence (spec §5.7): "Extraction is locked · n of m
 * fields verified · fix <field> on the Verification tab", and the way there.
 *
 * Tone is a 2 px left rail and nothing else (spec §4) — a panel washed amber
 * would read as the website being wrong, when what is true is that one step is
 * not finished yet.
 */
export function ExtractLockedStrip({ text, project, site }: { text: string; project: string; site: string }) {
  return (
    <div
      role="status"
      className="rise mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[6px] border border-line border-l-2 border-l-warn bg-panel px-4 py-3 [box-shadow:var(--shadow)]"
    >
      <p className="min-w-0 text-base">{text}</p>
      <Link
        to="/projects/$project/sites/$site"
        params={{ project, site }}
        className="text-base text-link underline-offset-4 hover:underline"
      >
        Go to the Verification tab
      </Link>
    </div>
  );
}
