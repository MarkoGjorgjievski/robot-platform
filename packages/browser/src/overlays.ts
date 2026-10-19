// What a capture closes, and what it must never open or click.
// Spec: docs/superpowers/specs/2026-10-19-capture-overlays-design.md
//
// One module, two runtimes. The pure helpers run in Node (unit tests) and in the page; the DOM
// helpers and the `entry…` functions run only in the page, sent as a string that pageScript()
// assembles: PAGE_PRELUDE, every constant in PAGE_CONSTANTS, the source of every function in
// PAGE_FUNCTIONS, then the call. Three rules keep that working:
//  1. A function that runs in the page names only constants and functions declared in THIS module —
//     never an import. Vitest rewrites an imported name to `__vi_import_0__.name`, which the page
//     does not have.
//  2. Every page function is a `function` declaration listed in PAGE_FUNCTIONS (the page throws
//     ReferenceError on one that is not), and every constant it reads is in PAGE_CONSTANTS.
//  3. Every script starts with PAGE_PRELUDE. Under the dev runtime (tsx: esbuild with keepNames) a
//     nested function's source reads `__name(fn, "name")`, and the page has no `__name`. The tabs
//     step this module replaces threw on exactly that under `pnpm dev:all`, and its catch hid it.

// ---- Constants ------------------------------------------------------------------------------

/** Names of a close control inside the topmost overlay (§3.3.4), case-folded. */
export const CLOSE_WORDS: readonly string[] = [
  'close', 'schließen', 'schliessen', 'fermer', 'cerrar', 'chiudi', 'sluiten', 'fechar', 'zamknij',
  'stäng', 'luk', 'lukk', 'sulje', '×', '✕', 'x', 'dismiss', 'no thanks', 'not now',
  'continue shopping', 'stay here',
];

/** The window property holding the capture's in-page memory. Not enumerable; never in the HTML. */
export const ROBOT_STATE_KEY = '__robotCapture';

/** aria-haspopup values that mean "this opens a layer", not "this reveals a panel" (§3.2.1). */
export const HASPOPUP_SKIP: readonly string[] = ['dialog', 'true', 'menu', 'listbox', 'grid', 'tree'];

/** The structural controls the expand pass clicks (today's Phase 1 list, unchanged). */
export const EXPAND_SELECTORS: readonly string[] = [
  'main details:not([open]) summary',
  'article details:not([open]) summary',
  'main [aria-expanded="false"]',
  'article [aria-expanded="false"]',
  'main [data-toggle="collapse"]',
  'article [data-toggle="collapse"]',
];

/** "Show more" and friends, as a RegExp source (today's Phase 2 pattern, unchanged). */
export const EXPAND_TEXT_PATTERN = '^(show more|see more|see all|view details|read more|expand|view all|load more|\\+ more|show all)$';

/** An element that says it is a dialog. Page only (isShown, holdsPage, listOverlayEls). */
const DIALOG_LIKE = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';

// ---- Pure: names --------------------------------------------------------------------------------

