import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { PageHeaderCell } from './page-header-cell';
import { URL_MIN, applyPasteByName, parseBlock, validateExpectedClient, type GridState } from '../../lib/site/schema-grid';
import { cellLine, type CellLine, type ColumnState } from '../../lib/site/schema-tab-view';
import type { CellStatus } from '../../lib/site/verification-view';
import { TYPE_LABELS } from '../../lib/fields-view';

/**
 * The grid is the page (spec §5.6). One row per field of the project, one
 * column per proof page, and the expected value of a field on a page in the
 * cell where they meet.
 *
 * Field and Type are read-only here — they belong to the project, said once
 * above the table rather than in every row. Everything else is typed in place:
 * where the value is on this website, and what it should read on each page.
 */

// Field (0) and Type (1) are display, never focusable, so arrow/tab navigation
// ranges over the description column (2) and the page columns (3…COLS-1).
const NAV_MIN = 2;

/**
 * State as a 2 px rail beside the value, never a fill behind it (spec §4). The
 * rail sits on the cell's own block rather than on the `<td>`, so the row's
 * padding leaves a gap above and below it — a full-height border in every row
 * stacks into one unbroken line down the table and reads as a column divider
 * that changes colour.
 */
const RAIL: Record<CellLine['tone'], string> = {
  pass: 'border-pass',
  fail: 'border-fail',
  stale: 'border-warn',
  not_captured: 'border-warn',
  none: 'border-transparent',
};

/**
 * The second line takes the rail's tone, with one exception spec §5.6 names:
 * "changed since verified" is grey. A stale cell is not a problem — it is a
 * result that no longer describes what is typed above it — and a whole grid of
 * amber sentences after one edit reads as a website that has gone wrong. The
 * rail still carries the state; the words stay quiet.
 */
const LINE: Record<CellLine['tone'], string> = {
  pass: 'text-pass',
  fail: 'text-fail',
  stale: 'text-muted-foreground',
  not_captured: 'text-warn',
  none: 'text-muted-foreground',
};

type Props = {
  state: GridState;
  onChange: (next: GridState) => void;
  cellStatus?: (rowId: string, urlIndex: number) => CellStatus | null;
  columnStates: ColumnState[];
  captures: Record<string, { blockedReason?: string; screenshotUrl?: string }>;
  /** A verification is in flight: values stay legible, nothing can be typed. */
  readOnly: boolean;
  onFindPages: (listingUrl: string) => Promise<string[]>;
  typeFix?: (rowId: string) => { suggested: 'url'; onApply: () => void; pending: boolean; error?: string } | null;
  onRemovePage?: (index: number) => void;
  /** Focused once — the field a run arrived for, on its new page. `col` is a page index. */
  focusCell?: { row: number; col: number } | null;
};

