import { ShieldCheck } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { RunDot } from '../run-dot';
import { failsText, type Badge, type Field } from '../../lib/site/verification-model';

/**
 * A line about the selected product that a cell click cannot say on its own:
 * a page-data value no element shows (with a tick and ×), or a suggestion
 * outlined in several places. Presentational — the caller decides what
 * accepting or rejecting means. Moved from field-row.tsx's `FieldRowHint`
 * (table-first verification, task 2).
 */
export type FieldHint = { text: string; value?: string; onAccept?: () => void; onReject?: () => void };

/** The engine's verdict on a field, after a Verify (spec §2.4). Moved from field-row.tsx. */
export function BadgeView({ badge }: { badge: Badge }) {
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
      return <span className="shrink-0 text-sm text-fail">{failsText(badge.products)}</span>;
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
 * A field's expanded row (spec 2026-09-28 A1: "Expanding a row shows the
 * descriptor and, for the selected product, Type it"): the hint the selected
 * product's cell cannot show on its own, Type it (a value for that product
 * that cannot be clicked), and the descriptor (where the field lives on this
 * website, in the customer's own words). Moved from field-row.tsx, where this
 * was the row's hint line plus its `expanded` block.
 */
export function FieldDetails({
  field,
  productNumber,
  description,
  typed,
  typedError,
  hint,
  locked,
  onType,
  onDescription,
}: {
  field: Field;
  /** 1-based: the product Type it, and its input's aria-label, refer to. */
  productNumber: number;
  description: string;
  /** The value typed for `field` on product `productNumber`, resolved by the caller. */
  typed: string;
  typedError?: string;
  hint?: FieldHint;
  locked: boolean;
  onType: (value: string) => void;
  onDescription: (text: string) => void;
}) {
  const saved = typedError === undefined && typed.trim() !== '';

  return (
    <div className="space-y-3">
      {hint ? (
        <div className="flex min-w-0 items-center gap-2">
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
  );
}
