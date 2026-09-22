import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { trpc } from '../../lib/trpc';
import {
  emptyFilterNote,
  reExtractLabel,
  rowsMissingField,
  selectionToItemIds,
  type FieldCoverage,
  type ItemGap,
  type Row,
} from '../../lib/site/coverage-view';
import { gapFieldOption, missingRowsLine, selectAllLabel } from '../../lib/site/run-screen-view';
import { useBackfillMutation } from './backfill-panel';
import type { ResultColumn } from './results-table';

/**
 * Repair one field: pick the field whose column came back thin, take the rows
 * it is missing from, and send just those pages back through the chain.
 *
 * The tick is the whole selection — there are no per-row boxes — which is
 * deliberate: the one spender on this bar is armed by an explicit act, and the
 * number of pages it will fetch is written on both the tick and the button
 * (`reExtractLabel`, the one place the cost shape is said out loud before the
 * click: cached paths first, AI only where the cache cannot answer).
 *
 * `crawl.coverage` is not read here — the route owns it, because the repair
 * panel below needs the same answer — and the route only asks for it on a
 * settled, non-sample, non-repair extraction that actually produced rows.
 */
export function CoverageBar({
  runId,
  project,
  site,
  rows,
  coverage,
  gapByUrl,
  columns,
}: {
  runId: string;
  project: string;
  site: string;
  /** This extraction's rows, as the sheet has them — each carries its own `_url`. */
  rows: readonly Record<string, unknown>[];
  /** `crawl.coverage`'s per-field report. */
  coverage: readonly FieldCoverage[];
  /** The same report's gap items, keyed by url — what turns a picked row into an item id. */
  gapByUrl: Map<string, ItemGap>;
  /** The project's contract — the customer's own name for each field key. */
  columns: readonly ResultColumn[];
}) {
  const [field, setField] = useState<string | null>(null);
  const [selected, setSelected] = useState(false);
  const backfill = useBackfillMutation(project, site);

  // Every field with a blank cell in its column, including one whose blanks are
  // all confirmed absent: that field has nothing to repair, and `emptyFilterNote`
  // below is how it gets to say so rather than being silently absent from the
  // list the customer is reading their own thin column against.
  const gappy = coverage.filter((c) => c.missing + c.confirmedAbsent > 0);
  if (gappy.length === 0) return null;

  const nameOf = (key: string) => columns.find((c) => c.key === key)?.name ?? key;

  const missing = field ? rowsMissingField(rows as Row[], field, gapByUrl) : [];
  const urls = selected
    ? missing.map((r) => r._url).filter((u): u is string => typeof u === 'string')
    : [];
  const itemIds = selectionToItemIds(urls, gapByUrl);
  // A field whose gaps are all confirmed absent filters to nothing. The filter
  // is right — there is nothing left to repair — but a disabled button over an
  // empty list reads as broken, so the explanation takes its place.
  const note = field ? emptyFilterNote(coverage.find((c) => c.name === field)) : null;

  return (
    <div className="rise mb-3 rounded-[6px] border border-line bg-panel px-4 py-3 [box-shadow:var(--shadow)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-base font-medium">Repair one field</span>

        <Select
          value={field ?? undefined}
          onValueChange={(value) => {
            setField(value);
            // A selection made under one field must never carry into another,
            // where the button would fire against rows nobody picked.
            setSelected(false);
          }}
        >
          <SelectTrigger size="sm" aria-label="Which field to repair" className="w-[260px]">
            <SelectValue placeholder="Pick a field" />
          </SelectTrigger>
          <SelectContent>
            {gappy.map((cov) => (
              <SelectItem key={cov.name} value={cov.name}>
                {gapFieldOption(cov, nameOf(cov.name))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Not beside the note: "0 rows missing SKU" over "all 2 remaining gaps
            are confirmed absent" is the same fact twice, and the first of the
            two reads as a miscount. */}
        {field && !note ? (
          <span className="text-base text-muted-foreground">{missingRowsLine(missing.length, nameOf(field))}</span>
        ) : null}
      </div>

      {field && !note ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="coverage-select-all"
              checked={selected}
              disabled={missing.length === 0}
              onCheckedChange={(value) => setSelected(value === true)}
            />
            <Label htmlFor="coverage-select-all" className="text-base font-normal">
              {selectAllLabel(missing.length)}
            </Label>
          </div>

          <Button
            size="sm"
            disabled={backfill.isPending || itemIds.length === 0}
            onClick={() => backfill.mutate({ runId, itemIds, targetFields: [field] })}
          >
            {backfill.isPending ? <Loader2 className="animate-spin" /> : null}
            {reExtractLabel(itemIds.length)}
          </Button>

          {/* Every disabled control says why, within a line of it. */}
          {itemIds.length === 0 ? (
            <span className="text-base text-muted-foreground">
              {missing.length === 0 ? 'No rows on this page are missing it' : 'Tick the rows first'}
            </span>
          ) : null}
        </div>
      ) : null}

      {note ? <p className="mt-2 text-base text-muted-foreground">{note}</p> : null}

      {backfill.isError ? (
        <p role="alert" className="mt-2 text-base text-fail">
          {backfill.error.message}
        </p>
      ) : null}
    </div>
  );
}
