// CLI: Jev with images — an experiment (spec docs/superpowers/specs/2026-10-15-jev-images-experiment.md).
//
//   pnpm --filter @robot/api exec tsx src/jev-images-run.ts --set a|b [--dry-run] [--recapture]
//        [--max-usd 2] [--max-questions 600] [--repeats N] [--billing] [--report-only]
//
// Two phases per set:
//   prepare — fresh captures with our own Chromium (one at a time, per-host pacing), a 1440x1000 PNG
//             crop per question under docs/testing/results/2026-10-15-jev-images/crops/, and
//             plan-<set>.json holding every request. Reused by later invocations unless --recapture.
//   send    — TypeSafe systemOne (model jev-1.14.0, images header): one request per page and crop, every
//             question sharing that crop in it, the image once in state; calls and answers appended to
//             answers.json as they come; then report.md is rewritten from everything so far.
//   --billing — on set B's plan: on 3 pages, 1 question with the image vs 5 questions with the image in
//             state only vs 5 questions each referencing it (plus a text-only control): how images are billed.
// --dry-run stops after prepare and prints counts and the token estimate; nothing is sent.
//
// Spending cap: the sum of usage.input_tokens over answers.json (every set, every invocation)
// x $0.042 / 1e6 must stay under --max-usd (default $2.00), and answers.json holds at most
// --max-questions (default 600) answered questions. One retry per request (SDK); 5 failed requests in a row
// abort. Database: SELECT only.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { db, runs, runItems, extractions, sources } from '@robot/db';
import { buildBoxMapScript, normalize, pathFitsConcept, type Box, type CustomerFieldType } from '@robot/scraper';
import { contractFields, type ContractField } from './contract.js';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const OUT = join(repoRoot, 'docs', 'testing', 'results', '2026-10-15-jev-images');
const CROPS = join(OUT, 'crops');
const ANSWERS = join(OUT, 'answers.json');
const MODEL = 'jev-1.14.0';
const USD_PER_TOKEN = 0.042 / 1e6;
const W = 1440;
const H = 1000;
const HOST_GAP_MS = 4_000;
const PAGE_GAP_MS = 2_000;

// ─── Arguments ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let set: 'a' | 'b' | undefined;
let dryRun = false;
let recapture = false;
let reportOnly = false;
let billingOnly = false;
let maxUsd = 2;
let maxQuestions = 600;
let repeats: number | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--set') { const v = args[++i]; if (v !== 'a' && v !== 'b') die('--set a|b'); set = v; }
  else if (a === '--dry-run') dryRun = true;
  else if (a === '--recapture') recapture = true;
  else if (a === '--report-only') reportOnly = true;
  else if (a === '--billing') billingOnly = true;
  else if (a === '--max-usd') maxUsd = Math.min(2, Number(args[++i]));
  else if (a === '--max-questions') maxQuestions = Math.min(600, Number(args[++i]));
  else if (a === '--repeats') repeats = Number(args[++i]);
  else die(`unknown argument ${a}`);
}
if (!set && !reportOnly) die('usage: jev-images-run --set a|b [--dry-run] [--recapture] [--max-usd X] [--max-questions N] [--repeats N] [--billing] [--report-only]');
function die(msg: string): never { console.error(msg); process.exit(1); }

mkdirSync(CROPS, { recursive: true });

// ─── Types ───────────────────────────────────────────────────────────────────

type Field = { key: string; name: string; type: CustomerFieldType; concept: string; description: string };
type Candidate = { id: string; value: string; source: string };
type Rect = { x: number; y: number; w: number; h: number };
/** One question as planned: everything needed to send it, without the image bytes. */
type Planned = {
  id: string; set: 'a' | 'b'; group: string; site: string; url: string;
  field: Field; kind: 'choice' | 'noul';
  /** Noul: the value asked about. */
  value?: unknown;
  /** Choice: the candidates; truth is a candidate's value (or 'none'). Noul: truth 'yes' | 'no'. */
  candidates?: Candidate[];
  truth?: string;
  /** Set B: the stored judge verdict, and whether the campaign hand count calls it a real error. */
  judge?: 'correct' | 'wrong'; real?: boolean; shown?: boolean | null;
  instructions?: string;
  pageTitle?: string;
  crop?: string; cropMode?: 'viewport' | 'element' | 'hint' | 'fallback'; target?: Rect | null;
  /** Set B: the fresh page still carries the stored value in its text or data. */
  carried?: boolean;
  skipped?: string;
};
type Plan = { set: 'a' | 'b'; preparedAt: string; viewport: { width: number; height: number }; questions: Planned[]; walled: Array<{ url: string; reason: string }>; pages: Array<{ url: string; viewport: string }> };
/** One systemOne request. kind: main (the experiment) or a billing probe (control = text only, a, b, c). */
type Call = {
  id: string; set: 'a' | 'b'; kind: 'main' | 'control' | 'bill-a' | 'bill-b' | 'bill-c'; url: string; crop: string | null;
  qids: string[]; repeat: number; at: string; ms: number; model?: string;
  input_tokens: number | null; output_tokens: number | null; error?: string;
};
type Answer = {
  callId: string; set: 'a' | 'b'; qid: string; repeat: number; kind: Call['kind'];
  noul?: number; choice?: string; confidence?: number; probabilities?: Record<string, number>;
};
type Store = { calls: Call[]; answers: Answer[] };

// ─── Pure helpers (matching, crops, candidates) ──────────────────────────────

