// packages/scraper/src/verify/variant-dom.ts
// Finds a product's variants exposed in the DOM of a proof-page capture: links to
// separate per-variant pages, and in-page option pickers (select / radio group /
// button group) (spec 2026-10-01 §3, "Links and pickers on the page"). In-page
// scripts, dependency-free and self-contained like dom-scripts.ts; a later task
// (API sources.detectVariants) runs these against proof-page captures.
import { PAGE_SCRIPT_PRELUDE } from './dom-scripts.js';

export type VariantLinks = { container: string; count: number; links: Array<{ href: string; label: string }> };
export type VariantPicker = { axis: string; options: string[] };

/** A variant-like control: class/id/data-* name-or-value/aria-label matching one of these words. */
const CONTROL_PATTERN = 'variant|swatch|colou?r|size|option|style|length|material';
/** A control inside (or itself matching) one of these is never a product's own variant picker — matched as a substring. */
const EXCLUDE_PATTERN = 'related|recommend|also|similar|recently|upsell|cross-?sell|breadcrumb';
/**
 * Also never a variant picker if a class/id TOKEN (split on whitespace, `-`, `_`; camelCase not
 * split) is exactly one of these. Unlike EXCLUDE_PATTERN, these are common enough fragments of
 * ordinary words (tab -> "size-table", sort -> "assorted-grid", tabs -> "comfortable-fit",
 * "variant-table") that matching them as a substring wrongly excludes those controls (controller
 * ruling, fix round 2) — so they get their own regex, anchored to token boundaries.
 */
const EXCLUDE_TOKEN_PATTERN = '(^|[\\s_-])(filter|facet|sort|refine|pagination|tabs?)([\\s_-]|$)';

// ---- Everything below runs INSIDE the page: stringified via toString() into the scripts at the
// bottom of this file, each bound in the template to a `const` of the SAME name it is declared
// under here (as dom-scripts.ts does for looksVolatile/xpathsOf). A helper that calls another
// helper by name therefore resolves both here (real top-level functions, so this file still
// type-checks and lints) and once spliced into the page (same names, now const bindings in the
// IIFE's scope). Keep every one dependency-free: no imports, no closures over module state.

/** class, id, aria-label or any data-* attribute's name/value matches controlRe. */
function isVariantControl(el: Element, controlRe: RegExp): boolean {
  const cls = el.getAttribute('class');
  if (cls && controlRe.test(cls)) return true;
  const id = el.getAttribute('id');
  if (id && controlRe.test(id)) return true;
  const aria = el.getAttribute('aria-label');
  if (aria && controlRe.test(aria)) return true;
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.indexOf('data-') === 0 && (controlRe.test(attr.name) || controlRe.test(attr.value))) return true;
  }
  return false;
}

/**
 * Inside nav/header/footer, or any ancestor (self included) whose class/id matches excludeRe
 * (substring) or excludeTokenRe (whole token only — see EXCLUDE_TOKEN_PATTERN).
 */
function isExcluded(el: Element, excludeRe: RegExp, excludeTokenRe: RegExp): boolean {
  if (el.closest('nav,header,footer')) return true;
  let cur: Element | null = el;
  while (cur) {
    const cls = cur.getAttribute('class');
    const id = cur.getAttribute('id');
    if ((cls && (excludeRe.test(cls) || excludeTokenRe.test(cls))) || (id && (excludeRe.test(id) || excludeTokenRe.test(id)))) return true;
    cur = cur.parentElement;
  }
  return false;
}

/** No rendered box (display:none or detached) or computed visibility:hidden — a duplicate, unseen control. */
function isHidden(el: Element): boolean {
  if (el.getClientRects().length === 0) return true;
  return getComputedStyle(el).visibility === 'hidden';
}

/** Every label[for]'d element in the page, id -> trimmed text, built once per script run. */
function buildLabelForMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const lbl of Array.from(document.querySelectorAll('label[for]'))) {
    const id = lbl.getAttribute('for');
    if (!id || map.has(id)) continue;
    const t = (lbl.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) map.set(id, t);
  }
  return map;
}

