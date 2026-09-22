import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { RunDot } from '../run-dot';
import type { RunDotStatus } from '../../lib/run-dot-view';
import type { ExtractMode } from '../../lib/site/extract-view';

/**
 * Step 3: how much, then go.
 *
 * The budget is one sentence with two dropdowns in it — "Run [all] products
 * across [all] pages." — and picking `custom` reveals a number box right after
 * the dropdown that asked for it (spec §5.7). The line under it is
 * `runSentence` (extract-view.ts), rendered verbatim: what this budget actually
 * means, safety stop included.
 *
 * Once a run is going, the button is replaced by that run's own progress line
 * and a link to it. The section does not turn into something else.
 */

/** Where a `custom` box starts when the dropdown flips to it. */
const DEFAULT_ITEMS = 40;
const DEFAULT_PAGES = 3;

/**
 * A number box that lets the operator clear it while typing, but never lets the
 * screen disagree with what the tab holds.
 *
 * A plain controlled `value={n}` snaps an emptied box straight back to its old
 * number, so replacing "40" with "5" means selecting the text first or fighting
 * the input. The draft absorbs every keystroke and only a positive integer is
 * ever handed upward — which leaves exactly one gap: an empty, `0`, negative or
 * otherwise unparseable draft is shown while the tab still holds the last good
 * number, so the sentence under it describes a budget the box does not show.
 * Blur closes that gap by snapping the draft back to `value`.
 */
function NumberBox({ value, onValue, label }: { value: number; onValue: (n: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  return (
    <Input
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
      className="h-8 w-[72px] font-mono"
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
  reason,
  activeRun,
  project,
  site,
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
  /** Why Extract cannot be pressed, shown beside it. `null` when it can. */
  reason: string | null;
  /**
   * The run this section is showing. `dot` is what says whether anything is
   * still moving: `label` goes on saying what happened once the run is finished
   * ("40 of 40 extracted"), and a pulse still going beside a finished run reads
   * as work that is still in flight.
   */
  activeRun: { id: string; label: string; dot: RunDotStatus } | null;
  project: string;
  site: string;
}) {
  return (
    <div className="space-y-3">
      {/* The controls sit in the sentence, not above it: this line is the
          budget, read left to right, and a form stacked over a restatement of
          itself would be the same decision written twice. */}
      <div className="flex flex-wrap items-center gap-2 text-base">
        <span>Run</span>
        <Select
          value={items === 'all' ? 'all' : 'custom'}
          onValueChange={(v) => onChange({ items: v === 'all' ? 'all' : DEFAULT_ITEMS, pages })}
        >
          <SelectTrigger size="sm" aria-label="How many products" className="w-[104px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all</SelectItem>
            <SelectItem value="custom">custom</SelectItem>
          </SelectContent>
        </Select>
        {items !== 'all' ? (
          <NumberBox value={items} label="How many products" onValue={(n) => onChange({ items: n, pages })} />
        ) : null}
        {mode === 'detail' ? (
          <span>products.</span>
        ) : (
          <>
            <span>products across</span>
            <Select
              value={pages === 'all' ? 'all' : 'custom'}
              onValueChange={(v) => onChange({ items, pages: v === 'all' ? 'all' : DEFAULT_PAGES })}
            >
              <SelectTrigger size="sm" aria-label="How many pages" className="w-[104px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all</SelectItem>
                <SelectItem value="custom">custom</SelectItem>
              </SelectContent>
            </Select>
            {pages !== 'all' ? (
              <NumberBox value={pages} label="How many pages" onValue={(n) => onChange({ items, pages: n })} />
            ) : null}
            <span>pages.</span>
          </>
        )}
      </div>

      {/* Facts, not prose: the separators are what hold the budget's clauses
          apart on one line — the safety stop among them. */}
      <p className="text-base text-muted-foreground">{sentence}</p>

      {activeRun ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 font-mono">
            <RunDot status={activeRun.dot} />
            {activeRun.label}
          </span>
          <Link
            to="/projects/$project/sites/$site/runs/$run"
            params={{ project, site, run: activeRun.id }}
            className="text-base text-link underline-offset-4 hover:underline"
          >
            Open the run
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={extracting || reason !== null} onClick={onExtract}>
            {extracting ? <Loader2 className="animate-spin" /> : null}
            Extract
          </Button>
          {/* Every disabled control says why, within a line of it. */}
          {reason ? <span className="text-base text-muted-foreground">{reason}</span> : null}
        </div>
      )}
    </div>
  );
}
