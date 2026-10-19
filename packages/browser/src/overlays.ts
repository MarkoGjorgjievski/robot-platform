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

/** The expand round clicks at most this many controls per structural selector (today's cap). */
export const EXPAND_PER_SELECTOR = 10;

/**
 * The tabs step clicks at most this many tabs: clicks are 300 ms apart and the caller waits at most
 * 3 s, so the tenth lands at 2.7 s, before the undo check. An eleventh would escape it.
 */
export const EXPAND_MAX_TABS = 10;

/** "Show more" and friends, as a RegExp source (today's Phase 2 pattern, unchanged). */
export const EXPAND_TEXT_PATTERN = '^(show more|see more|see all|view details|read more|expand|view all|load more|\\+ more|show all)$';

/** One dismissal step: a CSS selector, or a whole accessible name (case-folded) of a button. */
export type DismissStep = { css: string } | { name: string; scoped?: boolean };

/**
 * Today's dismissal list, in today's order, with every `button:has-text("…")` turned into a whole
 * name (§3.3.1). A name step matches `button, [role=button]` whose accessible name or visible text
 * IS the text. A `scoped` name — one word, or generic ("ok", "close", "got it") — counts only for a
 * button inside a layer (inLayer): a product page has its own "Accept" and "Close" buttons.
 */
export const DISMISS_STEPS: readonly DismissStep[] = [
  // Cookie consent
  { css: 'button[id*="cookie" i][id*="accept" i]' },
  { css: 'button[id*="cookie" i][id*="close" i]' },
  { css: 'button[id*="consent" i][id*="accept" i]' },
  { css: 'button[class*="cookie" i][class*="accept" i]' },
  { css: 'button[class*="consent" i][class*="accept" i]' },
  { css: 'button[data-testid*="cookie" i]' },
  { css: '#onetrust-accept-btn-handler' },
  { css: '#accept-cookie-notification' },
  { css: '.cookie-banner button' },
  { css: '.cookie-notice button' },
  { css: '[aria-label*="cookie" i][aria-label*="accept" i]' },
  { css: '[aria-label*="cookie" i][aria-label*="close" i]' },
  // Generic consent/privacy modals
  { css: 'button[id*="consent" i][id*="close" i]' },
  { css: 'button[class*="consent" i][class*="close" i]' },
  { css: '[data-testid="close-consent"]' },
  { css: 'button[class*="privacy" i][class*="accept" i]' },
  // Health data consent (Target-style)
  { css: 'button[class*="consent" i][class*="continue" i]' },
  // Whole names (were substring `:has-text`)
  { name: 'continue shopping' },
  { name: 'accept all' },
  { name: 'accept cookies' },
  { name: 'accept all cookies' },
  // Common consent accept names (live check 2026-10-19: colourpop's bare "Accept", labelled
  // "allow cookies"). Still whole names; never a settings or preferences name.
  { name: 'accept', scoped: true },
  { name: 'accept and close' },
  { name: 'accept & close' },
  { name: 'allow all' },
  { name: 'allow all cookies' },
  { name: 'allow cookies' },
  { name: 'allow', scoped: true },
  { name: 'agree', scoped: true },
  { name: 'agree and close' },
  { name: 'agree and continue' },
  { name: 'akzeptieren', scoped: true },
  { name: 'alle akzeptieren' },
  { name: 'alle cookies akzeptieren' },
  { name: 'alle zulassen' },
  { name: 'zustimmen', scoped: true },
  { name: 'tout accepter' },
  { name: 'accepter', scoped: true },
  { name: 'accepter et fermer' },
  { name: 'aceptar', scoped: true },
  { name: 'aceptar todo' },
  { name: 'aceptar todas' },
  { name: 'accetta', scoped: true },
  { name: 'accetta tutto' },
  { name: 'accetta tutti' },
  { name: 'accepteren', scoped: true },
  { name: 'alles accepteren' },
  { name: 'aceitar', scoped: true },
  { name: 'aceitar todos' },
  { name: 'acceptera', scoped: true },
  { name: 'acceptera alla' },
  { name: 'i accept' },
  { name: 'i agree' },
  { name: 'got it', scoped: true },
  { name: 'ok, got it', scoped: true },
  { name: 'ok', scoped: true },
  { name: 'close', scoped: true },
  // Newsletter/email modals
  { css: '[aria-label="Close dialog"]' },
  { css: '[aria-label="Close modal"]' },
  { css: '[aria-label="Close"]' },
  { css: 'button[class*="modal" i][class*="close" i]' },
  { css: '.modal-close' },
  { css: '.popup-close' },
  { css: '[data-dismiss="modal"]' },
  // Generic overlay close buttons
  { css: 'dialog button[aria-label*="close" i]' },
  { css: '[role="dialog"] button[aria-label*="close" i]' },
];

/** Today's JavaScript removal selectors; still removed (not hidden), as today. */
export const REMOVAL_SELECTORS: readonly string[] = [
  '[class*="overlay" i][class*="modal" i]',
  '[class*="overlay" i][class*="consent" i]',
  '[class*="modal" i][class*="backdrop" i]',
  '[id*="consent" i][role="dialog"]',
  '[role="dialog"][aria-modal="true"]',
];

