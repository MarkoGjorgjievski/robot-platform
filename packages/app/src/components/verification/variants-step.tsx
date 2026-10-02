import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { nameRefusal } from '../../lib/fields-view';
import {
  METHOD_LABELS,
  NEW_COLUMN,
  axesFor,
  axisMappings,
  defaultTarget,
  newColumnName,
  setLine,
  variantsStepState,
  type DetectResult,
  type VariantMethod,
  type VariantSetup,
} from '../../lib/site/variants-view';
import { trpc } from '../../lib/trpc';

/**
 * `sources.detectVariants` for one set of landed screenshots: the one query
 * the Variants step and the table's Variants row share — same key, so the
 * captures are looked at once.
 */
export function detectVariantsQuery(utils: ReturnType<typeof trpc.useUtils>, sourceId: string, capturedKey: string) {
  return {
    queryKey: ['sources.detectVariants', sourceId, capturedKey] as const,
    queryFn: () => utils.client.sources.detectVariants.query({ sourceId }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  };
}

const METHODS: VariantMethod[] = ['list', 'links', 'none'];
const NEW = NEW_COLUMN;
const GENERIC = 'That could not be saved.';
const panel = 'rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]';

/**
 * The Verification tab's Variants step (spec 2026-10-01 §3), under the table,
 * only while the project wants variants. It reads the proof pages' captures —
 * free: no page load, no model — says what they show, and records how this
 * website exposes variants. It never holds Verify or Extract back (plan 2
 * gates on it).
 *
 * `capturedKey` names the set of landed screenshots ('' until every product's
 * has settled): the detection runs once per set, and again only when a
 * product's screenshot changes.
 */
export function VariantsStep({
  sourceId,
  datasetId,
  setup,
  cards,
  failedCards,
  capturedKey,
}: {
  sourceId: string;
  datasetId: string | null;
  setup: VariantSetup | null;
  cards: number;
  /** Products whose screenshot failed. */
  failedCards: number;
  capturedKey: string;
}) {
  const utils = trpc.useUtils();
  const variants = trpc.datasets.variants.useQuery({ datasetId: datasetId ?? '' }, { enabled: !!datasetId });
  const [changing, setChanging] = useState(false);
  const mode = variants.data?.mode ?? 'ignore';
  const axes = variants.data?.axes ?? [];
  // Every name a new column must not repeat: the project's fields and columns.
  const taken = [...(variants.data?.fields ?? []).map((f) => f.name), ...axes.map((a) => a.name)];
  const shownSetup = changing ? null : setup;

  const detection = useQuery({
    ...detectVariantsQuery(utils, sourceId, capturedKey),
    enabled: mode !== 'ignore' && !shownSetup && capturedKey !== '',
  });

  const state = variantsStepState({ mode, cards, failedCards, detection: detection.data ?? null, setup, changing, axes });
  if (state.kind === 'off') return null;

  return (
    <section aria-label="Variants" className={panel}>
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">Variants</h2>
      <div className="space-y-3 px-4 py-3">
        {state.kind === 'set' ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-base">{setLine(state)}</p>
            <Button variant="outline" size="sm" onClick={() => setChanging(true)}>
              Change
            </Button>
          </div>
        ) : state.kind === 'no-pages' ? (
          detection.isError ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p role="alert" className="text-sm text-fail">
                Could not look at the screenshots.
              </p>
              <Button variant="outline" size="sm" onClick={() => void detection.refetch()} disabled={detection.isFetching}>
                {detection.isFetching ? 'Retrying…' : 'Retry'}
              </Button>
            </div>
          ) : (
            <p className="text-base text-muted-foreground">
              {state.reason === 'Wait for the screenshots' && detection.isFetching ? 'Looking at the screenshots…' : state.reason}
            </p>
          )
        ) : (
          // Keyed on what was found: a fresh detection starts the choice over at its suggestion.
          <FoundForm
            key={`${capturedKey}|${state.initialMethod}`}
            sourceId={sourceId}
            datasetId={datasetId}
            detection={detection.data!}
            summary={state.summary}
            noColumns={state.noColumns}
            initialMethod={state.initialMethod}
            axes={axes}
            taken={taken}
            setup={setup}
            onCancel={setup ? () => setChanging(false) : undefined}
            onSaved={() => setChanging(false)}
          />
        )}
      </div>
    </section>
  );
}

