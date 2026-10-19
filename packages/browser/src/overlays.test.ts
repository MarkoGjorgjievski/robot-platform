// The pure halves of the overlay rules (spec 2026-10-19 §3.1, §3.3.1, §3.3.2, §3.3.4). They run in
// Node here and, inside pageScript(), in the page.
import { describe, it, expect } from 'vitest';
import {
  CLOSE_WORDS, PAGE_PRELUDE, coverage, hasVariantClassWord, isCloseWord, isDismissName, isFileLink,
  isSettingsName, isVariantControlFacts, normName, overlayByFacts, pageScript,
  type OverlayFacts, type VariantFacts,
} from './overlays.js';

describe('normName', () => {
  it('trims, collapses whitespace and case-folds', () => {
    expect(normName('  OK \n')).toBe('ok');
    expect(normName('Accept\n  All')).toBe('accept all');
    expect(normName('Schließen')).toBe('schließen');
    expect(normName(null)).toBe('');
  });
});

describe('isDismissName — whole names, not substrings (§3.3.1)', () => {
  it('matches the whole name, in any case and spacing', () => {
    expect(isDismissName('OK', 'ok')).toBe(true);
    expect(isDismissName(' Ok ', 'OK')).toBe(true);
    expect(isDismissName('OK, got it', 'ok, got it')).toBe(true);
  });
  it('never matches a name that merely contains the text — the ikea, skullcandy and puma clicks', () => {
    expect(isDismissName('Cookie settings', 'ok')).toBe(false);
    expect(isDismissName('look', 'ok')).toBe(false);
    expect(isDismissName('Rosy Outlook', 'ok')).toBe(false);
  });
  it('an empty name matches nothing', () => {
    expect(isDismissName('', '')).toBe(false);
    expect(isDismissName(null, 'ok')).toBe(false);
  });
});

describe('isCloseWord (§3.3.4)', () => {
  it('knows the close words in the languages the campaign met', () => {
    for (const w of ['Close', 'Schließen', 'schliessen', 'Fermer', 'Cerrar', 'Chiudi', 'Sluiten', 'Fechar', 'Zamknij', 'Stäng', 'Luk', 'Lukk', 'Sulje', '×', '✕', 'X', 'Dismiss', 'No thanks', 'Not now', 'Continue shopping', 'Stay here']) {
      expect(isCloseWord(w), w).toBe(true);
    }
    expect(CLOSE_WORDS).toHaveLength(21);
  });
  it('is a whole-name test too', () => {
    expect(isCloseWord('Close dialog')).toBe(false);
    expect(isCloseWord('Closet')).toBe(false);
    expect(isCloseWord('Add to bag')).toBe(false);
    expect(isCloseWord('')).toBe(false);
  });
});

describe("isSettingsName — never the page's settings (§3.3.2)", () => {
  it('names settings, preferences, manage, customise, options or more info, in any case', () => {
    for (const n of ['Cookie settings', 'Manage preferences', 'Customise', 'Customize cookies', 'OPTIONS', 'More info', 'manage']) {
      expect(isSettingsName(n), n).toBe(true);
    }
  });
  it('leaves accept and close names alone', () => {
    for (const n of ['Accept all', 'OK', 'Close', 'Got it', 'Optionsbar', '']) expect(isSettingsName(n), n).toBe(false);
  });
});

describe('isVariantControlFacts — never a variant control (§3.3.2)', () => {
  const none: VariantFacts = { tag: 'BUTTON', role: null, ariaPressed: false, ariaChecked: false, inChoiceGroup: false, choiceInput: false, className: '' };
  it('a plain button is not a variant control', () => {
    expect(isVariantControlFacts(none)).toBe(false);
    expect(isVariantControlFacts({ ...none, className: 'btn btn--primary' })).toBe(false);
  });
  it('aria-pressed, aria-checked, radio/option/tab roles and inputs are', () => {
    expect(isVariantControlFacts({ ...none, ariaPressed: true })).toBe(true);
    expect(isVariantControlFacts({ ...none, ariaChecked: true })).toBe(true);
    expect(isVariantControlFacts({ ...none, role: 'Radio' })).toBe(true);
    expect(isVariantControlFacts({ ...none, role: 'option' })).toBe(true);
    expect(isVariantControlFacts({ ...none, role: 'tab' })).toBe(true);
    expect(isVariantControlFacts({ ...none, tag: 'INPUT' })).toBe(true);
  });
  it('anything in a fieldset, radiogroup or listbox, or wrapping a radio, is', () => {
    expect(isVariantControlFacts({ ...none, inChoiceGroup: true })).toBe(true);
    expect(isVariantControlFacts({ ...none, choiceInput: true })).toBe(true);
  });
  it('a class word containing swatch or variant is — the "Rosy Outlook" swatch', () => {
    expect(isVariantControlFacts({ ...none, className: 'product-swatch__item' })).toBe(true);
    expect(isVariantControlFacts({ ...none, className: 'pill VariantPill' })).toBe(true);
    expect(hasVariantClassWord('ProductSwatch')).toBe(true);
    expect(hasVariantClassWord('')).toBe(false);
  });
});

describe('isFileLink (§3.2.6)', () => {
  it('a link to a document is a file', () => {
    expect(isFileLink('/files/manual.pdf')).toBe(true);
    expect(isFileLink('https://x.test/a/B.PDF?v=2')).toBe(true);
    expect(isFileLink('/doc.pdf#page=2')).toBe(true);
    expect(isFileLink('/sheet.xlsx')).toBe(true);
  });
  it('a page, a fragment or nothing is not', () => {
    expect(isFileLink('/p/sofa')).toBe(false);
    expect(isFileLink('#specs')).toBe(false);
    expect(isFileLink('/pdf-guide')).toBe(false);
    expect(isFileLink(null)).toBe(false);
  });
});

