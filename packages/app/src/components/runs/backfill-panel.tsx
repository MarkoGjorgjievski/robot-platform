import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Skeleton } from '../ui/skeleton';
import { trpc } from '../../lib/trpc';
import {
  backfillMutationInput,
  checkedHasDeadField,
  initialChecked,
  previewSummary,
  strategyCopy,
  type FieldClassification,
} from '../../lib/site/backfill-preview';
import { classificationLabel, fillLabel } from '../../lib/site/run-screen-view';
import type { ResultColumn } from './results-table';

/**
 * The one `crawl.backfill` mutation both spending paths share — the repair
 * bar's Re-extract and this panel's Run backfill. On success both must land
 * identically: this extraction (the repair's parent) gets its lineage line and
 * its coverage refreshed, the project's dots catch up, and the customer is
 * taken to the repair run itself. One hook keeps the two paths identical by
 * construction, which is why it lives here rather than being written twice.
 */
export function useBackfillMutation(project: string, site: string) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  return trpc.crawl.backfill.useMutation({
    onSuccess: (result) => {
      void utils.runs.invalidate();
      void utils.crawl.invalidate();
      // The project page's websites table has a last-run cell and a run dot per
      // website, and a new repair run is the moment both change.
      void utils.projects.get.invalidate();
      void navigate({
        to: '/projects/$project/sites/$site/runs/$run',
        params: { project, site, run: result.backfillRunId },
      });
    },
  });
}

/**
 * Repair every field with gaps at once: which fields, how many pages that is,
 * what it may cost — and, for a field whose cached path has stopped answering,
 * how to go about fixing it. All of that before the one spending click.
 *
 * Two uses of `crawl.backfillPreview` (free, AI-free), both gated on `open` — a
 * closed panel must not query. The first asks for the FULL gappy field set and
 * drives the checklist's fill numbers, verdicts and the strategy choice. The
 * second asks for the CHECKED subset and drives the cost line, so the summary
 * follows the ticks rather than staying pinned to the numbers the panel opened
 * with; `placeholderData` keeps the previous line on screen through the refetch
 * a tick triggers, instead of the cost blinking out on every click. Both derive
 * from the same server-side coverage load as the run that would follow, so the
 * estimate and the work it describes cannot drift apart.
 */
