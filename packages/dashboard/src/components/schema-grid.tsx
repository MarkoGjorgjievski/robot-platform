import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { URL_COUNT, applyPaste, parseBlock, validateExpectedClient, type GridState } from '../lib/schema-grid';
import { cellLine, type ColumnState } from '../lib/schema-tab-view';
import { PageHeaderCell } from './page-header-cell';

export type CellStatus = { status: 'pass' | 'fail' | 'not_captured' | 'stale'; found?: string; reason?: string; hint?: string; weak?: boolean; pathSource?: string };

type Props = {
  state: GridState;
  onChange: (next: GridState) => void;
  cellStatus?: (rowId: string, urlIndex: number) => CellStatus | null;
  columnStates: ColumnState[];
  captures: Record<string, { blockedReason?: string; screenshotUrl?: string }>;
  readOnly: boolean;
  pending: boolean;
  onFindPages: (listingUrl: string) => Promise<string[]>;
  typeFix?: (rowId: string) => { suggested: 'url'; onApply: () => void; pending: boolean; error?: string } | null;
};

// Field (0) and Type (1) are read-only display, never focusable — keyboard navigation
// only ranges over the description column (2) and the page columns (3..COLS-1).
const COLS = 3 + URL_COUNT;
const NAV_MIN = 2;

const RAIL: Record<'pass' | 'fail' | 'stale' | 'not_captured' | 'none', string> = {
  pass: 'cell-rail-pass',
  fail: 'cell-rail-fail',
  stale: 'cell-rail-stale',
  not_captured: 'cell-rail-not-captured',
  none: 'cell-rail-none',
};
const LINE_TEXT: Record<'pass' | 'fail' | 'stale' | 'not_captured' | 'none', string> = {
  pass: 'text-emerald-700',
  fail: 'text-red-700',
  stale: 'text-gray-600',
  not_captured: 'text-amber-700',
  none: 'text-gray-400',
};

export function SchemaGrid({ state, onChange, cellStatus, columnStates, captures, readOnly, pending, onFindPages, typeFix }: Props) {
  const inputs = useRef(new Map<string, HTMLElement>());
  const reg = (r: number, c: number) => (el: HTMLElement | null) => { if (el) inputs.current.set(`${r},${c}`, el); else inputs.current.delete(`${r},${c}`); };
  const focus = (r: number, c: number) => inputs.current.get(`${r},${c}`)?.focus();

  function onKey(e: KeyboardEvent, r: number, c: number) {
    const move: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1] };
    const d = move[e.key];
    if (!d) return;
    const target = e.target as HTMLInputElement;
    // Let left/right move the caret inside a text input unless it is at an edge.
    if ((e.key === 'ArrowLeft' && target.selectionStart !== 0) || (e.key === 'ArrowRight' && target.selectionEnd !== target.value?.length)) return;
    let [nr, nc] = [r + d[0], c + d[1]];
    if (nc >= COLS) { nc = NAV_MIN; nr++; }
    if (nc < NAV_MIN) { nc = COLS - 1; nr--; }
    if (nr < 0 || nr >= state.rows.length) return; // no ghost rows: Enter on the last row does nothing
    e.preventDefault();
    setTimeout(() => focus(nr, nc), 0);
  }

  function onPaste(e: ClipboardEvent, r: number, c: number) {
    if (readOnly) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return; // single value: let the input handle it
    e.preventDefault();
    const next = applyPaste(state, { row: r, col: c }, parseBlock(text));
    onChange({ ...next, rows: next.rows.slice(0, state.rows.length) }); // paste never creates rows
  }

  const setDescription = (i: number, v: string) => onChange({ ...state, rows: state.rows.map((row, j) => (j === i ? { ...row, description: v } : row)) });
  const setExpected = (i: number, u: number, v: string) => onChange({ ...state, rows: state.rows.map((row, j) => (j === i ? { ...row, expected: row.expected.map((x, k) => (k === u ? v : x)) } : row)) });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-left">
            <th className="px-2 py-1">Field</th>
            <th className="px-2 py-1">Type</th>
            <th className="px-2 py-1">Where it is on this website</th>
            {state.urls.map((u, i) => (
              <th key={i} className="px-2 py-1 text-left align-top">
                <PageHeaderCell
                  index={i}
                  url={u}
                  state={columnStates[i] ?? 'idle'}
                  blockedReason={captures[u]?.blockedReason}
                  screenshotUrl={captures[u]?.screenshotUrl}
                  disabled={readOnly}
                  onChange={(url) => onChange({ ...state, urls: state.urls.map((x, j) => (j === i ? url : x)) })}
                  onFindPages={onFindPages}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row, r) => {
            const fix = typeFix?.(row.id) ?? null;
            return (
              <tr key={row.id}>
                <td className="p-1 align-top font-mono text-xs text-gray-700">
                  {row.name}
                  {fix && (
                    <div className="mt-1">
                      <button type="button" className="btn-quiet" disabled={fix.pending} onClick={fix.onApply}>
                        {fix.pending && <Loader2 className="h-3 w-3 animate-spin" />}
                        Set type to url
                      </button>
                      {fix.error && <p className="mt-0.5 text-[11px] text-red-700">{fix.error}</p>}
                    </div>
                  )}
                </td>
                <td className="p-1 align-top text-xs text-gray-700">{row.type}</td>
                <td className="p-1">
                  <input
                    ref={reg(r, 2)}
                    readOnly={readOnly}
                    value={row.description}
                    onChange={(e) => setDescription(r, e.target.value)}
                    onKeyDown={(e) => onKey(e, r, 2)}
                    onPaste={(e) => onPaste(e, r, 2)}
                    className="w-full rounded border border-gray-300 px-2 py-1"
                    placeholder="green number next to Add to cart, not the crossed-out one"
                  />
                </td>
                {row.expected.map((v, u) => {
                  const status = cellStatus?.(row.id, u) ?? null;
                  const base = cellLine(status, v);
                  let tone = base.tone;
                  let text = base.text;
                  if (status?.weak) text = text ? `${text} · weak evidence: same value on every page` : 'weak evidence: same value on every page';
                  if (!status) {
                    const err = v.trim() !== '' ? validateExpectedClient(row.type, v) : null;
                    if (err) { tone = 'fail'; text = err; }
                  }
                  if (pending) text = '';
                  return (
                    <td key={u} className={`p-1 align-top ${RAIL[tone]}`}>
                      <input
                        ref={reg(r, 3 + u)}
                        readOnly={readOnly}
                        value={v}
                        onChange={(e) => setExpected(r, u, e.target.value)}
                        onKeyDown={(e) => onKey(e, r, 3 + u)}
                        onPaste={(e) => onPaste(e, r, 3 + u)}
                        className={`w-full rounded border border-gray-300 px-2 py-1 ${pending ? 'shimmer' : ''}`}
                      />
                      <p className={`min-h-[14px] text-[11px] ${LINE_TEXT[tone]}`}>{text}</p>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