/**
 * The layer a clicked control belongs to when it is not inside a §3.1 overlay (a small cookie bar):
 * if that layer went away, the click worked (§3.3.3).
 */
export const DISMISS_HOST_SELECTOR = [
  '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]', 'dialog',
  '[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]',
  '[id*="banner" i]', '[class*="banner" i]', '[id*="popup" i]', '[class*="popup" i]',
  '[id*="modal" i]', '[class*="modal" i]',
].join(', ');

/**
 * A consent manager's layer (review round 1): dialog semantics, a consent vendor's or a cookie/
 * consent/privacy name, or a cookie/consent label. Not DISMISS_HOST_SELECTOR: its banner, popup and
 * modal words also match a hero banner on the page.
 */
export const CONSENT_HOST_SELECTOR = [
  '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]', 'dialog',
  ...['cookie', 'consent', 'privacy', 'gdpr', 'cmp', 'onetrust', 'didomi', 'usercentrics', 'cookiebot', 'truste']
    .flatMap((w) => [`[id*="${w}" i]`, `[class*="${w}" i]`]),
  '[aria-label*="cookie" i]', '[aria-label*="consent" i]',
].join(', ');

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
   * A fieldset, `[role=radiogroup]` or `[role=listbox]`, or an element whose class contains
   * "swatch", within three ancestors (a page-wide form's fieldset does not make every button a choice).
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
  /**
   * It sits on top of page content (final review I2): it covers the window's centre, or something
   * of the page that is neither inside it nor around it lies under its own centre. Read only for
   * the unnamed fixed-box bullet: a buy box in a column the page reserves overlaps nothing.
   */
  overPage: boolean;
  /** It holds a shown close control: a button or link named by a close word that leaves nothing (isCloseControl). */
  hasClose: boolean;
  /** It holds its own heading (h1–h6 or role=heading). */
  hasHeading: boolean;
}

/**
 * A positioned box smaller than a quarter of the window is still an overlay from this share up
 * when it is a popup (overlayByFacts): puma DE's location popup is 384×374, 14 % of 1280×800.
 * Chat bubbles and floating buttons stay well under it.
 */
export const SMALL_POPUP_MIN = 0.08;

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
  // The cheap checks first; holdsPage, overPage, hasClose and hasHeading last (the page passes them
  // as getters, and on a page of nested full-width wrappers every wrapper reaches this function —
  // final review M3).
  const named = /modal|drawer|lightbox|popup|dialog/i.test(`${f.tag} ${f.id} ${f.className}`);
  const tag = f.tag.toLowerCase();
  const chrome = tag === 'header' || tag === 'footer' || tag === 'nav' || role === 'banner' || role === 'navigation'
    || (f.rect.height < 200 && (f.rect.top <= 0 || f.rect.top + f.rect.height >= f.vh));
  if (cover < 0.25) {
    // A smaller popup (live check 2026-10-19, puma DE's location popup over the sizes): a fixed or
    // absolute box over page content, not the page's header, footer or a bar along an edge, with
    // its own heading or a layer's name, and a close control. All four, so a chat bubble (tiny), a
    // sticky add-to-cart bar (in the flow, or at the edge), a promo bar (at the edge) and a buy box
    // (no close) stay page.
    if (cover < SMALL_POPUP_MIN || (f.position !== 'fixed' && f.position !== 'absolute') || chrome) return false;
    return (named || f.hasHeading) && f.hasClose && !f.holdsPage && f.overPage;
  }
  if (named && (f.position === 'fixed' || f.position === 'absolute')) return !f.holdsPage;
  if (f.position !== 'fixed' || chrome) return false;
  return !f.holdsPage && f.overPage;
}

// ---- Pure: a scrim drawn by html/body (live check 2026-10-19, kith) ---------------------------

export interface ScrimFacts {
  /** Computed `content` of the pseudo-element ('none' / 'normal' when there is none). */
  content: string;
  display: string;
  visibility: string;
  opacity: number;
  position: string;
  /** Its box from the computed top/left/width/height (a fixed pseudo-element's are the window's). */
  rect: Box;
  vw: number;
  vh: number;
  /** The background colour's alpha (a background image is not a scrim: a texture or a picture). */
  backgroundAlpha: number;
  backdropFilter: string;
  zIndex: string;
}

/** Below this effective alpha a full-window pseudo-element dims nothing (a grain texture at .05). */
export const SCRIM_MIN_ALPHA = 0.1;

/**
 * Is a `::before`/`::after` of `<html>` or `<body>` a scrim? A page that opens a modal often adds a
 * class to body whose pseudo-element dims the whole window (kith: `body.modal-background::before`,
 * fixed, inset 0, rgba(0,0,0,.6)). Hiding the modal leaves that class, and the scrim, behind. A
 * scrim is drawn (content, shown), fixed, over a quarter of the window, translucent — its colour
 * times its opacity between SCRIM_MIN_ALPHA and 1, or a backdrop filter: an opaque fill is the page's
 * background and a faint grain dims nothing (review round 1) — and not behind the page (a negative
 * z-index is a decorative background).
 */
