import { ChevronRight, ShieldCheck } from 'lucide-react';
import { Battery } from './battery';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { RunDot } from '../run-dot';
import { cn } from '../../lib/utils';
import { TYPE_LABELS } from '../../lib/fields-view';
import type { Badge, Field, Segment } from '../../lib/site/verification-model';

/**
 * A line under the row about the selected product that the screenshot cannot
 * say on its own: a page-data value no element shows (with a tick and ×), or
 * a suggestion outlined in several places. Presentational — the caller
 * decides what accepting or rejecting means.
 */
export type FieldRowHint = { text: string; value?: string; onAccept?: () => void; onReject?: () => void };

function BadgeView({ badge }: { badge: Badge }) {
  if (!badge) return null;
  switch (badge.kind) {
    case 'verified':
      return (
        <span className="inline-flex shrink-0 items-center gap-1 text-sm text-text">
          <ShieldCheck aria-hidden className="size-3.5" />
          verified
        </span>
      );
    case 'fails':
      return <span className="shrink-0 text-sm text-fail">fails on product {badge.product}</span>;
    case 'changed':
      return <span className="shrink-0 text-sm text-muted-foreground">changed since verified</span>;
    case 'checking':
      return (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
          <RunDot status="running" />
          checking…
        </span>
      );
  }
}

/**
 * One field, one row (spec §2.4): name and type, the battery, the engine's
 * verdict badge, and — expanded — Type it (a value for the selected product
 * that cannot be clicked) and the descriptor (where the field lives on this
 * website, in the customer's own words).
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
  const saved = typedError === undefined && typed.trim() !== '';

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

      {hint ? (
        <div className="flex min-w-0 items-center gap-2 pr-2 pb-2 pl-5">
          <span className="min-w-0 truncate text-sm text-warn" title={hint.value !== undefined ? `${hint.text}: ${hint.value}` : hint.text}>
            {hint.text}
            {hint.value !== undefined ? (
              <>
                : <span className="font-mono">{hint.value}</span>
              </>
            ) : null}
          </span>
          {hint.onAccept ? (
            <Button variant="outline" size="icon-xs" disabled={locked} aria-label={`Confirm ${field.name} from the page data`} onClick={hint.onAccept} className="shrink-0">
              ✓
            </Button>
          ) : null}
          {hint.onReject ? (
            <Button variant="ghost" size="icon-xs" disabled={locked} aria-label={`Reject the ${field.name} suggestion`} onClick={hint.onReject} className="shrink-0">
              ×
            </Button>
          ) : null}
        </div>
      ) : null}

      {expanded ? (
        <div className="space-y-3 pr-2 pb-3">
          <div>
            <span className="mb-1 block text-sm text-muted-foreground">Type it</span>
            <Input
              aria-label={`${field.name} on product ${productNumber}`}
              value={typed}
              disabled={locked}
              onChange={(e) => onType(e.target.value)}
            />
            {typedError ? (
              <p className="mt-1 text-sm text-fail">{typedError}</p>
            ) : saved ? (
              <p className="mt-1 text-sm text-muted-foreground">typed</p>
            ) : null}
          </div>

          <div>
            <span className="mb-1 block text-sm text-muted-foreground">Descriptor</span>
            <Textarea
              aria-label={`Where ${field.name} is on this website`}
              rows={2}
              value={description}
              disabled={locked}
              onChange={(e) => onDescription(e.target.value)}
            />
          </div>
        </div>
      ) : null}
    </li>
  );
}