/** Trimmed, whitespace-collapsed, case-folded — the form every name comparison uses. */
export function normName(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Whole names, not substrings (§3.3.1). `button:has-text("OK")` matched "Cookie settings" (ikea:
 * opened the preference centre), a review chip "look" (skullcandy) and the swatch "Rosy Outlook"
 * (puma: changed the variant). A name is the text, or it is not.
 */
export function isDismissName(name: string | null | undefined, wanted: string): boolean {
  const n = normName(name);
  return n !== '' && n === normName(wanted);
}

/** Is this name one of the close words (§3.3.4)? Whole names only. */
export function isCloseWord(name: string | null | undefined): boolean {
  const n = normName(name);
  return n !== '' && CLOSE_WORDS.includes(n);
}

/** Settings, preferences, manage, customise/customize, options or more info, as a word (§3.3.2). */
export function isSettingsName(name: string | null | undefined): boolean {
  return /(^|[^\p{L}])(settings|preferences|manage|customi[sz]e|options|more info)(?=$|[^\p{L}])/u.test(normName(name));
}

/**
 * Does a class attribute have a variant word: a token containing "swatch", or containing "variant"
 * that is not a button's modifier (`btn--variant-primary`, `button-variant-secondary`)?
 */
export function hasVariantClassWord(className: string | null | undefined): boolean {
  return (className ?? '').split(/\s+/).some((w) =>
    /swatch/i.test(w)
    || (/variant/i.test(w) && !/^(btn|button)([-_]|$)/i.test(w) && !/--variant/i.test(w)));
}

/** Input types that are buttons, not choices. */
const BUTTON_INPUT_TYPES = ['submit', 'button', 'reset', 'image'];

export interface VariantFacts {
  tag: string;
  /** An `<input>`'s type attribute (null when absent or not an input). */
  inputType: string | null;
  role: string | null;
  ariaPressed: boolean;
  ariaChecked: boolean;
  /**
   * Inside a fieldset, `[role=radiogroup]` or `[role=listbox]`, or within three ancestors of an
   * element whose class contains "swatch".
   */
  inChoiceGroup: boolean;
  /** Wraps a radio/checkbox input, or is a `<label>` for one. */
  choiceInput: boolean;
  className: string;
}

/** A control that picks what the page shows — dismissal never clicks one outside an overlay (§3.3.2, §5.1). */
export function isVariantControlFacts(f: VariantFacts): boolean {
  if (f.ariaPressed || f.ariaChecked) return true;
  const role = normName(f.role);
  if (role === 'radio' || role === 'option' || role === 'tab') return true;
  if (f.tag.toLowerCase() === 'input' && !BUTTON_INPUT_TYPES.includes(normName(f.inputType))) return true;
  if (f.inChoiceGroup || f.choiceInput) return true;
  return hasVariantClassWord(f.className);
}

// ---- Pure: links --------------------------------------------------------------------------------

/** A link to a document rather than a page (§3.2.6: ikea's tabs step clicked its PDFs). */
export function isFileLink(href: string | null | undefined): boolean {
  if (!href) return false;
  return /\.(pdf|docx?|xlsx?|pptx?|zip|csv|rtf|odt|ods|epub)(?:[?#]|$)/i.test(href.trim());
}

/**
 * Given the nearest enclosing anchor (or null), would clicking it leave the page?
 *
 * An anchor is only dangerous if it actually goes somewhere. `<a href="#">` and
 * `href="javascript:void(0)"` are the standard way to build a close button, and a
 * blanket "never click an anchor" rule would break dismissal on many real sites —
 * so the guard has to be about the destination, not the tag.
 *
 * (Moved here from playwright-browser.ts, which re-exports it: the page needs it too.)
 */
export function hrefNavigates(link: { href: string | null; target: string | null } | null): boolean {
  if (!link?.href) return false;
  const href = link.href.trim().toLowerCase();
  if (href === '' || href === '#' || href.startsWith('#')) return false;
  if (href.startsWith('javascript:')) return false;
  // Opens a new tab; the page we are capturing stays put.
  if (link.target === '_blank') return false;
  return true;
}

// ---- Pure: the overlay definition (§3.1) -------------------------------------------------------

export interface Box { top: number; left: number; width: number; height: number }

/** The share of the window (0–1) a box covers, clipped to the window. */
export function coverage(rect: Box, vw: number, vh: number): number {
  if (vw <= 0 || vh <= 0) return 0;
  const w = Math.max(0, Math.min(rect.left + rect.width, vw) - Math.max(rect.left, 0));
  const h = Math.max(0, Math.min(rect.top + rect.height, vh) - Math.max(rect.top, 0));
  return (w * h) / (vw * vh);
}

export interface OverlayFacts {
  tag: string;
  id: string;
  className: string;
  role: string | null;
  ariaModal: string | null;
  openDialog: boolean;
  /** Computed `position`. */
  position: string;
  rect: Box;
  vw: number;
  vh: number;
  /**
   * The element IS the page (plan departure 1). For a dialog: it holds most of the page's text
   * (mostOfText). For anything else: it contains the page's `main` or `h1`, the first of each
   * outside every dialog.
   */
  holdsPage: boolean;
}

/**
 * Is a VISIBLE element an overlay (§3.1)? Visibility is the caller's check (isShown in the page).
 * One definition, used by the expand pass's skips and undo, by dismissal's topmost layer and
 * removal pass, and by the final warning.
 *
 * A dialog (role, aria-modal, open `<dialog>`) counts at any size, but only while some of it is on
 * the window: a closed drawer slid off-screen by a transform is still `role=dialog aria-modal`.
 */
export function overlayByFacts(f: OverlayFacts): boolean {
  const role = normName(f.role);
  const cover = coverage(f.rect, f.vw, f.vh);
  if (role === 'dialog' || role === 'alertdialog' || normName(f.ariaModal) === 'true' || f.openDialog) return cover > 0 && !f.holdsPage;
  if (f.holdsPage) return false;
  const quarter = cover >= 0.25;
  if (!quarter) return false;
  const named = /modal|drawer|lightbox|popup|dialog/i.test(`${f.tag} ${f.id} ${f.className}`);
  if (named && (f.position === 'fixed' || f.position === 'absolute')) return true;
  if (f.position !== 'fixed') return false;
  const tag = f.tag.toLowerCase();
  if (tag === 'header' || tag === 'footer' || tag === 'nav' || role === 'banner' || role === 'navigation') return false;
  const atEdge = f.rect.top <= 0 || f.rect.top + f.rect.height >= f.vh;
  return !(f.rect.height < 200 && atEdge);
}

// ---- Pure: what the expand pass must not click (§3.2) -------------------------------------------

/** Does this aria-haspopup value say the control opens a layer? */
export function opensLayer(ariaHaspopup: string | null): boolean {
  return HASPOPUP_SKIP.includes(normName(ariaHaspopup));
}

export interface ControlledFacts {
  tag: string;
  id: string;
  className: string;
  role: string | null;
  ariaModal: string | null;
  /** Computed `position` (it is computed even while the target is display:none). */
  position: string;
}

/** Is an aria-controls target a layer rather than a panel (§3.2.2)? */
export function isDialogLikeFacts(f: ControlledFacts): boolean {
  const role = normName(f.role);
  if (role === 'dialog' || role === 'alertdialog' || normName(f.ariaModal) === 'true' || f.tag.toLowerCase() === 'dialog') return true;
  if (/modal|drawer|lightbox|popup/i.test(`${f.tag} ${f.id} ${f.className}`)) return true;
  return f.position === 'fixed';
}

/** Does an element holding `elLen` characters of text hold most (60 %+) of the page's `bodyLen`? */
export function mostOfText(elLen: number, bodyLen: number): boolean {
  return bodyLen > 0 && elLen / bodyLen >= 0.6;
}

/** What a log line or a test needs to name an overlay. */
export interface OverlayDescription { tag: string; id: string; text: string }

// ---- Page only: DOM helpers -----------------------------------------------------------------------

interface RobotState {
  /** Expand pass: every control clicked (or already expanded when the pass began). */
  clicked: WeakSet<Element>;
  /** Dismissal: every element clicked once; never clicked again in this capture. */
  tried: WeakSet<Element>;
  /** Expand pass: the overlays present before the current round. */
  baseline: Set<Element>;
  /** Expand pass: the overlays that appeared during the current round. */
  pending: Element[];
  /** Dismissal: the element last clicked, and the layer it sits in. */
  last: Element | null;
  lastHost: Element | null;
}

/** The capture's memory inside this document. A navigation starts it fresh. */
function robotState(): RobotState {
  const w = window as unknown as Record<string, RobotState | undefined>;
  let s = w[ROBOT_STATE_KEY];
  if (!s) {
    s = { clicked: new WeakSet(), tried: new WeakSet(), baseline: new Set(), pending: [], last: null, lastHost: null };
    Object.defineProperty(window, ROBOT_STATE_KEY, { value: s, enumerable: false, configurable: true, writable: true });
  }
  return s;
}

/** An element's class attribute as a string (an SVG element's `className` is not one). */
function classOf(el: Element): string {
  const c = (el as HTMLElement).className as unknown;
  return typeof c === 'string' ? c : (el.getAttribute('class') ?? '');
}

/** The parent element, crossing out of a shadow root to its host. */
function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.parentNode;
  return root instanceof ShadowRoot ? root.host : null;
}

/** The document and every open shadow root inside it (Playwright's selectors reached those). */
function searchRoots(): Array<Document | ShadowRoot> {
  const roots: Array<Document | ShadowRoot> = [document];
  for (let i = 0; i < roots.length; i++) {
    for (const el of Array.from(roots[i].querySelectorAll('*'))) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
    }
  }
  return roots;
}

/** querySelectorAll across the given roots; an invalid selector yields what was found so far. */
function queryDeep(roots: Array<Document | ShadowRoot>, selector: string): Element[] {
  const out: Element[] = [];
  for (const root of roots) {
    try {
      out.push(...Array.from(root.querySelectorAll(selector)));
    } catch {
      return out;
    }
  }
  return out;
}

/**
 * Has a box, not display:none, not visibility:hidden, opacity above 0 (§3.1). Opacity does not
 * inherit, so a dialog-like element also checks its ancestors (only those: it is the case that
 * matters — a dialog parked in a faded wrapper — and the walk is not free).
 */
function isShown(el: Element): boolean {
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) <= 0) return false;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return false;
  if (el.matches(DIALOG_LIKE)) {
    for (let a = parentOf(el); a && a !== document.documentElement; a = parentOf(a)) {
      if (parseFloat(getComputedStyle(a).opacity) <= 0) return false;
    }
  }
  return true;
}

