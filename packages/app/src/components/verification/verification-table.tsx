import { Fragment, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '../ui/context-menu';
import { cn } from '../../lib/utils';
import { TYPE_LABELS } from '../../lib/fields-view';
import { BadgeView, FieldDetails } from './field-details';
import { liveCell, type LiveCell } from '../../lib/site/live-cells';
import { LOCKED_REASON } from './verify-bar';
import { VariantsRow, type VariantsRowProps } from './variants-row';
import { cellLabel, DEFAULT_CELL_TITLE, REVERIFY_FIELD, REVERIFY_FIELD_FREE, type Badge, type Field, type RowStatus, type Segment } from '../../lib/site/verification-model';
import { ScrollArea, ScrollAreaContent, ScrollAreaViewport } from '@ui-sdk/react/scroll-area';
import { fixLabel, moveSelection, type CellSelection, type MoveKey } from '../../lib/site/table-selection';

/**
 * One cell: its display value, state, the product's URL (for "Open product
 * page"), and — only for a suggestion found in one place — the one-click
 * accept a tick would do (spec 2026-09-29 A7). Clicking the cell selects it
 * (spec 2026-10-07 §1); the table reports that through `onSelect`.
 */
/**
 * `notOnPage` (spec 2026-10-12 §B2): a typed value the proof page's stored
 * text does not show — `typedNotShown` in `lib/site/verification-model.ts`'s
 * neighbour `shown.ts`. Certification still runs on whatever path produces
 * the value at scale; this only warns the person typing it at Verify.
 */
export type TableCell = {
  value: string; state: Segment; url: string; onAccept?: () => void; absent?: boolean; notOnPage?: boolean;
  /** A blank cell on a field with a default (spec 2026-10-13 §6): shows the default, muted, under `DEFAULT_CELL_TITLE`. */
  isDefault?: boolean;
  /** The cell the row's "changed since verified" is about (Marko 2026-11-18): its product was not part of the field's last verification. */
  changed?: boolean;
};

const NOT_ON_PAGE_TITLE = 'The page does not show this value; a path that produces it will be certified anyway. Mark it on the screenshot if it is there, or use "Not on this product".';

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
  /** Spec 2026-10-21 §5: "Updated automatically on {d MMM}: …" — information, nothing to act on. */
  | { kind: 'refreshed'; text: string }
  /** `onReplace` is null for a page that could not be read now: it still exists, so there is nothing to replace. */
  | { kind: 'page-gone'; items: Array<{ product: number; text: string; onReplace: (() => void) | null }> };

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
  /** The coverage check's line for this field (spec 2026-10-10 §A5), shown under the row like `drift`. */
  coverage?: { text: string; onUseAsProofPage: (() => void) | null };
  /** The field has a website default (spec 2026-10-13 §6): "Not on this product" is not offered on its cells. */
  hasDefault: boolean;
  /** Same-everywhere's second action: make the row's value the website's default and accept the row. */
  onMakeDefault: () => void;
  /** `DEFAULT_ONLY_WORD` beside the verified badge of a field that passed by default only; null otherwise. */
  defaultOnlyWord: string | null;
  /** `ADDRESS_WARNING`: a certified fixed-index path on a proof page whose address names a variant
   * (spec 2026-10-14 §6); shown under the status, never changes it or the badge. Null hides it. */
  addressWarning: string | null;
  /** Re-verifies this row's field alone, for the address warning (spec 2026-10-17 §8). */
  onReverifyField?: () => void;
  /** Jev's note for the row (spec 2026-10-16 §6, `jevNote`): shown muted under the status, never changes it. Null hides it. */
  jevNote: string | null;
  /** A held field's word (spec 2026-10-21 §5, `heldWord`): shown under the status whatever the row's status is —
   * a held row's cells may read failed or suggested, and the customer must still see that runs go on. Null hides it. */
  heldWord: string | null;
  /** A needs-you row's one action (`rowFix`, first run 2026-10-25): the named product's Fix / Mark on the screenshot. Null hides it. */
  fix: { product: number; label: 'Fix' | 'Mark' } | null;
  /** A needs-you row's way out beside the screenshot (`rowOffer`): accept the page data's values, or mark the field not on this website. Null hides it. */
  offer: { kind: 'page-data' | 'not-on-website'; onTake: () => void } | null;
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

/** Rows whose status column offers a plain Accept: the A key takes the same one. */
const ACCEPTABLE = new Set<string>(['agreed', 'majority']);

type StatusCellProps = { field: Field; status: RowStatus; badge: Badge; count: { passed: number; checked: number } | null; locked: boolean; onAccept: () => void; onMakeDefault: () => void; fix: TableRow['fix']; offer: TableRow['offer']; onFix: (sel: CellSelection) => void; defaultOnlyWord: string | null; addressWarning: string | null; jevNote: string | null; heldWord: string | null; onReverifyField?: () => void; showMoney: boolean };

/** The status column: the row's status, and under it the address warning (spec 2026-10-14 §6)
 * when the row is accepted or agreed, or whenever the badge reads verified; then Jev's note
 * (spec 2026-10-16 §6), muted, whatever the status — it never changes the status. */
function StatusCell({ addressWarning, jevNote, heldWord, onReverifyField, showMoney, ...props }: StatusCellProps) {
  const shows = !!addressWarning && (props.status.kind === 'accepted' || props.status.kind === 'agreed' || props.badge?.kind === 'verified');
  if (!shows && !jevNote && !heldWord) return <StatusBody {...props} />;
  return (
    <div className="flex flex-col gap-1">
      <StatusBody {...props} />
      {heldWord ? <span className="text-sm text-muted-foreground">{heldWord}</span> : null}
      {shows ? (
        <span className="flex flex-wrap items-center gap-2 text-sm text-warn">
          <span>{addressWarning}</span>
          {onReverifyField ? (
            <Button size="sm" variant="outline" disabled={props.locked} onClick={onReverifyField}>
              {showMoney ? REVERIFY_FIELD_FREE : REVERIFY_FIELD}
            </Button>
          ) : null}
        </span>
      ) : null}
      {jevNote ? <span className="text-sm text-muted-foreground" data-testid="jev-note">{jevNote}</span> : null}
    </div>
  );
}

function StatusBody({ field, status, badge, count, locked, onAccept, onMakeDefault, fix, offer, onFix, defaultOnlyWord }: Omit<StatusCellProps, 'addressWarning' | 'jevNote' | 'heldWord' | 'onReverifyField' | 'showMoney'>) {
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
      // Accept takes every cell, the odd product included: clicking it beside the warning is the customer's check (first run 2026-10-25, re-run 3).
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
            {/* The value is the same on every product, odd ones included (first run 2026-10-25): an odd product differs only in where it was found. */}
            same on every product — check it{status.odd?.length ? `; different place on ${productsText(status.odd)}` : ''}
          </span>
          <Button variant="outline" size="xs" disabled={locked} aria-label={`Accept ${field.name} anyway`} title={locked ? LOCKED_REASON : undefined} onClick={onAccept}>
            Accept anyway
          </Button>
          <Button variant="outline" size="xs" disabled={locked} aria-label={`Make ${field.name} the default for this website`} title={locked ? LOCKED_REASON : undefined} onClick={onMakeDefault}>
            Make it the default
          </Button>
          {locked ? <span className="text-sm text-muted-foreground">{LOCKED_REASON}</span> : null}
        </div>
      );
    case 'needs-you':
      if (!fix && !offer) return <span className="text-sm text-muted-foreground">{status.reason}</span>;
      // A value the page does not show has nothing to fix on the screenshot: its button reads Mark.
      const fixWord = offer?.kind === 'page-data' ? 'Mark' : fix?.label;
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{offer?.kind === 'not-on-website' ? 'not found on any product' : status.reason}</span>
          {offer?.kind === 'page-data' ? (
            <Button variant="outline" size="xs" disabled={locked} aria-label={`Accept ${field.name} from the page data`} title={locked ? LOCKED_REASON : 'The page carries this value in its data without showing it as text'} onClick={offer.onTake}>
              Accept page data
            </Button>
          ) : null}
          {offer?.kind === 'not-on-website' ? (
            <Button variant="outline" size="xs" disabled={locked} aria-label={`${field.name} is not on this website`} title={locked ? LOCKED_REASON : 'Leave this field empty for this website'} onClick={offer.onTake}>
              Not on this website
            </Button>
          ) : null}
          {fix ? (
            <Button
              variant="outline"
              size="xs"
              disabled={locked}
              aria-label={`${fixWord} ${field.name} on the screenshot of product ${fix.product}`}
              title={locked ? LOCKED_REASON : undefined}
              onClick={() => onFix({ product: fix.product - 1, key: field.key })}
            >
              {fixWord} on screenshot
            </Button>
          ) : null}
        </div>
      );
    case 'accepted':
      return (
        <span className="inline-flex flex-wrap items-center gap-2">
          <BadgeView badge={badge} />
          {defaultOnlyWord ? <span className="text-sm text-muted-foreground">{defaultOnlyWord}</span> : null}
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
          case 'refreshed':
            return (
              <div key={i} className="text-sm text-muted-foreground">
                {line.text}
              </div>
            );
          case 'page-gone':
            return (
              <div key={i} className="space-y-1.5">
                {line.items.map((it) => (
                  <div key={it.product} className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-warn">{it.text}</span>
                    {it.onReplace ? (
                      <Button variant="outline" size="xs" disabled={locked} aria-label={`Replace product ${it.product} (${field.name})`} onClick={it.onReplace}>
                        Replace product {it.product}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            );
        }
      })}
    </div>
  );
}

