// The pure halves of the overlay rules (spec 2026-10-19 §3.1, §3.3.1, §3.3.2, §3.3.4). They run in
// Node here and, inside pageScript(), in the page.
import { describe, it, expect } from 'vitest';
import {
  CLOSE_WORDS, DISMISS_STEPS, PAGE_PRELUDE, coverage, hasVariantClassWord, isCloseWord, isDismissName, isFileLink,
  isSettingsName, isVariantControlFacts, mostOfText, normName, overlayByFacts, pageScript,
  isDialogLikeFacts, opensLayer, type ControlledFacts, type OverlayFacts, type VariantFacts,
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
  const none: VariantFacts = { tag: 'BUTTON', inputType: null, role: null, ariaPressed: false, ariaChecked: false, inChoiceGroup: false, choiceInput: false, className: '' };
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
  it('a submit, button, reset or image input is a button, not a variant control', () => {
    for (const t of ['submit', 'button', 'reset', 'image', 'SUBMIT']) {
      expect(isVariantControlFacts({ ...none, tag: 'INPUT', inputType: t }), t).toBe(false);
    }
    for (const t of ['text', 'number', 'radio', 'checkbox']) {
      expect(isVariantControlFacts({ ...none, tag: 'INPUT', inputType: t }), t).toBe(true);
    }
  });
  it('a button modifier class that merely mentions variant is not a variant word', () => {
    for (const c of ['btn btn--variant-primary', 'button-variant-secondary', 'c-btn--variant', 'btn_variant']) {
      expect(hasVariantClassWord(c), c).toBe(false);
    }
    for (const c of ['variant-pill', 'variants', 'product-form__variant', 'color-swatch', 'swatch']) {
      expect(hasVariantClassWord(c), c).toBe(true);
    }
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
  it('a dialog off the window is no overlay — a closed drawer slid out by a transform', () => {
    const off = { top: 0, left: 1280, width: 480, height: 800 };
    expect(overlayByFacts({ ...base, role: 'dialog', position: 'fixed', rect: off })).toBe(false);
    expect(overlayByFacts({ ...base, ariaModal: 'true', position: 'fixed', rect: off })).toBe(false);
    expect(overlayByFacts({ ...base, openDialog: true, position: 'fixed', rect: off })).toBe(false);
    // One pixel on the window is enough for a dialog.
    expect(overlayByFacts({ ...base, role: 'dialog', position: 'fixed', rect: { ...off, left: 1279 } })).toBe(true);
  });
  it('the page itself is never an overlay — an app shell (plan departure 1)', () => {
    expect(overlayByFacts({ ...base, position: 'fixed', holdsPage: true })).toBe(false);
    expect(overlayByFacts({ ...base, className: 'modal', position: 'fixed', holdsPage: true })).toBe(false);
  });
  it('a dialog is the page only when it holds most of the page\'s text', () => {
    // For a dialog the page sets holdsPage from mostOfText, not from the main/h1 rule: a dialog
    // holding an h1 ("10% off") is a promo; one wrapping the whole app is the page.
    expect(overlayByFacts({ ...base, role: 'dialog', holdsPage: true })).toBe(false);
    expect(overlayByFacts({ ...base, ariaModal: 'true', holdsPage: true })).toBe(false);
    expect(overlayByFacts({ ...base, role: 'dialog', holdsPage: false })).toBe(true);
  });
  it('mostOfText is 60 % or more of a non-empty page', () => {
    expect(mostOfText(60, 100)).toBe(true);
    expect(mostOfText(100, 100)).toBe(true);
    expect(mostOfText(59, 100)).toBe(false);
    expect(mostOfText(0, 0)).toBe(false);
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
    // Only an open <dialog> is dialog-like; a closed one is not a layer.
    expect(s).toContain('const DIALOG_LIKE = "[role=\\"dialog\\"], [role=\\"alertdialog\\"], [aria-modal=\\"true\\"], dialog[open]";');
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

describe('opensLayer — aria-haspopup that means a layer (§3.2.1)', () => {
  it('dialog, true, menu, listbox, grid and tree open a layer', () => {
    for (const v of ['dialog', 'true', 'menu', 'listbox', 'grid', 'tree', ' Dialog ']) expect(opensLayer(v), v).toBe(true);
  });
  it('false, empty or absent does not', () => {
    for (const v of ['false', '', null]) expect(opensLayer(v), String(v)).toBe(false);
  });
});

describe('isDialogLikeFacts — an aria-controls target that is a layer (§3.2.2)', () => {
  const panel: ControlledFacts = { tag: 'DIV', id: 'acc-panel', className: 'accordion__panel', role: 'region', ariaModal: null, position: 'static' };
  it('a plain panel is not', () => {
    expect(isDialogLikeFacts(panel)).toBe(false);
  });
  it('a dialog role, aria-modal or <dialog> is — kith\'s size drawer', () => {
    expect(isDialogLikeFacts({ ...panel, role: 'dialog' })).toBe(true);
    expect(isDialogLikeFacts({ ...panel, role: 'alertdialog' })).toBe(true);
    expect(isDialogLikeFacts({ ...panel, ariaModal: 'true' })).toBe(true);
    expect(isDialogLikeFacts({ ...panel, tag: 'DIALOG' })).toBe(true);
  });
  it('a tag, id or class naming a modal, drawer, lightbox or popup is', () => {
    expect(isDialogLikeFacts({ ...panel, tag: 'S-DRAWER' })).toBe(true);
    expect(isDialogLikeFacts({ ...panel, id: 'ProductSizeDrawer' })).toBe(true);
    expect(isDialogLikeFacts({ ...panel, className: 'fit-modal' })).toBe(true);
    expect(isDialogLikeFacts({ ...panel, className: 'zoom-lightbox' })).toBe(true);
    expect(isDialogLikeFacts({ ...panel, id: 'popup-1' })).toBe(true);
  });
  it('a fixed target is', () => {
    expect(isDialogLikeFacts({ ...panel, position: 'fixed' })).toBe(true);
  });
});

describe('DISMISS_STEPS — today\'s list, whole names instead of substrings (§3.3.1)', () => {
  it('has no substring text selector left', () => {
    for (const s of DISMISS_STEPS) if ('css' in s) expect(s.css).not.toMatch(/:has-text|:text/);
  });
  it('stores names case-folded, and lists "OK, got it" by its whole name', () => {
    for (const s of DISMISS_STEPS) if ('name' in s) expect(s.name).toBe(normName(s.name));
    expect(DISMISS_STEPS).toContainEqual({ name: 'ok, got it' });
    expect(DISMISS_STEPS).toContainEqual({ name: 'ok' });
  });
  it('keeps today\'s order: the consent managers before the generic close controls', () => {
    const onetrust = DISMISS_STEPS.findIndex((s) => 'css' in s && s.css === '#onetrust-accept-btn-handler');
    const close = DISMISS_STEPS.findIndex((s) => 'name' in s && s.name === 'close');
    const ariaClose = DISMISS_STEPS.findIndex((s) => 'css' in s && s.css === '[aria-label="Close"]');
    expect(onetrust).toBeGreaterThanOrEqual(0);
    expect(onetrust).toBeLessThan(close);
    expect(close).toBeLessThan(ariaClose);
  });
});
