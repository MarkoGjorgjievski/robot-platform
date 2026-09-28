import { FieldRow, type FieldRowHint } from './field-row';
import { VerifyBar } from './verify-bar';
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

/**
 * The Verification tab's right rail (spec §2.4–§2.5): every project field, in
 * order, with its battery and verdict; the Verify gate and its footer
 * (`VerifyBar`, moved out for the verification table's own bar — table-first
 * verification, task 2; this sidebar has no "agreed" rows of its own, so it
 * always offers nothing to accept in one click).
 *
 * Locking is one flag for the whole rail, not one per row — `stage` is only
 * non-null while a Verify run is in flight (spec §2.5: "the rectangles, cards
 * and inputs lock" for that same span), so it doubles as the lock.
 */
export function FieldsSidebar({
  rows,
  verify,
  saveState,
  saveError,
  extract,
  stage,
}: {
  rows: FieldsSidebarRow[];
  verify: { label: string; disabled: boolean; reason?: string; busy: boolean; onClick: () => void };
  saveState: 'idle' | 'pending' | 'saving' | 'error';
  /** The server's reason the last save was refused, in one line; shown with the error state. */
  saveError?: string | null;
  extract: { enabled: boolean; project: string; site: string };
  /** Where a running Verify is, e.g. "checking product 2 of 3". `null` when nothing is running. */
  stage: string | null;
}) {
  const locked = stage !== null;

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

      <VerifyBar
        acceptAll={{ count: 0, disabled: true, onClick: () => {} }}
        verify={verify}
        saveState={saveState}
        saveError={saveError}
        extract={extract}
        stage={stage}
      />
    </div>
  );
}
