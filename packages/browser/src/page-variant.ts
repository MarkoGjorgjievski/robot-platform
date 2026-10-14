// packages/browser/src/page-variant.ts
// Which variant a page is showing (spec 2026-10-14 §3): what the address
// names and what the page marks selected. Pure; the picker's selection is
// read by a script the caller passes in (`CaptureOptions.selection`), so
// this package never depends on the scraper's DOM scripts.
import type { PageVariant } from './types.js';

export type Selection = { ids?: string[]; pairs?: Array<{ name: string; value: string }>; labels?: string[] };

/** Query keys that never name a variant: analytics, referrers, pagination. */
const NOISE_KEYS = /^(utm_|gclid$|fbclid$|msclkid$|ref$|referrer$|source$|campaign$|_ga$|_gl$|page$|sort$|q$|search$|lang$|locale$|currency$|srsltid$|_pos$|_sid$|_ss$|_kx$|mc_|pr_|cm_|icid$|irclickid$|ranmid$|view$)/i;
/** A value in page data that is an id: digits only, or a Shopify gid, 6+ characters. */
const ID_VALUE = /^(gid:\/\/shopify\/ProductVariant\/)?\d{6,}$/;
/** The only address keys that name an id (`?variant=123`, `?sku=4006…`); other keys' values are labels. */
const ID_KEY = /^(variant|variant_?id|sku)$/i;