export function isScrimFacts(f: ScrimFacts): boolean {
  if (f.content === 'none' || f.content === 'normal') return false;
  if (f.display === 'none' || f.visibility === 'hidden' || !(f.opacity > 0)) return false;
  if (f.position !== 'fixed') return false;
  const z = parseInt(f.zIndex, 10);
  if (!Number.isNaN(z) && z < 0) return false;
  const dim = f.backgroundAlpha * f.opacity;
  const blurs = f.backdropFilter !== 'none' && f.backdropFilter !== '';
  if (!blurs && !(dim >= SCRIM_MIN_ALPHA && dim < 1)) return false;
  return coverage(f.rect, f.vw, f.vh) >= 0.25;
}

/** The alpha of a computed colour (`rgb(…)` 1, `rgba(…, a)` a, `transparent` 0). */
export function colourAlpha(colour: string): number {
  const c = colour.trim().toLowerCase();
  if (c === '' || c === 'transparent') return 0;
  const m = /^rgba?\(([^)]*)\)$/.exec(c);
  if (!m) return 1;
  const parts = m[1].split(/[,/ ]+/).filter((p) => p !== '');
  if (parts.length < 4) return 1;
  const a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  return Number.isNaN(a) ? 1 : a;
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

/** The one line a capture logs when an overlay still covers the window's centre (§3.4, §8.3). */
export function overlayWarning(url: string, d: OverlayDescription): string {
  return `[browser] ${url}: an overlay still covers the middle of the page after dismissal: ${d.tag}${d.id ? `#${d.id}` : ''} "${d.text}"`;
}

// ---- Page only: DOM helpers -----------------------------------------------------------------------

interface RobotState {
  /** Expand pass: every control clicked (or already expanded when the pass began). */
  clicked: WeakSet<Element>;
  /**
   * Expand pass: what it revealed — the aria-controls targets of the controls it clicked (or found
   * expanded) and the <details> it opened. Dismissal never clicks inside one (final review I1).
   */
  revealed: Set<Element>;
  /** Dismissal: every element clicked once; never clicked again in this capture. */
  tried: WeakSet<Element>;
  /** Expand pass: the overlays present before the current round. */
  baseline: Set<Element>;
  /** Expand pass: the overlays that appeared during the current round. */
  pending: Element[];
  /** Dismissal: the element last clicked, and the layer it sits in. */
  last: Element | null;
  lastHost: Element | null;
  /**
   * A layer was closed or hidden in this capture, or Escape was pressed: only then may the page
   * have left a scrim behind (hideScrims; review round 1).
   */
  layerClosed: boolean;
}