export function normText(s: string): string {
  return s.normalize('NFKC').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The ways a number may be written on a page: 160 → 160, 160.00, 160,00; 1161.75 → 1,161.75. */
export function numberForms(v: unknown): string[] {
  const raw = String(v).trim();
  const n = Number(raw.replace(/[^0-9.\-]/g, ''));
  const out = new Set<string>([raw]);
  if (Number.isFinite(n)) {
    out.add(String(n));
    out.add(n.toFixed(2));
    out.add(n.toFixed(2).replace('.', ','));
    if (Number.isInteger(n * 10)) out.add(n.toFixed(1));
    out.add(n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    out.add(n.toLocaleString('en-US'));
  }
  return [...out].filter((s) => s !== '');
}
export function numberIn(v: unknown, text: string): boolean {
  return numberForms(v).some((f) => new RegExp(`(?<![\\d.,])${escapeRe(f)}(?![\\d]|[.,]\\d)`).test(text));
}
const LONG = 80;
/** Does the text hold the value? Numbers by their written forms, text by its first 60 characters. */
export function valueIn(v: unknown, type: string, text: string): boolean {
  if (type === 'boolean') return true;
  if (type === 'number' || type === 'money') return numberIn(v, text);
  const nv = normText(String(v));
  if (nv === '') return false;
  return normText(text).includes(nv.slice(0, 60));
}
/** A box whose own text is (part of) the value. */
export function boxHolds(box: { text: string }, v: unknown, type: string): boolean {
  const t = box.text ?? '';
  if (t.trim() === '') return false;
  if (type === 'number' || type === 'money') return numberIn(v, t);
  const nb = normText(t);
  const nv = normText(String(v));
  if (nv.length < 8) return nb === nv || new RegExp(`(^|\\W)${escapeRe(nv)}(\\W|$)`).test(nb);
  if (nb.includes(nv.slice(0, 40))) return true;
  return nb.length >= 12 && nv.startsWith(nb.slice(0, 40));
}
const HINTS: Record<string, RegExp> = {
  rating: /out of 5|\bstars?\b|\breviews?\b|\brating/i,
  sku: /\b(sku|ref\.?|reference|style|item|product code|model|art\.? ?nr)\b/i,
  availability: /add to (cart|bag|basket)|in stock|out of stock|sold out|notify me|unavailable/i,
  price: /[$£€]\s?\d|\d\s?(€|kr|rm)\b|\brm\s?\d/i,
  description: /\b(description|details|about this)\b/i,
};
/** Where a crop centres: the first box (top-down) holding the value, else a field hint, else nothing. */
export function locate(boxes: Box[], h1s: Array<{ text: string; rect: Rect }>, field: Field, value: unknown): { rect: Rect; how: 'element' | 'hint' } | null {
  const ordered = [...boxes].filter((b) => b.rect.y + b.rect.h > 0 && b.rect.w >= 4 && b.rect.h >= 4).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  // The title is the heading: crop on the h1 whatever else repeats the name (breadcrumbs, carousels).
  if (field.concept === 'product_name' && h1s[0]) return { rect: h1s[0].rect, how: 'element' };
  if (field.type !== 'boolean' && value !== undefined) {
    // The product area first (within 2000 px of the heading), then anywhere (never the footer for a brand).
    const h = h1s[0]?.rect;
    const holds = ordered.filter((b) => b.kind !== 'image' && boxHolds(b, value, field.type));
    const hit = (h ? holds.find((b) => Math.abs(b.rect.y - h.y) < 2000) : undefined) ?? (field.concept === 'brand' && h ? undefined : holds[0]);
    if (hit) return { rect: hit.rect, how: 'element' };
  }
  if ((field.concept === 'product_name' || field.concept === 'brand') && h1s[0]) return { rect: h1s[0].rect, how: 'hint' };
  const re = HINTS[field.concept];
  if (re) {
    // Near the heading when there is one: the buy box, not the footer.
    const h1 = h1s[0]?.rect;
    const near = (b: Box) => !h1 || (Math.abs(b.rect.y - h1.y) < 1200);
    const hit = ordered.find((b) => b.kind !== 'image' && re.test(b.text) && near(b)) ?? ordered.find((b) => b.kind !== 'image' && re.test(b.text));
    if (hit) return { rect: hit.rect, how: 'hint' };
  }
  if (h1s[0]) return { rect: h1s[0].rect, how: 'hint' };
  return null;
}
/** The viewport (top-left 1440x1000) when the target is inside it, else 1440x1000 centred on it, clamped to the document. */
export function cropFor(target: Rect | null, docW: number, docH: number): { clip: { x: number; y: number; width: number; height: number }; mode: 'viewport' | 'element' } {
  const height = Math.max(256, Math.min(H, docH));
  if (!target || (target.x >= 0 && target.y >= 0 && target.x + target.w <= W && target.y + target.h <= H)) {
    return { clip: { x: 0, y: 0, width: W, height }, mode: 'viewport' };
  }
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  const x = Math.max(0, Math.min(Math.round(cx - W / 2), Math.max(0, docW - W)));
  const y = Math.max(0, Math.min(Math.round(cy - H / 2), Math.max(0, docH - height)));
  return { clip: { x, y, width: W, height }, mode: 'element' };
}

type Leaf = { source: string; path: string; raw: unknown };
function leaves(value: unknown, path: string, depth: number, out: Leaf[], source: string): void {
  if (depth > 12 || out.length > 5000) return;
  if (Array.isArray(value)) { value.slice(0, 30).forEach((v, i) => leaves(v, `${path}[${i}]`, depth + 1, out, source)); return; }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) leaves(v, path === '' ? k : `${path}.${k}`, depth + 1, out, source);
    return;
  }
  if (path !== '' && value !== null && value !== undefined && value !== '') out.push({ source, path, raw: value });
}

/**
 * Choice candidates: distinct values of the page's structured leaves whose path fits the field
 * (JSON-LD and meta), plus the visible strings for the field (money strings near the heading for a
 * price, the h1 for a title, og:site_name for a brand). Verbatim; never free page text.
 */
export function candidatesFor(
  field: Field,
  structured: { ldJson: unknown[]; meta: Record<string, string> },
  boxes: Box[],
  h1s: Array<{ text: string; rect: Rect }>,
): Candidate[] {
  const out: Array<Omit<Candidate, 'id'>> = [];
  const seen = new Set<string>();
  const key = (v: string) => (field.type === 'money' ? normalize('money', v) : normText(v));
  const add = (value: string, source: string) => {
    const v = value.replace(/\s+/g, ' ').trim();
    if (v === '' || v.length > 200) return;
    const k = key(v);
    if (k === null || k === '' || seen.has(k)) return;
    seen.add(k);
    out.push({ value: v, source });
  };
  const ls: Leaf[] = [];
  structured.ldJson.forEach((b) => leaves(b, '', 0, ls, 'json-ld'));
  for (const [k, v] of Object.entries(structured.meta)) ls.push({ source: 'meta', path: k, raw: v });
  for (const l of ls) {
    if (!pathFitsConcept(field.concept, l.path)) continue;
    if (field.type === 'money' && normalize('money', l.raw) === null) continue;
    if (typeof l.raw === 'object') continue;
    add(String(l.raw), `${l.source} ${l.path}`);
  }
  if (field.concept === 'brand') {
    for (const k of ['og:site_name', 'application-name', 'product:brand']) if (structured.meta[k]) add(structured.meta[k]!, `meta ${k}`);
  }
  if (field.concept === 'product_name') {
    for (const h of h1s.slice(0, 2)) add(h.text, 'visible h1');
    if (structured.meta['og:title']) add(structured.meta['og:title'], 'meta og:title');
  }
  if (field.concept === 'price') {
    const h1 = h1s[0]?.rect;
    const moneyText = /^[^\d]{0,8}[$£€]\s?\d[\d,]*(\.\d{1,2})?\s*$|^\s*\d[\d,]*(\.\d{1,2})?\s?(€|£)\s*$/;
    for (const b of [...boxes].sort((a, c) => a.rect.y - c.rect.y || a.rect.x - c.rect.x)) {
      if (!moneyText.test(b.text)) continue;
      if (h1 ? Math.abs(b.rect.y - h1.y) > 700 || Math.abs(b.rect.x - h1.x) > 900 : b.rect.y > 1200) continue;
      add(b.text, 'visible');
    }
  }
  return out.slice(0, 30).map((c, i) => ({ id: `c${i + 1}`, ...c }));
}

/** How the value is written in a question: long text cut to its first 160 characters. */
export function valueText(v: unknown): { text: string; cut: boolean } {
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length > LONG * 2 ? { text: `${s.slice(0, 160)}…`, cut: true } : { text: s, cut: false };
}
export function noulInstructions(field: Field, v: unknown, override?: string): string {
  if (override) return override;
  if (field.type === 'boolean') {
    const yes = v === true || String(v).toLowerCase() === 'true' || /instock/i.test(String(v));
    return `Does the screenshot show this product as ${yes ? 'in stock (it can be bought now)' : 'out of stock (it cannot be bought now)'}?`;
  }
  const { text, cut } = valueText(v);
  return `Does the screenshot show "${text}" as this product's ${field.name}?${cut ? ' (The quoted text is the beginning of a longer text.)' : ''}`;
}
/** Truth match for a Choice: the chosen candidate's value equals the truth value (money by amount, text by normalised text). */
export function sameValue(type: string, a: string, b: string): boolean {
  if (type === 'money' || type === 'number') {
    const na = normalize(type as CustomerFieldType, a);
    return na !== null && na === normalize(type as CustomerFieldType, b);
  }
  return normText(a) === normText(b);
}

// ─── Case lists ──────────────────────────────────────────────────────────────

const BATCH_C = {
  sigmabeauty: { runId: 'c6c561de-336d-4e7e-b020-bb8b4ee29f6b', report: '2026-10-13T08-46-judge-run-sigmabeauty.md' },
  lacoste: { runId: '730a8df2-4435-485c-979c-1c8424b62fcd', report: '2026-10-13T09-32-judge-run-lacoste.md' },
  puma: { runId: '3ca46d0a-9403-4569-a994-ffd2d2d6f7c3', report: '2026-10-13T10-31-judge-run-puma.md' },
  notonthehighstreet: { runId: '582723e6-935a-4eb6-acc1-a01e632200b8', report: '2026-10-13T11-28-judge-run-notonthehighstreet.md' },
  ikea: { runId: '09250446-55d9-41b9-8812-f3ef8c41c948', report: '2026-10-13T11-40-judge-run-ikea.md' },
} as const;
type BatchSite = keyof typeof BATCH_C;

/** The campaign's hand count of batch C's real errors (docs/testing/2026-10-11-campaign-2.md): 10. */
function isRealError(site: BatchSite, fieldKey: string, url: string, shown: boolean | null | undefined): boolean {
  if (site === 'sigmabeauty') return fieldKey === 'rating';
  if (site === 'puma') return fieldKey === 'description' || (fieldKey === 'sku' && url.includes('312123') && url.includes('swatch=16'));
  if (site === 'notonthehighstreet') return fieldKey === 'rating' && shown === false;
  return false;
}