/** The first element matching the selector that is not inside a dialog-like element, or null. */
function firstOutsideDialogs(selector: string): Element | null {
  for (const el of Array.from(document.querySelectorAll(selector))) {
    if (el.closest(DIALOG_LIKE) === null) return el;
  }
  return null;
}

/** An element's rendered text, whitespace removed, as a length. */
function textLength(el: Element): number {
  return ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, '').length;
}

/**
 * Is this element the page itself? A dialog is when it holds most of the page's text (a whole app
 * rendered inside `role=dialog aria-modal`). Anything else is when it contains the page's `main` or
 * `h1`, the first of each outside every dialog: a promo dialog placed before the product holding
 * `<h1>10% off</h1>` is not the page.
 */
function holdsPage(el: Element): boolean {
  if (el.matches(DIALOG_LIKE)) return mostOfText(textLength(el), textLength(document.body));
  const main = firstOutsideDialogs('main');
  const h1 = firstOutsideDialogs('h1');
  return (main !== null && el.contains(main)) || (h1 !== null && el.contains(h1));
}

/** The §3.1 definition, applied to a live element. */
function isOverlay(el: Element): boolean {
  if (el === document.documentElement || el === document.body || !isShown(el)) return false;
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return overlayByFacts({
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    className: classOf(el),
    role: el.getAttribute('role'),
    ariaModal: el.getAttribute('aria-modal'),
    openDialog: el.tagName === 'DIALOG' && (el as HTMLDialogElement).open,
    position: s.position,
    rect: { top: r.top, left: r.left, width: r.width, height: r.height },
    vw: window.innerWidth,
    vh: window.innerHeight,
    holdsPage: holdsPage(el),
  });
}