describe('coverage', () => {
  it('is the share of the window a box covers, clipped to the window', () => {
    expect(coverage({ top: 0, left: 0, width: 1280, height: 800 }, 1280, 800)).toBe(1);
    expect(coverage({ top: -400, left: 0, width: 1280, height: 800 }, 1280, 800)).toBe(0.5);
    expect(coverage({ top: 0, left: 1280, width: 400, height: 800 }, 1280, 800)).toBe(0);
    expect(coverage({ top: 0, left: 0, width: 10, height: 10 }, 0, 0)).toBe(0);
  });
});

describe('overlayByFacts — the one definition (§3.1)', () => {
  const base: OverlayFacts = {
    tag: 'div', id: '', className: '', role: null, ariaModal: null, openDialog: false, position: 'static',
    rect: { top: 0, left: 0, width: 1280, height: 800 }, vw: 1280, vh: 800, holdsPage: false,
  };
  const small = { top: 600, left: 20, width: 300, height: 120 };
  it('a dialog by role, aria-modal or an open <dialog> is an overlay at any size', () => {
    expect(overlayByFacts({ ...base, role: 'dialog', rect: small })).toBe(true);
    expect(overlayByFacts({ ...base, role: 'alertdialog', rect: small })).toBe(true);
    expect(overlayByFacts({ ...base, ariaModal: 'true', rect: small })).toBe(true);
    expect(overlayByFacts({ ...base, openDialog: true, rect: small })).toBe(true);
  });
  it('a box named modal/drawer/lightbox/popup/dialog counts when fixed or absolute and a quarter of the window', () => {
    expect(overlayByFacts({ ...base, className: 'modal-wrapper', position: 'absolute', rect: { top: 0, left: 0, width: 800, height: 500 } })).toBe(true);
    expect(overlayByFacts({ ...base, tag: 'modal-dialog', position: 'fixed' })).toBe(true);
    expect(overlayByFacts({ ...base, id: 'size-drawer', position: 'fixed', rect: { top: 0, left: 800, width: 480, height: 800 } })).toBe(true);
    expect(overlayByFacts({ ...base, className: 'modal-wrapper', position: 'absolute', rect: { top: 0, left: 0, width: 300, height: 200 } })).toBe(false);
    expect(overlayByFacts({ ...base, className: 'modal', position: 'static' })).toBe(false);
  });
  it('any fixed box covering a quarter is an overlay — the puma location popup', () => {
    expect(overlayByFacts({ ...base, tag: 'section', position: 'fixed' })).toBe(true);
    expect(overlayByFacts({ ...base, position: 'absolute' })).toBe(false);
  });
  it('but not the page\'s header or footer', () => {
    expect(overlayByFacts({ ...base, tag: 'header', position: 'fixed' })).toBe(false);
    expect(overlayByFacts({ ...base, tag: 'nav', position: 'fixed', rect: { top: 0, left: 0, width: 400, height: 800 } })).toBe(false);
    expect(overlayByFacts({ ...base, role: 'navigation', position: 'fixed', rect: { top: 0, left: 0, width: 400, height: 800 } })).toBe(false);
    expect(overlayByFacts({ ...base, role: 'banner', position: 'fixed' })).toBe(false);
    // A band under 200 px at the top or bottom edge (a window short enough for it to cover a quarter).
    expect(overlayByFacts({ ...base, position: 'fixed', vh: 600, rect: { top: 0, left: 0, width: 1280, height: 180 } })).toBe(false);
    expect(overlayByFacts({ ...base, position: 'fixed', vh: 600, rect: { top: 420, left: 0, width: 1280, height: 180 } })).toBe(false);
    expect(overlayByFacts({ ...base, position: 'fixed', vh: 600, rect: { top: 200, left: 0, width: 1280, height: 180 } })).toBe(true);
  });
  it('a fixed box off the window covers nothing', () => {
    expect(overlayByFacts({ ...base, position: 'fixed', rect: { top: 0, left: 1280, width: 480, height: 800 } })).toBe(false);
  });
  it('the page itself is never an overlay — an app shell (plan departure 1)', () => {
    expect(overlayByFacts({ ...base, position: 'fixed', holdsPage: true })).toBe(false);
    expect(overlayByFacts({ ...base, role: 'dialog', holdsPage: true })).toBe(false);
  });
});

describe('pageScript', () => {
  it('starts with the __name shim the dev runtime needs', () => {
    expect(PAGE_PRELUDE).toBe('var __name = (fn) => fn;');
    expect(pageScript('1')).toContain(`(() => {\n${PAGE_PRELUDE}\n`);
  });
  it('carries the constants and every page function by name', () => {
    const s = pageScript('1');
    expect(s).toContain('const CLOSE_WORDS = [');
    expect(s).toContain('const ROBOT_STATE_KEY = "__robotCapture";');
    for (const name of ['normName', 'overlayByFacts', 'hrefNavigates', 'isOverlay', 'outermostOverlay', 'listOverlayEls', 'topmostOverlayEl', 'accessibleName', 'neverDismiss', 'robotState', 'queryDeep']) {
      expect(s).toContain(`function ${name}(`);
    }
  });
  it('a string entry is an expression; a function entry is called with its argument as JSON', () => {
    expect(pageScript('2 + 2').trimEnd().endsWith('return (2 + 2);\n})()')).toBe(true);
    const s = pageScript(function entryEcho(x: { a: string }) { return x.a; } as (...args: never[]) => unknown, { a: "it's" });
    expect(s).toContain('({"a":"it\'s"})');
  });
});