async function loadFields(): Promise<Field[]> {
  const src = await db.query.sources.findFirst({ where: eq(sources.id, '39c5a38a-28a1-4093-b6b7-86790a3b8a86'), with: { dataset: { columns: { schema: true } } } });
  return contractFields(src?.dataset?.schema).map((f: ContractField) => ({ key: f.key, name: f.name, type: f.type, concept: f.concept, description: String(f.description ?? '') }));
}
async function runValues(runId: string): Promise<Map<string, { row: Record<string, unknown>; shown: Record<string, boolean | null> }>> {
  const rows = await db
    .select({ url: runItems.url, kind: runItems.kind, data: extractions.data, vr: extractions.validationResult })
    .from(runItems).leftJoin(extractions, eq(extractions.id, runItems.extractionId))
    .where(eq(runItems.runId, runId)).orderBy(asc(runItems.createdAt), asc(runItems.id));
  const out = new Map<string, { row: Record<string, unknown>; shown: Record<string, boolean | null> }>();
  for (const r of rows) {
    if (r.kind !== 'detail' || !Array.isArray(r.data) || r.data.length === 0 || out.has(r.url)) continue;
    out.set(r.url, { row: (r.data as Array<Record<string, unknown>>)[0]!, shown: ((r.vr as { shown?: Record<string, boolean | null> } | null)?.shown) ?? {} });
  }
  return out;
}
/** The judge report's per-item table: url → { field name → verdict code }. */
function parseItemTable(md: string): Map<string, Record<string, string>> {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.startsWith('| URL | Page title |'));
  const header = lines[start]!.replace(/\\\|/g, '¦').split('|').map((s) => s.trim()).slice(1, -1);
  const out = new Map<string, Record<string, string>>();
  for (const l of lines.slice(start + 2)) {
    if (!l.startsWith('| http')) break;
    const cells = l.replace(/\\\|/g, '¦').split('|').map((s) => s.trim()).slice(1, -1);
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { if (i >= 2) rec[h] = cells[i] ?? ''; });
    out.set(cells[0]!, rec);
  }
  return out;
}
/** "## Wrong values" / "## Correct values flagged not shown" entries: field name, url. */
function parseSection(md: string, heading: string): Array<{ field: string; url: string }> {
  const at = md.indexOf(`## ${heading}`);
  if (at < 0) return [];
  const body = md.slice(at + heading.length + 3).split('\n## ')[0]!;
  return [...body.matchAll(/^- \*\*(.+?)\*\* — (\S+)/gm)].map((m) => ({ field: m[1]!, url: m[2]! }));
}
const verdictOf = (code: string): 'correct' | 'wrong' | null => (code.startsWith('C') ? 'correct' : code.startsWith('W') ? 'wrong' : null);

async function casesA(fields: Field[]): Promise<Planned[]> {
  const f = (k: string) => fields.find((x) => x.key === k)!;
  const qs: Planned[] = [];
  const add = (p: Omit<Planned, 'id' | 'set'>) => qs.push({ id: `a${String(qs.length + 1).padStart(2, '0')}`, set: 'a', ...p });
  const ruggable = [
    'https://ruggable.com/products/sierra-ivory-opal-tufted-rug?size=6x9&system=rug-cvr',
    'https://ruggable.com/products/morris-and-co-pimpernel-jade-tufted-rug?size=6x9&system=rug-cvr',
    'https://ruggable.com/products/cyrus-rose-gold-tufted-rug?size=6x9&system=rug-cvr',
  ];
  for (const url of ruggable) add({ group: 'ruggable-price', site: 'ruggable', url, field: { ...f('price'), description: "the price a buyer pays now for the selected size (6'x9')" }, kind: 'choice' });
  const gymshark = [
    'https://www.gymshark.com/products/gymshark-everyday-seamless-leggings-leggings-brown-aw26',
    'https://www.gymshark.com/products/gymshark-everyday-seamless-flared-legging-leggings-black-aw25',
    'https://www.gymshark.com/products/gymshark-whitney-mid-rise-legging-leggings-black-ss26',
  ];
  for (const url of gymshark) add({ group: 'gymshark-brand', site: 'gymshark', url, field: f('brand'), kind: 'choice', truth: 'Gymshark' });
  const colourpop = ['change-me-mega-highlighter', 'game-over-shadow-stix', 'beetle-chrome-liquid-shadow', 'truth-or-bare-lippie-pencil-vault', 'drift', 'cotton-candy-shadow-stix', 'opaltini', 'coven-clash-jelly-much-duo', 'emo-inside-jelly-much-shadow-n'];
  for (const slug of colourpop) add({ group: 'colourpop-title', site: 'colourpop', url: `https://colourpop.com/products/${slug}`, field: f('title'), kind: 'choice' });
  const skull = [
    'https://www.skullcandy.com/products/smokin-buds-true-wireless-earbuds?variant=44804831182905',
    'https://www.skullcandy.com/products/crusher-evo-sensory-bass-headphones-with-personal-sound?variant=46368310689849',
    'https://www.skullcandy.com/products/push-anc-active?variant=43208350498873',
  ];
  for (const url of skull) add({ group: 'skullcandy-stock', site: 'skullcandy', url, field: f('in_stock'), kind: 'noul', value: true, instructions: 'Does the screenshot show the selected colour of this product as in stock (it can be bought now)?' });

  // Batch C: the 10 real errors (Noul on the stored, wrong value: truth no) and 10 correct values the shown flag flagged (truth yes).
  for (const site of Object.keys(BATCH_C) as BatchSite[]) {
    const md = readFileSync(join(repoRoot, 'docs', 'testing', 'results', BATCH_C[site].report), 'utf8');
    const values = await runValues(BATCH_C[site].runId);
    for (const w of parseSection(md, 'Wrong values')) {
      const field = fields.find((x) => x.name === w.field)!;
      const v = values.get(w.url);
      if (!v || !isRealError(site, field.key, w.url, v.shown[field.key])) continue;
      add({ group: 'real-error', site, url: w.url, field, kind: 'noul', value: v.row[field.key], truth: 'no', shown: v.shown[field.key] ?? null });
    }
  }
  const flagged: Array<{ site: BatchSite; field: string; url: string }> = [];
  for (const site of ['lacoste', 'ikea'] as const) {
    const md = readFileSync(join(repoRoot, 'docs', 'testing', 'results', BATCH_C[site].report), 'utf8');
    for (const e of parseSection(md, 'Correct values flagged not shown')) flagged.push({ site, ...e });
  }
  const pick = [...flagged.filter((x) => x.site === 'lacoste'), ...flagged.filter((x) => x.site === 'ikea')].slice(0, 10);
  for (const p of pick) {
    const values = await runValues(BATCH_C[p.site].runId);
    const field = fields.find((x) => x.name === p.field)!;
    const v = values.get(p.url)!;
    add({ group: 'flagged-correct', site: p.site, url: p.url, field, kind: 'noul', value: v.row[field.key], truth: 'yes', shown: v.shown[field.key] ?? null });
  }
  return qs;
}