/** The outermost overlay this element sits in (itself included), or null. */
function outermostOverlay(el: Element): Element | null {
  let found: Element | null = null;
  for (let e: Element | null = el; e && e !== document.body && e !== document.documentElement; e = parentOf(e)) {
    if (isOverlay(e)) found = e;
  }
  return found;
}

/**
 * Every overlay on the page, in document order, shadow roots included. Cheap first: an element
 * off the window, or not dialog-like and covering less than a quarter of it, never gets a
 * computed style.
 */
function listOverlayEls(): Element[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out: Element[] = [];
  for (const el of queryDeep(searchRoots(), '*')) {
    const r = el.getBoundingClientRect();
    const cover = coverage({ top: r.top, left: r.left, width: r.width, height: r.height }, vw, vh);
    if (cover <= 0) continue;
    if (cover < 0.25 && !el.matches(DIALOG_LIKE)) continue;
    if (isOverlay(el)) out.push(el);
  }
  return out;
}

/** The overlay the browser hit-tests first at the window's centre (into open shadow roots), or null. */
function centreOverlayEl(): Element | null {
  const x = window.innerWidth / 2;
  const y = window.innerHeight / 2;
  let hit = document.elementFromPoint(x, y);
  while (hit && hit.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit ? outermostOverlay(hit) : null;
}

/** §3.1's topmost overlay: the one at the centre, failing that the one with the highest z-index. */
function topmostOverlayEl(): Element | null {
  const atCentre = centreOverlayEl();
  if (atCentre) return atCentre;
  let best: Element | null = null;
  let bestZ = -Infinity;
  for (const el of listOverlayEls()) {
    const z = parseInt(getComputedStyle(el).zIndex, 10);
    const zz = Number.isNaN(z) ? 0 : z;
    if (zz >= bestZ) { best = el; bestZ = zz; }
  }
  return best ? (outermostOverlay(best) ?? best) : null;
}

function describeEl(el: Element): OverlayDescription {
  const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return { tag: el.tagName.toLowerCase(), id: el.id || '', text };
}

/** A control's accessible name, close enough: aria-label, aria-labelledby, text, value, title. */
function accessibleName(el: Element): string {
  const label = normName(el.getAttribute('aria-label'));
  if (label) return label;
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const text = normName(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '));
    if (text) return text;
  }
  const text = normName((el as HTMLElement).innerText ?? el.textContent);
  if (text) return text;
  if (el instanceof HTMLInputElement) return normName(el.value);
  return normName(el.getAttribute('title'));
}

/** §3.3.2's variant control, read off a live element. */
function isVariantControl(el: Element): boolean {
  const control = el.tagName === 'LABEL' ? (el as HTMLLabelElement).control : null;
  let inSwatch = false;
  for (let a = parentOf(el), i = 0; a && i < 3; a = parentOf(a), i++) {
    if (/swatch/i.test(classOf(a))) { inSwatch = true; break; }
  }
  return isVariantControlFacts({
    tag: el.tagName,
    inputType: el.tagName === 'INPUT' ? el.getAttribute('type') : null,
    role: el.getAttribute('role'),
    ariaPressed: el.hasAttribute('aria-pressed'),
    ariaChecked: el.hasAttribute('aria-checked'),
    inChoiceGroup: inSwatch || el.closest('fieldset, [role="radiogroup"], [role="listbox"]') !== null,
    choiceInput: el.querySelector('input[type="radio"], input[type="checkbox"]') !== null
      || (control instanceof HTMLInputElement && (control.type === 'radio' || control.type === 'checkbox')),
    className: classOf(el),
  });
}

/**
 * Dismissal never clicks this (§3.3.2): a variant control outside an overlay (a consent dialog's
 * own toggles are not the product's), anything named like settings, or a link that leaves the page.
 */
function neverDismiss(el: Element): boolean {
  if (isVariantControl(el) && outermostOverlay(el) === null) return true;
  if (isSettingsName(accessibleName(el))) return true;
  const a = el.closest('a');
  return hrefNavigates(a ? { href: a.getAttribute('href'), target: a.getAttribute('target') } : null);
}

/** §3.2.2 on a live element. */
function isDialogLike(el: Element): boolean {
  return isDialogLikeFacts({
    tag: el.tagName,
    id: el.id || '',
    className: classOf(el),
    role: el.getAttribute('role'),
    ariaModal: el.getAttribute('aria-modal'),
    position: getComputedStyle(el).position,
  });
}

/** The expand pass skips this control (§3.2.1–3): it opens a layer, controls one, or sits in one. */
function expandSkip(el: Element): boolean {
  if (opensLayer(el.getAttribute('aria-haspopup'))) return true;
  for (const id of (el.getAttribute('aria-controls') ?? '').split(/\s+/)) {
    const target = id ? document.getElementById(id) : null;
    if (target && isDialogLike(target)) return true;
  }
  return outermostOverlay(el) !== null;
}

/** Undo a scroll lock (overflow hidden on html/body, or a body pinned with position:fixed). */
function liftScrollLock(): void {
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    el.style.removeProperty('overflow');
    el.style.removeProperty('overflow-y');
    if (getComputedStyle(el).overflowY === 'hidden') el.style.setProperty('overflow-y', 'visible', 'important');
  }
  const body = document.body;
  if (body && body.style.position === 'fixed') {
    body.style.removeProperty('position');
    body.style.removeProperty('top');
  }
}