const MOVE_KEYS: ReadonlySet<string> = new Set<MoveKey>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

function inTextField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/**
 * The verification table: a row per product and a column per field, the Output's own way round (Marko
 * 2026-11-19; it was a row per field until then). Each product's photo, title and link are columns of their
 * own before the fields; each cell is the field's value on that product with its state; and a last row holds
 * each field's status and its one action.
 *
 * Pure presentation — `columns` and `addHead` are drawn by the route (the
 * product-card pieces and `AddProductCard` in `compact` mode), and every cell and
 * status action is a callback the route resolves against the model
 * (`rowStatus`, `acceptRow`, `acceptAllAgreed` in `lib/site/verification-model.ts`).
 */
/** A product column's three head rows — or, for a slot with no page yet, the one input that spans them. */
/** `end`: the row's action, in the pinned last column (the same width as the checked-products table's, so the two line up). */
export type ProductColumn = { image: ReactNode; title: ReactNode; page: ReactNode; end?: ReactNode } | { blank: ReactNode };

/** The pinned last column's width, shared with `SampledProducts`. */
export const END_COLUMN = 150;

const LIVE_CLASS: Record<LiveCell, string> = { scan: 'cell-scan', wait: 'opacity-45', still: '' };

export function VerificationTable({
  columns,
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
  onAbsent,
  onEscape,
  showMoney,
  liveStage = null,
  settling = false,
}: {
  /** One per product column, rendered by the route: its photo, title and link rows, or a blank slot's address input. */
  columns: ProductColumn[];
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
  onAbsent?: (sel: CellSelection) => void;
  /** Escape with nothing else to close: the route clears the selection or closes the panel. */
  onEscape: () => void;
  /** `showsMoney(session)` (spec 2026-10-17 §8a): the re-verify button says "free" to staff only. */
  showMoney: boolean;
  /** A running Verify's stage as the server reports it (`starting`, `capturing 2/3`, `searching`…): the cells show where it is (`liveCell`). */
  liveStage?: string | null;
  /** True for a moment after a Verify ends: the cells settle one after another as the verdicts land. */
  settling?: boolean;
}) {
  const fieldKeys = rows.map((r) => r.field.key);
  const products = columns.length;

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
      // A row per product: left/right walk the fields and up/down the products (the model's own axes are the other way).
      const TURNED: Partial<Record<MoveKey, MoveKey>> = { ArrowLeft: 'ArrowUp', ArrowRight: 'ArrowDown', ArrowUp: 'ArrowLeft', ArrowDown: 'ArrowRight' };
      const key = TURNED[e.key as MoveKey] ?? (e.key as MoveKey);
      const next = moveSelection(selection, key, fieldKeys, products);
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
    if ((e.key === 'a' || e.key === 'A') && !mod) {
      // The same Accept the cell's tick or the row's button gives; nothing when neither is offered.
      const row = rows.find((r) => r.field.key === selection.key);
      const accept = row?.cells[selection.product]?.onAccept ?? (row && ACCEPTABLE.has(row.status.kind) ? row.onAccept : undefined);
      if (locked || !accept) return;
      e.preventDefault();
      accept();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      // Always the cell's value: a cell is a button, so no text inside it can be
      // selected, and a page selection made elsewhere earlier (Chromium keeps it
      // when a button is clicked) must not win over the focused cell.
      e.preventDefault();
      onCopy(selection);
    }
  }

  /** One value cell. */
  function renderCell(row: TableRow, fi: number, i: number) {
    const cell = row.cells[i]!;
                  const sel: CellSelection = { product: i, key: row.field.key };
                  const isSelected = selection?.product === i && selection.key === row.field.key;
                  // Tab enters the table once: at the selected cell, else the first cell.
                  const tabbable = isSelected || (!selection && fi === 0 && i === 0);
                  const label = fixLabel(cell.state);
                  const value = cell.value.trim();
                  return (
                    <td key={`${row.field.key}:${i}`} className="group relative border-t border-l border-line p-0 align-top">
                      <ContextMenu onOpenChange={(open) => { if (open) skipReturnFocus.current = false; }}>
                        <ContextMenuTrigger asChild>
                          <button
                            type="button"
                            data-cell={`${i}:${row.field.key}`}
                            data-selected={isSelected ? 'true' : undefined}
                            tabIndex={tabbable ? 0 : -1}
                            aria-label={cellLabel(row.field.name, i + 1, cell.state, cell.value) + (cell.changed ? ', changed since verified' : '')}
                            onClick={() => onSelect(sel)}
                            onContextMenu={() => onSelect(sel)}
                            style={settling ? { animationDelay: `${(fi * products + i) * 45}ms` } : undefined}
                            className={cn(
                              'flex h-full w-full items-center border-l-2 px-2 py-2 text-left transition-[opacity,border-color] duration-300',
                              CELL_BORDER[cell.state],
                              LIVE_CLASS[liveCell(liveStage, row.field.key, i)],
                              settling && 'cell-settle',
                              isSelected && 'outline outline-1 outline-text',
                              cell.onAccept ? 'pr-14' : 'pr-9',
                            )}
                          >
                            <span
                              className={cn('min-w-0 truncate font-mono text-base', (cell.absent || cell.isDefault) && 'text-muted-foreground', cell.notOnPage && 'text-warn')}
                              title={cell.notOnPage ? NOT_ON_PAGE_TITLE : cell.isDefault ? DEFAULT_CELL_TITLE : cell.value || undefined}
                            >
                              {cell.changed ? <span aria-hidden title="Changed since verified" className="mr-1.5 inline-block size-1.5 rounded-full bg-warn align-middle" /> : null}
                              {cell.value || '—'}
                              {cell.notOnPage ? <span className="ml-1 font-sans text-xs text-muted-foreground">not on this page</span> : null}
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
                          <ContextMenuItem disabled={!value || cell.absent} onSelect={() => onCopy(sel)}>
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
                          <ContextMenuItem disabled={locked || !cell.url.trim() || cell.absent || row.hasDefault} onSelect={() => onAbsent?.(sel)}>
                            Not on this product
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
                        tabIndex={isSelected ? 0 : -1}
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
                          tabIndex={isSelected ? 0 : -1}
                          className="absolute top-1/2 right-1 -translate-y-1/2 bg-panel opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <Check aria-hidden className="size-3" />
                        </Button>
                      ) : null}
                    </td>
                  );
  }

  const showVariants = !!variants && variants.need.kind !== 'none' && (variants.method === 'list' || variants.method === 'links');
  const fieldNotes = rows.filter((r) => (r.drift && r.drift.length > 0) || r.coverage || r.expanded);

  return (
    <div className="space-y-1.5">
    <ScrollArea className="table-scroll relative overflow-hidden rounded-[6px] border border-line bg-panel">
    <ScrollAreaViewport ref={wrapRef} onKeyDown={onKeyDown} data-sync-x="" className="w-full">
    <ScrollAreaContent>
      {/* A plain table (Marko 2026-11-18): a row per product at one line's height; the photo, the title and the link
          each in a column of their own, then a column per field. The photo and title stay put while the fields scroll. */}
      <table className="w-full table-fixed border-collapse" data-testid="verification-grid" style={{ minWidth: 48 + 220 + 240 + rows.length * 190 + END_COLUMN }}>
        <colgroup>
          <col style={{ width: 48 }} />
          <col style={{ width: 220 }} />
          <col style={{ width: 240 }} />
          {rows.map((row) => (
            <col key={row.field.key} />
          ))}
          <col style={{ width: END_COLUMN }} />
        </colgroup>
        <thead>
          <tr className="[&>th]:border-b [&>th]:border-line">
            <th scope="col" className="sticky left-0 z-10 bg-panel px-2 py-2 text-left text-sm font-normal text-muted-foreground" aria-label="Image" />
            <th scope="col" className="sticky left-[48px] z-10 bg-panel px-2 py-2 text-left text-sm font-normal text-muted-foreground">Title</th>
            <th scope="col" className="border-l border-line px-2 py-2 text-left text-sm font-normal text-muted-foreground">Link</th>
            {rows.map((row) => (
              <th key={row.field.key} scope="col" className="border-l border-line px-2 py-2 text-left align-top font-normal">
                <button type="button" aria-expanded={row.expanded} onClick={row.onToggle} className="flex w-full min-w-0 items-baseline gap-1.5 text-left">
                  <ChevronRight aria-hidden className={cn('size-3 shrink-0 self-center text-muted-foreground transition-transform', row.expanded && 'rotate-90')} />
                  <span className="min-w-0 truncate text-base">{row.field.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{TYPE_LABELS[row.field.type]}</span>
                </button>
              </th>
            ))}
            <th scope="col" className="sticky right-0 z-10 [box-shadow:inset_1px_0_0_var(--border),inset_0_-1px_0_var(--border)] bg-panel" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {columns.map((c, i) => (
            <tr key={i} className="[&>*]:border-b [&>*]:border-line">
              {'blank' in c ? (
                <th scope="row" colSpan={3} className="sticky left-0 z-10 bg-panel px-2 py-1.5 text-left font-normal">{c.blank}</th>
              ) : (
                <>
                  <td className="sticky left-0 z-10 bg-panel px-2 py-1">{c.image}</td>
                  <th scope="row" className="sticky left-[48px] z-10 bg-panel px-2 py-1 text-left font-normal">{c.title}</th>
                  <td className="border-l border-line px-2 py-1">{c.page}</td>
                </>
              )}
              {rows.map((row, fi) => renderCell(row, fi, i))}
              <td className="sticky right-0 z-10 [box-shadow:inset_1px_0_0_var(--border),inset_0_-1px_0_var(--border)] bg-panel px-2 py-1 text-right">{'blank' in c ? null : c.end}</td>
            </tr>
          ))}
          {/* Each field's status and its one action, under its own column. */}
          <tr>
            {/* Pinned over the photo and title columns only, like the rows above: spanning the link column too, it
                covered a field column once the table scrolled sideways (Marko 2026-11-19). */}
            <th scope="row" colSpan={2} className="sticky left-0 z-10 bg-panel px-2 py-2 text-left align-top text-sm font-normal text-muted-foreground">
              Status
            </th>
            <td className="border-l border-line" />
            {rows.map((row) => (
              <td key={row.field.key} className="border-l border-line px-2 py-2 align-top">
                <StatusCell field={row.field} status={row.status} badge={row.badge} count={row.count} locked={locked} onAccept={row.onAccept} onMakeDefault={row.onMakeDefault} fix={row.fix} offer={row.offer} onFix={onFix} defaultOnlyWord={row.defaultOnlyWord} addressWarning={row.addressWarning} jevNote={row.jevNote} heldWord={row.heldWord} onReverifyField={row.onReverifyField} showMoney={showMoney} />
              </td>
            ))}
            <td className="sticky right-0 z-10 [box-shadow:inset_1px_0_0_var(--border)] bg-panel" />
          </tr>
        </tbody>
      </table>
    </ScrollAreaContent>
    </ScrollAreaViewport>
    </ScrollArea>
      {/* Under the plain table, not inside it: adding a product is an action on the table, not a row of it. */}
      {addHead ? <div>{addHead}</div> : null}
      {fieldNotes.length > 0 ? (
        <div className="rounded-[6px] border border-line bg-panel" data-testid="verification-grid-notes">
          {fieldNotes.map((row) => (
            <div key={row.field.key} className="space-y-2 border-b border-line px-3 py-2.5 last:border-0">
              <p className="text-sm font-medium">{row.field.name}</p>
              {row.drift && row.drift.length > 0 ? <DriftLines field={row.field} lines={row.drift} locked={locked} /> : null}
              {row.coverage ? (
                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground" data-coverage={row.field.key}>
                  <span>{row.coverage.text}</span>
                  {row.coverage.onUseAsProofPage ? (
                    <Button variant="outline" size="xs" disabled={locked} aria-label={`Use a sampled product as proof page for ${row.field.name}`} onClick={row.coverage.onUseAsProofPage}>
                      Use as proof page
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {row.expanded ? <FieldDetails field={row.field} locked={locked} {...row.details} /> : null}
            </div>
          ))}
        </div>
      ) : null}
      {/* The Variants row keeps its own shape (a column per product) under the table. */}
      {showVariants ? (
        <div className="overflow-x-auto rounded-[6px] border border-line bg-panel">
          <table className="w-full table-fixed border-collapse" style={{ minWidth: 180 + columns.length * 190 + (addHead ? 160 : 0) + 220 }}>
            <colgroup>
              <col style={{ width: 180 }} />
              {columns.map((_, i) => (
                <col key={i} />
              ))}
              {addHead ? <col style={{ width: 160 }} /> : null}
              <col style={{ width: 220 }} />
            </colgroup>
            <tbody>
              <VariantsRow props={variants!} locked={locked} hasAddHead={!!addHead} />
            </tbody>
          </table>
        </div>
      ) : null}
      {keyboard && selection ? (
        <p className="hidden items-center gap-x-3 text-xs text-muted-foreground md:flex" data-testid="table-keys">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd><kbd className="kbd">←</kbd><kbd className="kbd">→</kbd> move</span>
          <span><kbd className="kbd">Enter</kbd> fix on the screenshot</span>
          <span><kbd className="kbd">A</kbd> accept</span>
          <span><kbd className="kbd">Esc</kbd> close</span>
        </p>
      ) : null}
      <p className="hidden text-xs text-muted-foreground md:block" data-testid="table-click-hint">Click any cell to open its screenshot on that value.</p>
    </div>
  );
}

/**
 * The proof table before it has products (Marko 2026-11-20): the same columns, so the website's fields are there
 * from the start and nothing moves when products arrive. `finding`: products are being found, and three placeholder
 * rows stand in for them; otherwise the body is one line saying how to start.
 */
export function EmptyProofTable({ fields, finding, message }: { fields: readonly Pick<Field, 'key' | 'name' | 'type'>[]; finding: boolean; message: ReactNode }) {
  const span = 3 + fields.length + 1;
  return (
    <div className="overflow-x-auto rounded-[6px] border border-line bg-panel" data-testid="proof-table-empty" aria-busy={finding || undefined}>
      <table className="w-full table-fixed border-collapse" style={{ minWidth: 48 + 220 + 240 + fields.length * 190 + END_COLUMN }}>
        <colgroup>
          <col style={{ width: 48 }} />
          <col style={{ width: 220 }} />
          <col style={{ width: 240 }} />
          {fields.map((f) => (
            <col key={f.key} />
          ))}
          <col style={{ width: END_COLUMN }} />
        </colgroup>
        <thead>
          <tr className="[&>th]:border-b [&>th]:border-line">
            <th scope="col" aria-label="Image" />
            <th scope="col" className="px-2 py-2 text-left text-sm font-normal text-muted-foreground">Title</th>
            <th scope="col" className="border-l border-line px-2 py-2 text-left text-sm font-normal text-muted-foreground">Link</th>
            {fields.map((f) => (
              <th key={f.key} scope="col" className="border-l border-line px-2 py-2 text-left align-top font-normal">
                <span className="flex min-w-0 items-baseline gap-1.5 pl-[18px]">
                  <span className="min-w-0 truncate text-base">{f.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{TYPE_LABELS[f.type]}</span>
                </span>
              </th>
            ))}
            <th scope="col" className="border-l border-line" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {finding ? (
            [0, 1, 2].map((r) => (
              <tr key={r} className="h-[34px] [&>*]:border-b [&>*]:border-line [&:last-child>*]:border-b-0">
                <td className="px-2 py-1"><Skeleton className="size-8 bg-raised" /></td>
                <td className="px-2 py-1"><Skeleton className="h-3.5 bg-raised" style={{ width: `${75 - r * 12}%` }} /></td>
                <td className="border-l border-line px-2 py-1"><Skeleton className="h-3 w-3/5 bg-raised" /></td>
                {fields.map((f, i) => (
                  <td key={f.key} className="border-l border-line px-2 py-1"><Skeleton className="h-3.5 bg-raised" style={{ width: `${70 - ((r + i) % 3) * 15}%` }} /></td>
                ))}
                <td className="border-l border-line" />
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={span} className="py-6 text-base text-muted-foreground">
                {/* Pinned to the left, so it stays in view however wide the field columns make the table. */}
                <span className="sticky left-0 block w-fit px-3">{message}</span>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