/** Set B: every judged-wrong value of batch C's five runs, the rest judged-correct values, 300 in all; whole items, in stored order. */
async function casesB(fields: Field[], total = 300): Promise<Planned[]> {
  type Cell = { site: BatchSite; url: string; field: Field; value: unknown; judge: 'correct' | 'wrong'; shown: boolean | null };
  const bySite = new Map<BatchSite, Array<{ url: string; cells: Cell[] }>>();
  let wrongs = 0;
  for (const site of Object.keys(BATCH_C) as BatchSite[]) {
    const md = readFileSync(join(repoRoot, 'docs', 'testing', 'results', BATCH_C[site].report), 'utf8');
    const values = await runValues(BATCH_C[site].runId);
    const items: Array<{ url: string; cells: Cell[] }> = [];
    for (const [url, codes] of parseItemTable(md)) {
      const v = values.get(url);
      if (!v) continue;
      const cells: Cell[] = [];
      for (const field of fields) {
        if (field.type === 'image') continue;
        const verdict = verdictOf(codes[field.name] ?? '');
        if (!verdict) continue;
        cells.push({ site, url, field, value: v.row[field.key], judge: verdict, shown: v.shown[field.key] ?? null });
        if (verdict === 'wrong') wrongs++;
      }
      items.push({ url, cells });
    }
    bySite.set(site, items);
  }
  const sites = [...bySite.keys()];
  const quota = Math.floor((total - wrongs) / sites.length);
  const chosen: Cell[] = [];
  for (const site of sites) {
    const items = bySite.get(site)!;
    let correct = 0;
    // Items with a wrong value first (every wrong value is in), then items in stored order until the site's correct quota.
    const ordered = [...items.filter((i) => i.cells.some((c) => c.judge === 'wrong')), ...items.filter((i) => !i.cells.some((c) => c.judge === 'wrong'))];
    for (const it of ordered) {
      const hasWrong = it.cells.some((c) => c.judge === 'wrong');
      if (!hasWrong && correct >= quota) break;
      for (const c of it.cells) {
        if (c.judge === 'wrong') chosen.push(c);
        else if (correct < quota) { chosen.push(c); correct++; }
      }
    }
  }
  return chosen.map((c, i) => ({
    id: `b${String(i + 1).padStart(3, '0')}`, set: 'b' as const, group: c.site, site: c.site, url: c.url, field: c.field, kind: 'noul' as const,
    value: c.value, judge: c.judge, real: c.judge === 'wrong' && isRealError(c.site, c.field.key, c.url, c.shown), shown: c.shown,
  }));
}

// ─── Prepare: captures and crops ─────────────────────────────────────────────

type Annotation = { boxes: Box[]; h1s: Array<{ text: string; rect: Rect }>; scrollWidth: number; scrollHeight: number; innerText: string };
function annotateScript(): string {
  return '(() => {'
    // Hide overlays first (Colourpop's zoom lightbox, Ruggable's cart drawer, cookie dialogs): any fixed or
    // modal element covering a quarter of the viewport. Synchronous, so the box map and the crops see the page.
    + ' const vw = window.innerWidth * window.innerHeight;'
    + ' for (const el of Array.from(document.querySelectorAll("body *"))) {'
    + '   const cs = window.getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") continue;'
    // An open custom modal element (Colourpop's <modal-dialog open> zoom gallery) is hidden outright.
    + '   if (/MODAL|DIALOG|DRAWER|LIGHTBOX/.test(el.tagName) && el.hasAttribute("open")) { el.style.setProperty("display", "none", "important"); continue; }'
    + '   const modal = el.getAttribute("aria-modal") === "true" || el.getAttribute("role") === "dialog" || el.tagName === "DIALOG";'
    + '   if (cs.position !== "fixed" && !modal) continue;'
    + '   const r = el.getBoundingClientRect(); if (r.width * r.height >= 0.25 * vw) el.style.setProperty("display", "none", "important");'
    + ' }'
    + ' document.documentElement.style.setProperty("overflow", "auto", "important"); if (document.body) document.body.style.setProperty("overflow", "auto", "important");'
    + ` const boxes = ${buildBoxMapScript()};`
    + ' const h1s = Array.from(document.querySelectorAll("h1")).map((h) => { const r = h.getBoundingClientRect();'
    + ' return { text: (h.innerText || "").replace(/\\s+/g, " ").trim(), rect: { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) } }; })'
    + ' .filter((h) => h.text && h.rect.w > 0 && h.rect.h > 0);'
    + ' return { boxes, h1s, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,'
    + ' innerText: (document.body ? document.body.innerText : "").slice(0, 400000) };'
    + ' })()';
}

function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }

async function prepare(s: 'a' | 'b'): Promise<Plan> {
  const fields = await loadFields();
  const questions = s === 'a' ? await casesA(fields) : await casesB(fields);
  const urls = [...new Set(questions.map((q) => q.url))];
  console.log(`[jev] set ${s}: ${questions.length} questions on ${urls.length} pages; capturing (one Chromium, per-host pacing)`);

  const { PlaywrightBrowser, verdictSentence } = await import('@robot/browser');
  const browser = new PlaywrightBrowser();
  await browser.launch({ headless: true, viewport: { width: W, height: H } });
  // capture() closes its page at the end; keep it open so crops come from the same render (any x, any y).
  type PageLike = { close: () => Promise<void>; screenshot: (o: Record<string, unknown>) => Promise<Buffer> };
  let held: { page: PageLike; close: () => Promise<void> } | null = null;
  const ctx = (browser as unknown as { context: { newPage: () => Promise<PageLike> } }).context;
  const newPage = ctx.newPage.bind(ctx);
  ctx.newPage = async () => {
    const p = await newPage();
    const realClose = p.close.bind(p);
    p.close = async () => { held = { page: p, close: realClose }; };
    return p;
  };
  const walled: Plan['walled'] = [];
  const written = new Set<string>();
  const pages: Plan['pages'] = [];
  const lastByHost = new Map<string, number>();
  try {
    for (const [i, url] of urls.entries()) {
      const host = new URL(url).host;
      const wait = Math.max(i > 0 ? PAGE_GAP_MS : 0, (lastByHost.get(host) ?? 0) + HOST_GAP_MS - Date.now());
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastByHost.set(host, Date.now());
      const qs = questions.filter((q) => q.url === url);
      console.log(`[jev] ${i + 1}/${urls.length} ${url} (${qs.length} q)`);
      held = null;
      try {
        const capture = await browser.capture(url, { waitUntil: 'load', maxTiles: 1, annotate: annotateScript() });
        const page = held as { page: PageLike; close: () => Promise<void> } | null;
        try {
          if (capture.verdict.kind !== 'ok' && capture.verdict.kind !== 'wrong-variant') {
            const reason = verdictSentence(capture.verdict, url);
            walled.push({ url, reason });
            for (const q of qs) q.skipped = `walled: ${reason}`;
            console.warn(`  skipped: ${reason}`);
            continue;
          }
          if (capture.verdict.kind === 'wrong-variant') console.warn('  note: the page shows another variant than the address names');
          const ann = capture.annotation as Annotation | undefined;
          if (!ann || !Array.isArray(ann.boxes) || !page) {
            for (const q of qs) q.skipped = 'no annotation';
            continue;
          }
          const dataText = normText(JSON.stringify([capture.structuredData.ldJson, capture.structuredData.meta, capture.interceptedRequests.map((r) => r.parsedJson)])
            .replace(/\\[nrt]/g, ' ').replace(/\\"/g, '"').replace(/\\u0026/g, '&'));
          const text = ann.innerText ?? '';
          for (const q of qs) {
            q.pageTitle = capture.title;
            if (q.kind === 'choice') {
              q.candidates = candidatesFor(q.field, capture.structuredData, ann.boxes, ann.h1s);
              if (q.group === 'colourpop-title' && ann.h1s[0]) q.truth = ann.h1s[0].text;
              const c = q.candidates;
              q.instructions = `Which candidate is the ${q.field.name} of the product shown — ${q.field.description}?`;
              const truthBox = q.truth ? c.find((x) => sameValue(q.field.type, x.value, q.truth!)) : undefined;
              // Centre on the visible field: the first box holding any candidate value (the heading for a title or brand).
              let at: ReturnType<typeof locate> = null;
              if (q.field.concept === 'price') {
                for (const cand of c) { const l = locate(ann.boxes, ann.h1s, q.field, cand.value); if (l?.how === 'element' && (!at || l.rect.y < at.rect.y)) at = l; }
              }
              // Title and brand: the heading (never a value-matched box: that would point at the answer).
              at ??= locate(ann.boxes, ann.h1s, q.field, undefined);
              void truthBox;
              q.target = at?.rect ?? null;
              q.cropMode = at ? (at.how === 'element' ? 'element' : 'hint') : 'fallback';
            } else {
              q.instructions = noulInstructions(q.field, q.value, q.instructions);
              q.carried = q.set === 'b' ? (valueIn(q.value, q.field.type, text) || valueIn(q.value, q.field.type, dataText)) : true;
              if (q.set === 'b' && !q.carried) { q.skipped = 'changed since'; continue; }
              const at = locate(ann.boxes, ann.h1s, q.field, q.value);
              q.target = at?.rect ?? null;
              q.cropMode = at ? at.how : 'fallback';
            }
            const { clip, mode } = cropFor(q.target ?? null, ann.scrollWidth, ann.scrollHeight);
            if (mode === 'viewport') q.cropMode = 'viewport';
            // One file per distinct crop of the page: questions sharing it are asked in one call.
            const name = `${s}-p${String(i + 1).padStart(3, '0')}-${slug(q.site)}-${clip.x}-${clip.y}.png`;
            if (!existsSync(join(CROPS, name)) || !written.has(name)) {
              writeFileSync(join(CROPS, name), await page.page.screenshot({ type: 'png', fullPage: true, clip, timeout: 60_000 }));
              written.add(name);
            }
            q.crop = `crops/${name}`;
          }
          // The page's viewport crop, for the billing measurement (one image, many questions).
          const vname = `${s}-p${String(i + 1).padStart(3, '0')}-${slug(qs[0]!.site)}-0-0.png`;
          if (!written.has(vname)) {
            writeFileSync(join(CROPS, vname), await page.page.screenshot({ type: 'png', fullPage: true, clip: cropFor(null, ann.scrollWidth, ann.scrollHeight).clip, timeout: 60_000 }));
            written.add(vname);
          }
          pages.push({ url, viewport: `crops/${vname}` });
        } finally {
          await page?.close().catch(() => {});
        }
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)).split('\n')[0]!;
        walled.push({ url, reason: `capture failed: ${msg}` });
        for (const q of qs) q.skipped = `capture failed: ${msg}`;
        console.warn(`  capture failed: ${msg}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  const plan: Plan = { set: s, preparedAt: new Date().toISOString(), viewport: { width: W, height: H }, questions, walled, pages };
  writeFileSync(join(OUT, `plan-${s}.json`), JSON.stringify(plan, null, 2));
  return plan;
}

// ─── Send ────────────────────────────────────────────────────────────────────

const readStore = (): Store => (existsSync(ANSWERS) ? JSON.parse(readFileSync(ANSWERS, 'utf8')) as Store : { calls: [], answers: [] });
const tokensOf = (cs: Call[]) => cs.reduce((n, c) => n + (c.input_tokens ?? 0), 0);
/** Wes Bos: 850x850 ≈ 2,300 tokens → ~315 px per token; text ~4 chars per token. */
const IMAGE_TOKENS_EST = Math.round((W * H) / 315);
const estimateCall = (qs: Planned[]) => IMAGE_TOKENS_EST + Math.round(JSON.stringify(qs.map((q) => [q.instructions, q.candidates, q.field])).length / 4) + 50;

/** The question text: the instructions plus the field it is about (a batched call holds several fields). */
function questionFor(q: Planned, sdk: { choice: typeof import('@typesafe-ai/sdk').choice; noul: typeof import('@typesafe-ai/sdk').noul }, prefix = '') {
  if (q.kind === 'choice') {
    return sdk.choice(`${prefix}${q.instructions!}`, {
      ...Object.fromEntries((q.candidates ?? []).map((c) => [c.id, c.value])),
      none: `None of the candidates is the product's ${q.field.name} as the screenshot shows it`,
    });
  }
  return sdk.noul(`${prefix}${q.instructions!} (${q.field.name}: ${q.field.description})`);
}
/** State: the screenshot once, the page title, and each choice question's candidates as verbatim { id, value } items. */
function stateFor(qs: Planned[], screenshot: unknown) {
  const choices = qs.filter((q) => q.kind === 'choice');
  return {
    ...(screenshot !== undefined ? { screenshot: screenshot as never } : {}),
    page_title: qs[0]?.pageTitle ?? '',
    ...(choices.length ? { candidates: Object.fromEntries(choices.map((q) => [q.id, (q.candidates ?? []).map((c) => ({ id: c.id, value: c.value }))])) } : {}),
  };
}

type Sdk = typeof import('@typesafe-ai/sdk');
async function makeClient(): Promise<{ sdk: Sdk; client: InstanceType<Sdk['TypeSafeClient']> }> {
  const sdk = await import('@typesafe-ai/sdk');
  if (!process.env.TYPESAFE_API_KEY) die('TYPESAFE_API_KEY is not set');
  const client = new sdk.TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' }, retry: { maxRetries: 1 }, timeout: 90_000, logLevel: 'error' });
  return { sdk, client };
}

/** One request; the call and its answers are appended to the store and saved at once. */
async function call(
  store: Store, sdk: Sdk, client: InstanceType<Sdk['TypeSafeClient']>,
  meta: Pick<Call, 'set' | 'kind' | 'url' | 'crop' | 'repeat'>, qs: Planned[],
  build: (img: InstanceType<Sdk['Image']> | null) => { state: unknown; questions: Record<string, unknown>; assets?: Record<string, unknown> },
): Promise<Call> {
  const img = meta.crop ? sdk.image(readFileSync(join(OUT, meta.crop))) : null;
  const req = build(img);
  const c: Call = { id: `k${store.calls.length + 1}`, ...meta, qids: qs.map((q) => q.id), at: new Date().toISOString(), ms: 0, input_tokens: null, output_tokens: null };
  const t0 = Date.now();
  try {
    const res = await client.systemOne({ model: MODEL, state: req.state as never, questions: req.questions as never, ...(req.assets ? { assets: req.assets as never } : {}) });
    c.ms = Date.now() - t0;
    Object.assign(c, { model: res.model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens });
    for (const [key, r0] of Object.entries(res.answers as Record<string, unknown>)) {
      const r = r0 as { type: string; noul?: number; choice?: string; confidence?: number; probabilities?: Record<string, number> };
      const qid = key.replace(/^q_/, '');
      const a: Answer = { callId: c.id, set: meta.set, qid, repeat: meta.repeat, kind: meta.kind };
      if (r.type === 'noul') a.noul = r.noul; else Object.assign(a, { choice: r.choice, confidence: r.confidence, probabilities: r.probabilities });
      store.answers.push(a);
    }
  } catch (err) {
    c.ms = Date.now() - t0;
    c.error = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300);
  }
  store.calls.push(c);
  writeFileSync(ANSWERS, JSON.stringify(store, null, 1));
  const spent = tokensOf(store.calls) * USD_PER_TOKEN;
  console.log(`[jev] ${c.id} ${meta.kind} ${meta.set} r${meta.repeat} ${qs.length}q ${c.error ? `ERROR ${c.error}` : `${c.input_tokens} tok ${c.ms} ms`} · total $${spent.toFixed(4)}`);
  return c;
}

const capOk = (store: Store, nextEst: number) => {
  const spent = tokensOf(store.calls) * USD_PER_TOKEN;
  if (spent + nextEst * USD_PER_TOKEN * 2 > maxUsd) { console.warn(`[jev] STOP: spend cap $${maxUsd} (spent $${spent.toFixed(4)})`); return false; }
  const asked = store.answers.length + store.calls.filter((c) => c.error).length;
  if (asked >= maxQuestions) { console.warn(`[jev] STOP: ${maxQuestions} questions`); return false; }
  return true;
};

/**
 * The billing measurement (coordinator's addition): on 3 set B pages with at least 5 questions, the
 * page's viewport crop and its first 5 questions — control: 1 question, no image; a: 1 question, image
 * in state; b: 5 questions in one call, image in state only; c: 5 questions, each referencing the image.
 */
async function billing(plan: Plan): Promise<void> {
  const { sdk, client } = await makeClient();
  const store = readStore();
  if (store.calls.some((c) => c.kind.startsWith('bill-'))) { console.log('[jev] billing already measured'); return; }
  const pages = plan.pages.filter((p) => plan.questions.filter((q) => q.url === p.url && !q.skipped).length >= 5).slice(0, 3);
  for (const p of pages) {
    const qs = plan.questions.filter((q) => q.url === p.url && !q.skipped).slice(0, 5);
    if (!capOk(store, estimateCall(qs) * 3)) return;
    const meta = { set: plan.set, url: p.url, repeat: 0 } as const;
    const one = [qs[0]!];
    await call(store, sdk, client, { ...meta, kind: 'control', crop: null }, one, () => ({ state: stateFor(one, undefined), questions: { [`q_${one[0]!.id}`]: questionFor(one[0]!, sdk) } }));
    await call(store, sdk, client, { ...meta, kind: 'bill-a', crop: p.viewport }, one, (img) => ({ state: stateFor(one, img), questions: { [`q_${one[0]!.id}`]: questionFor(one[0]!, sdk) } }));
    await call(store, sdk, client, { ...meta, kind: 'bill-b', crop: p.viewport }, qs, (img) => ({ state: stateFor(qs, img), questions: Object.fromEntries(qs.map((q) => [`q_${q.id}`, questionFor(q, sdk)])) }));
    await call(store, sdk, client, { ...meta, kind: 'bill-c', crop: p.viewport }, qs, (img) => ({
      state: stateFor(qs, '<screenshot>'),
      questions: Object.fromEntries(qs.map((q) => [`q_${q.id}`, questionFor(q, sdk, 'Looking at <screenshot>: ')])),
      assets: { '<screenshot>': img },
    }));
  }
}