/** The capture's memory inside this document. A navigation starts it fresh. */
function robotState(): RobotState {
  const w = window as unknown as Record<string, RobotState | undefined>;
  let s = w[ROBOT_STATE_KEY];
  if (!s) {
    s = { clicked: new WeakSet(), revealed: new Set(), tried: new WeakSet(), baseline: new Set(), pending: [], last: null, lastHost: null, layerClosed: false };
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

/**
 * The first element matching the selector that is not inside a dialog-like element (and, with
 * `visible`, is shown), or null.
 */
function firstOutsideDialogs(selector: string, visible = false): Element | null {
  for (const el of Array.from(document.querySelectorAll(selector))) {
    if (el.closest(DIALOG_LIKE) === null && (!visible || isShown(el))) return el;
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
  return wrapsPage(el);
}

/**
 * Does this element contain the page's `main` or `h1`, the first of each outside every dialog?
 * The first VISIBLE h1 (review round 1): a hidden brand h1 is not where the page is.
 */
function wrapsPage(el: Element): boolean {
  const main = firstOutsideDialogs('main');
  const h1 = firstOutsideDialogs('h1', true);
  return (main !== null && el.contains(main)) || (h1 !== null && el.contains(h1));
}

/** Does `inner` sit inside `outer` (itself included), crossing shadow roots? */
function within(outer: Element, inner: Element): boolean {
  for (let e: Element | null = inner; e; e = parentOf(e)) {
    if (e === outer) return true;
  }
  return false;
}

/**
 * Does this element sit on top of page content (OverlayFacts.overPage)? It covers the window's
 * centre, or the browser hit-tests, under its own centre (clipped to the window), an element that
 * is neither inside it nor one of its ancestors, nor a wrapper of the whole page (a `#page` or
 * `#root` beside the box, or one whose padding reserves the box's column): only content counts.
 */
function sitsOnPage(el: Element): boolean {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = el.getBoundingClientRect();
  if (r.left <= vw / 2 && vw / 2 < r.right && r.top <= vh / 2 && vh / 2 < r.bottom) return true;
  const x = Math.min(Math.max((Math.max(r.left, 0) + Math.min(r.right, vw)) / 2, 0), vw - 1);
  const y = Math.min(Math.max((Math.max(r.top, 0) + Math.min(r.bottom, vh)) / 2, 0), vh - 1);
  for (const hit of document.elementsFromPoint(x, y)) {
    if (hit === document.documentElement || hit === document.body) continue;
    if (within(el, hit) || within(hit, el) || wrapsPage(hit)) continue;
    return true;
  }
  return false;
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
    // Getters: overlayByFacts reads them only once the cheap checks pass (final review M3), and
    // only the unnamed fixed-box and smaller-popup bullets read overPage (a hit test is not free).
    get holdsPage() { return holdsPage(el); },
    get overPage() { return sitsOnPage(el); },
    get hasClose() { return controlsIn(el).some((c) => isCloseControl(c) && isShown(c)); },
    get hasHeading() { return queryIn(el, 'h1, h2, h3, h4, h5, h6, [role="heading"]').length > 0; },
  });
}

/** Elements under `el` matching the selector, its open shadow root included. */
function queryIn(el: Element, selector: string): Element[] {
  return [
    ...Array.from(el.querySelectorAll(selector)),
    ...(el.shadowRoot ? Array.from(el.shadowRoot.querySelectorAll(selector)) : []),
  ];
}

/** The controls under `el` a close word can name. */
function controlsIn(el: Element): Element[] {
  return queryIn(el, 'button, a, [role="button"], [aria-label]');
}

/**
 * A close control (§3.3.4): a button, link or labelled element whose name, aria-label, text or
 * title is a close word, that is not a wrapper of a button (a wrapper reads its button's text: the
 * button is the control) and not a link that leaves the page.
 */
function isCloseControl(el: Element): boolean {
  const BUTTONS = 'button, a, [role="button"]';
  if (!el.matches(BUTTONS) && el.querySelector(BUTTONS) !== null) return false;
  const a = el.closest('a');
  if (hrefNavigates(a ? { href: a.getAttribute('href'), target: a.getAttribute('target') } : null)) return false;
  const names = [accessibleName(el), normName(el.getAttribute('aria-label')), normName((el as HTMLElement).innerText ?? el.textContent), normName(el.getAttribute('title'))];
  return names.some((n) => isCloseWord(n));
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
 * off the window, or not dialog-like and covering less than SMALL_POPUP_MIN of it, never gets a
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
    if (cover < SMALL_POPUP_MIN && !el.matches(DIALOG_LIKE)) continue;
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
  return isVariantControlFacts(variantFactsOf(el));
}

/**
 * A variant choice for any reason other than `role=tab` (§5.1): what the tabs step must not click.
 * A real tab is the step's whole point; a `[data-tab]` or `tab-` swatch in a radiogroup is not.
 */
function isVariantChoice(el: Element): boolean {
  const f = variantFactsOf(el);
  return isVariantControlFacts(normName(f.role) === 'tab' ? { ...f, role: null } : f);
}

/** The facts §3.3.2 reads off a live element. */
function variantFactsOf(el: Element): VariantFacts {
  const control = el.tagName === 'LABEL' ? (el as HTMLLabelElement).control : null;
  // Both checks stop at three ancestors: a page-wide <form><fieldset> holds the swatches and the
  // specs accordion alike, and only the swatches are choices.
  const GROUP = 'fieldset, [role="radiogroup"], [role="listbox"]';
  let inSwatch = false;
  let inGroupEl = el.matches(GROUP);
  for (let a = parentOf(el), i = 0; a && i < 3 && !(inSwatch && inGroupEl); a = parentOf(a), i++) {
    if (/swatch/i.test(classOf(a))) inSwatch = true;
    if (a.matches(GROUP)) inGroupEl = true;
  }
  return {
    tag: el.tagName,
    inputType: el.tagName === 'INPUT' ? el.getAttribute('type') : null,
    role: el.getAttribute('role'),
    ariaPressed: el.hasAttribute('aria-pressed'),
    ariaChecked: el.hasAttribute('aria-checked'),
    inChoiceGroup: inSwatch || inGroupEl,
    choiceInput: el.querySelector('input[type="radio"], input[type="checkbox"]') !== null
      || (control instanceof HTMLInputElement && (control.type === 'radio' || control.type === 'checkbox')),
    className: classOf(el),
  };
}

/**
 * The expand pass clicked this control (or found it expanded): remember it, and the panels it
 * names with aria-controls, so dismissal leaves both alone.
 */
function markExpanded(el: Element): void {
  const st = robotState();
  st.clicked.add(el);
  for (const id of (el.getAttribute('aria-controls') ?? '').split(/\s+/)) {
    const target = id ? document.getElementById(id) : null;
    if (target) st.revealed.add(target);
  }
  const details = el.tagName === 'SUMMARY' ? el.parentElement : null;
  if (details && details.tagName === 'DETAILS') st.revealed.add(details);
}

/**
 * Is this part of what the expand pass opened (final review I1)? A control it clicked (or found
 * expanded in main/article), or anything inside a panel or <details> it revealed. Only what the
 * pass touched: a header toggle open on load stays clickable. A panel's own "Close", or a
 * toggle whose label turns into "Close" once open, would shut it again.
 */
function openedByExpand(el: Element): boolean {
  const st = robotState();
  if (st.clicked.has(el)) return true;
  if (st.revealed.size === 0) return false;
  for (let a: Element | null = el; a; a = parentOf(a)) {
    if (st.revealed.has(a)) return true;
  }
  return false;
}

/**
 * Dismissal never clicks this (§3.3.2): a variant control or anything the expand pass opened,
 * outside an overlay (a consent dialog's own toggles are not the product's), anything named like
 * settings, or a link that leaves the page.
 */
function neverDismiss(el: Element): boolean {
  if (isSettingsName(accessibleName(el)) || isSettingsName((el as HTMLElement).innerText ?? el.textContent)) return true;
  const a = el.closest('a');
  if (hrefNavigates(a ? { href: a.getAttribute('href'), target: a.getAttribute('target') } : null)) return true;
  // A button that sends a form (review round 1): the page's own, unless a layer or a consent host holds it.
  if (submitsForm(el) && outermostOverlay(el) === null && consentHostOf(el) === null) return true;
  if (!isVariantControl(el) && !openedByExpand(el)) return false;
  return outermostOverlay(el) === null;
}

/** Would clicking this send a form? A submit button (a `<button>`'s default type) or input in a form. */
function submitsForm(el: Element): boolean {
  if (el instanceof HTMLButtonElement) return el.form !== null && el.type === 'submit';
  if (el instanceof HTMLInputElement) return el.form !== null && (el.type === 'submit' || el.type === 'image');
  return false;
}

/** The consent host (CONSENT_HOST_SELECTOR) an element sits in, crossing shadow roots, or null. */
function consentHostOf(el: Element): Element | null {
  for (let a: Element | null = el; a && a !== document.body && a !== document.documentElement; a = parentOf(a)) {
    if (a.matches(CONSENT_HOST_SELECTOR)) return a;
  }
  return null;
}

/**
 * Is this button in a layer, where a bare or generic name ("Accept", "OK", "Close") may be clicked
 * (review round 1)? Inside an overlay, a consent host, or a fixed or sticky box below body.
 */
function inLayer(el: Element): boolean {
  if (outermostOverlay(el) !== null || consentHostOf(el) !== null) return true;
  for (let a: Element | null = el; a && a !== document.body && a !== document.documentElement; a = parentOf(a)) {
    const p = getComputedStyle(a).position;
    if (p === 'fixed' || p === 'sticky') return true;
  }
  return false;
}

/** Does this button carry one of the name steps' names (a scoped one only in a layer)? */
function hasConsentName(el: Element): boolean {
  const names = [accessibleName(el), normName((el as HTMLElement).innerText ?? el.textContent)];
  let layer: boolean | null = null;
  for (const step of DISMISS_STEPS) {
    if (!('name' in step) || !names.some((n) => isDismissName(n, step.name))) continue;
    if (!step.scoped) return true;
    layer ??= inLayer(el);
    if (layer) return true;
  }
  return false;
}

/** The consent-like layer (DISMISS_HOST_SELECTOR) an element sits in, crossing shadow roots, or null. */
function dismissHostOf(el: Element): Element | null {
  for (let a: Element | null = el; a; a = parentOf(a)) {
    if (a.matches(DISMISS_HOST_SELECTOR)) return a;
  }
  return null;
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

/**
 * Stop painting a scrim html or body draws with ::before/::after (isScrimFacts) → how many. The page
 * normally takes it away when its modal closes; this is the net for when the modal was hidden
 * instead (no close control, Escape ignored). An adopted stylesheet, so the captured HTML is the
 * page's own; a `<style>` element where adopted sheets are not supported.
 */
function hideScrims(): number {
  const rules: string[] = [];
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    for (const p of ['::before', '::after']) {
      const s = getComputedStyle(el, p);
      const px = (v: string): number => { const x = parseFloat(v); return Number.isNaN(x) ? 0 : x; };
      const facts: ScrimFacts = {
        content: s.content, display: s.display, visibility: s.visibility, opacity: parseFloat(s.opacity), position: s.position,
        rect: { top: px(s.top), left: px(s.left), width: px(s.width), height: px(s.height) },
        vw: window.innerWidth, vh: window.innerHeight,
        backgroundAlpha: colourAlpha(s.backgroundColor),
        backdropFilter: s.backdropFilter ?? 'none',
        zIndex: s.zIndex,
      };
      if (isScrimFacts(facts)) rules.push(`${el === document.body ? 'body' : 'html'}${p}{display:none !important}`);
    }
  }
  if (rules.length === 0) return 0;
  const css = rules.join('\n');
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = css;
    document.head?.appendChild(style);
  }
  return rules.length;
}

