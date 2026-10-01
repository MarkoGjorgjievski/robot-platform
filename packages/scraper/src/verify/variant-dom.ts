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
/** A control inside (or itself matching) one of these is never a product's own variant picker. */
const EXCLUDE_PATTERN = 'related|recommend|also|similar|recently|upsell|cross-?sell|breadcrumb';

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

/** Inside nav/header/footer, or any ancestor (self included) whose class/id matches excludeRe. */
function isExcluded(el: Element, excludeRe: RegExp): boolean {
  if (el.closest('nav,header,footer')) return true;
  let cur: Element | null = el;
  while (cur) {
    const cls = cur.getAttribute('class');
    const id = cur.getAttribute('id');
    if ((cls && excludeRe.test(cls)) || (id && excludeRe.test(id))) return true;
    cur = cur.parentElement;
  }
  return false;
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

/** A radio input's label: an associated label[for], a wrapping label, else its value. */
function radioLabel(input: Element): string {
  const id = input.getAttribute('id');
  if (id) {
    const lbl = Array.from(document.querySelectorAll('label')).find((l) => l.getAttribute('for') === id);
    if (lbl) {
      const t = (lbl.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
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

/** The control's label: aria-label, else an associated label[for]/legend, else the matching word. */
function axisOf(controlEl: Element, anchorEl: Element, controlRe: RegExp): string {
  const aria = (controlEl.getAttribute('aria-label') ?? '').trim();
  if (aria) return aria.toLowerCase();
  const anchorId = anchorEl.getAttribute('id');
  if (anchorId) {
    const lbl = Array.from(document.querySelectorAll('label')).find((l) => l.getAttribute('for') === anchorId);
    if (lbl) {
      const t = (lbl.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t) return t.toLowerCase();
    }
  }
  const legend = controlEl.querySelector('legend');
  if (legend) {
    const t = (legend.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) return t.toLowerCase();
  }
  const word = matchedWord(controlEl, controlRe);
  return word ? word.toLowerCase() : '';
}

/**
 * The first qualifying picker inside controlEl: a select with >=2 non-empty options, else a
 * radio group (shared name) with >=2 distinctly-labelled inputs, else >=2 buttons with distinct
 * labels.
 */
function findPickerIn(controlEl: Element): { anchorEl: Element; options: string[] } | null {
  const select = controlEl.querySelector('select');
  if (select) {
    const opts: string[] = [];
    for (const o of Array.from((select as HTMLSelectElement).options)) {
      const val = (o.value ?? '').trim();
      const text = (o.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (val !== '' && text !== '') opts.push(text);
    }
    if (opts.length >= 2) return { anchorEl: select, options: opts };
  }
  const byName = new Map<string, Element[]>();
  for (const r of Array.from(controlEl.querySelectorAll('input[type="radio"]'))) {
    const name = r.getAttribute('name');
    if (!name) continue;
    const group = byName.get(name) ?? [];
    group.push(r);
    byName.set(name, group);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const labels = group.map((r) => radioLabel(r)).filter((l) => l !== '');
    if (labels.length >= 2) return { anchorEl: group[0]!, options: labels };
  }
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
    if (labels.length >= 2) return { anchorEl: controlEl, options: labels };
  }
  return null;
}

/** Evaluates (in a page) to VariantLinks[]: up to 3 link groups, largest first. */
export function buildVariantLinksScript(pageUrl: string): string {
  return `(() => {
    ${PAGE_SCRIPT_PRELUDE}
    const controlRe = /${CONTROL_PATTERN}/i;
    const excludeRe = /${EXCLUDE_PATTERN}/i;
    const pageUrl = ${JSON.stringify(pageUrl)};
    const isVariantControl = ${isVariantControl.toString()};
    const isExcluded = ${isExcluded.toString()};
    const resolveHref = ${resolveHref.toString()};
    const linkLabel = ${linkLabel.toString()};
    const describeContainer = ${describeContainer.toString()};
    let host = '';
    try { host = new URL(pageUrl).host; } catch {}
    const all = document.body ? document.body.querySelectorAll('*') : [];
    const candidates = [];
    for (const el of all) {
      if (!isVariantControl(el, controlRe)) continue;
      if (isExcluded(el, excludeRe)) continue;
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
    return kept.slice(0, 3).map((c) => ({ container: describeContainer(c.el), count: c.links.length, links: c.links }));
  })()`;
}

/** Evaluates (in a page) to VariantPicker[]. */
export function buildVariantPickerScript(): string {
  return `(() => {
    ${PAGE_SCRIPT_PRELUDE}
    const controlRe = /${CONTROL_PATTERN}/i;
    const excludeRe = /${EXCLUDE_PATTERN}/i;
    const isVariantControl = ${isVariantControl.toString()};
    const isExcluded = ${isExcluded.toString()};
    const radioLabel = ${radioLabel.toString()};
    const buttonLabel = ${buttonLabel.toString()};
    const matchedWord = ${matchedWord.toString()};
    const axisOf = ${axisOf.toString()};
    const findPickerIn = ${findPickerIn.toString()};
    const all = document.body ? document.body.querySelectorAll('*') : [];
    const candidates = [];
    for (const el of all) {
      if (!isVariantControl(el, controlRe)) continue;
      if (isExcluded(el, excludeRe)) continue;
      const picker = findPickerIn(el);
      if (!picker) continue;
      candidates.push({ controlEl: el, picker });
    }
    // Nested matching controls: keep only the innermost control that holds the picker (controller notes #3).
    const kept = candidates.filter((c) => !candidates.some((d) => d !== c && c.controlEl.contains(d.controlEl) && d.controlEl !== c.controlEl));
    // Dedupe pickers by element: two surviving controls could still point at the same select/button-group.
    const byAnchor = new Map();
    for (const k of kept) if (!byAnchor.has(k.picker.anchorEl)) byAnchor.set(k.picker.anchorEl, k);
    return Array.from(byAnchor.values()).map((k) => ({ axis: axisOf(k.controlEl, k.picker.anchorEl, controlRe), options: k.picker.options }));
  })()`;
}