// ---- Page only: entries -------------------------------------------------------------------------

function entryListOverlays(): OverlayDescription[] {
  return listOverlayEls().map((el) => describeEl(el));
}

function entryTopmostOverlay(): OverlayDescription | null {
  const el = topmostOverlayEl();
  return el ? describeEl(el) : null;
}

function entryCentreOverlay(): OverlayDescription | null {
  const el = centreOverlayEl();
  return el ? describeEl(el) : null;
}

/**
 * Start of the expand pass: a control already expanded counts as clicked (§3.2.5, plan departure
 * 2), so a single-open accordion is not toggled back to the panel the page opened.
 */
function entryExpandStart(): number {
  const st = robotState();
  let n = 0;
  for (const el of Array.from(document.querySelectorAll('main [aria-expanded="true"], article [aria-expanded="true"]'))) {
    st.clicked.add(el);
    n++;
  }
  return n;
}

/** Remember which overlays are there before a round, so the round's own can be told apart. */
function entryOverlayBaseline(): number {
  const st = robotState();
  st.baseline = new Set(listOverlayEls());
  return st.baseline.size;
}

/**
 * One expand round: today's structural controls and "show more" buttons, each clicked at most once
 * per capture, skipping layer triggers and anything inside an overlay; closed <details> are opened.
 *
 * Clicks happen IN THE PAGE (`element.click()`), not through a Playwright locator: a locator click
 * scrolls its element into view first, and on a listing that loads lazily that appends products —
 * one real listing captured 144, 144, 72 and 108 rows across four runs. Revealing DOM that already
 * exists is this pass's job; loading more of a list is pagination's.
 */