/** Take an overlay off the screenshot but keep its text in the HTML (§3.3.5, plan departure 4). */
function hideOverlay(el: Element): void {
  (el as HTMLElement).style?.setProperty('display', 'none', 'important');
}

// ---- Page only: entries -------------------------------------------------------------------------

function entryListOverlays(): OverlayDescription[] {
  return listOverlayEls().map((el) => describeEl(el));
}

function entryTopmostOverlay(): OverlayDescription | null {
  const el = topmostOverlayEl();
  return el ? describeEl(el) : null;
}

/**
 * Is there a topmost overlay that offers no close control not yet tried? Then a click elsewhere
 * would land on its backdrop or scrim (a page-wide "OK" under kith-like `body::before`), so
 * dismissal presses Escape first.
 */
function entryTopmostWithoutClose(): boolean {
  const top = topmostOverlayEl();
  if (!top) return false;
  // The candidate search's own filter, and its two ways to close a layer: a close word, or a
  // consent name (a page may read Escape on its consent dialog as "reject" — review minor 4).
  return !controlsIn(top).some((c) => dismissUsable(c) && (isCloseControl(c) || (c.matches('button, [role="button"]') && hasConsentName(c))));
}

/** Dismissal may offer this element: not tried, shown, on the window, and not never-click (§3.3.2). */
function dismissUsable(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const onWindow = coverage({ top: r.top, left: r.left, width: r.width, height: r.height }, window.innerWidth, window.innerHeight) > 0;
  return !robotState().tried.has(el) && isShown(el) && onWindow && !neverDismiss(el);
}

