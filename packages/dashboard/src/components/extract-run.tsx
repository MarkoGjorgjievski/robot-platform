// packages/dashboard/src/components/extract-run.tsx
// Step 3 of the Extract tab: how much, then go.
//
// The budget is one sentence with two dropdowns in it — "Run [all] products
// across [all] pages." — and picking `custom` reveals a number box right
// after the dropdown that asked for it (mockup extract-v5-run.html). The
// sentence under it is `runSentence` (extract-view.ts), rendered verbatim:
// what this budget actually means, safety stop included.
//
// Once a run is going, the button is replaced by the run's own progress line
// and a link to it. The section does not turn into something else.
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import type { ExtractMode } from '../lib/extract-view';

/** Where a `custom` box starts when the dropdown flips to it (mockup values). */
const DEFAULT_ITEMS = 40;
const DEFAULT_PAGES = 3;

/**
 * A quiet control sitting inline in the sentence: a 1px rule border on
 * surface, 32px tall, no box of its own. The focus ring comes from the base
 * layer.
 */
const BOX_CLASS = 'h-8 rounded-md border border-gray-300 bg-gray-50 px-2 text-sm text-gray-900';

/**
 * A number box that lets the operator clear it while typing, but never lets
 * the screen disagree with what the parent holds.
 *
 * A plain controlled `value={n}` snaps an emptied box straight back to its
 * old number, so replacing "40" with "5" means selecting the text first or
 * fighting the input. The draft absorbs every keystroke and only a positive
 * integer is ever handed upward — which leaves exactly one gap: an empty,
 * `0`, negative or otherwise unparseable draft is shown while the parent
 * still holds the last good number, so the sentence under it describes a
 * budget the box does not show. Blur closes that gap by snapping the draft
 * back to `value`.
 */
function NumberBox({ value, onValue, label }: { value: number; onValue: (n: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  return (
    <input
      type="number"
      min={1}
      aria-label={label}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = Number.parseInt(e.target.value, 10);
        if (Number.isFinite(parsed) && parsed > 0) onValue(parsed);
      }}
      onBlur={() => {
        const parsed = Number.parseInt(draft, 10);
        if (!Number.isFinite(parsed) || parsed < 1) setDraft(String(value));
      }}
      className={`${BOX_CLASS} w-16 font-mono`}
    />
  );
}

export function ExtractRun({
  mode,
  items,
  pages,
  onChange,
  sentence,
  onExtract,
  extracting,
  disabled,
  reason,
  activeRun,
  projectSlug,
  sourceSlug,
}: {
  /** A fixed list of product URLs has nothing to page through, so detail mode has no pages control. */
  mode: ExtractMode;
  items: number | 'all';
  pages: number | 'all';
  onChange: (budget: { items: number | 'all'; pages: number | 'all' }) => void;
  /** `runSentence(...)` — what this budget means, said out loud. */
  sentence: string;
  onExtract: () => void;
  extracting: boolean;
  disabled: boolean;
  reason?: string;
  /**
   * The run this section is showing, and whether it is still moving. `moving`
   * is what the spinner keys off: `label` goes on saying what happened once
   * the run is finished ("Completed · 40 of 40"), and a spinner still turning
   * beside a finished run reads as work that is still going on.
   */
  activeRun: { id: string; label: string; moving: boolean } | null;
  projectSlug: string;
  sourceSlug: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-900">
        <span>Run</span>
        <select
          aria-label="How many products"
          value={items === 'all' ? 'all' : 'custom'}
          onChange={(e) => onChange({ items: e.target.value === 'all' ? 'all' : DEFAULT_ITEMS, pages })}
          className={BOX_CLASS}
        >
          <option value="all">all</option>
          <option value="custom">custom</option>
        </select>
        {items !== 'all' && (
          <NumberBox value={items} label="How many products" onValue={(n) => onChange({ items: n, pages })} />
        )}
        {mode === 'detail' ? (
          <span>products.</span>
        ) : (
          <>
            <span>products across</span>
            <select
              aria-label="How many pages"
              value={pages === 'all' ? 'all' : 'custom'}
              onChange={(e) => onChange({ items, pages: e.target.value === 'all' ? 'all' : DEFAULT_PAGES })}
              className={BOX_CLASS}
            >
              <option value="all">all</option>
              <option value="custom">custom</option>
            </select>
            {pages !== 'all' && (
              <NumberBox value={pages} label="How many pages" onValue={(n) => onChange({ items, pages: n })} />
            )}
            <span>pages.</span>
          </>
        )}
      </div>

      {/* Facts, not prose: the separators are what hold the budget's clauses
          apart on one line. */}
      <p className="text-xs text-gray-600">{sentence}</p>

      {activeRun ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="flex items-center gap-2 font-mono text-gray-900">
            {activeRun.moving && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-600" />}
            {activeRun.label}
          </span>
          <Link
            to="/projects/$project/sources/$source/runs/$run"
            params={{ project: projectSlug, source: sourceSlug, run: activeRun.id }}
            className="text-xs text-accent-700 underline-offset-2 hover:underline"
          >
            Open the run
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary h-8" disabled={disabled || extracting} onClick={onExtract}>
            {extracting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Extract
          </button>
          {disabled && reason && <span className="text-xs text-gray-600">{reason}</span>}
        </div>
      )}
    </div>
  );
}
