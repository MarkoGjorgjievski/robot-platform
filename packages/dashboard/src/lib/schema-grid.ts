export const FIELD_TYPES = ['text', 'number', 'money', 'boolean', 'date', 'url', 'image', 'text_list'] as const;
export type GridFieldType = (typeof FIELD_TYPES)[number];
export type GridRow = { id: string; key?: string; name: string; type: GridFieldType; description: string; expected: string[] };
export type GridState = { urls: string[]; listingUrl: string; rows: GridRow[] };
export const URL_COUNT = 3;
const FIXED_COLS = 3; // name, type, description

let seq = 0;
export function emptyRow(): GridRow { return { id: `r${Date.now().toString(36)}${(seq++).toString(36)}`, name: '', type: 'text', description: '', expected: Array(URL_COUNT).fill('') }; }
export function emptyState(): GridState { return { urls: Array(URL_COUNT).fill(''), listingUrl: '', rows: [emptyRow()] }; }

const TRUE = ['true', 'yes', 'y', '1', 'in stock', 'instock', 'available', 'in-stock'];
const FALSE = ['false', 'no', 'n', '0', 'out of stock', 'outofstock', 'unavailable', 'sold out'];
const LABEL: Record<GridFieldType, string> = { text: 'text', number: 'a number', money: 'a money amount', boolean: 'yes/no (or in stock/out of stock)', date: 'a date', url: 'a URL', image: 'an image URL', text_list: 'a comma-separated list' };

export function validateExpectedClient(type: GridFieldType, text: string): string | null {
  const t = text.trim();
  if (t === '') return 'Expected value is required';
  const ok = (() => {
    switch (type) {
      case 'text': case 'text_list': return true;
      case 'number': case 'money': return /\d/.test(t) && /^[^\d]*[-+]?[\d.,]+[^\d]*$/.test(t.replace(/[A-Za-z$€£¥₹\s]/g, ''));
      case 'boolean': return TRUE.includes(t.toLowerCase()) || FALSE.includes(t.toLowerCase());
      case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(t) || !Number.isNaN(Date.parse(t));
      case 'url': case 'image': try { return /^https?:$/.test(new URL(t).protocol); } catch { return false; }
    }
  })();
  return ok ? null : `Not ${LABEL[type]}`;
}

export function parseBlock(text: string): string[][] {
  return text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
}

function setCell(row: GridRow, col: number, value: string): GridRow {
  if (col === 0) return { ...row, name: value };
  if (col === 1) return { ...row, type: (FIELD_TYPES as readonly string[]).includes(value.trim().toLowerCase()) ? (value.trim().toLowerCase() as GridFieldType) : row.type };
  if (col === 2) return { ...row, description: value };
  const i = col - FIXED_COLS;
  if (i < 0 || i >= URL_COUNT) return row;
  const expected = [...row.expected]; expected[i] = value;
  return { ...row, expected };
}

export function applyPaste(state: GridState, at: { row: number; col: number }, block: string[][]): GridState {
  const rows = [...state.rows];
  block.forEach((line, r) => {
    const idx = at.row + r;
    while (rows.length <= idx) rows.push(emptyRow());
    let row = rows[idx]!;
    line.forEach((value, c) => { row = setCell(row, at.col + c, value); });
    rows[idx] = row;
  });
  return { ...state, rows };
}

const HEADER_ALIASES: Record<string, number> = { name: 0, field: 0, 'field name': 0, type: 1, description: 2, where: 2 };