/** Dismissal pressed Escape: the page may have closed a layer, so its scrim may be left (hideScrims). */
function entryNoteEscape(): void {
  robotState().layerClosed = true;
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
  let n = 0;
  for (const el of Array.from(document.querySelectorAll('main [aria-expanded="true"], article [aria-expanded="true"]'))) {
    markExpanded(el);
    n++;
  }
  return n;
}

/**
 * Remember which overlays are there, so the ones a round or the tabs step opens can be told apart.
 * Called right before the first click, so a page with nothing to expand pays no full-DOM scan.
 */
function takeOverlayBaseline(): void {
  robotState().baseline = new Set(listOverlayEls());
}

/**
 * One expand round: today's structural controls and "show more" buttons, each clicked at most once
 * per capture, skipping layer triggers, variant choices (§5.1) and anything inside an overlay; closed
 * <details> are opened.
 * The ten-per-selector cap counts controls that would be clicked, so a skipped or already-clicked
 * one never hides a real accordion further down.
 *
 * Clicks happen IN THE PAGE (`element.click()`), not through a Playwright locator: a locator click
 * scrolls its element into view first, and on a listing that loads lazily that appends products —
 * one real listing captured 144, 144, 72 and 108 rows across four runs. Revealing DOM that already
 * exists is this pass's job; loading more of a list is pagination's.
 */
function entryExpandRound(): number {
  const st = robotState();
  let n = 0;
  const act = (): void => {
    if (n === 0) takeOverlayBaseline();
    n++;
  };
  // offsetParent is null for display:none. Outside the viewport is fine and expected. Never a
  // variant choice (§5.1 holds for the whole capture): a swatch that is also a disclosure.
  const clickable = (el: Element): boolean =>
    (el as HTMLElement).offsetParent !== null && !st.clicked.has(el) && !expandSkip(el) && !isVariantChoice(el);
  const click = (el: Element): void => {
    act();
    markExpanded(el);
    try { (el as HTMLElement).click(); } catch { /* not clickable */ }
  };
  for (const selector of EXPAND_SELECTORS) {
    let taken = 0;
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (taken >= EXPAND_PER_SELECTOR) break;
      if (!clickable(el)) continue;
      click(el);
      taken++;
    }
  }
  const re = new RegExp(EXPAND_TEXT_PATTERN, 'i');
  const main = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
  for (const el of Array.from(main.querySelectorAll('button, a[role="button"], [class*="expand"], [class*="show-more"], [class*="read-more"]'))) {
    if (re.test(el.textContent?.trim() ?? '') && clickable(el)) click(el);
  }
  for (const el of Array.from(main.querySelectorAll('details:not([open])'))) {
    if (outermostOverlay(el) !== null) continue;
    act();
    st.revealed.add(el);
    el.setAttribute('open', '');
  }
  return n;
}

/** The overlays that appeared since the baseline (§3.2.4). */
function entryNewOverlays(): number {
  const st = robotState();
  st.pending = listOverlayEls().filter((el) => !st.baseline.has(el));
  return st.pending.length;
}

/**
 * After Escape: take away what the round opened and is still there, and lift the scroll lock. A
 * fixed layer (a lightbox, a video modal) is removed. Anything else — an inline `role=dialog` a
 * panel revealed — is hidden instead, so its text stays in the HTML (final review M1).
 */
function entryRemoveNewOverlays(): OverlayDescription[] {
  const st = robotState();
  const removed: OverlayDescription[] = [];
  const any = st.pending.length > 0;
  for (const el of st.pending) {
    if (!el.isConnected || !isShown(el)) continue;
    removed.push(describeEl(el));
    if (getComputedStyle(el).position === 'fixed') el.remove();
    else hideOverlay(el);
  }
  st.pending = [];
  if (removed.length > 0) st.layerClosed = true;
  if (any) liftScrollLock();
  return removed;
}

