import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Popover, PopoverContent } from '@ui-sdk/react/popover';
import { fieldsFor, valueFromBox, validateValue, type Box } from '../../lib/site/verification-model';

/**
 * The mark popover (spec §2.3): the element's value (or, for an error, why
 * it can't be used), a field dropdown, and a tick to confirm. Presentational
 * — the route owns the answer; this only reports what the customer decided
 * (`onTick`/`onRemove`/`onReject`) or that they closed it (`onClose`).
 *
 * `value`/`error` are the route's reading of `box` for `initialKey`'s field
 * (or the first fitting one) — what to show the moment the popover opens.
 * Browsing the `Select` afterwards is a purely local concern (there is no
 * "field changed" callback), so a fresh selection is resolved here, from
 * `box` and the newly chosen field's type, with the same `valueFromBox` /
 * `validateValue` pair `fieldsFor` used to decide `fits` in the first place.
 */
export function MarkPopover({
  open,
  at,
  box,
  value,
  fields,
  initialKey,
  error,
  suggestion,
  onTick,
  onRemove,
  onReject,
  onClose,
}: {
  open: boolean;
  at: { x: number; y: number };
  box: Box;
  value: string;
  fields: ReturnType<typeof fieldsFor>;
  initialKey?: string;
  error?: string;
  /** Open on a suggestion: that field's tick stores the suggested value, so its fitness and reason come from it (final review M1). */
  suggestion?: { key: string; value: string };
  onTick: (key: string) => void;
  onRemove?: () => void;
  onReject?: () => void;
  onClose: () => void;
}) {
  const defaultKey = () => initialKey ?? fields[0]?.field.key ?? '';
  const [selectedKey, setSelectedKey] = useState(defaultKey);

  // A fresh popover (a new box, or reopened for a different element) starts
  // back at its own default selection rather than whatever was last picked.
  useEffect(() => {
    if (open) setSelectedKey(defaultKey());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, box]);

  const selected = fields.find((f) => f.field.key === selectedKey) ?? fields[0];
  const isInitial = selectedKey === (initialKey ?? fields[0]?.field.key ?? '');

  // For the initial selection the route's own `value`/`error` are shown as
  // given; for any other one, resolved fresh here.
  const shown = isInitial
    ? (error ? { error } : { value })
    : selected
      ? resolveFor(box, selected.field.type)
      : { error: 'No fields on this project' };

  const forSuggestion = !!selected && !!suggestion && selected.field.key === suggestion.key;
  const fitReason =
    selected && !selected.fits
      ? forSuggestion
        ? (validateValue(selected.field.type, suggestion!.value) ?? 'This value does not fit this field')
        : reasonFor(box, selected.field.type)
      : null;

  return (
    // On UI SDK's popover (Marko 2026-11-19): the screenshot is itself a popover in the browser's top layer, and
    // only a popup of the same kind opens above it. Anchored to the point that was clicked.
    <Popover open={open} modal={false} onOpenChange={(next) => { if (!next) onClose(); }}>
      <PopoverContent
        anchor={{ x: at.x, y: at.y }}
        side="bottom"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        aria-label="Mark this value"
        className="shot-popover m-0 w-72 space-y-3 rounded-md border border-line bg-popover p-4 text-popover-foreground [box-shadow:var(--shadow)]"
      >
        {'error' in shown ? (
          <p className="text-sm text-fail">{shown.error}</p>
        ) : (
          <p className="line-clamp-2 font-mono text-base">{shown.value}</p>
        )}

        {/* The browser's own list: it opens above everything, the top layer included. */}
        <select
          aria-label="Field"
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
          className="h-8 w-full rounded-md border border-line bg-transparent px-2 text-base outline-none focus-visible:border-line-hover"
        >
          {selectedKey ? null : <option value="">Choose a field</option>}
          {fields.map((f) => (
            <option key={f.field.key} value={f.field.key}>
              {f.field.name}{f.answered ? ' · already on this product' : ''}
            </option>
          ))}
        </select>

        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {selected && selected.fits ? (
              <Button size="icon-sm" aria-label={`Confirm ${selected.field.name}`} onClick={() => onTick(selected.field.key)}>
                ✓
              </Button>
            ) : (
              <span className="min-w-0 truncate text-sm text-fail">{fitReason}</span>
            )}
            {onRemove ? (
              <Button variant="outline" size="sm" onClick={onRemove}>
                Remove
              </Button>
            ) : null}
          </div>
          {onReject ? (
            <Button variant="ghost" size="icon-sm" aria-label="Reject suggestion" onClick={onReject}>
              ×
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function resolveFor(box: Box, type: Parameters<typeof valueFromBox>[1]): { value: string } | { error: string } {
  const r = valueFromBox(box, type);
  return 'error' in r ? { error: r.error } : { value: r.value };
}

function reasonFor(box: Box, type: Parameters<typeof valueFromBox>[1]): string {
  const r = valueFromBox(box, type);
  if ('error' in r) return r.error;
  return validateValue(type, r.value) ?? 'This element does not fit this field';
}