/** The main run: one call per (page, crop), every question that shares the crop in it, the image once in state. */
async function send(plan: Plan, reps: number): Promise<void> {
  const { sdk, client } = await makeClient();
  const store = readStore();
  const done = new Set(store.answers.filter((a) => a.kind === 'main').map((a) => `${a.qid}#${a.repeat}`));
  const todo = plan.questions.filter((q) => !q.skipped && q.crop);
  const groups = new Map<string, Planned[]>();
  for (const q of todo) groups.set(`${q.url}|${q.crop}`, [...(groups.get(`${q.url}|${q.crop}`) ?? []), q]);
  let errStreak = 0;
  for (let rep = 1; rep <= reps; rep++) {
    for (const qs0 of groups.values()) {
      const qs = qs0.filter((q) => !done.has(`${q.id}#${rep}`));
      if (qs.length === 0) continue;
      if (!capOk(store, estimateCall(qs))) return;
      const c = await call(store, sdk, client, { set: plan.set, kind: 'main', url: qs[0]!.url, crop: qs[0]!.crop!, repeat: rep }, qs,
        (img) => ({ state: stateFor(qs, img), questions: Object.fromEntries(qs.map((q) => [`q_${q.id}`, questionFor(q, sdk)])) }));
      errStreak = c.error ? errStreak + 1 : 0;
      if (errStreak >= 5) { console.warn('[jev] ABORT: 5 failed requests in a row'); return; }
    }
  }
}

// ─── Report ──────────────────────────────────────────────────────────────────

const pct = (a: number, b: number) => (b === 0 ? '—' : `${Math.round((100 * a) / b)}%`);
const short = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\?.*$/, (m) => (m.length > 30 ? `${m.slice(0, 30)}…` : m)).slice(0, 70);
const cellText = (v: unknown) => String(valueText(v).text).replace(/\|/g, '\\|').slice(0, 60);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };

/** Hand-written after looking at the answers and crops of the 2026-10-15 run (not computed). */
const READING = [
  '## Reading the numbers (2026-10-15, by hand)', '',
  '- **Set A truths set by looking at the crops** (`truth-a.json`): Ruggable shows the sale price for 6\'x9\' ($374.25 / $449.25 / $424.15, the list price struck through beside it); Skullcandy shows OUT OF STOCK on Smokin\' Buds and Push ANC Active, ADD TO CART on Crusher Evo. **a21 changed since batch C:** Puma 312123 `?swatch=16` now prints "Style: 312123_16", the stored value, so its truth is yes (Jev said yes); the other 9 real errors are still wrong on the fresh pages.',
  '- **Set A misses are all one kind:** the 5 flagged-correct cases Jev rejects are 4 Ikea descriptions (the stored JSON-LD copy starts with the product name, and the crop does not show it as stored) and Lacoste\'s rating 4.625 (the page shows stars only). Those values are not printed as stored, so Jev\'s "no" is literally right; the case list called them correct because the judge did.',
  '- **Set B false alarms (44) are mostly values not visible in the crop:** 28 are descriptions (collapsed accordions, text below the crop, Ikea\'s name-prefixed JSON-LD copy), 7 are Sigma\'s brand "SigmaBeauty" against a "SIGMA" logo, and the rest are scattered (2 Sigma prices shown in MYR, 3 Puma titles split over two lines, 2 stock answers, 2 ratings). On title, price, SKU and brand outside Sigma, Jev agreed with the judge on every value but 4 (3 Puma titles, and the Puma Lafrance SKU, where Jev is right).',
  '- **Where Jev and the judge disagree on judge-wrong values, Jev is usually the one that is right:** Sigma\'s SKUs are printed at the bottom of the page ("SKU: SBS01", seen in the crop), and Puma\'s Lafrance "Style: 314471_01" is printed; the judge said "no SKU" (its known limit). Jev agrees with the judge on Lacoste\'s 11 star-only ratings and 3 barcodes, which really are not printed.',
  '- **Calibration:** above 0.5 Jev is 91–95% in line with the judge; below 0.5 the low bucket (0.0–0.1) is mostly real "not shown", while 0.1–0.5 is mostly correct values Jev could not see (descriptions) — a useful "unsure" band rather than a "wrong" signal.',
  '- **Stability:** no answer flipped across the three set A repeats; probabilities moved by at most 0.05.',
  '',
];