/** Lowercase, strip quotes and primes, join `6 x 9` / `6 × 9` / `6 / 9` to their digits, drop leading zeros in digit runs, collapse punctuation to single spaces. */
export function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”'"`′″]/g, '')
    .replace(/×/g, 'x')
    .replace(/(\d)\s*([x/])\s*(?=\d)/g, '$1$2')
    .replace(/(^|[^\d.])0+(?=\d)/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function idOf(value: string): string | null {
  const m = ID_VALUE.exec(value.trim());
  if (!m) return null;
  return value.trim().replace(/^gid:\/\/shopify\/ProductVariant\//, '');
}

/** What the address names: every query pair and key=value fragment pair that is not noise. */
export function addressVariant(url: string): { ids: string[]; pairs: Array<{ name: string; value: string }>; labels: string[]; text: string } {
  const pairs: Array<{ name: string; value: string }> = [];
  const parts: string[] = [];
  let u: URL;
  try { u = new URL(url); } catch { return { ids: [], pairs: [], labels: [], text: '' }; }
  const take = (params: URLSearchParams) => {
    for (const [k, v] of params) {
      const name = k.trim(), value = v.trim();
      if (!name || !value || NOISE_KEYS.test(name)) continue;
      pairs.push({ name, value });
      parts.push(`${name}=${value}`);
    }
  };
  take(u.searchParams);
  const hash = u.hash.replace(/^#/, '');
  if (hash.includes('=')) take(new URLSearchParams(hash));
  const addrId = (p: { name: string; value: string }) => (ID_KEY.test(p.name) ? idOf(p.value) ?? (/^\d+$/.test(p.value) ? p.value : null) : null);
  const ids = pairs.map(addrId).filter((x): x is string => x !== null);
  const labels = pairs.filter((p) => addrId(p) === null).map((p) => p.value);
  return { ids, pairs, labels, text: parts.join('&') };
}

const SELECTED_KEY = /^(selected|current)_?(variant|option|sku|offer)/i;
const MAX_DEPTH = 8;
const MAX_NODES = 5_000;

function collect(node: unknown, out: Selection, depth: number, budget: { n: number }, viaSelected: boolean): void {
  if (budget.n-- <= 0 || depth > MAX_DEPTH || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const v of node.slice(0, 50)) collect(v, out, depth + 1, budget, viaSelected); return; }
  const obj = node as Record<string, unknown>;
  if (viaSelected) {
    const id = obj.id ?? obj.variant_id ?? obj.variantId;
    if (typeof id === 'number' || typeof id === 'string') { const s = idOf(String(id)) ?? String(id); (out.ids ??= []).push(s); }
    if (typeof obj.sku === 'string' && obj.sku.trim()) (out.labels ??= []).push(obj.sku.trim());
    if (typeof obj.title === 'string' && obj.title.trim()) (out.labels ??= []).push(obj.title.trim());
  }
  for (const [k, v] of Object.entries(obj)) {
    const sel = SELECTED_KEY.test(k);
    if (sel && (typeof v === 'string' || typeof v === 'number')) {
      const s = idOf(String(v));
      if (s) (out.ids ??= []).push(s); else if (String(v).trim()) (out.labels ??= []).push(String(v).trim());
      continue;
    }
    collect(v, out, depth + 1, budget, sel);
  }
}

/** `selected…`/`current…` variant, option, sku or offer keys in the page data and the JSON bodies seen. */
export function selectedInPageData(data: { ldJson: unknown[]; nextData: unknown; initialState: unknown }, apiBodies: unknown[]): Selection {
  const out: Selection = {};
  const budget = { n: MAX_NODES };
  for (const root of [data.nextData, data.initialState, ...data.ldJson, ...apiBodies]) collect(root, out, 0, budget, false);
  if (out.ids) out.ids = [...new Set(out.ids)];
  if (out.labels) out.labels = [...new Set(out.labels)];
  return out;
}

function merge(a: Selection | null | undefined, b: Selection | null | undefined): Required<Selection> {
  const pairs = new Map<string, { name: string; value: string }>();
  for (const p of [...(a?.pairs ?? []), ...(b?.pairs ?? [])]) pairs.set(`${p.name}\u0000${p.value}`, p);
  return {
    ids: [...new Set([...(a?.ids ?? []), ...(b?.ids ?? [])])],
    pairs: [...pairs.values()],
    labels: [...new Set([...(a?.labels ?? []), ...(b?.labels ?? [])])],
  };
}

const hasAny = (s: Selection) => (s.ids?.length ?? 0) + (s.pairs?.length ?? 0) + (s.labels?.length ?? 0) > 0;

export function pageVariantFrom(url: string, picker: Selection | null, pageData: Selection): PageVariant {
  const named = addressVariant(url);
  const shown = merge(picker, pageData);
  const all = merge({ ids: named.ids, pairs: named.pairs, labels: named.labels }, shown);
  return { ids: all.ids, pairs: all.pairs, labels: all.labels, named: named.pairs.length > 0, selected: hasAny(shown) };
}

/**
 * The address's own text when the page shows a different variant from the
 * one it names (spec 2026-10-14 §7), decided from the page's own selection
 * (the picker's and the page data's, never the address's): for some kind
 * the address names and the page shows, nothing of that kind agrees.
 * Kinds: ids (from variant-style keys only) against the page's ids; a pair
 * against the page's pairs of the same name — a pair whose name the page
 * shows no selection for never decides (`?pid=…` against a size picker).
 * Free labels never decide. Nothing comparable or no selection → null.
 */
export function wrongVariant(url: string, picker: Selection | null, pageData: Selection): string | null {
  const named = addressVariant(url);
  const shown = merge(picker, pageData);
  if (named.pairs.length === 0 || !hasAny(shown)) return null;
  const shownLabels = new Set(shown.labels.map(normalizeLabel));
  const verdicts: boolean[] = [];
  if (named.ids.length && shown.ids.length) {
    // A numeric sku the page carries as a selected label still agrees.
    verdicts.push(named.ids.some((id) => shown.ids.includes(id) || shownLabels.has(normalizeLabel(id))));
  }
  const nameKey = (s: string) => s.trim().toLowerCase();
  const shownNames = new Set(shown.pairs.map((p) => nameKey(p.name)));
  const comparable = named.pairs.filter((n) => !ID_KEY.test(n.name) && shownNames.has(nameKey(n.name)));
  if (comparable.length) {
    verdicts.push(comparable.some((n) => shown.pairs.some((s) => nameKey(s.name) === nameKey(n.name) && normalizeLabel(s.value) === normalizeLabel(n.value))));
  }
  if (verdicts.length === 0) return null;   // nothing comparable
  return verdicts.some(Boolean) ? null : named.text;
}