/** Resolves href against pageUrl; null for a fragment, javascript:, or non-http(s) link. */
function resolveHref(href: string, pageUrl: string): string | null {
  const h = href.trim();
  if (h === '' || h.charAt(0) === '#' || /^javascript:/i.test(h)) return null;
  try {
    const u = new URL(h, pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Trimmed text, else title, else aria-label, else an inner img's alt. */
function linkLabel(a: Element): string {
  const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text;
  const title = (a.getAttribute('title') ?? '').trim();
  if (title) return title;
  const aria = (a.getAttribute('aria-label') ?? '').trim();
  if (aria) return aria;
  const img = a.querySelector('img[alt]');
  if (img) {
    const alt = (img.getAttribute('alt') ?? '').trim();
    if (alt) return alt;
  }
  return '';
}

/** A short CSS-ish description of el, for the report. */
function describeContainer(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id');
  if (id) return `${tag}#${id}`;
  const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter(Boolean);
  if (cls.length) return `${tag}.${cls.join('.')}`;
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.indexOf('data-') === 0) return `${tag}[${attr.name}="${attr.value}"]`;
  }
  return tag;
}

/** A radio input's OPTION label: an associated label[for] (via the shared map), a wrapping label, else its value. */
function radioLabel(input: Element, labelForMap: Map<string, string>): string {
  const id = input.getAttribute('id');
  if (id) {
    const t = labelForMap.get(id);
    if (t) return t;
  }
  const wrap = input.closest('label');
  if (wrap) {
    const t = (wrap.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  return ((input as HTMLInputElement).value ?? '').trim();
}

/** Trimmed text, else aria-label, else title. */
function buttonLabel(b: Element): string {
  const text = (b.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text;
  const aria = (b.getAttribute('aria-label') ?? '').trim();
  if (aria) return aria;
  const title = (b.getAttribute('title') ?? '').trim();
  if (title) return title;
  return '';
}

/**
 * The first token (split on non-alphanumerics) of el's class, id, or any data-* attribute's
 * value-then-name that matches controlRe — the value is checked before the name so a generic
 * attribute name (`data-option="color"`) still yields the specific word, "color".
 */
function matchedWord(el: Element, controlRe: RegExp): string | null {
  const sources: string[] = [];
  const cls = el.getAttribute('class');
  if (cls) sources.push(cls);
  const id = el.getAttribute('id');
  if (id) sources.push(id);
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.indexOf('data-') === 0) {
      sources.push(attr.value);
      sources.push(attr.name);
    }
  }
  for (const src of sources) {
    for (const token of src.split(/[^A-Za-z0-9]+/)) {
      if (token && controlRe.test(token)) return token;
    }
  }
  return null;
}

/** The control's label for a select/button-group picker: aria-label, else an associated label[for]/legend, else the matching word. */
function axisOf(controlEl: Element, anchorEl: Element, controlRe: RegExp, labelForMap: Map<string, string>): string {
  const aria = (controlEl.getAttribute('aria-label') ?? '').trim();
  if (aria) return aria.toLowerCase();
  const anchorId = anchorEl.getAttribute('id');
  if (anchorId) {
    const t = labelForMap.get(anchorId);
    if (t) return t.toLowerCase();
  }
  const legend = controlEl.querySelector('legend');
  if (legend) {
    const t = (legend.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) return t.toLowerCase();
  }
  const word = matchedWord(controlEl, controlRe);
  return word ? word.toLowerCase() : '';
}

/** True when fieldset's only radio inputs are exactly this group's (no sibling group sharing it). */
function fieldsetOnlyHasGroup(fieldset: Element, group: Element[]): boolean {
  const all = Array.from(fieldset.querySelectorAll('input[type="radio"]'));
  if (all.length !== group.length) return false;
  return all.every((r) => group.includes(r));
}

/**
 * A radio GROUP's axis — never an option's own label[for] (that names the option, not the
 * group): the closest fieldset>legend that belongs to this group alone, else the control's own
 * legend, else the control's aria-label, else the radios' shared name, else the matched word.
 */
function radioGroupAxis(controlEl: Element, group: Element[], name: string, controlRe: RegExp): string {
  const fs = group[0]!.closest('fieldset');
  if (fs && fieldsetOnlyHasGroup(fs, group)) {
    const legend = fs.querySelector('legend');
    const t = (legend?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) return t.toLowerCase();
  }
  const controlLegend = controlEl.querySelector('legend');
  if (controlLegend) {
    const t = (controlLegend.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) return t.toLowerCase();
  }
  const aria = (controlEl.getAttribute('aria-label') ?? '').trim();
  if (aria) return aria.toLowerCase();
  if (name.trim()) return name.trim().toLowerCase();
  const word = matchedWord(controlEl, controlRe);
  return word ? word.toLowerCase() : '';
}

/**
 * Every qualifying picker inside controlEl: a select (controlEl itself, or one inside it) with >=2 non-empty, non-placeholder
 * options, else every radio group (shared name) with >=2 distinctly-labelled inputs, else >=2
 * buttons with distinct labels.
 */
function findPickersIn(
  controlEl: Element,
  controlRe: RegExp,
  labelForMap: Map<string, string>,
): Array<{ anchorEl: Element; options: string[]; axis: string }> {
  const select = controlEl.matches('select') ? controlEl : controlEl.querySelector('select');
  if (select) {
    const opts: string[] = [];
    for (const o of Array.from((select as HTMLSelectElement).options)) {
      if (o.disabled) continue;
      const val = (o.value ?? '').trim();
      if (val === '') continue;
      const text = (o.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text === '') continue;
      if (/^(select|choose|pick|please)\b/i.test(text)) continue;
      if (text.endsWith('...') || text.endsWith('…')) continue;
      opts.push(text);
    }
    if (opts.length >= 2) return [{ anchorEl: select, options: opts, axis: axisOf(controlEl, select, controlRe, labelForMap) }];
  }
  const byName = new Map<string, Element[]>();
  const order: string[] = [];
  for (const r of Array.from(controlEl.querySelectorAll('input[type="radio"]'))) {
    const name = r.getAttribute('name');
    if (!name) continue;
    if (!byName.has(name)) {
      byName.set(name, []);
      order.push(name);
    }
    byName.get(name)!.push(r);
  }
  const radioResults: Array<{ anchorEl: Element; options: string[]; axis: string }> = [];
  for (const name of order) {
    const group = byName.get(name)!;
    if (group.length < 2) continue;
    const labels = group.map((r) => radioLabel(r, labelForMap)).filter((l) => l !== '');
    if (labels.length >= 2) radioResults.push({ anchorEl: group[0]!, options: labels, axis: radioGroupAxis(controlEl, group, name, controlRe) });
  }
  if (radioResults.length > 0) return radioResults;
  const buttons = Array.from(controlEl.querySelectorAll('button'));
  if (buttons.length >= 2) {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const b of buttons) {
      const label = buttonLabel(b);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
    }
    if (labels.length >= 2) return [{ anchorEl: controlEl, options: labels, axis: axisOf(controlEl, controlEl, controlRe, labelForMap) }];
  }
  return [];
}

/** Evaluates (in a page) to VariantLinks[]: up to 3 link groups, largest first, no two with the same href set. */
export function buildVariantLinksScript(pageUrl: string): string {
  return `(() => {
    ${PAGE_SCRIPT_PRELUDE}
    const controlRe = /${CONTROL_PATTERN}/i;
    const excludeRe = /${EXCLUDE_PATTERN}/i;
    const excludeTokenRe = /${EXCLUDE_TOKEN_PATTERN}/i;
    const pageUrl = ${JSON.stringify(pageUrl)};
    const isVariantControl = ${isVariantControl.toString()};
    const isExcluded = ${isExcluded.toString()};
    const isHidden = ${isHidden.toString()};
    const resolveHref = ${resolveHref.toString()};
    const linkLabel = ${linkLabel.toString()};
    const describeContainer = ${describeContainer.toString()};
    let host = '';
    try { host = new URL(pageUrl).host; } catch {}
    const all = document.body ? document.body.querySelectorAll('*') : [];
    const candidates = [];
    for (const el of all) {
      if (!isVariantControl(el, controlRe)) continue;
      if (isExcluded(el, excludeRe, excludeTokenRe)) continue;
      if (isHidden(el)) continue;
      const seen = new Map();
      for (const a of el.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href');
        if (!href) continue;
        const resolved = resolveHref(href, pageUrl);
        if (!resolved) continue;
        let u;
        try { u = new URL(resolved); } catch { continue; }
        if (u.host !== host) continue;
        if (seen.has(resolved)) continue;
        seen.set(resolved, linkLabel(a));
      }
      if (seen.size >= 2) candidates.push({ el, links: Array.from(seen, ([href, label]) => ({ href, label })) });
    }
    // Nested matching controls: keep only the innermost control that holds the links (controller notes #3).
    const kept = candidates.filter((c) => !candidates.some((d) => d !== c && c.el.contains(d.el) && d.el !== c.el));
    kept.sort((a, b) => b.links.length - a.links.length);
    // Drop a group whose sorted href set duplicates one already reported (e.g. a hidden mobile copy of a visible one).
    const seenSets = new Set();
    const out = [];
    for (const c of kept) {
      if (out.length >= 3) break;
      const sig = c.links.map((l) => l.href).slice().sort().join('|');
      if (seenSets.has(sig)) continue;
      seenSets.add(sig);
      out.push(c);
    }
    return out.map((c) => ({ container: describeContainer(c.el), count: c.links.length, links: c.links }));
  })()`;
}

/** Evaluates (in a page) to VariantPicker[]. */
export function buildVariantPickerScript(): string {
  return `(() => {
    ${PAGE_SCRIPT_PRELUDE}
    const controlRe = /${CONTROL_PATTERN}/i;
    const excludeRe = /${EXCLUDE_PATTERN}/i;
    const excludeTokenRe = /${EXCLUDE_TOKEN_PATTERN}/i;
    const isVariantControl = ${isVariantControl.toString()};
    const isExcluded = ${isExcluded.toString()};
    const isHidden = ${isHidden.toString()};
    const buildLabelForMap = ${buildLabelForMap.toString()};
    const radioLabel = ${radioLabel.toString()};
    const buttonLabel = ${buttonLabel.toString()};
    const matchedWord = ${matchedWord.toString()};
    const axisOf = ${axisOf.toString()};
    const fieldsetOnlyHasGroup = ${fieldsetOnlyHasGroup.toString()};
    const radioGroupAxis = ${radioGroupAxis.toString()};
    const findPickersIn = ${findPickersIn.toString()};
    const labelForMap = buildLabelForMap();
    const all = document.body ? document.body.querySelectorAll('*') : [];
    const candidates = [];
    for (const el of all) {
      if (!isVariantControl(el, controlRe)) continue;
      if (isExcluded(el, excludeRe, excludeTokenRe)) continue;
      if (isHidden(el)) continue;
      for (const picker of findPickersIn(el, controlRe, labelForMap)) candidates.push({ controlEl: el, picker });
    }
    // Nested matching controls: keep only the innermost control that holds the picker (controller notes #3).
    const kept = candidates.filter((c) => !candidates.some((d) => d !== c && c.controlEl.contains(d.controlEl) && d.controlEl !== c.controlEl));
    // Dedupe pickers by element: two surviving controls could still point at the same select/button-group.
    const byAnchor = new Map();
    for (const k of kept) if (!byAnchor.has(k.picker.anchorEl)) byAnchor.set(k.picker.anchorEl, k);
    return Array.from(byAnchor.values()).map((k) => ({ axis: k.picker.axis, options: k.picker.options }));
  })()`;
}
