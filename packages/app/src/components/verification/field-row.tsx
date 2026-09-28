import { ChevronRight } from 'lucide-react';
import { Battery } from './battery';
import { BadgeView, FieldDetails, type FieldHint } from './field-details';
import { cn } from '../../lib/utils';
import { TYPE_LABELS } from '../../lib/fields-view';
import type { Badge, Field, Segment } from '../../lib/site/verification-model';

/** @deprecated Use `FieldHint` from `./field-details` — kept so this file's callers need no rename. */
export type FieldRowHint = FieldHint;

/**
 * One field, one row (spec §2.4): name and type, the battery, the engine's
 * verdict badge, and — expanded — the hint, Type it and the descriptor
 * (`FieldDetails`, moved out to `field-details.tsx` for the verification
 * table's own expanded row — table-first verification, task 2).
 *
 * `selected` is the rail that marks this as the field under the currently
 * selected rectangle on the screenshot; it is unrelated to `productNumber`,
 * which is which product card Type it and its aria-labels are for — a
 * concept the battery itself never needs, since selecting a product is shown
 * on the grid and the screenshot, not on this row.
 */
export function FieldRow({
  field,
  segments,
  badge,
  selected,
  productNumber,
  expanded,
  description,
  typed,
  typedError,
  hint,
  locked,
  onSegment,
  onToggle,
  onType,
  onDescription,
}: {
  field: Field;
  segments: Segment[];
  badge: Badge;
  selected: boolean;
  /** 1-based: the product Type it, and its input's aria-label, refer to. */
  productNumber: number;
  expanded: boolean;
  description: string;
  /** The value typed for `field` on product `productNumber`, resolved by the caller. */
  typed: string;
  typedError?: string;
  hint?: FieldRowHint;
  locked: boolean;
  onSegment: (i: number) => void;
  onToggle: () => void;
  onType: (value: string) => void;
  onDescription: (text: string) => void;
}) {
  return (
    <li className={cn('border-b border-line border-l-2 pl-2 last:border-b-0', selected ? 'border-l-text' : 'border-l-transparent')}>
      <div className="flex flex-wrap items-center gap-3 py-2.5 pr-2">
        {/* The toggle is its own button, not the whole row: the battery beside
            it is a set of buttons too, and a button cannot nest a button. */}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            aria-hidden
            className={cn('size-3 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')}
          />
          <span className="min-w-0 truncate text-base">{field.name}</span>
          <span className="shrink-0 text-sm text-muted-foreground">{TYPE_LABELS[field.type]}</span>
        </button>

        <Battery segments={segments} onSegment={onSegment} label={field.name} disabled={locked} />
        <BadgeView badge={badge} />
      </div>

      {expanded ? (
        <div className="pr-2 pb-3 pl-5">
          <FieldDetails
            field={field}
            productNumber={productNumber}
            description={description}
            typed={typed}
            typedError={typedError}
            hint={hint}
            locked={locked}
            onType={onType}
            onDescription={onDescription}
          />
        </div>
      ) : null}
    </li>
  );
}
