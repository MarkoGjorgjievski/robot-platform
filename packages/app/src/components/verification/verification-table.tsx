import { Fragment, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '../ui/context-menu';
import { cn } from '../../lib/utils';
import { TYPE_LABELS } from '../../lib/fields-view';
import { BadgeView, FieldDetails } from './field-details';
import { LOCKED_REASON } from './verify-bar';
import { VariantsRow, type VariantsRowProps } from './variants-row';
import { cellLabel, type Badge, type Field, type RowStatus, type Segment } from '../../lib/site/verification-model';
import { fixLabel, moveSelection, type CellSelection, type MoveKey } from '../../lib/site/table-selection';

/**
 * One cell: its display value, state, the product's URL (for "Open product
 * page"), and — only for a suggestion found in one place — the one-click
 * accept a tick would do (spec 2026-09-29 A7). Clicking the cell selects it
 * (spec 2026-10-07 §1); the table reports that through `onSelect`.
 */
export type TableCell = { value: string; state: Segment; url: string; onAccept?: () => void };

/**
 * The drift check's repair line(s) for a field (plan 2026-10-05 Task 4),
 * built by the route from `driftRows` (`lib/site/drift-view.ts`) — the text
 * is already the plan's exact copy; this only says what each action does.
 * `onSeeMissed` is null when the check carries no `runId` to link to; a
 * moved line's `onAccept` is null when it carries no mark to accept.
 */
export type DriftLine =
  | { kind: 'moved'; text: string; onAccept: (() => void) | null }
  | { kind: 'changed'; text: string; onAccept: () => void }
  | { kind: 'other-layout'; text: string; onSeeMissed: (() => void) | null }
  | { kind: 'lost'; text: string; onMarkAgain: () => void }
  | { kind: 'page-gone'; items: Array<{ product: number; text: string; onReplace: () => void }> };

export type TableRow = {
  field: Field;
  cells: TableCell[];
  status: RowStatus;
  badge: Badge;
  /** "n/m" shown after a Verify badge (spec 2026-10-07 §2, `headerCount`); null hides it. */
  count: { passed: number; checked: number } | null;
  expanded: boolean;
  details: Omit<Parameters<typeof FieldDetails>[0], 'field' | 'locked'>;
  /** Agreed, majority or same-everywhere ("Accept anyway"): what the status column's one action does. */
  onAccept: () => void;
  onToggle: () => void;
  /** Shown under the row whatever `expanded` is — a field can be both drifted and expanded. */
  drift?: DriftLine[];
};

/** The 2 px rail a value cell carries in its state colour (spec §4: never a background wash). */
const CELL_BORDER: Record<Segment, string> = {
  empty: 'border-line',
  suggested: 'border-warn',
  answered: 'border-pass',
  failed: 'border-fail',
};

/** "product 3" / "products 3 and 4" / "products 2, 3 and 4". */
function productsText(ns: number[]): string {
  if (ns.length === 1) return `product ${ns[0]}`;
  return `products ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

function StatusCell({ field, status, badge, count, locked, onAccept }: { field: Field; status: RowStatus; badge: Badge; count: { passed: number; checked: number } | null; locked: boolean; onAccept: () => void }) {
  switch (status.kind) {
    case 'agreed':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">agreed</span>
          <Button variant="outline" size="xs" disabled={locked} aria-label={`Accept ${field.name}`} title={locked ? LOCKED_REASON : undefined} onClick={onAccept}>
            Accept
          </Button>
          {locked ? <span className="text-sm text-muted-foreground">{LOCKED_REASON}</span> : null}
        </div>
      );
    case 'majority':
      // Spec A4: Accept takes the majority's cells only; the odd product stays for a person.
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-warn">different place on {productsText(status.odd)} — check it</span>
          <Button variant="outline" size="xs" disabled={locked} aria-label={`Accept ${field.name}`} title={locked ? LOCKED_REASON : undefined} onClick={onAccept}>
            Accept
          </Button>
          {locked ? <span className="text-sm text-muted-foreground">{LOCKED_REASON}</span> : null}
        </div>
      );
    case 'same-everywhere':
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-warn">
            same on every product — check it{status.odd?.length ? `; ${productsText(status.odd)} ${status.odd.length === 1 ? 'differs' : 'differ'}` : ''}
          </span>
          <Button variant="outline" size="xs" disabled={locked} aria-label={`Accept ${field.name} anyway`} title={locked ? LOCKED_REASON : undefined} onClick={onAccept}>
            Accept anyway
          </Button>
          {locked ? <span className="text-sm text-muted-foreground">{LOCKED_REASON}</span> : null}
        </div>
      );
    case 'needs-you':
      return <span className="text-sm text-muted-foreground">{status.reason}</span>;
    case 'accepted':
      return (
        <span className="inline-flex flex-wrap items-center gap-2">
          <BadgeView badge={badge} />
          {count && badge && (badge.kind === 'verified' || badge.kind === 'fails') ? (
            <span className="text-sm text-muted-foreground" aria-label={`${count.passed} of ${count.checked} products`}>
              {count.passed}/{count.checked}
            </span>
          ) : null}
        </span>
      );
  }
}

/**
 * The drift line(s) under a drifted row (plan 2026-10-05 Task 4): the exact
 * copy from `driftRows`, plus the one action each kind carries — disabled
 * with the same lock as every other row action, except "See missed
 * products", a navigation rather than a board edit.
 */
function DriftLines({ field, lines, locked }: { field: Field; lines: DriftLine[]; locked: boolean }) {
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        switch (line.kind) {
          case 'moved':
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-warn">{line.text}</span>
                {line.onAccept ? (
                  <Button variant="outline" size="xs" disabled={locked} aria-label={`Accept new location for ${field.name}`} onClick={line.onAccept}>
                    Accept new location
                  </Button>
                ) : null}
              </div>
            );
          case 'changed':
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-warn">{line.text}</span>
                <Button variant="outline" size="xs" disabled={locked} aria-label={`Accept new values for ${field.name}`} onClick={line.onAccept}>
                  Accept new values
                </Button>
              </div>
            );
          case 'lost':
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-warn">{line.text}</span>
                <Button variant="outline" size="xs" disabled={locked} aria-label={`Mark ${field.name} again`} onClick={line.onMarkAgain}>
                  Mark it again
                </Button>
              </div>
            );
          case 'other-layout':
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-warn">{line.text}</span>
                {line.onSeeMissed ? (
                  <Button variant="outline" size="xs" onClick={line.onSeeMissed}>
                    See missed products
                  </Button>
                ) : null}
              </div>
            );
          case 'page-gone':
            return (
              <div key={i} className="space-y-1.5">
                {line.items.map((it) => (
                  <div key={it.product} className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-warn">{it.text}</span>
                    <Button variant="outline" size="xs" disabled={locked} aria-label={`Replace product ${it.product} (${field.name})`} onClick={it.onReplace}>
                      Replace product {it.product}
                    </Button>
                  </div>
                ))}
              </div>
            );
        }
      })}
    </div>
  );
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
const MOVE_KEYS: ReadonlySet<string> = new Set<MoveKey>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

function inTextField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function VerificationTable({
  heads,
  addHead,
  rows,
  locked,
  variants,
  selection,
  keyboard,
  onSelect,
  onFix,
  onCopy,
  onTypeIt,
  onEscape,
}: {
  /** One per product column, rendered by the route (`ProductCard` compact, or a blank slot). */
  heads: ReactNode[];
  /** `AddProductCard` compact, while there are fewer than six products. */
  addHead?: ReactNode;
  rows: TableRow[];
  locked: boolean;
  /**
   * The Variants row (spec 2026-10-01 §4.1), after the fields: drawn only
   * while this website needs variant certification — a need other than
   * `none` and a method of `list` or `links`. Never in `ignore` mode.
   */
  variants?: VariantsRowProps | null;
  /** The selected cell (spec 2026-10-07 §1), owned by the route. */
  selection: CellSelection | null;
  /** False while the mark popover or the variants mark mode owns the keyboard. */
  keyboard: boolean;
  onSelect: (sel: CellSelection) => void;
  /** Fix / Mark: open the screenshot on this cell (spec §4). */
  onFix: (sel: CellSelection) => void;
  onCopy: (sel: CellSelection) => void;
  onTypeIt: (key: string) => void;
  /** Escape with nothing else to close: the route clears the selection or closes the panel. */
  onEscape: () => void;
}) {
  const totalCols = 1 + heads.length + (addHead ? 1 : 0) + 1;
  const fieldKeys = rows.map((r) => r.field.key);
  const products = heads.length;

  // Roving tabindex: after a key moved the selection, focus follows it — but
  // only then. A click already focused its own cell, and a selection made by
  // the route (Fix from the bar, a reload) must not steal focus from an input.
  const wrapRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef(false);
  /**
   * Radix's ContextMenu returns focus to its trigger (the cell) once it
   * closes. "Type it" needs the opposite — the Type input it just focused —
   * so it flags this ref before closing and the cell's `onCloseAutoFocus`
   * skips the default return exactly once.
   */
  const skipReturnFocus = useRef(false);
  useEffect(() => {
    if (!focusNext.current || !selection) return;
    focusNext.current = false;
    wrapRef.current?.querySelector<HTMLButtonElement>(`button[data-cell="${selection.product}:${selection.key}"]`)?.focus();
  }, [selection]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!keyboard || e.defaultPrevented || inTextField(e.target)) return;
    // Only keys aimed at a cell: the status column's buttons keep their own Enter.
    const onCell = (e.target as HTMLElement | null)?.closest?.('button[data-cell]');
    if (e.key === 'Escape') {
      if (!onCell) return;
      e.preventDefault();
      onEscape();
      return;
    }
    if (!selection || !onCell) return;
    // Modified keys are the browser's: Ctrl+F (find), Alt+Left/Right (back/forward),
    // Ctrl+Home/End, etc. Shift alone carries no browser shortcut here, so it still moves.
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    if (MOVE_KEYS.has(e.key) && !mod) {
      const next = moveSelection(selection, e.key as MoveKey, fieldKeys, products);
      e.preventDefault();
      if (next.product === selection.product && next.key === selection.key) return;
      focusNext.current = true;
      onSelect(next);
      return;
    }
    if ((e.key === 'Enter' || e.key === 'f' || e.key === 'F') && !mod) {
      if (locked) return;
      e.preventDefault();
      onFix(selection);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      // A dragged text selection inside the cell keeps native copy (Review Focus 4).
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      onCopy(selection);
    }
  }

  return (
    <div ref={wrapRef} onKeyDown={onKeyDown} className="overflow-x-auto rounded-[6px] border border-line bg-panel">
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
          {rows.map((row, fi) => (
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

                {row.cells.map((cell, i) => {
                  const sel: CellSelection = { product: i, key: row.field.key };
                  const isSelected = selection?.product === i && selection.key === row.field.key;
                  // Tab enters the table once: at the selected cell, else the first cell.
                  const tabbable = isSelected || (!selection && fi === 0 && i === 0);
                  const label = fixLabel(cell.state);
                  const value = cell.value.trim();
                  return (
                    <td key={i} className="group relative w-[190px] border-t border-line p-0 align-top">
                      <ContextMenu onOpenChange={(open) => { if (open) skipReturnFocus.current = false; }}>
                        <ContextMenuTrigger asChild>
                          <button
                            type="button"
                            data-cell={`${i}:${row.field.key}`}
                            data-selected={isSelected ? 'true' : undefined}
                            tabIndex={tabbable ? 0 : -1}
                            aria-label={cellLabel(row.field.name, i + 1, cell.state, cell.value)}
                            onClick={() => onSelect(sel)}
                            onContextMenu={() => onSelect(sel)}
                            className={cn(
                              'flex h-full w-full items-center border-l-2 px-2 py-2 text-left',
                              CELL_BORDER[cell.state],
                              isSelected && 'outline outline-1 outline-text',
                              cell.onAccept ? 'pr-14' : 'pr-9',
                            )}
                          >
                            <span className="min-w-0 truncate font-mono text-base" title={cell.value || undefined}>
                              {cell.value || '—'}
                            </span>
                          </button>
                        </ContextMenuTrigger>
                        <ContextMenuContent
                          onCloseAutoFocus={(e) => {
                            if (skipReturnFocus.current) {
                              skipReturnFocus.current = false;
                              e.preventDefault();
                            }
                          }}
                        >
                          <ContextMenuItem disabled={!value} onSelect={() => onCopy(sel)}>
                            Copy value
                          </ContextMenuItem>
                          <ContextMenuItem disabled={!cell.url.trim()} onSelect={() => window.open(cell.url, '_blank', 'noopener,noreferrer')}>
                            Open product page
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem disabled={locked} onSelect={() => onFix(sel)}>
                            {label} on screenshot
                          </ContextMenuItem>
                          <ContextMenuItem
                            disabled={locked}
                            onSelect={() => {
                              skipReturnFocus.current = true;
                              onTypeIt(row.field.key);
                            }}
                          >
                            Type it
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>

                      {/* Fix / Mark (spec 2026-10-07 §2): on hover and on the selected cell; always on a red cell. */}
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={locked}
                        aria-label={`${label} ${row.field.name} on product ${i + 1} on the screenshot`}
                        title={locked ? LOCKED_REASON : `${label} on the screenshot`}
                        onClick={() => onFix(sel)}
                        className={cn(
                          'absolute top-1/2 -translate-y-1/2 bg-panel text-muted-foreground hover:text-text focus-visible:opacity-100',
                          cell.onAccept ? 'right-8' : 'right-1',
                          cell.state === 'failed' || isSelected ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
                        )}
                      >
                        {label}
                      </Button>
                      {cell.onAccept ? (
                        <Button
                          variant="outline"
                          size="icon-xs"
                          disabled={locked}
                          aria-label={`Accept ${row.field.name} on product ${i + 1}`}
                          title={`Accept ${row.field.name} on product ${i + 1}`}
                          onClick={cell.onAccept}
                          className="absolute top-1/2 right-1 -translate-y-1/2 bg-panel opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <Check aria-hidden className="size-3" />
                        </Button>
                      ) : null}
                    </td>
                  );
                })}

                {addHead ? <td className="w-[190px] border-t border-line" /> : null}

                <td className="w-[220px] border-t border-line px-2 py-2 align-top">
                  <StatusCell field={row.field} status={row.status} badge={row.badge} count={row.count} locked={locked} onAccept={row.onAccept} />
                </td>
              </tr>

              {row.drift && row.drift.length > 0 ? (
                <tr>
                  <td colSpan={totalCols} className="border-t border-line bg-panel px-3 py-2">
                    <DriftLines field={row.field} lines={row.drift} locked={locked} />
                  </td>
                </tr>
              ) : null}

              {row.expanded ? (
                <tr>
                  <td colSpan={totalCols} className="border-t border-line bg-panel px-3 py-3">
                    <FieldDetails field={row.field} locked={locked} {...row.details} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
          {variants && variants.need.kind !== 'none' && (variants.method === 'list' || variants.method === 'links') ? (
            <VariantsRow props={variants} locked={locked} hasAddHead={!!addHead} />
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