export function rowsFromTable(table: string[][], urlCount: number): { rows: GridRow[]; problems: string[] } {
  if (table.length < 2) return { rows: [], problems: ['The file needs a header row and at least one field row'] };
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const colOf = (n: number): number => header.findIndex((h) => Object.entries(HEADER_ALIASES).some(([k, v]) => v === n && h === k));
  const nameCol = colOf(0), typeCol = colOf(1), descCol = colOf(2);
  const urlCols = Array.from({ length: urlCount }, (_, i) => header.findIndex((h) => h === `url ${i + 1}` || h === `url${i + 1}` || h === `expected ${i + 1}` || h === `value ${i + 1}`));
  const problems: string[] = [];
  for (const [label, col] of [['name', nameCol], ['type', typeCol], ['description', descCol]] as const) if (col === -1) problems.push(`Missing column: ${label}`);
  urlCols.forEach((c, i) => { if (c === -1) problems.push(`Missing column: url ${i + 1}`); });
  if (problems.length) return { rows: [], problems };
  const rows = table.slice(1).map((line) => {
    const base = emptyRow();
    let row = setCell(base, 0, line[nameCol] ?? '');
    row = setCell(row, 1, line[typeCol] ?? '');
    row = setCell(row, 2, line[descCol] ?? '');
    urlCols.forEach((c, i) => { row = setCell(row, FIXED_COLS + i, line[c] ?? ''); });
    return row;
  });
  return { rows, problems: [] };
}

export function gridProblems(state: GridState): string[] {
  const problems: string[] = [];
  const urls = state.urls.map((u) => u.trim());
  if (urls.some((u) => u === '')) problems.push(`All ${URL_COUNT} product URLs are required`);
  const hosts = new Set<string>();
  for (const u of [...urls, state.listingUrl.trim()].filter(Boolean)) { try { hosts.add(new URL(u).hostname.toLowerCase()); } catch { problems.push(`Not a valid URL: ${u}`); } }
  if (hosts.size > 1) problems.push('All URLs must be on the same website');
  if (new Set(urls.map((u) => u.replace(/#.*$/, ''))).size !== urls.length) problems.push('URLs must be different pages');
  if (state.rows.length === 0) problems.push('Add at least one field');
  const names = new Set<string>();
  for (const r of state.rows) {
    if (r.name.trim() === '') { problems.push('Every field needs a name'); continue; }
    if (names.has(r.name.trim().toLowerCase())) problems.push(`Duplicate field name: ${r.name}`);
    names.add(r.name.trim().toLowerCase());
    if (r.description.trim() === '') problems.push(`${r.name}: description is required`);
    r.expected.forEach((v, i) => { const err = validateExpectedClient(r.type, v); if (err) problems.push(`${r.name} @ ${urls[i] || `URL ${i + 1}`}: ${err}`); });
  }
  return problems;
}

export function isComplete(state: GridState): boolean { return gridProblems(state).length === 0; }

export function shortUrl(url: string): string {
  let p: string;
  try { const u = new URL(url); p = u.pathname + (u.search ? '?…' : ''); } catch { p = url; }
  if (p.length <= 28) return p;
  return `${p.slice(0, 13)}…${p.slice(-14)}`;
}

export function toSchemaInput(state: GridState) {
  const urls = state.urls.map((u) => u.trim());
  const expected: Record<string, Record<string, string>> = {};
  for (const r of state.rows) expected[r.key ?? r.name] = Object.fromEntries(urls.map((u, i) => [u, r.expected[i] ?? '']));
  return {
    urls,
    ...(state.listingUrl.trim() ? { listingUrl: state.listingUrl.trim() } : {}),
    fields: state.rows.map((r) => ({ ...(r.key ? { key: r.key } : {}), name: r.name.trim(), type: r.type, description: r.description.trim() })),
    expected,
  };
}

export function fromSource(source: { schemaDefinition: unknown; verificationSet: unknown }): GridState | null {
  const def = source.schemaDefinition as Array<{ key: string; name: string; type: GridFieldType; description: string }> | null;
  const set = source.verificationSet as { urls: string[]; expected: Record<string, Record<string, string>>; listing_url?: string } | null;
  if (!Array.isArray(def) || !set) return null;
  return {
    urls: set.urls,
    listingUrl: set.listing_url ?? '',
    rows: def.map((f) => ({ ...emptyRow(), key: f.key, name: f.name, type: f.type, description: f.description, expected: set.urls.map((u) => set.expected[f.key]?.[u] ?? '') })),
  };
}
