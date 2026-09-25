import { ArrowRight, Loader2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { FieldRow, type FieldRowHint } from './field-row';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';
import type { Badge, Field, Segment } from '../../lib/site/verification-model';

export type FieldsSidebarRow = {
  field: Field;
  segments: Segment[];
  badge: Badge;
  /** This field is the one under the selected rectangle on the screenshot. */
  selected: boolean;
  /** 1-based: the product Type it, and its input's aria-label, refer to. */
  productNumber: number;
  expanded: boolean;
  description: string;
  /** The value typed for `field` on that product, resolved by the caller. */
  typed: string;
  typedError?: string;
  /** A line under the row for the selected product (see `FieldRowHint`). */
  hint?: FieldRowHint;
  onSegment: (i: number) => void;
  onToggle: () => void;
  onType: (value: string) => void;
  onDescription: (text: string) => void;
};

const SAVE_LABEL: Record<'idle' | 'pending' | 'saving' | 'error', { text: string; className: string }> = {
  idle: { text: 'saved', className: 'text-muted-foreground' },
  pending: { text: 'saving…', className: 'text-muted-foreground' },
  saving: { text: 'saving…', className: 'text-muted-foreground' },
  error: { text: 'Not saved — it will try again on your next change or when you verify', className: 'text-warn' },
};

/**
 * The Verification tab's right rail (spec §2.4–§2.5): every project field, in
 * order, with its battery and verdict; the Verify gate and its footer.
 *
 * Locking is one flag for the whole rail, not one per row — `stage` is only
 * non-null while a Verify run is in flight (spec §2.5: "the rectangles, cards
 * and inputs lock" for that same span), so it doubles as the lock.
 */
export function FieldsSidebar({
  rows,
  verify,
  saveState,
  extract,
  stage,
}: {
  rows: FieldsSidebarRow[];
  verify: { label: string; disabled: boolean; reason?: string; busy: boolean; onClick: () => void };
  saveState: 'idle' | 'pending' | 'saving' | 'error';
  extract: { enabled: boolean; project: string; site: string };
  /** Where a running Verify is, e.g. "checking product 2 of 3". `null` when nothing is running. */
  stage: string | null;
}) {
  const locked = stage !== null;
  const save = SAVE_LABEL[saveState];

  return (
    <div className="rise flex flex-col rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
      <ul>
        {rows.map((row) => (
          <FieldRow
            key={row.field.key}
            field={row.field}
            segments={row.segments}
            badge={row.badge}
            selected={row.selected}
            productNumber={row.productNumber}
            expanded={row.expanded}
            description={row.description}
            typed={row.typed}
            typedError={row.typedError}
            hint={row.hint}
            locked={locked}
            onSegment={row.onSegment}
            onToggle={row.onToggle}
            onType={row.onType}
            onDescription={row.onDescription}
          />
        ))}
      </ul>

      <div className="space-y-2 border-t border-line px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={verify.disabled} onClick={verify.onClick}>
            {verify.busy ? <Loader2 className="animate-spin" /> : null}
            {verify.label}
          </Button>
          {/* Every disabled control says why, within a line of it. */}
          {verify.disabled && verify.reason ? (
            <span className="min-w-0 truncate text-sm text-muted-foreground" title={verify.reason}>
              {verify.reason}
            </span>
          ) : null}
        </div>

        <p className={cn('text-sm', save.className)}>{save.text}</p>

        {stage ? <p className="text-sm text-muted-foreground">{stage}</p> : null}

        {extract.enabled ? (
          <Link
            to="/projects/$project/sites/$site/extract"
            params={{ project: extract.project, site: extract.site }}
            className={cn(buttonVariants({ size: 'sm' }), 'w-full')}
          >
            Go to Extract
            <ArrowRight />
          </Link>
        ) : (
          <div>
            <Button size="sm" variant="outline" disabled className="w-full">
              Go to Extract
              <ArrowRight />
            </Button>
            <p className="mt-1 text-sm text-muted-foreground">Unlocks when every field is verified</p>
          </div>
        )}
      </div>
    </div>
  );
}