function FoundForm({
  sourceId,
  datasetId,
  detection,
  summary,
  noColumns,
  initialMethod,
  axes,
  taken,
  setup,
  onCancel,
  onSaved,
}: {
  sourceId: string;
  datasetId: string | null;
  detection: DetectResult;
  summary: string[];
  /** Every captured page's list (when it has one) found no column at all (Global Constraints). */
  noColumns: boolean;
  initialMethod: VariantMethod;
  axes: Array<{ key: string; name: string }>;
  /** Field and column names a new column must not repeat. */
  taken: string[];
  /** The confirmed setup when changing it: its column mapping is where each axis starts. */
  setup: VariantSetup | null;
  onCancel?: () => void;
  onSaved: () => void;
}) {
  const utils = trpc.useUtils();
  const save = trpc.sources.setVariantSetup.useMutation();
  const [method, setMethod] = useState<VariantMethod>(initialMethod);
  /** Per detected axis, the project column it becomes: an existing axis key, or `NEW`. */
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const found = axesFor(detection, method);
  // The customer's pick, else the confirmed mapping (on Change), else a column of the same name, else a new one.
  const targetOf = (a: { from: string; label: string }) => targets[a.from] ?? defaultTarget(a, axes, setup);

  async function confirm() {
    setError(null);
    const mapped = method === 'none' ? [] : axisMappings(found, targetOf, taken);
    try {
      await save.mutateAsync({ sourceId, method, axes: mapped });
      // The status's `variants` follow the setup (setup missing → required), so it is refreshed too.
      await Promise.all([
        utils.sources.get.invalidate(),
        utils.sources.verificationStatus.invalidate({ sourceId }),
        datasetId ? utils.datasets.variants.invalidate({ datasetId }) : null,
      ]);
      onSaved();
    } catch (err) {
      // A new column whose name a field already has is the customer's to fix.
      const newAxis = method === 'none' ? undefined : found.find((a) => targetOf(a) === NEW);
      const newName = newAxis ? newColumnName(newAxis.label, taken) : undefined;
      setError((newName ? nameRefusal(err, newName) : null) ?? GENERIC);
    }
  }

  return (
    <>
      <div className="space-y-1">
        {summary.map((line) => (
          <p key={line} className="text-base">
            {line}
          </p>
        ))}
      </div>

      <RadioGroup value={method} onValueChange={(v) => setMethod(v as VariantMethod)} aria-label="How this website shows variants" className="gap-2" disabled={save.isPending}>
        {METHODS.map((m) => (
          <div key={m} className="flex items-center gap-2">
            <RadioGroupItem id={`variant-method-${m}`} value={m} />
            <Label htmlFor={`variant-method-${m}`} className="text-base font-normal">
              {METHOD_LABELS[m]}
            </Label>
          </div>
        ))}
      </RadioGroup>

      {method !== 'none' && found.length > 0 ? (
        <ul className="space-y-1.5 border-t border-line pt-3">
          {found.map((a) => (
            <li key={a.from} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0 text-base">
                {a.label}
                {a.options.length > 0 ? (
                  <span className="text-muted-foreground">
                    {' '}
                    · {a.options.slice(0, 4).join(', ')}
                    {a.options.length > 4 ? '…' : ''}
                  </span>
                ) : null}
              </span>
              <span className="text-sm text-muted-foreground">becomes column</span>
              <Select value={targetOf(a)} onValueChange={(v) => setTargets((t) => ({ ...t, [a.from]: v }))} disabled={save.isPending}>
                <SelectTrigger size="sm" aria-label={`Column for ${a.label}`} className="h-7 gap-1 px-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {axes.map((x) => (
                    <SelectItem key={x.key} value={x.key}>
                      {x.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW}>New column &lsquo;{newColumnName(a.label, taken)}&rsquo;</SelectItem>
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      ) : method === 'list' && noColumns ? (
        <p className="text-sm text-muted-foreground">These variants have no colour or size in the page data — they will be told apart by their SKU</p>
      ) : method !== 'none' ? (
        <p className="text-sm text-muted-foreground">Nothing of this kind on these products yet. Add a product with variants to check it.</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void confirm()} disabled={save.isPending}>
          Confirm
        </Button>
        {onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={save.isPending}>
            Cancel
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-fail">
          {error}
        </p>
      ) : null}
    </>
  );
}
