// The overlay definition (spec 2026-10-19 §3.1) and the never-click rules (§3.3.2), on a real DOM.
// setContentEvaluate injects HTML offline (no server, no network) at a 1280×800 window.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from './playwright-browser.js';
import { CENTRE_OVERLAY_SCRIPT, LIST_OVERLAYS_SCRIPT, TOPMOST_OVERLAY_SCRIPT, pageScript, type OverlayDescription } from './overlays.js';

let browser: PlaywrightBrowser;
beforeAll(async () => {
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const ids = (list: OverlayDescription[]) => list.map((d) => d.id).sort();

/** A product page has text; a dialog holding most of a page's text is the page (round 2). */
const PRODUCT_TEXT = 'A brass table lamp with a linen shade, 45 cm tall, E27 bulb, dimmable, two-year warranty, free returns within 30 days.';

const MIXED = `<!doctype html><html><body style="margin:0">
<header id="site-header" style="position:fixed;top:0;left:0;right:0;height:80px;background:#fff">Shop</header>
<div id="promo" style="position:fixed;left:0;right:0;bottom:0;height:150px;background:#eee">Free delivery</div>
<main id="product" style="min-height:2400px"><h1>Widget</h1></main>
<div id="consent" role="dialog" style="position:fixed;left:20px;bottom:20px;width:300px;height:120px;background:#fff">Cookies</div>
<div id="hidden-dialog" role="dialog" style="display:none">Hidden</div>
<div id="clear-dialog" role="dialog" style="position:fixed;inset:0;opacity:0">Faded</div>
<section id="geo" style="position:fixed;inset:0;background:rgba(0,0,0,.4)"><div style="margin:200px auto;width:400px;background:#fff">Choose location</div></section>
<div id="static-modal" class="modal" style="height:900px">Static</div>
<div id="abs-lightbox" class="lightbox" style="position:absolute;top:0;left:0;width:800px;height:500px">Lightbox</div>
<div id="abs-plain" style="position:absolute;top:0;left:0;width:1280px;height:800px;pointer-events:none"></div>
<div id="side-nav" role="navigation" style="position:fixed;top:0;left:0;width:400px;height:800px">Menu</div>
</body></html>`;

describe('the overlay definition in a real page (§3.1)', () => {
  it('lists dialogs, a fixed full-window box and a named absolute layer — not headers, footers, hidden or static boxes', async () => {
    const list = await browser.setContentEvaluate<OverlayDescription[]>(MIXED, LIST_OVERLAYS_SCRIPT);
    expect(ids(list)).toEqual(['abs-lightbox', 'consent', 'geo']);
    expect(list.find((d) => d.id === 'geo')).toEqual({ tag: 'section', id: 'geo', text: 'Choose location' });
  }, 30_000);

  it('a fixed full-window container holding the page is never an overlay (app shell)', async () => {
    const html = `<!doctype html><html><body style="margin:0"><div id="shell" style="position:fixed;inset:0;overflow:auto"><main><h1>Lamp</h1><div style="height:3000px"></div></main></div></body></html>`;
    expect(await browser.setContentEvaluate<OverlayDescription[]>(html, LIST_OVERLAYS_SCRIPT)).toEqual([]);
  }, 30_000);

  it('a fixed column whose space the page reserves is not an overlay; the same box over the page is (final review I2)', async () => {
    const page = (reserve: string) => `<!doctype html><html><body style="margin:0">
      <header style="height:80px;${reserve}"><h1>ShopLogo</h1></header>
      <main style="min-height:2400px;${reserve}"><div style="height:2000px;background:#eee">Gallery</div></main>
      <aside id="bb" style="position:fixed;top:0;right:0;width:420px;height:100vh;background:#fff"><p>Price</p></aside>
      </body></html>`;
    expect(await browser.setContentEvaluate<OverlayDescription[]>(page('margin-right:420px'), LIST_OVERLAYS_SCRIPT)).toEqual([]);
    expect(ids(await browser.setContentEvaluate<OverlayDescription[]>(page(''), LIST_OVERLAYS_SCRIPT))).toEqual(['bb']);
  }, 30_000);

  it('a buy box beside a full-width page wrapper is not an overlay — a sibling of #page, or #page reserving the column (round 2)', async () => {
    const aside = '<aside id="bb" style="position:fixed;top:0;right:0;width:420px;height:100vh;background:#fff"><p>Price</p></aside>';
    const sibling = `<!doctype html><html><body style="margin:0">
      <div id="page"><header style="height:80px;margin-right:420px"><h1>ShopLogo</h1></header>
      <main style="min-height:2400px;margin-right:420px"><p>Gallery</p></main></div>${aside}</body></html>`;
    const padded = `<!doctype html><html><body style="margin:0">
      <div id="page" style="padding-right:420px"><header style="height:80px"><h1>ShopLogo</h1></header>
      <main style="min-height:2400px"><p>Gallery</p></main></div>${aside}</body></html>`;
    const portal = `<!doctype html><html><body style="margin:0">
      <div id="root" style="padding-right:420px"><main style="min-height:2400px"><h1>Lamp</h1></main></div>
      <div id="portal">${aside}</div></body></html>`;
    for (const html of [sibling, padded, portal]) {
      expect(await browser.setContentEvaluate<OverlayDescription[]>(html, LIST_OVERLAYS_SCRIPT)).toEqual([]);
    }
  }, 30_000);

  it('finds an overlay inside an open shadow root', async () => {
    const html = `<!doctype html><html><body><main><h1>Widget</h1></main><div id="host"></div>
      <script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<div id="shadow-layer" style="position:fixed;inset:0;background:#000">Sign up</div>';</script></body></html>`;
    expect(ids(await browser.setContentEvaluate<OverlayDescription[]>(html, LIST_OVERLAYS_SCRIPT))).toEqual(['shadow-layer']);
  }, 30_000);

  it('a closed drawer slid off the window is no overlay and never the topmost', async () => {
    const html = `<!doctype html><html><body style="margin:0"><main style="min-height:2400px"><h1>Widget</h1></main>
      <div id="consent" role="dialog" style="position:fixed;left:20px;bottom:20px;width:300px;height:120px;z-index:5;background:#fff">Cookies</div>
      <div id="cart-drawer" role="dialog" aria-modal="true" style="position:fixed;top:0;right:0;width:420px;height:100vh;z-index:999;transform:translateX(100%);background:#fff">Your bag</div>
      </body></html>`;
    expect(ids(await browser.setContentEvaluate<OverlayDescription[]>(html, LIST_OVERLAYS_SCRIPT))).toEqual(['consent']);
    expect((await browser.setContentEvaluate<OverlayDescription | null>(html, TOPMOST_OVERLAY_SCRIPT))?.id).toBe('consent');
  }, 30_000);

  it('a full-window dialog before the product holding its own h1 is an overlay; the product still protects its shell', async () => {
    const html = `<!doctype html><html><body style="margin:0">
      <div id="promo" role="dialog" style="position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.5)"><h1>10% off</h1><button>Close</button></div>
      <div id="shell" style="position:fixed;inset:0;overflow:auto"><main><h1>Lamp</h1><p>${PRODUCT_TEXT}</p><div style="height:3000px"></div></main></div>
      </body></html>`;
    expect(ids(await browser.setContentEvaluate<OverlayDescription[]>(html, LIST_OVERLAYS_SCRIPT))).toEqual(['promo']);
    const only = `<!doctype html><html><body style="margin:0"><div style="height:3000px">Lamp. ${PRODUCT_TEXT}</div>
      <div id="promo" role="dialog" style="position:fixed;inset:0;background:#fff"><h1>10% off</h1></div></body></html>`;
    expect(ids(await browser.setContentEvaluate<OverlayDescription[]>(only, LIST_OVERLAYS_SCRIPT))).toEqual(['promo']);
  }, 30_000);

  it('a dialog wrapping the whole page is the page, not an overlay', async () => {
    const html = `<!doctype html><html><body style="margin:0">
      <div id="app" role="dialog" aria-modal="true" style="position:fixed;inset:0;overflow:auto"><main><h1>Lamp</h1><p>${PRODUCT_TEXT}</p><div style="height:3000px"></div></main></div>
      <div id="consent" role="dialog" style="position:fixed;left:20px;bottom:20px;width:300px;height:120px;z-index:5;background:#fff">Cookies</div>
      </body></html>`;
    expect(ids(await browser.setContentEvaluate<OverlayDescription[]>(html, LIST_OVERLAYS_SCRIPT))).toEqual(['consent']);
  }, 30_000);

  it('a dialog inside a faded-out ancestor is hidden', async () => {
    const html = `<!doctype html><html><body style="margin:0"><main><h1>Widget</h1></main>
      <div style="opacity:0"><div id="faded" role="dialog" style="position:fixed;inset:0;background:#fff">Sign up</div></div>
      <div id="shown" role="dialog" style="position:fixed;left:20px;bottom:20px;width:300px;height:120px;background:#fff">Cookies</div>
      </body></html>`;
    expect(ids(await browser.setContentEvaluate<OverlayDescription[]>(html, LIST_OVERLAYS_SCRIPT))).toEqual(['shown']);
  }, 30_000);
});

describe('the topmost and the centre overlay', () => {
  it('the topmost is the one hit at the centre; an outer wrapper wins over its dialog', async () => {
    const html = `<!doctype html><html><body style="margin:0"><main style="min-height:2400px"><h1>Widget</h1></main>
      <div id="low" style="position:fixed;inset:0;z-index:10;background:rgba(0,0,0,.3)"></div>
      <div id="wrap" class="modal-wrapper" style="position:fixed;inset:0;z-index:100"><div id="inner" role="dialog" style="width:600px;height:400px;margin:200px auto;background:#fff">Sign up</div></div>
      </body></html>`;
    expect((await browser.setContentEvaluate<OverlayDescription | null>(html, TOPMOST_OVERLAY_SCRIPT))?.id).toBe('wrap');
    expect((await browser.setContentEvaluate<OverlayDescription | null>(html, CENTRE_OVERLAY_SCRIPT))?.id).toBe('wrap');
  }, 30_000);

  it('failing the centre, the topmost is the overlay with the highest z-index; the centre has none', async () => {
    const html = `<!doctype html><html><body style="margin:0"><main style="min-height:2400px"><h1>Widget</h1></main>
      <div id="consent" role="dialog" style="position:fixed;left:20px;bottom:20px;width:300px;height:120px;z-index:5;background:#fff">Cookies</div>
      <div id="chat" role="dialog" style="position:fixed;right:20px;bottom:20px;width:300px;height:120px;z-index:50;background:#fff">Chat</div>
      </body></html>`;
    expect((await browser.setContentEvaluate<OverlayDescription | null>(html, TOPMOST_OVERLAY_SCRIPT))?.id).toBe('chat');
    expect(await browser.setContentEvaluate<OverlayDescription | null>(html, CENTRE_OVERLAY_SCRIPT)).toBeNull();
  }, 30_000);
});

describe('the never-click rules on live elements (§3.3.2)', () => {
  it('knows a variant control when it sees one', async () => {
    const html = `<!doctype html><html><body><main><h1>Shoe</h1>
      <button id="pressed" aria-pressed="false">Black</button>
      <button id="checked" role="radio" aria-checked="true">M</button>
      <div role="radiogroup"><span id="in-group">S</span></div>
      <fieldset><button id="in-fieldset">L</button></fieldset>
      <button id="swatch" class="product-swatch__item">Rosy Outlook</button>
      <button id="variant" class="variant-pill">Red</button>
      <input id="qty" type="number">
      <label id="size-label"><input type="radio" name="s">XL</label>
      <button id="tab" role="tab">Specs</button>
      <button id="ok">OK</button>
      <button id="look" class="chip">look</button>
      </main></body></html>`;
    const found = await browser.setContentEvaluate<string[]>(html, pageScript(
      "Array.from(document.querySelectorAll('main [id]')).filter((el) => isVariantControl(el)).map((el) => el.id)",
    ));
    expect(found.sort()).toEqual(['checked', 'in-fieldset', 'in-group', 'pressed', 'qty', 'size-label', 'swatch', 'tab', 'variant']);
  }, 30_000);

  it('never dismisses a page swatch, a settings control or a link away — a consent dialog\'s own toggle is fine', async () => {
    const html = `<!doctype html><html><body><main><h1>Shoe</h1>
      <button id="swatch" class="swatch">Rosy Outlook</button>
      <button id="settings">Cookie settings</button>
      <button id="manage">Manage preferences</button>
      <a id="away" href="/other-product">OK</a>
      <a id="hash" href="#">Close</a>
      <button id="ok">OK</button>
      </main>
      <div role="dialog" style="position:fixed;bottom:0;left:0;width:400px;height:200px;background:#fff">
        <button id="consent-toggle" aria-pressed="false">Analytics</button>
        <button id="consent-more">More info</button>
      </div></body></html>`;
    const found = await browser.setContentEvaluate<string[]>(html, pageScript(
      "Array.from(document.querySelectorAll('[id]')).filter((el) => neverDismiss(el)).map((el) => el.id)",
    ));
    expect(found.sort()).toEqual(['away', 'consent-more', 'manage', 'settings', 'swatch']);
  }, 30_000);

  it('a submit/button/reset/image input and a button-modifier class are not variant controls', async () => {
    const html = `<!doctype html><html><body><main><h1>Shoe</h1>
      <input id="submit" type="submit" value="OK">
      <input id="button" type="button" value="Close">
      <input id="reset" type="reset">
      <input id="image" type="image" alt="Close">
      <input id="text" type="text">
      <button id="modifier" class="btn btn--variant-primary">Accept</button>
      </main></body></html>`;
    const found = await browser.setContentEvaluate<string[]>(html, pageScript(
      "Array.from(document.querySelectorAll('main [id]')).filter((el) => isVariantControl(el)).map((el) => el.id)",
    ));
    expect(found).toEqual(['text']);
  }, 30_000);

  it('a button within three levels of a swatch container is a variant control, unless in an overlay', async () => {
    const html = `<!doctype html><html><body><main><h1>Shoe</h1>
      <div class="color-swatches"><ul><li><button id="in-swatch">Red</button></li></ul></div>
      <div class="Swatch-list"><button id="direct">Blue</button></div>
      <div class="swatches"><div><div><div><button id="too-deep">Green</button></div></div></div></div>
      </main>
      <div role="dialog" style="position:fixed;bottom:0;left:0;width:400px;height:200px;background:#fff">
        <div class="swatch-row"><button id="dialog-swatch">Accept</button></div>
      </div></body></html>`;
    const variant = await browser.setContentEvaluate<string[]>(html, pageScript(
      "Array.from(document.querySelectorAll('button[id]')).filter((el) => isVariantControl(el)).map((el) => el.id)",
    ));
    expect(variant.sort()).toEqual(['dialog-swatch', 'direct', 'in-swatch']);
    const never = await browser.setContentEvaluate<string[]>(html, pageScript(
      "Array.from(document.querySelectorAll('button[id]')).filter((el) => neverDismiss(el)).map((el) => el.id)",
    ));
    expect(never.sort()).toEqual(['direct', 'in-swatch']);
  }, 30_000);
});

describe('what the expand pass opened (round 2)', () => {
  it('a header toggle open on load and named "Close" is not refused when the expand pass never touched it', async () => {
    const html = `<!doctype html><html><body><header><button id="menu" aria-expanded="true" aria-label="Close">×</button></header>
      <main><h1>Shoe</h1></main></body></html>`;
    const found = await browser.setContentEvaluate<string[]>(html, pageScript(
      "Array.from(document.querySelectorAll('[id]')).filter((el) => neverDismiss(el)).map((el) => el.id)",
    ));
    expect(found).toEqual([]);
  }, 30_000);
});

describe('the __name shim', () => {
  it('lets a keepNames-wrapped function run in the page (the dev runtime\'s output)', async () => {
    const html = '<!doctype html><html><body></body></html>';
    expect(await browser.setContentEvaluate<number>(html, pageScript("__name(() => 42, 'f')()"))).toBe(42);
  }, 30_000);
});