function entryExpandRound(): number {
  const st = robotState();
  let n = 0;
  const click = (el: Element): void => {
    if (st.clicked.has(el) || expandSkip(el)) return;
    st.clicked.add(el);
    try { (el as HTMLElement).click(); n++; } catch { /* not clickable */ }
  };
  for (const selector of EXPAND_SELECTORS) {
    const els = Array.prototype.slice.call(document.querySelectorAll(selector), 0, 10) as Element[];
    for (const el of els) {
      // offsetParent is null for display:none. Outside the viewport is fine and expected.
      if ((el as HTMLElement).offsetParent === null) continue;
      click(el);
    }
  }
  const re = new RegExp(EXPAND_TEXT_PATTERN, 'i');
  const main = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
  for (const el of Array.from(main.querySelectorAll('button, a[role="button"], [class*="expand"], [class*="show-more"], [class*="read-more"]'))) {
    if (re.test(el.textContent?.trim() ?? '') && (el as HTMLElement).offsetParent !== null) click(el);
  }
  for (const el of Array.from(main.querySelectorAll('details:not([open])'))) {
    if (outermostOverlay(el) !== null) continue;
    el.setAttribute('open', '');
    n++;
  }
  return n;
}

/** The overlays that appeared since the baseline (§3.2.4). */
function entryNewOverlays(): number {
  const st = robotState();
  st.pending = listOverlayEls().filter((el) => !st.baseline.has(el));
  return st.pending.length;
}

/** After Escape: remove what the round opened and is still there, and lift the scroll lock. */
function entryRemoveNewOverlays(): OverlayDescription[] {
  const st = robotState();
  const removed: OverlayDescription[] = [];
  const any = st.pending.length > 0;
  for (const el of st.pending) {
    if (!el.isConnected || !isShown(el)) continue;
    removed.push(describeEl(el));
    el.remove();
  }
  st.pending = [];
  if (any) liftScrollLock();
  return removed;
}

/**
 * Click through tabs so every panel's content is in the DOM. Never a tab that is a link elsewhere
 * (new tab or not) or to a file (§3.2.6, plan departure 3), and the same skips as the rounds.
 * Clicks are staggered 300 ms apart; the caller waits for them.
 */
function entryTabs(): number {
  const main = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
  const picked: HTMLElement[] = [];
  const seen = new Set<Element>();
  const consider = (el: Element): void => {
    if (seen.has(el) || (el as HTMLElement).offsetParent === null) return;
    seen.add(el);
    const a = el.closest('a');
    if (a) {
      const href = a.getAttribute('href');
      if (hrefNavigates({ href, target: null }) || isFileLink(href)) return;
    }
    if (expandSkip(el)) return;
    picked.push(el as HTMLElement);
  };
  main.querySelectorAll('[role="tab"]').forEach((el) => consider(el));
  main.querySelectorAll('[data-tab]').forEach((el) => consider(el));
  main.querySelectorAll('[class*="tab" i]').forEach((el) => {
    const classes = classOf(el).toLowerCase();
    if ((classes.includes('tab__') || classes.includes('tab-') || classes.includes('tabs__'))
        && !classes.includes('panel') && !classes.includes('content') && !classes.includes('body')
        && el.matches('button, a, [role="tab"]')) consider(el);
  });
  picked.forEach((el, i) => { setTimeout(() => el.click(), i * 300); });
  return picked.length;
}

