import { useEffect, useRef, useState } from 'react';
import { useRouteContext } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { BlockedTooltip } from '../shell/staff-banner';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { VARIANT_MODES, VARIANT_MODE_LABELS, axisRefusal, type VariantMode } from '../../lib/fields-view';
import { staffBlockedNote } from '../../lib/staff-view';
import { trpc } from '../../lib/trpc';

/** The one message every failed change falls back to (cause-neutral, as in the field list). */
const GENERIC = 'That change could not be saved.';

/**
 * The project's Variants setting (spec 2026-10-01 §2): one choice for how a
 * product with variants becomes rows, and — once variants are on — the
 * variant columns (Colour, Size…) a website's setup added, renamed or removed
 * here. Each field's level is shown on its own row in the field list below.
 *
 * Turning variants off deletes nothing (the API keeps columns, levels and every
 * website's setup), so the choice is a plain radio that saves on click.
 */
export function VariantsPanel({
  datasetId,
  mode,
  axes,
}: {
  datasetId: string;
  mode: VariantMode;
  axes: Array<{ key: string; name: string }>;
}) {
  const utils = trpc.useUtils();
  const setMode = trpc.datasets.setVariantMode.useMutation();
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    await Promise.all([utils.datasets.variants.invalidate({ datasetId }), utils.projects.get.invalidate()]);
  }

  async function choose(next: VariantMode) {
    setError(null);
    try {
      await setMode.mutateAsync({ datasetId, mode: next });
      await refresh();
    } catch {
      setError(GENERIC);
    }
  }

  return (
    <section aria-label="Variants" className="rise rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <h2 className="border-b border-line px-4 py-3 text-base font-medium">Variants</h2>
      <div className="space-y-3 px-4 py-3">
        <RadioGroup
          value={mode}
          onValueChange={(v) => void choose(v as VariantMode)}
          aria-label="Variants"
          className="gap-2"
          disabled={setMode.isPending}
        >
          {VARIANT_MODES.map((m) => (
            <div key={m} className="flex items-center gap-2">
              <RadioGroupItem id={`variant-mode-${m}`} value={m} />
              <Label htmlFor={`variant-mode-${m}`} className="text-base font-normal">
                {VARIANT_MODE_LABELS[m]}
              </Label>
            </div>
          ))}
        </RadioGroup>

        {mode !== 'ignore' ? (
          <div className="border-t border-line pt-3">
            <h3 className="text-sm text-muted-foreground">Variant columns</h3>
            {axes.length === 0 ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                None yet. Columns such as Colour and Size are added when you set up a website&apos;s variants.
              </p>
            ) : (
              <ul className="mt-1">
                {axes.map((a) => (
                  <AxisRow key={a.key} datasetId={datasetId} axis={a} onError={setError} onSettled={refresh} />
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-fail">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** A variant column: its name edited in place, as a field's is, and a quiet delete. */
function AxisRow({
  datasetId,
  axis,
  onError,
  onSettled,
}: {
  datasetId: string;
  axis: { key: string; name: string };
  onError: (message: string | null) => void;
  onSettled: () => Promise<void>;
}) {
  const rename = trpc.datasets.renameAxis.useMutation();
  const remove = trpc.datasets.deleteAxis.useMutation();
  // Staff mode (spec 2026-10-07 §2.3): deleting a variant column is blocked, and says so.
  const { session } = useRouteContext({ from: '/_app' });
  const blocked = staffBlockedNote(!!session.staff, null);
  const [draft, setDraft] = useState(axis.name);
  const input = useRef<HTMLInputElement>(null);
  // Escape's blur arrives before the restored draft renders (see the field list's FieldRow).
  const escaped = useRef(false);

  useEffect(() => {
    if (document.activeElement !== input.current) setDraft(axis.name);
  }, [axis.name]);

  async function commitName() {
    if (escaped.current) {
      escaped.current = false;
      setDraft(axis.name);
      return;
    }
    const name = draft.trim();
    if (!name || name === axis.name) {
      setDraft(axis.name);
      return;
    }
    onError(null);
    try {
      await rename.mutateAsync({ datasetId, key: axis.key, name });
      await onSettled();
    } catch (err) {
      onError(axisRefusal(err, name) ?? GENERIC);
      setDraft(axis.name);
    }
  }

  async function onDelete() {
    onError(null);
    try {
      await remove.mutateAsync({ datasetId, key: axis.key });
      await onSettled();
    } catch (err) {
      // "Nike uses Colour": the website that maps to this column, named.
      onError(axisRefusal(err, axis.name) ?? GENERIC);
    }
  }

  return (
    <li className="group/row flex items-center gap-2 py-1">
      <input
        ref={input}
        size={1}
        value={draft}
        aria-label={`Name of variant column ${axis.name}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commitName()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            escaped.current = true;
            e.currentTarget.blur();
          }
        }}
        className="-mx-2 h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-[16px] font-medium text-text outline-none hover:border-line-hover focus:border-text focus:bg-bg group-hover/row:border-line md:text-base"
      />
      <BlockedTooltip note={blocked}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete variant column ${axis.name}`}
          onClick={() => void onDelete()}
          disabled={remove.isPending || !!blocked}
          className="text-muted-foreground hover:text-fail"
        >
          <Trash2 />
        </Button>
      </BlockedTooltip>
    </li>
  );
}