export function BackfillPanel({
  runId,
  project,
  site,
  gappyFieldNames,
  columns,
}: {
  runId: string;
  project: string;
  site: string;
  /** Every field the coverage report says has something missing. */
  gappyFieldNames: string[];
  /** The project's contract — the customer's own name for each field key. */
  columns: readonly ResultColumn[];
}) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string> | null>(null);
  const [strategy, setStrategy] = useState<'repair_sweep' | 'full_focus'>('repair_sweep');

  const preview = trpc.crawl.backfillPreview.useQuery({ runId, targetFields: gappyFieldNames }, { enabled: open });

  useEffect(() => {
    if (preview.data && checked === null) {
      setChecked(initialChecked(preview.data.fields as FieldClassification[]));
    }
  }, [preview.data, checked]);

  // Sorted so the query key is stable under Set iteration order — otherwise
  // ticking a field off and back on would miss its own cache entry.
  const activeChecked = checked ?? new Set(gappyFieldNames);
  const checkedPreview = trpc.crawl.backfillPreview.useQuery(
    { runId, targetFields: [...activeChecked].sort() },
    { enabled: open, placeholderData: (prev) => prev },
  );

  const backfill = useBackfillMutation(project, site);

  if (gappyFieldNames.length === 0) return null;

  const nameOf = (key: string) => columns.find((c) => c.key === key)?.name ?? key;

  if (!open) {
    return (
      <div className="rise mb-3">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Repair all gaps…
        </Button>
      </div>
    );
  }

  const fields = (preview.data?.fields ?? []) as FieldClassification[];
  // A verified website's repair runs its certified paths only — never AI — so
  // there is no repair-then-sweep-versus-full-focus choice to make, and none is
  // shown (`strategyCopy`'s own doc comment). `full_focus` still goes to the
  // server unshown, because its guard requires some value.
  const certified = preview.data?.certified ?? false;
  const showStrategy = checkedHasDeadField(fields, activeChecked) && !certified;
  const deadChecked = fields.filter((f) => activeChecked.has(f.name) && f.classification === 'dead');
  const input = preview.data ? backfillMutationInput(fields, activeChecked, strategy, { certified }) : null;
  const nothingChecked = !input || input.targetFields.length === 0;

  const toggle = (name: string) => {
    setChecked((prev) => {
      const next = new Set(prev ?? gappyFieldNames);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <section className="rise mb-3 rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <h3 className="text-base font-medium">Repair all gaps</h3>
        <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>

      <div className="space-y-3 px-4 py-3">
        {!preview.data ? (
          // The shape of the checklist, not a sentence claiming there is
          // nothing in it: the preview is one round-trip away.
          <div>
            <Skeleton className="h-[22px] w-64 bg-raised" />
            <Skeleton className="mt-2 h-[22px] w-52 bg-raised" />
          </div>
        ) : (
          <>
            <ul className="space-y-2">
              {fields.map((field) => (
                <li key={field.name} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Checkbox
                    id={`backfill-${field.name}`}
                    checked={activeChecked.has(field.name)}
                    onCheckedChange={() => toggle(field.name)}
                  />
                  <Label htmlFor={`backfill-${field.name}`} className="text-base font-normal">
                    {nameOf(field.name)}
                  </Label>
                  <span className="font-mono text-sm text-muted-foreground">{fillLabel(field.fill)}</span>
                  {/* The verdict in the state colour, on the words themselves
                      — no chip, no tint behind them (spec §4). */}
                  <span className={`text-sm ${field.classification === 'dead' ? 'text-fail' : 'text-pass'}`}>
                    {classificationLabel(field.classification)}
                  </span>
                </li>
              ))}
            </ul>

            {showStrategy
              ? deadChecked.map((field) => {
                  // The copy is built against the customer's name for the
                  // field, not the engine's key — the module only reads `name`
                  // and `fill` to write it, so the rename is safe and the
                  // mutation below still sends the real keys.
                  const copy = strategyCopy({ ...field, name: nameOf(field.name) }, { certified });
                  if (!copy) return null;
                  return (
                    <div key={field.name} className="border-l-2 border-warn pl-3">
                      <p className="text-base text-warn">{copy.title}</p>
                      <RadioGroup
                        className="mt-1.5 gap-2"
                        value={strategy}
                        onValueChange={(value) => setStrategy(value as 'repair_sweep' | 'full_focus')}
                      >
                        <div className="flex items-start gap-2">
                          <RadioGroupItem id={`strategy-repair-${field.name}`} value="repair_sweep" className="mt-0.5" />
                          <Label htmlFor={`strategy-repair-${field.name}`} className="text-base leading-normal font-normal">
                            {copy.recommended}
                          </Label>
                        </div>
                        <div className="flex items-start gap-2">
                          <RadioGroupItem id={`strategy-focus-${field.name}`} value="full_focus" className="mt-0.5" />
                          <Label htmlFor={`strategy-focus-${field.name}`} className="text-base leading-normal font-normal">
                            {copy.alternative}
                          </Label>
                        </div>
                      </RadioGroup>
                      {/* One choice, not one per field: `crawl.backfill` takes a
                          single strategy for the whole request, and saying so
                          beats letting two panels look independent. */}
                      {deadChecked.length > 1 ? (
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          This choice applies to every field with a broken path in this repair.
                        </p>
                      ) : null}
                    </div>
                  );
                })
              : null}

            {/* What it costs, said before the button, every time. */}
            {checkedPreview.data ? (
              <p className="font-mono text-base">{previewSummary(checkedPreview.data)}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                disabled={backfill.isPending || nothingChecked}
                onClick={() => input && backfill.mutate({ runId, ...input })}
              >
                {backfill.isPending ? <Loader2 className="animate-spin" /> : null}
                Run backfill
              </Button>
              {/* Every disabled control says why, within a line of it. */}
              {nothingChecked ? (
                <span className="text-base text-muted-foreground">Tick at least one field to repair</span>
              ) : null}
            </div>

            {backfill.isError ? (
              <p role="alert" className="text-base text-fail">
                {backfill.error.message}
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