// ---- Script assembly. Keep at the end of the module: pageScript reads the constants above. -----

/** esbuild's keepNames helper, as a no-op: see rule 3 at the top. `var`, so a real one is harmless. */
export const PAGE_PRELUDE = 'var __name = (fn) => fn;';

/** Every constant page code reads, emitted as `const NAME = <json>;` under the same name. */
const PAGE_CONSTANTS: Record<string, unknown> = {
  CLOSE_WORDS, ROBOT_STATE_KEY, BUTTON_INPUT_TYPES, DIALOG_LIKE, HASPOPUP_SKIP, EXPAND_SELECTORS, EXPAND_TEXT_PATTERN,
};

/** Every function page code calls, emitted from its own source. */
const PAGE_FUNCTIONS: ReadonlyArray<(...args: never[]) => unknown> = [
  // pure
  normName, isDismissName, isCloseWord, isSettingsName, hasVariantClassWord, isVariantControlFacts,
  isFileLink, hrefNavigates, coverage, mostOfText, overlayByFacts, opensLayer, isDialogLikeFacts,
  // DOM
  robotState, classOf, parentOf, searchRoots, queryDeep, isShown, firstOutsideDialogs, textLength, holdsPage, isOverlay,
  outermostOverlay, listOverlayEls, centreOverlayEl, topmostOverlayEl, describeEl, accessibleName,
  isVariantControl, neverDismiss, isDialogLike, expandSkip, liftScrollLock,
];

/**
 * A self-invoking page script: the prelude, the constants, every page function, then the entry.
 * A function entry is called with `arg` as JSON; a string entry is an expression over the helpers
 * (tests use that form, since a function written in a test file may not name the helpers).
 */
export function pageScript(entry: ((...args: never[]) => unknown) | string, arg?: unknown): string {
  const constants = Object.entries(PAGE_CONSTANTS).map(([name, value]) => `const ${name} = ${JSON.stringify(value)};`).join('\n');
  const functions = PAGE_FUNCTIONS.map((fn) => fn.toString()).join('\n');
  const call = typeof entry === 'string'
    ? `(${entry})`
    : `(${entry.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`;
  return `(() => {\n${PAGE_PRELUDE}\n${constants}\n${functions}\nreturn ${call};\n})()`;
}

/** Every overlay on the page → `OverlayDescription[]`. */
export const LIST_OVERLAYS_SCRIPT = pageScript(entryListOverlays);
/** §3.1's topmost overlay → `OverlayDescription | null`. */
export const TOPMOST_OVERLAY_SCRIPT = pageScript(entryTopmostOverlay);
/** The overlay at the window's centre, if any → `OverlayDescription | null` (§3.4's warning). */
export const CENTRE_OVERLAY_SCRIPT = pageScript(entryCentreOverlay);
/** Start of the expand pass → number of controls already expanded. */
export const EXPAND_START_SCRIPT = pageScript(entryExpandStart);
/** Remember the overlays present now → their count. */
export const OVERLAY_BASELINE_SCRIPT = pageScript(entryOverlayBaseline);
/** One expand round → number of controls clicked or <details> opened. */
export const EXPAND_ROUND_SCRIPT = pageScript(entryExpandRound);
/** Overlays that appeared since the baseline → their count. */
export const NEW_OVERLAYS_SCRIPT = pageScript(entryNewOverlays);
/** Remove what appeared and is still there → `OverlayDescription[]`. */
export const REMOVE_NEW_OVERLAYS_SCRIPT = pageScript(entryRemoveNewOverlays);
/** Click the tabs (staggered) → how many will be clicked. */
export const TABS_SCRIPT = pageScript(entryTabs);
