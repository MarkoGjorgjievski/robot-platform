import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { FIELD_TYPES, URL_COUNT, applyPaste, emptyRow, parseBlock, shortUrl, validateExpectedClient, type GridState } from '../lib/schema-grid';

export type CellStatus = { status: 'pass' | 'fail' | 'not_captured' | 'stale'; found?: string; reason?: string; hint?: string; weak?: boolean };
type Props = { state: GridState; onChange: (next: GridState) => void; cellStatus?: (rowId: string, urlIndex: number) => CellStatus | null; disabled?: boolean };

const COLS = 3 + URL_COUNT;
const CELL_BG: Record<CellStatus['status'], string> = { pass: 'bg-emerald-50 border-emerald-300', fail: 'bg-red-50 border-red-300', not_captured: 'bg-amber-50 border-amber-300', stale: 'bg-gray-100 border-gray-300' };

export function SchemaGrid({ state, onChange, cellStatus, disabled }: Props) {
  const inputs = useRef(new Map<string, HTMLElement>());
  const reg = (r: number, c: number) => (el: HTMLElement | null) => { if (el) inputs.current.set(`${r},${c}`, el); else inputs.current.delete(`${r},${c}`); };
  const focus = (r: number, c: number) => inputs.current.get(`${r},${c}`)?.focus();

  function onKey(e: KeyboardEvent, r: number, c: number) {
    // The type cell is a native <select>: let ArrowUp/Down/Left/Right and
    // Enter drive its own dropdown instead of stealing grid focus. Tab still
    // navigates the grid like every other cell.
    if (e.target instanceof HTMLSelectElement && e.key !== 'Tab') return;
    const move: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1] };
    const d = move[e.key];
    if (!d) return;
    const target = e.target as HTMLInputElement;
    // Let left/right move the caret inside a text input unless it is at an edge.
    if ((e.key === 'ArrowLeft' && target.selectionStart !== 0) || (e.key === 'ArrowRight' && target.selectionEnd !== target.value?.length)) return;
    let [nr, nc] = [r + d[0], c + d[1]];
    if (nc >= COLS) { nc = 0; nr++; }
    if (nc < 0) { nc = COLS - 1; nr--; }
    if (nr < 0) return;
    if (nr >= state.rows.length) { if (e.key === 'Enter' || e.key === 'Tab') onChange({ ...state, rows: [...state.rows, emptyRow()] }); else return; }
    e.preventDefault();
    setTimeout(() => focus(nr, nc), 0);
  }

  function onPaste(e: ClipboardEvent, r: number, c: number) {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes('\n')) return; // single value: let the input handle it
    e.preventDefault();
    onChange(applyPaste(state, { row: r, col: c }, parseBlock(text)));
  }

  const setRow = (i: number, patch: Partial<GridState['rows'][number]>) => onChange({ ...state, rows: state.rows.map((row, j) => (j === i ? { ...row, ...patch } : row)) });
  const setExpected = (i: number, u: number, v: string) => setRow(i, { expected: state.rows[i]!.expected.map((x, k) => (k === u ? v : x)) });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-left">
            <th className="px-2 py-1">Field</th><th className="px-2 py-1">Type</th><th className="px-2 py-1">Description (where it is, what it looks like)</th>
            {state.urls.map((u, i) => <th key={i} className="px-2 py-1 font-mono text-xs" title={u}>{u ? shortUrl(u) : `URL ${i + 1}`}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row, r) => (
            <tr key={row.id}>
              <td className="p-1"><input ref={reg(r, 0)} disabled={disabled} value={row.name} onChange={(e) => setRow(r, { name: e.target.value })} onKeyDown={(e) => onKey(e, r, 0)} onPaste={(e) => onPaste(e, r, 0)} className="w-full rounded border border-gray-300 px-2 py-1" placeholder="price" /></td>
              <td className="p-1"><select ref={reg(r, 1)} disabled={disabled} value={row.type} onChange={(e) => setRow(r, { type: e.target.value as GridState['rows'][number]['type'] })} onKeyDown={(e) => onKey(e, r, 1)} className="rounded border border-gray-300 px-2 py-1">{FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></td>
              <td className="p-1"><input ref={reg(r, 2)} disabled={disabled} value={row.description} onChange={(e) => setRow(r, { description: e.target.value })} onKeyDown={(e) => onKey(e, r, 2)} onPaste={(e) => onPaste(e, r, 2)} className="w-full rounded border border-gray-300 px-2 py-1" placeholder="green number next to Add to cart, not the crossed-out one" /></td>
              {row.expected.map((v, u) => {
                const status = cellStatus?.(row.id, u) ?? null;
                const err = validateExpectedClient(row.type, v);
                return (
                  <td key={u} className="p-1 align-top">
                    <input ref={reg(r, 3 + u)} disabled={disabled} value={v} onChange={(e) => setExpected(r, u, e.target.value)} onKeyDown={(e) => onKey(e, r, 3 + u)} onPaste={(e) => onPaste(e, r, 3 + u)}
                      className={`w-full rounded border px-2 py-1 ${status ? CELL_BG[status.status] : err && v !== '' ? 'border-red-300' : 'border-gray-300'}`} />
                    {err && v !== '' && <p className="mt-0.5 text-xs text-red-700">{err}</p>}
                    {status?.status === 'pass' && status.found !== undefined && status.found !== v && <p className="mt-0.5 text-xs text-emerald-800">found: {status.found}</p>}
                    {status?.status === 'fail' && <p className="mt-0.5 text-xs text-red-800">{status.found !== undefined ? `found: ${status.found}. ` : ''}{status.hint}</p>}
                    {status?.status === 'not_captured' && <p className="mt-0.5 text-xs text-amber-800">page not captured</p>}
                    {status?.status === 'stale' && <p className="mt-0.5 text-xs text-gray-600">changed since verified</p>}
                    {status?.weak && <p className="mt-0.5 text-xs text-gray-500">weak evidence: same value on every page</p>}
                  </td>
                );
              })}
              <td className="p-1"><button type="button" disabled={disabled} onClick={() => onChange({ ...state, rows: state.rows.filter((_, j) => j !== r) })} className="text-gray-400 hover:text-red-600" aria-label="Delete row"><Trash2 className="h-4 w-4" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" disabled={disabled} onClick={() => onChange({ ...state, rows: [...state.rows, emptyRow()] })} className="mt-2 inline-flex items-center gap-1 text-sm text-accent-700"><Plus className="h-4 w-4" /> Add row</button>
    </div>
  );
}
