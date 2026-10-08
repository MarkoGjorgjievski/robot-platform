// packages/app/src/components/verification/cell-detail-bar.tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../ui/button';
import { fixLabel, stateWord } from '../../lib/site/table-selection';
import type { Segment } from '../../lib/site/verification-model';

export type DetailBarSelection = {
  fieldName: string;
  productLabel: string;
  productNumber: number;
  value: string;
  state: Segment;
  onCopy: () => void | Promise<void>;
  onFix: () => void;
  onTypeIt: () => void;
  preview: ReactNode | null;
};

const STATE_TEXT: Record<Segment, string> = {
  empty: 'text-muted-foreground',
  suggested: 'text-warn',
  answered: 'text-pass',
  failed: 'text-fail',
};

/**
 * The line above the Verification table that says what the selected cell
 * holds (spec 2026-10-07 §2): field, product, state word, the full value in
 * mono (wrapping, scrolling past ~6 lines), Copy / Fix / Type it, and the
 * screenshot crop while the panel is closed. Stable height, so selecting a
 * cell never moves the table. Presentational — the route resolves everything.
 *
 * Both states render as `<section aria-label="Selected cell">` (not a plain
 * `<div>` for the empty state) so the route smoke can find it by role
 * "region" whether or not a cell is selected.
 */
export function CellDetailBar({ selection, locked }: { selection: DetailBarSelection | null; locked: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  // A new cell forgets the last "Copied".
  useEffect(() => {
    setCopied(false);
  }, [selection?.fieldName, selection?.productNumber]);

  // Reserve the crop's height (160px + py-2 at a 13px root + the border) on sm+, so the
  // table never jumps when the selection clears or the panel opens (spec §2).
  const shell = 'min-h-[76px] sm:min-h-[calc(160px+1rem+2px)] rounded-[6px] border border-line bg-panel px-3 py-2';

  if (!selection) {
    return (
      <section aria-label="Selected cell" className={`${shell} flex items-center`}>
        <p className="text-sm text-muted-foreground">Select a cell to see its full value.</p>
      </section>
    );
  }

  const s = selection;
  const empty = s.value.trim() === '';
  const label = fixLabel(s.state);

  async function copy() {
    // "Copied" only once the clipboard took it; a rejection leaves "Copy".
    try {
      await s.onCopy();
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section aria-label="Selected cell" className={`${shell} flex flex-wrap items-start gap-3 sm:flex-nowrap`}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-0 truncate text-base">
            {s.fieldName} · {s.productLabel} <span className="text-muted-foreground">(product {s.productNumber})</span>
          </span>
          <span className={`text-sm ${STATE_TEXT[s.state]}`}>{stateWord(s.state)}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" size="xs" disabled={empty} aria-label={`Copy ${s.fieldName} on product ${s.productNumber}`} onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button variant="outline" size="xs" disabled={locked} aria-label={`${label} ${s.fieldName} on the screenshot`} onClick={s.onFix}>
              {label}
            </Button>
            <Button variant="ghost" size="xs" disabled={locked} aria-label={`Type ${s.fieldName} on product ${s.productNumber}`} onClick={s.onTypeIt}>
              Type it
            </Button>
          </div>
        </div>
        <div className="max-h-[8.5rem] overflow-auto font-mono text-base break-words whitespace-pre-wrap" data-testid="selected-value">
          {empty ? <span className="text-muted-foreground">—</span> : s.value}
        </div>
      </div>
      {s.preview ? <div className="hidden sm:block">{s.preview}</div> : null}
    </section>
  );
}