function report(): void {
  const store = readStore();
  const plans = (['a', 'b'] as const).map((s) => (existsSync(join(OUT, `plan-${s}.json`)) ? JSON.parse(readFileSync(join(OUT, `plan-${s}.json`), 'utf8')) as Plan : null));
  const main = store.answers.filter((a) => a.kind === 'main');
  const L: string[] = [];
  const tok = tokensOf(store.calls);
  const okCalls = store.calls.filter((c) => !c.error);
  L.push('# Jev with images — results', '');
  L.push(`Spec: \`docs/superpowers/specs/2026-10-15-jev-images-experiment.md\`. CLI: \`packages/api/src/jev-images-run.ts\`. Model \`${MODEL}\`, header \`TypeSafe-Danger-Zone-Images: true\`, SDK \`@typesafe-ai/sdk\` 0.7.0.`, '');
  L.push(`- Requests: ${store.calls.length} (${store.calls.filter((c) => c.error).length} failed): ${store.calls.filter((c) => c.kind === 'main').length} for the experiment, ${store.calls.filter((c) => c.kind !== 'main').length} for the billing measurement. Answers: ${store.answers.length}.`);
  L.push(`- Input tokens: ${tok.toLocaleString('en-US')}; output tokens: ${store.calls.reduce((n, c) => n + (c.output_tokens ?? 0), 0).toLocaleString('en-US')}.`);
  L.push(`- **Cost: $${(tok * USD_PER_TOKEN).toFixed(4)}** (input tokens × $0.042 / 1M; cap $2.00).`);
  L.push(`- Latency per request: median ${median(okCalls.map((c) => c.ms))} ms (min ${Math.min(...okCalls.map((c) => c.ms))}, max ${Math.max(...okCalls.map((c) => c.ms))}).`);
  L.push(`- Images: ${W}×${H} PNG crops from our own Chromium (viewport ${W}×${H}), fresh captures (${[plans[0]?.preparedAt, plans[1]?.preparedAt].filter(Boolean).join(', ')}). Overlays covering a quarter of the viewport (fixed or modal: a zoom lightbox, a cart drawer, cookie dialogs) are hidden before the box map and the crops. A crop is the viewport when the value's element is inside it, else ${W}×${H} centred on the element (box map; the heading for a title), else on a field hint (rating/stock/SKU words, the heading). Questions on one page that share a crop are asked in one call, the image once in \`state\`. Crops in \`crops/\`, every call and answer in \`answers.json\`, the requests in \`plan-a.json\` / \`plan-b.json\`.`);
  L.push('');

  // Batching and billing.
  const bill = store.calls.filter((c) => c.kind !== 'main' && !c.error);
  if (bill.length) {
    L.push('## Batching and billing', '');
    L.push(`Three set B pages, each with its ${W}×${H} viewport crop and its first five questions. control: 1 question, no image. a: 1 question, image in state. b: 5 questions in one call, image in state only, the questions say "the screenshot" in words. c: the same 5 questions, each prefixed "Looking at <screenshot>:" with the image passed in \`assets\` under that reference (state names it too).`, '');
    L.push('| Page | control (text, 1 q) | a (image, 1 q) | b (image in state, 5 q) | c (image referenced, 5 q) | image ≈ a − control | b − a | c − b |', '|---|---:|---:|---:|---:|---:|---:|---:|');
    const urls = [...new Set(bill.map((c) => c.url))];
    const rows: Array<Record<string, number>> = [];
    for (const u of urls) {
      const t = (k: Call['kind']) => bill.find((c) => c.url === u && c.kind === k);
      const r = { control: t('control')?.input_tokens ?? NaN, a: t('bill-a')?.input_tokens ?? NaN, b: t('bill-b')?.input_tokens ?? NaN, c: t('bill-c')?.input_tokens ?? NaN };
      const ms = { control: t('control')?.ms ?? NaN, a: t('bill-a')?.ms ?? NaN, b: t('bill-b')?.ms ?? NaN, c: t('bill-c')?.ms ?? NaN };
      rows.push(r);
      L.push(`| ${short(u)} | ${r.control} (${ms.control} ms) | ${r.a} (${ms.a} ms) | ${r.b} (${ms.b} ms) | ${r.c} (${ms.c} ms) | ${r.a - r.control} | ${r.b - r.a} | ${r.c - r.b} |`);
    }
    const img = median(rows.map((r) => r.a! - r.control!));
    const bMinusA = median(rows.map((r) => r.b! - r.a!));
    const cMinusB = median(rows.map((r) => r.c! - r.b!));
    L.push('');
    L.push(`- One ${W}×${H} image ≈ **${img} tokens** (median of a − control; ${((W * H) / img).toFixed(0)} px per token; $${(img * USD_PER_TOKEN).toFixed(6)} per image).`);
    L.push(`- Four more questions with the image in state only add a median **${bMinusA} tokens** (b − a): ${bMinusA < img / 2 ? '**the image is billed once — it amortises across questions when it sits only in state.**' : '**the image does not amortise: more questions bill it again.**'}`);
    L.push(`- Referencing it in each question adds a median **${cMinusB} tokens** over b (c − b): ${cMinusB > img * 2 ? `each reference is billed as another copy of the image (≈ ${(cMinusB / img).toFixed(1)} images more for 5 references).` : 'references are not billed as extra copies.'}`);
    L.push('');
  }

  // Tokens per image in the main run.
  const mainCalls = okCalls.filter((c) => c.kind === 'main' && c.input_tokens != null);
  if (mainCalls.length) {
    L.push('## Tokens per call (main run)', '');
    for (const n of [...new Set(mainCalls.map((c) => c.qids.length))].sort((a, b) => a - b)) {
      const cs = mainCalls.filter((c) => c.qids.length === n);
      L.push(`- ${n} question(s) per call: ${cs.length} calls, median ${median(cs.map((c) => c.input_tokens!))} input tokens, median ${median(cs.map((c) => c.ms))} ms.`);
    }
    L.push('');
  }

  // Set A.
  const pa = plans[0];
  if (pa && existsSync(join(OUT, 'truth-a.json'))) {
    const t = JSON.parse(readFileSync(join(OUT, 'truth-a.json'), 'utf8')) as Record<string, string>;
    for (const q of pa.questions) if (t[q.id] !== undefined) q.truth = t[q.id];
  }
  if (pa) {
    L.push('## Set A — the hard cases', '');
    if (pa.walled.length) L.push(`Not captured: ${pa.walled.map((w) => `${short(w.url)} (${w.reason})`).join('; ')}.`, '');
    type Row = { q: Planned; reps: Answer[]; rights: boolean[]; stable: boolean };
    const rows: Row[] = [];
    for (const q of pa.questions) {
      const reps = main.filter((a) => a.set === 'a' && a.qid === q.id).sort((x, y) => x.repeat - y.repeat);
      const right = (a: Answer) => {
        if (q.kind === 'noul') return q.truth === 'yes' ? (a.noul ?? 0) >= 0.5 : q.truth === 'no' ? (a.noul ?? 1) < 0.5 : false;
        if (!q.truth) return false;
        if (q.truth === 'none') return a.choice === 'none';
        const c = q.candidates?.find((x) => x.id === a.choice);
        return !!c && sameValue(q.field.type, c.value, q.truth);
      };
      const side = (a: Answer) => (q.kind === 'noul' ? String((a.noul ?? 0) >= 0.5) : String(a.choice));
      rows.push({ q, reps, rights: reps.map(right), stable: reps.length > 0 && reps.every((a) => side(a) === side(reps[0]!)) });
    }
    L.push('| Group | Right (all repeats) | Cases right on every repeat | Unstable cases |', '|---|---:|---:|---:|');
    for (const g of [...new Set(rows.map((r) => r.q.group))]) {
      const rs = rows.filter((r) => r.q.group === g && r.reps.length > 0);
      const all = rs.flatMap((r) => r.rights);
      L.push(`| ${g} | ${all.filter(Boolean).length}/${all.length} | ${rs.filter((r) => r.rights.every(Boolean)).length}/${rs.length} | ${rs.filter((r) => !r.stable).length} |`);
    }
    const allR = rows.filter((r) => r.reps.length);
    L.push(`| **all** | ${allR.flatMap((r) => r.rights).filter(Boolean).length}/${allR.flatMap((r) => r.rights).length} | ${allR.filter((r) => r.rights.every(Boolean)).length}/${allR.length} | ${allR.filter((r) => !r.stable).length} |`);
    L.push('');
    L.push('Choice: the answer is the chosen candidate\'s value; "p" is Jev\'s probability of its choice, "p(truth)" of the true candidate. Noul: p(yes), and "p" is the probability of the side it took. ✓/✗ per repeat.', '');
    L.push('| Case | Page | Field | Truth | Answers (r1 / r2 / r3) | p | p(truth) | Right | Stable | Crop |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const r of rows) {
      const q = r.q;
      if (q.skipped) { L.push(`| ${q.id} ${q.group} | ${short(q.url)} | ${q.field.name} | ${q.truth ?? '?'} | not asked: ${q.skipped} | | | | | |`); continue; }
      const ansText = r.reps.map((a) => (q.kind === 'noul' ? `p(yes) ${a.noul!.toFixed(3)}` : a.choice === 'none' ? 'none' : `"${(q.candidates?.find((c) => c.id === a.choice)?.value ?? a.choice ?? '').slice(0, 40)}"`)).join(' / ');
      const p = r.reps.map((a) => (q.kind === 'noul' ? (a.noul! >= 0.5 ? a.noul! : 1 - a.noul!) : a.confidence ?? 0).toFixed(2)).join(' / ');
      const truthId = q.kind === 'choice' && q.truth ? (q.truth === 'none' ? 'none' : q.candidates?.find((c) => sameValue(q.field.type, c.value, q.truth!))?.id) : undefined;
      const pt = q.kind === 'choice' ? r.reps.map((a) => (truthId ? (a.probabilities?.[truthId] ?? 0).toFixed(2) : 'n/a')).join(' / ') : '';
      const truth = q.kind === 'noul' ? `${q.truth} (${cellText(q.value)})` : `"${(q.truth ?? '?').slice(0, 40)}"${truthId ? '' : ' (not a candidate)'} of ${q.candidates?.length ?? 0}`;
      L.push(`| ${q.id} ${q.group} | ${short(q.url)} | ${q.field.name} | ${truth.replace(/\|/g, '\\|')} | ${ansText.replace(/\|/g, '\\|')} | ${p} | ${pt} | ${r.rights.map((x) => (x ? '✓' : '✗')).join('')} | ${r.stable ? 'yes' : '**no**'} | [${q.cropMode}](${q.crop}) |`);
    }
    L.push('');
  }

  // Set B.
  const pb = plans[1];
  if (pb) {
    const qs = pb.questions;
    const changed = qs.filter((q) => q.skipped === 'changed since');
    const walledQ = qs.filter((q) => q.skipped && q.skipped !== 'changed since');
    const scored = qs.map((q) => ({ q, a: main.find((a) => a.set === 'b' && a.qid === q.id && a.repeat === 1) })).filter((x): x is { q: Planned; a: Answer } => !!x.a && x.a.noul != null);
    const yes = (x: { a: Answer }) => x.a.noul! >= 0.5;
    const jc = scored.filter((x) => x.q.judge === 'correct');
    const jw = scored.filter((x) => x.q.judge === 'wrong');
    const agree = scored.filter((x) => (x.q.judge === 'correct') === yes(x)).length;
    L.push('## Set B — against the judge', '');
    L.push(`- Sample: ${qs.length} values from batch C's five judged runs (every judged-wrong value, ${qs.filter((q) => q.judge === 'correct').length} judged-correct, whole items in stored order); ${qs.filter((q) => q.judge === 'wrong').length} judged wrong, of which ${qs.filter((q) => q.real).length} are the campaign's real errors.`);
    L.push(`- **Changed since** (the fresh page no longer carries the stored value in its text or data; not asked): **${changed.length}**.`);
    L.push(`- Not captured: ${walledQ.length} values${pb.walled.length ? ` (${pb.walled.map((w) => `${short(w.url)}: ${w.reason}`).join('; ')})` : ''}.`);
    L.push(`- **Scored: ${scored.length}. Agreement with the judge: ${agree}/${scored.length} = ${pct(agree, scored.length)}.**`);
    const realScored = scored.filter((x) => x.q.real);
    const realAll = qs.filter((q) => q.real);
    L.push(`- **Real errors caught: ${realScored.filter((x) => !yes(x)).length}/${realScored.length}** still on the page (${realAll.length} in the sample; ${realAll.filter((q) => q.skipped === 'changed since').length} changed since).`);
    L.push(`- **False alarms** (judge correct, Jev no): **${jc.filter((x) => !yes(x)).length}/${jc.length}** = ${pct(jc.filter((x) => !yes(x)).length, jc.length)}.`);
    L.push(`- Judge-wrong but not a real error (the judge's own limits): Jev said no on ${jw.filter((x) => !x.q.real && !yes(x)).length}/${jw.filter((x) => !x.q.real).length}.`);
    L.push('');
    L.push('| Judge \\ Jev | yes (p ≥ 0.5) | no |', '|---|---:|---:|');
    L.push(`| correct | ${jc.filter(yes).length} | ${jc.filter((x) => !yes(x)).length} |`);
    L.push(`| wrong — real error | ${realScored.filter(yes).length} | ${realScored.filter((x) => !yes(x)).length} |`);
    L.push(`| wrong — judge's limit | ${jw.filter((x) => !x.q.real).filter(yes).length} | ${jw.filter((x) => !x.q.real && !yes(x)).length} |`);
    L.push('');
    L.push('### Per site and field', '', '| Site | Field | Scored | Agree | Jev no on judge-correct | Jev no on judge-wrong | Changed since |', '|---|---|---:|---:|---:|---:|---:|');
    for (const k of [...new Set(qs.map((q) => `${q.site}|${q.field.name}`))]) {
      const [site, fname] = k.split('|');
      const s = scored.filter((x) => x.q.site === site && x.q.field.name === fname);
      const ag = s.filter((x) => (x.q.judge === 'correct') === yes(x)).length;
      const c = s.filter((x) => x.q.judge === 'correct');
      const w = s.filter((x) => x.q.judge === 'wrong');
      L.push(`| ${site} | ${fname} | ${s.length} | ${ag} | ${c.filter((x) => !yes(x)).length}/${c.length} | ${w.filter((x) => !yes(x)).length}/${w.length} | ${qs.filter((q) => q.site === site && q.field.name === fname && q.skipped === 'changed since').length} |`);
    }
    L.push('');
    L.push('### Calibration', '', 'Answers bucketed by Jev\'s p(yes); "judge correct" is the share of the bucket the judge called correct (the reference); "Jev right" is the share where Jev\'s side (yes at p ≥ 0.5) matches the judge.', '');
    L.push('| p(yes) | n | judge correct | Jev right |', '|---|---:|---:|---:|');
    for (const [lo, hi] of [[0, 0.1], [0.1, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.9], [0.9, 1.0001]] as Array<[number, number]>) {
      const b = scored.filter((x) => x.a.noul! >= lo && x.a.noul! < hi);
      L.push(`| ${lo.toFixed(1)}–${Math.min(1, hi).toFixed(1)} | ${b.length} | ${pct(b.filter((x) => x.q.judge === 'correct').length, b.length)} | ${pct(b.filter((x) => (x.q.judge === 'correct') === yes(x)).length, b.length)} |`);
    }
    L.push('');
    const show = (x: { q: Planned; a: Answer }) => `| ${x.q.id} | ${short(x.q.url)} | ${x.q.field.name} | ${cellText(x.q.value)} | ${x.q.judge}${x.q.real ? ' (real)' : ''} | ${x.a.noul!.toFixed(3)} | [${x.q.cropMode}](${x.q.crop}) |`;
    L.push('### Disagreements', '', '| Id | Page | Field | Stored value | Judge | p(yes) | Crop |', '|---|---|---|---|---|---:|---|');
    for (const x of scored.filter((x) => (x.q.judge === 'correct') !== yes(x))) L.push(show(x));
    L.push('');
    L.push('### Judge-wrong values', '', '| Id | Page | Field | Stored value | Judge | p(yes) | Crop |', '|---|---|---|---|---|---:|---|');
    for (const x of scored.filter((x) => x.q.judge === 'wrong')) L.push(show(x));
    for (const q of qs.filter((q) => q.judge === 'wrong' && q.skipped)) L.push(`| ${q.id} | ${short(q.url)} | ${q.field.name} | ${cellText(q.value)} | wrong${q.real ? ' (real)' : ''} | not asked: ${q.skipped} | |`);
    L.push('');
  }
  L.push(...READING);
  writeFileSync(join(OUT, 'report.md'), `${L.join('\n')}\n`);
  console.log(`[jev] wrote ${join(OUT, 'report.md')}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

if (reportOnly) { report(); process.exit(0); }
const planPath = join(OUT, `plan-${set!}.json`);
const plan = !recapture && existsSync(planPath) ? JSON.parse(readFileSync(planPath, 'utf8')) as Plan : await prepare(set!);
// Truth decided by looking at the crops (Ruggable's shown sale price, Skullcandy's stock): truth-a.json, { qid: truth }.
const truthPath = join(OUT, 'truth-a.json');
if (set === 'a' && existsSync(truthPath)) {
  const t = JSON.parse(readFileSync(truthPath, 'utf8')) as Record<string, string>;
  for (const q of plan.questions) if (t[q.id] !== undefined) q.truth = t[q.id];
}
const sendable = plan.questions.filter((q) => !q.skipped && q.crop);
const groupCount = new Set(sendable.map((q) => `${q.url}|${q.crop}`)).size;
const reps = repeats ?? (set === 'a' ? 3 : 1);
const est = (groupCount * IMAGE_TOKENS_EST + sendable.length * 120) * reps;
console.log(`[jev] set ${set}: ${plan.questions.length} questions, ${sendable.length} sendable in ${groupCount} calls, ${plan.questions.filter((q) => q.skipped === 'changed since').length} changed since, ${plan.questions.filter((q) => q.skipped && q.skipped !== 'changed since').length} not captured; × ${reps} repeat(s)`);
console.log(`[jev] estimate ~${est.toLocaleString('en-US')} input tokens ≈ $${(est * USD_PER_TOKEN).toFixed(4)} (image ≈ ${IMAGE_TOKENS_EST} tokens, billed once per call); already spent $${(tokensOf(readStore().calls) * USD_PER_TOKEN).toFixed(4)} of the $${maxUsd.toFixed(2)} cap`);
for (const g of [...new Set(plan.questions.map((q) => q.group))]) {
  const gq = plan.questions.filter((q) => q.group === g);
  console.log(`  ${g}: ${gq.length} (${gq.filter((q) => q.skipped).length} skipped) — crops ${gq.map((q) => q.cropMode ?? '-').join(',')}`);
}
if (set === 'a') for (const q of plan.questions.filter((q) => q.kind === 'choice')) console.log(`  ${q.id} truth=${q.truth ?? '?'} candidates: ${(q.candidates ?? []).map((c) => `${c.id}=${c.value.slice(0, 40)} [${c.source}]`).join(' · ')}`);
if (dryRun) { console.log('[jev] --dry-run: nothing sent.'); process.exit(0); }
if (billingOnly) { await billing(plan); report(); process.exit(0); }
await send(plan, reps);
report();
process.exit(0);