/**
 * Click through tabs so every panel's content is in the DOM. Never a tab that is a link elsewhere
 * (new tab or not) or to a file (§3.2.6, plan departure 3), never a variant choice (§5.1: a
 * `[data-tab]` swatch), and the same skips as the rounds. At most EXPAND_MAX_TABS, staggered
 * 300 ms apart, so the last click lands inside the caller's 3 s wait and before its undo check.
 */
function entryTabs(): number {
  const main = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
  const picked: HTMLElement[] = [];
  const seen = new Set<Element>();
  const consider = (el: Element): void => {
    if (picked.length >= EXPAND_MAX_TABS) return;
    if (seen.has(el) || (el as HTMLElement).offsetParent === null) return;
    seen.add(el);
    const a = el.closest('a');
    if (a) {
      const href = a.getAttribute('href');
      if (hrefNavigates({ href, target: null }) || isFileLink(href)) return;
    }
    if (expandSkip(el) || isVariantChoice(el)) return;
    picked.push(el as HTMLElement);
    markExpanded(el);
  };
  main.querySelectorAll('[role="tab"]').forEach((el) => consider(el));
  main.querySelectorAll('[data-tab]').forEach((el) => consider(el));
  main.querySelectorAll('[class*="tab" i]').forEach((el) => {
    const classes = classOf(el).toLowerCase();
    if ((classes.includes('tab__') || classes.includes('tab-') || classes.includes('tabs__'))
        && !classes.includes('panel') && !classes.includes('content') && !classes.includes('body')
        && el.matches('button, a, [role="tab"]')) consider(el);
  });
  if (picked.length > 0) takeOverlayBaseline();
  picked.forEach((el, i) => { setTimeout(() => el.click(), i * 300); });
  return picked.length;
}

/**
 * The next control dismissal should click, or null (§3.3.1, §3.3.2, §3.3.4). First a close word
 * inside the topmost overlay; then today's steps in order. Every element is offered once per
 * capture: whether its click worked or not, it is never offered again. Only an element on the
 * window is offered: an off-canvas cart, menu or search drawer (translateX(100%)) has a "Close"
 * that closes nothing, and seven of them cost a clean page five seconds of dead clicks (§5.5).
 *
 * `final`: the pass just before the screenshot, after the expand pass (§3.4). There today's steps
 * are offered only to an element inside an overlay or a consent-like layer (DISMISS_HOST_SELECTOR):
 * a bare page-level "Close" or [aria-label="Close"] is far likelier to belong to a panel the
 * expand pass just opened than to a late banner (final review I1).
 */
function entryNextDismissCandidate(opts?: { final?: boolean }): Element | null {
  const final = opts?.final === true;
  const st = robotState();
  const usable = dismissUsable;
  const take = (el: Element): Element => {
    st.tried.add(el);
    st.last = el;
    st.lastHost = outermostOverlay(el) ?? el.closest(DISMISS_HOST_SELECTOR);
    return el;
  };
  const top = topmostOverlayEl();
  if (top) {
    for (const el of controlsIn(top)) {
      if (usable(el) && isCloseControl(el)) return take(el);
    }
  }
  const roots = searchRoots();
  // A button's accessible name and its visible text: colourpop's "Accept" is labelled "allow cookies".
  let named: Array<[Element, string[]]> | null = null;
  for (const step of DISMISS_STEPS) {
    let els: Element[];
    if ('css' in step) {
      els = queryDeep(roots, step.css);
    } else {
      named ??= queryDeep(roots, 'button, [role="button"]').map((el): [Element, string[]] => [el, [accessibleName(el), normName((el as HTMLElement).innerText ?? el.textContent)]]);
      els = named.filter(([, names]) => names.some((n) => isDismissName(n, step.name))).map(([el]) => el);
    }
    const scoped = 'name' in step && step.scoped === true;
    for (const el of els) {
      if (!usable(el)) continue;
      if (scoped && !inLayer(el)) continue;
      if (final && outermostOverlay(el) === null && dismissHostOf(el) === null) continue;
      return take(el);
    }
  }
  return null;
}

/** Did the last click work (§3.3.3)? The element, or the layer it sat in, is gone or hidden. */
function entryLastDismissWorked(): boolean {
  const st = robotState();
  const gone = (el: Element | null): boolean => el !== null && (!el.isConnected || !isShown(el));
  const worked = gone(st.last) || gone(st.lastHost);
  if (worked) st.layerClosed = true;
  return worked;
}

/**
 * The removal pass, every round (§3.3.5): hide every §3.1 overlay, remove today's selectors and
 * today's high z-index body children (never the page itself), lift the scroll lock → how many.
 */