export function SchemaGrid({
  state,
  onChange,
  cellStatus,
  columnStates,
  captures,
  readOnly,
  onFindPages,
  typeFix,
  onRemovePage,
  focusCell,
}: Props) {
  const inputs = useRef(new Map<string, HTMLElement>());
  const reg = (r: number, c: number) => (el: HTMLElement | null) => {
    if (el) inputs.current.set(`${r},${c}`, el);
    else inputs.current.delete(`${r},${c}`);
  };
  const focus = (r: number, c: number) => inputs.current.get(`${r},${c}`)?.focus();
  const COLS = 3 + state.urls.length;

  // Set once by the tab's arrival effect and never changed, so this fires
  // exactly once — after the new column's input has mounted and registered.
  useEffect(() => {
    if (focusCell) focus(focusCell.row, 3 + focusCell.col);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCell]);

  function onKey(e: KeyboardEvent, r: number, c: number) {
    const move: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      Enter: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      Tab: [0, e.shiftKey ? -1 : 1],
    };
    const d = move[e.key];
    if (!d) return;
    const target = e.target as HTMLInputElement;
    // Left/right move the caret inside the text until it is at an edge.
    if ((e.key === 'ArrowLeft' && target.selectionStart !== 0) || (e.key === 'ArrowRight' && target.selectionEnd !== target.value?.length)) return;
    let [nr, nc] = [r + d[0], c + d[1]];
    if (nc >= COLS) {
      nc = NAV_MIN;
      nr++;
    }
    if (nc < NAV_MIN) {
      nc = COLS - 1;
      nr--;
    }
    if (nr < 0 || nr >= state.rows.length) return; // no ghost rows
    e.preventDefault();
    setTimeout(() => focus(nr, nc), 0);
  }

  function onPaste(e: ClipboardEvent, r: number, c: number) {
    if (readOnly) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return; // one value: let the input have it
    e.preventDefault();
    onChange(applyPasteByName(state, { row: r, col: c }, parseBlock(text)).state);
  }

  const setDescription = (i: number, v: string) =>
    onChange({ ...state, rows: state.rows.map((row, j) => (j === i ? { ...row, description: v } : row)) });
  const setExpected = (i: number, u: number, v: string) =>
    onChange({
      ...state,
      rows: state.rows.map((row, j) => (j === i ? { ...row, expected: row.expected.map((x, k) => (k === u ? v : x)) } : row)),
    });

  // One idiom for every input in the table: text at rest, a hairline on row
  // hover, the text colour on focus. The negative margin keeps the value on the
  // column's x while the box is wider than the word. `text-[16px]` below `md`
  // as everywhere else — anything smaller makes iOS Safari zoom on focus, and
  // this one lives inside a horizontal scroller.
  //
  // `text-ellipsis` because the columns are fixed and the strings are not: on a
  // real website the hints and the values both overrun, and an input clips at
  // the box edge mid-word with nothing to say it did — "The currency of the
  // price (code or symbol" reads as the sentence somebody wrote. The ellipsis
  // is the sign, and the `title` on each input is the rest of the string.
  // Chromium draws it only while the input is not focused, which is exactly
  // right: a focused one scrolls to the caret instead.
  //
  // While a run is in flight the affordances go and the text stays: a read-only
  // field that still lights up on hover is offering something it will not do.
  const field = `-mx-2 h-7 w-full min-w-0 overflow-hidden rounded-md border border-transparent bg-transparent px-2 text-[16px] text-ellipsis text-text outline-none placeholder:text-muted-foreground md:text-base ${
    readOnly ? 'cursor-default' : 'hover:border-line-hover focus:border-text focus:bg-bg group-hover/row:border-line'
  }`;

  return (
    // `min-w-0` + `overflow-x-clip` for the reason the other tables give: a grid
    // item's minimum is its content, and Chromium still counts a table's own
    // floor into the document's scroll area through it.
    <div className="rise min-w-0 overflow-x-clip">
      <div className="rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
        <div className="overflow-x-auto rounded-[6px]">
          {/* `table-fixed` is load-bearing, not tidiness. A cell's second line
              clamped, which in an
              auto-layout table makes the whole red sentence the column's
              min-content width, so one "This page shows 99.00…" stretched its
              page column across the screen and crushed Field, Type and the
              hint into three characters each. Fixed layout makes the widths
              below the authority and lets the ellipsis do its job. */}
          <table className="w-full table-fixed border-collapse text-base" style={{ minWidth: 476 + state.urls.length * 210 }}>
            <colgroup>
              <col className="w-[150px]" />
              <col className="w-[86px]" />
              {/* The hint takes whatever the pages leave — the longest catalogue
                  description is a sentence, and a fixed 240 px clipped it — with
                  240 px guaranteed by the table's own floor above. */}
              <col />
              {state.urls.map((u, i) => (
                <col key={`${i}:${u}`} style={{ width: 210 }} />
              ))}
            </colgroup>

            <thead>
              <tr className="[&>th]:border-b [&>th]:border-line [&>th]:bg-panel [&>th]:pr-3 [&>th]:pb-2 [&>th]:text-left [&>th]:align-bottom [&>th]:font-normal [&>th]:text-muted-foreground">
                <th className="pt-2.5 pl-4 text-sm">Field</th>
                <th className="pt-2.5 pl-3 text-sm">Type</th>
                <th className="pt-2.5 pl-3 text-sm">Where it is on this website</th>
                {state.urls.map((u, i) => (
                  // Keyed by index AND url: removing a middle page shifts every
                  // later page down an index, and keying on the index alone
                  // would let React reuse the same header — carrying its open
                  // popover and its draft onto a different page.
                  <th key={`${i}:${u}`} className="pl-3 align-top">
                    <PageHeaderCell
                      index={i}
                      url={u}
                      state={columnStates[i] ?? 'idle'}
                      blockedReason={captures[u]?.blockedReason}
                      screenshotUrl={captures[u]?.screenshotUrl}
                      disabled={readOnly}
                      onChange={(url) => onChange({ ...state, urls: state.urls.map((x, j) => (j === i ? url : x)) })}
                      onFindPages={onFindPages}
                      onRemove={i >= URL_MIN && onRemovePage ? () => onRemovePage(i) : undefined}
                    />
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {state.rows.map((row, r) => {
                const fix = typeFix?.(row.id) ?? null;
                return (
                  <tr key={row.id} className="group/row border-b border-line transition-colors last:border-0 hover:bg-raised">
                    <td className="py-2 pr-3 pl-4 align-top">
                      <span className="block truncate font-medium text-text" title={row.name}>
                        {row.name}
                      </span>
                      {fix ? (
                        <div className="mt-1.5">
                          <Button variant="outline" size="xs" disabled={fix.pending || readOnly} onClick={fix.onApply}>
                            {fix.pending ? <Loader2 className="animate-spin" /> : null}
                            Set type to link
                          </Button>
                          {fix.error ? (
                            <p role="alert" className="mt-1 text-sm text-fail">
                              {fix.error}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </td>

                    <td className="py-2 pr-3 pl-3 align-top text-muted-foreground">{TYPE_LABELS[row.type]}</td>

                    <td className="py-2 pr-3 pl-3 align-top">
                      <input
                        ref={reg(r, 2)}
                        size={1}
                        readOnly={readOnly}
                        aria-readonly={readOnly || undefined}
                        aria-label={`Where ${row.name} is on this website`}
                        title={row.description || undefined}
                        value={row.description}
                        onChange={(e) => setDescription(r, e.target.value)}
                        onKeyDown={(e) => onKey(e, r, 2)}
                        onPaste={(e) => onPaste(e, r, 2)}
                        className={field}
                        placeholder="the green number next to Add to cart, not the crossed-out one"
                      />
                      {/* The expected cells beside it reserve two lines for
                          their result, so this one does too — otherwise the
                          hint floats above every value in its row. */}
                      <p className="min-h-[34px]" aria-hidden />
                    </td>

                    {row.expected.map((value, u) => {
                      const status = cellStatus?.(row.id, u) ?? null;
                      const base = cellLine(status, value, fix?.suggested ?? null, u);
                      let tone = base.tone;
                      let text = base.text;
                      if (status?.weak) text = text ? `${text} · weak evidence: same value on every page` : 'weak evidence: same value on every page';
                      if (!status) {
                        const err = value.trim() !== '' ? validateExpectedClient(row.type, value) : null;
                        if (err) {
                          tone = 'fail';
                          text = err;
                        }
                      }
                      // Mid-run the stored result describes the run before this
                      // one; saying nothing is honest until this one lands.
                      if (readOnly) {
                        tone = 'none';
                        text = '';
                      }
                      return (
                        <td key={u} className="py-2 pr-3 pl-3 align-top">
                          <div className={`border-l-2 pl-2.5 ${RAIL[tone]}`}>
                            <input
                              ref={reg(r, 3 + u)}
                              size={1}
                              readOnly={readOnly}
                              aria-readonly={readOnly || undefined}
                              aria-label={`${row.name} on page ${u + 1}`}
                              title={value || undefined}
                              value={value}
                              onChange={(e) => setExpected(r, u, e.target.value)}
                              onKeyDown={(e) => onKey(e, r, 3 + u)}
                              onPaste={(e) => onPaste(e, r, 3 + u)}
                              className={`${field} font-mono`}
                            />
                            {/* Two lines, always reserved so nothing ever
                                shifts (spec §5.6). Two rather than one because
                                the red reasons are whole sentences — "This page
                                shows X. Is your value right…" — and the cell
                                that has gone wrong is the one thing on this
                                screen a customer has to be able to read. */}
                            <p className={`line-clamp-2 min-h-[34px] text-sm ${LINE[tone]}`} title={text || undefined}>
                              {text}
                            </p>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
