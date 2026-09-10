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

/** Where a `custom` box starts when the dropdown flips to it (mockup values). */
const DEFAULT_ITEMS = 40;
const DEFAULT_PAGES = 3;

const SELECT_CLASS =
  'rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100 disabled:opacity-50';

/**
 * A number box that lets the operator clear it while typing.
 *
 * A plain controlled `value={n}` snaps an emptied box straight back to its
 * old number, so replacing "40" with "5" means selecting the text first or
 * fighting the input. The draft absorbs every keystroke; only a positive
 * integer is ever handed upward.
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
      className="w-16 rounded-md border border-gray-300 px-2 py-1 font-mono text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
    />
  );
}

export function ExtractRun({
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
  items: number | 'all';
  pages: number | 'all';
  onChange: (budget: { items: number | 'all'; pages: number | 'all' }) => void;
  /** `runSentence(...)` — what this budget means, said out loud. */
  sentence: string;
  onExtract: () => void;
  extracting: boolean;
  disabled: boolean;
  reason?: string;
  activeRun: { id: string; label: string } | null;
  projectSlug: string;
  sourceSlug: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-800">
        <span>Run</span>
        <select
          aria-label="How many products"
          value={items === 'all' ? 'all' : 'custom'}
          onChange={(e) => onChange({ items: e.target.value === 'all' ? 'all' : DEFAULT_ITEMS, pages })}
          className={SELECT_CLASS}
        >
          <option value="all">all</option>
          <option value="custom">custom</option>
        </select>
        {items !== 'all' && (
          <NumberBox value={items} label="How many products" onValue={(n) => onChange({ items: n, pages })} />
        )}
        <span>products across</span>
        <select
          aria-label="How many pages"
          value={pages === 'all' ? 'all' : 'custom'}
          onChange={(e) => onChange({ items, pages: e.target.value === 'all' ? 'all' : DEFAULT_PAGES })}
          className={SELECT_CLASS}
        >
          <option value="all">all</option>
          <option value="custom">custom</option>
        </select>
        {pages !== 'all' && (
          <NumberBox value={pages} label="How many pages" onValue={(n) => onChange({ items, pages: n })} />
        )}
        <span>pages.</span>
      </div>

      <p className="text-xs text-gray-500">{sentence}</p>

      {activeRun ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="flex items-center gap-2 text-gray-800">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
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
          {disabled && reason && <span className="text-xs text-gray-500">{reason}</span>}
        </div>
      )}
    </div>
  );
}