function entryRemovalPass(): number {
  let n = 0;
  for (const el of listOverlayEls()) {
    if (!isShown(el)) continue; // inside one hidden a moment ago
    hideOverlay(el);
    n++;
  }
  const remove = (el: Element): void => {
    if (!el.isConnected || el === document.body || el === document.documentElement || holdsPage(el)) return;
    el.remove();
    n++;
  };
  for (const selector of REMOVAL_SELECTORS) document.querySelectorAll(selector).forEach((el) => remove(el));
  document.querySelectorAll('body > div').forEach((el) => {
    const s = getComputedStyle(el);
    if ((s.position === 'fixed' || s.position === 'absolute') && parseFloat(s.zIndex) > 1000 && el.querySelector('button')) remove(el);
  });
  if (n > 0) robotState().layerClosed = true;
  // Not counted: a scrim no longer painted is no reason for another round.
  if (robotState().layerClosed) hideScrims();
  // Today's unconditional reset; the fuller lift only when something was taken away.
  if (document.body) document.body.style.overflow = '';
  if (document.documentElement) document.documentElement.style.overflow = '';
  if (n > 0) liftScrollLock();
  return n;
}

// ---- Script assembly. Keep at the end of the module: pageScript reads the constants above. -----

/** esbuild's keepNames helper, as a no-op: see rule 3 at the top. `var`, so a real one is harmless. */
export const PAGE_PRELUDE = 'var __name = (fn) => fn;';

/** Every constant page code reads, emitted as `const NAME = <json>;` under the same name. */
const PAGE_CONSTANTS: Record<string, unknown> = {
  CLOSE_WORDS, ROBOT_STATE_KEY, BUTTON_INPUT_TYPES, DIALOG_LIKE, HASPOPUP_SKIP, EXPAND_SELECTORS, EXPAND_TEXT_PATTERN,
  EXPAND_PER_SELECTOR, EXPAND_MAX_TABS, DISMISS_STEPS, REMOVAL_SELECTORS, DISMISS_HOST_SELECTOR, SMALL_POPUP_MIN, CONSENT_HOST_SELECTOR, SCRIM_MIN_ALPHA,
};

/** Every function page code calls, emitted from its own source. */
const PAGE_FUNCTIONS: ReadonlyArray<(...args: never[]) => unknown> = [
  // pure
  normName, isDismissName, isCloseWord, isSettingsName, hasVariantClassWord, isVariantControlFacts,
  isFileLink, hrefNavigates, coverage, mostOfText, overlayByFacts, isScrimFacts, colourAlpha, opensLayer, isDialogLikeFacts,
  // DOM
  robotState, classOf, parentOf, searchRoots, queryDeep, isShown, firstOutsideDialogs, textLength, holdsPage, wrapsPage, within, sitsOnPage, isOverlay,
  outermostOverlay, listOverlayEls, centreOverlayEl, topmostOverlayEl, describeEl, accessibleName,
  isVariantControl, isVariantChoice, variantFactsOf, markExpanded, openedByExpand, neverDismiss, dismissHostOf, isDialogLike, expandSkip, liftScrollLock,
  takeOverlayBaseline, hideOverlay, queryIn, controlsIn, isCloseControl, hideScrims, submitsForm, consentHostOf, inLayer, hasConsentName, dismissUsable,
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
/** A topmost overlay with no close control left to try → boolean (dismissal presses Escape first). */
export const TOPMOST_WITHOUT_CLOSE_SCRIPT = pageScript(entryTopmostWithoutClose);
/** Note that dismissal pressed Escape (hideScrims may then run). */
export const NOTE_ESCAPE_SCRIPT = pageScript(entryNoteEscape);
/** The overlay at the window's centre, if any → `OverlayDescription | null` (§3.4's warning). */
export const CENTRE_OVERLAY_SCRIPT = pageScript(entryCentreOverlay);
/** Start of the expand pass → number of controls already expanded. */
export const EXPAND_START_SCRIPT = pageScript(entryExpandStart);
/** One expand round → number of controls clicked or <details> opened. */
export const EXPAND_ROUND_SCRIPT = pageScript(entryExpandRound);
/** Overlays that appeared since the baseline → their count. */
export const NEW_OVERLAYS_SCRIPT = pageScript(entryNewOverlays);
/** Remove what appeared and is still there → `OverlayDescription[]`. */
export const REMOVE_NEW_OVERLAYS_SCRIPT = pageScript(entryRemoveNewOverlays);
/** Click the tabs (staggered) → how many will be clicked. */
export const TABS_SCRIPT = pageScript(entryTabs);
/** The next control to click → `Element | null`. Use with `page.evaluateHandle`. */
export const NEXT_DISMISS_CANDIDATE_SCRIPT = pageScript(entryNextDismissCandidate);
/** The same for the final pass (§3.4): today's steps only inside an overlay or a consent-like layer. */
export const NEXT_DISMISS_CANDIDATE_FINAL_SCRIPT = pageScript(entryNextDismissCandidate, { final: true });
/** Did the last click work → boolean. */
export const LAST_DISMISS_WORKED_SCRIPT = pageScript(entryLastDismissWorked);
/** The removal pass → number of overlays hidden or elements removed. */
export const REMOVAL_PASS_SCRIPT = pageScript(entryRemovalPass);
