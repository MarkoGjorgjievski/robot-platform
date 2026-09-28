import { Fragment, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { TYPE_LABELS } from '../../lib/fields-view';
import { BadgeView, FieldDetails } from './field-details';
import type { Badge, Field, RowStatus, Segment } from '../../lib/site/verification-model';

export type TableCell = { value: string; state: Segment; selected: boolean; onClick: () => void };
export type TableRow = {
  field: Field;
  cells: TableCell[];
  status: RowStatus;
  badge: Badge;
  expanded: boolean;
  details: Omit<Parameters<typeof FieldDetails>[0], 'field' | 'locked'>;
  /** Agreed or same-everywhere ("Accept anyway"): what the status column's one action does. */
  onAccept: () => void;
  onToggle: () => void;
};

/** The 2 px rail a value cell carries in its state colour (spec §4: never a background wash). */
const CELL_BORDER: Record<Segment, string> = {
  empty: 'border-line',
  suggested: 'border-warn',
  answered: 'border-pass',
  failed: 'border-fail',
};

/** The value cell's aria-label state word — distinct from the battery's own ("confirmed"): the table calls an answered cell "accepted". */
const CELL_WORD: Record<Segment, string> = {
  empty: 'empty',
  suggested: 'suggested',
  answered: 'accepted',
  failed: 'failed',
};

function StatusCell({ field, status, badge, locked, onAccept }: { field: Field; status: RowStatus; badge: Badge; locked: boolean; onAccept: () => void }) {
  switch (status.kind) {
    case 'agreed':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">agreed</span>
          <Button variant="outline" size="xs" disabled={locked} aria-label={`Accept ${field.name}`} onClick={onAccept}>
            Accept
          </Button>
        </div>
      );
    case 'same-everywhere':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-warn">same on every product — check it</span>
          <Button variant="outline" size="xs" disabled={locked} aria-label={`Accept ${field.name} anyway`} onClick={onAccept}>
            Accept anyway
          </Button>
        </div>
      );
    case 'needs-you':
      return <span className="text-sm text-muted-foreground">{status.reason}</span>;
    case 'accepted':
      return <BadgeView badge={badge} />;
  }
}

/**
 * The verification table (spec 2026-09-28 A1): a row per field, a column per
 * product — the product cards become the column heads. Replaces the fields
 * sidebar and battery: each cell is the battery's own segment, spread out
 * with its value, and the last column says what the row needs and holds its
 * one action.
 *
 * Pure presentation — `heads` and `addHead` are drawn by the route (a
 * `ProductCard`/`AddProductCard` in `compact` mode), and every cell and
 * status action is a callback the route resolves against the model
 * (`rowStatus`, `acceptRow`, `acceptAllAgreed` in `lib/site/verification-model.ts`).
 */
export function VerificationTable({
  heads,
  addHead,
  rows,
  locked,
}: {
  /** One per product column, rendered by the route (`ProductCard` compact, or a blank slot). */
  heads: ReactNode[];
  /** `AddProductCard` compact, while there are fewer than six products. */
  addHead?: ReactNode;
  rows: TableRow[];
  locked: boolean;
}) {
  const totalCols = 1 + heads.length + (addHead ? 1 : 0) + 1;

  return (
    <div className="overflow-x-auto rounded-[6px] border border-line bg-panel">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col style={{ width: 180 }} />
          {heads.map((_, i) => (
            <col key={i} style={{ width: 190 }} />
          ))}
          {addHead ? <col style={{ width: 190 }} /> : null}
          <col style={{ width: 220 }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-panel px-2 py-2 text-left align-bottom text-sm font-normal text-muted-foreground">
              Field
            </th>
            {heads.map((head, i) => (
              <th key={i} scope="col" className="px-2 py-2 align-bottom font-normal">
                {head}
              </th>
            ))}
            {addHead ? (
              <th scope="col" className="px-2 py-2 align-bottom font-normal">
                {addHead}
              </th>
            ) : null}
            <th scope="col" className="px-2 py-2 text-left align-bottom text-sm font-normal text-muted-foreground">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.field.key}>
              <tr>
                <th scope="row" className="sticky left-0 z-10 w-[180px] border-t border-line bg-panel px-2 py-2 text-left align-top font-normal">
                  <button
                    type="button"
                    aria-expanded={row.expanded}
                    onClick={row.onToggle}
                    className="flex min-w-0 items-center gap-1.5 text-left"
                  >
                    <ChevronRight
                      aria-hidden
                      className={cn('size-3 shrink-0 text-muted-foreground transition-transform', row.expanded && 'rotate-90')}
                    />
                    <span className="min-w-0 truncate text-base">{row.field.name}</span>
                  </button>
                  <span className="block pl-[18px] text-sm text-muted-foreground">{TYPE_LABELS[row.field.type]}</span>
                </th>

                {row.cells.map((cell, i) => (
                  <td key={i} className="w-[190px] border-t border-line p-0 align-top">
                    <button
                      type="button"
                      disabled={locked}
                      aria-label={`${row.field.name} on product ${i + 1}: ${CELL_WORD[cell.state]}`}
                      onClick={cell.onClick}
                      className={cn(
                        'flex h-full w-full items-center border-l-2 px-2 py-2 text-left disabled:cursor-not-allowed',
                        CELL_BORDER[cell.state],
                        cell.selected && 'outline outline-1 outline-text',
                      )}
                    >
                      <span className="min-w-0 truncate font-mono text-base" title={cell.value || undefined}>
                        {cell.value || '—'}
                      </span>
                    </button>
                  </td>
                ))}

                {addHead ? <td className="w-[190px] border-t border-line" /> : null}

                <td className="w-[220px] border-t border-line px-2 py-2 align-top">
                  <StatusCell field={row.field} status={row.status} badge={row.badge} locked={locked} onAccept={row.onAccept} />
                </td>
              </tr>

              {row.expanded ? (
                <tr>
                  <td colSpan={totalCols} className="border-t border-line bg-panel px-3 py-3">
                    <FieldDetails field={row.field} locked={locked} {...row.details} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
