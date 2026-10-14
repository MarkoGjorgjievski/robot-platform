// packages/browser/src/page-variant.ts
// Which variant a page is showing (spec 2026-10-14 §3): what the address
// names and what the page marks selected. Pure; the picker's selection is
// read by a script the caller passes in (`CaptureOptions.selection`), so
// this package never depends on the scraper's DOM scripts.
import type { PageVariant } from './types.js';

export type Selection = { ids?: string[]; pairs?: Array<{ name: string; value: string }>; labels?: string[] };

/** Query keys that never name a variant: analytics, referrers, pagination. */
const NOISE_KEYS = /^(utm_|gclid$|fbclid$|msclkid$|ref$|referrer$|source$|campaign$|_ga$|_gl$|page$|sort$|q$|search$|lang$|locale$|currency$|srsltid$|_pos$|_sid$|_ss$|_kx$|mc_)/i;
/** A value that is an id: digits only, or a Shopify gid, 6+ characters. */
const ID_VALUE = /^(gid:\/\/shopify\/ProductVariant\/)?\d{6,}$/;
/** A query key whose digits are a variant id at any length (`?variant=123`, spec §3). */
const ID_KEY = /^variant(_?id)?$/i;

export function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’“”'"`′″]/g, '')
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
  const addrId = (p: { name: string; value: string }) => idOf(p.value) ?? (ID_KEY.test(p.name) && /^\d+$/.test(p.value) ? p.value : null);
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

function merge(a: Selection | null | undefined, b: Selection | null | undefined): Selection {
  return {
    ids: [...new Set([...(a?.ids ?? []), ...(b?.ids ?? [])])],
    pairs: [...(a?.pairs ?? []), ...(b?.pairs ?? [])],
    labels: [...new Set([...(a?.labels ?? []), ...(b?.labels ?? [])])],
  };
}

const hasAny = (s: Selection) => (s.ids?.length ?? 0) + (s.pairs?.length ?? 0) + (s.labels?.length ?? 0) > 0;

export function pageVariantFrom(url: string, picker: Selection | null, pageData: Selection): PageVariant {
  const named = addressVariant(url);
  const shown = merge(picker, pageData);
  const all = merge({ ids: named.ids, pairs: named.pairs, labels: named.labels }, shown);
  return { ids: all.ids!, pairs: all.pairs!, labels: all.labels!, named: named.pairs.length > 0, selected: hasAny(shown) };
}

/**
 * The address's own text when the page shows a different variant from the
 * one it names (spec 2026-10-14 §7): the two carry a comparable kind and
 * nothing of that kind agrees. Not comparable → null; no selection → null.
 */
export function wrongVariant(pv: PageVariant, url: string): string | null {
  if (!pv.named || !pv.selected) return null;
  const named = addressVariant(url);
  // What the page showed is everything in `pv` that the address did not put there.
  const shownIds = pv.ids.filter((id) => !named.ids.includes(id));
  const namedPairKeys = new Set(named.pairs.map((p) => `${p.name}\u0000${p.value}`));
  const shownPairs = pv.pairs.filter((p) => !namedPairKeys.has(`${p.name}\u0000${p.value}`));
  const shownLabels = pv.labels.filter((l) => !named.labels.includes(l));
  const verdicts: boolean[] = [];
  if (named.ids.length && shownIds.length) verdicts.push(named.ids.some((id) => shownIds.includes(id)));
  if (named.pairs.length && shownPairs.length) {
    verdicts.push(named.pairs.some((n) => shownPairs.some((s) => normalizeLabel(s.name) === normalizeLabel(n.name) && normalizeLabel(s.value) === normalizeLabel(n.value))));
  }
  if (named.labels.length && shownLabels.length) {
    verdicts.push(named.labels.some((n) => shownLabels.some((s) => normalizeLabel(s) === normalizeLabel(n) || normalizeLabel(s).includes(normalizeLabel(n)))));
  }
  if (verdicts.length === 0) return null;   // nothing comparable
  return verdicts.some(Boolean) ? null : named.text;
}
