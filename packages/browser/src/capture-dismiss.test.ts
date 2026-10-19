// Spec 2026-10-19 §3.3: dismissal closes what the page put over the product without touching the
// page. Campaign 2's dismissal sites (ikea, skullcandy, lacoste, puma DE) as fixtures, plus the
// three inputs the plan's Review Focus names (app shell, fixed buy box, shadow-root consent).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from './playwright-browser.js';
import { fixturePage, pageState, serveHtml, TRACK_SCRIPT, type HtmlSite, type PageState } from './__fixtures__/overlay-pages.js';

const SWATCHES = `<div class="reviews"><button id="chip-look" class="chip">look</button></div>
  <div class="swatches"><button id="swatch-black" class="swatch" aria-pressed="true">Black</button><button id="swatch-rosy" class="swatch" aria-pressed="false">Rosy Outlook</button></div>`;
const SWATCH_SCRIPT = `document.querySelectorAll('.swatch').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.swatch').forEach((o) => o.setAttribute('aria-pressed', 'false'));
  b.setAttribute('aria-pressed', 'true');
}));`;

/** A product page has text; a dialog holding most of a page's text is the page, not an overlay. */
const PRODUCT_COPY = '<p>A brass table lamp with a linen shade, 45 cm tall, E27 bulb, dimmable, two-year warranty, free returns within 30 days.</p>';

const PAGES: Record<string, string> = {
  // ikea: "Cookie settings" sits first in the banner; only "OK" closes it.
  '/cookie-settings': fixturePage(SWATCHES,
    `<div id="cookie-banner" class="cookie-banner" style="position:fixed;left:0;right:0;bottom:0;height:120px;background:#fff;z-index:10">
       <button id="cookie-settings">Cookie settings</button> <button id="cookie-ok">OK</button></div>
     <div id="prefs" role="dialog" style="display:none;position:fixed;inset:10%;background:#fff;z-index:20">Preference centre</div>`,
    `${SWATCH_SCRIPT}
     document.getElementById('cookie-settings').addEventListener('click', () => openLayer('prefs'));
     document.getElementById('cookie-ok').addEventListener('click', () => document.getElementById('cookie-banner').remove());`),
  // skullcandy's "look", puma's "Rosy Outlook", and a real "OK" after them in the document.
  '/names': fixturePage(SWATCHES,
    `<div id="notice" style="position:fixed;left:0;right:0;bottom:0;height:100px;background:#fff">We use cookies. <button id="notice-ok">OK</button></div>`,
    `${SWATCH_SCRIPT}
     document.getElementById('notice-ok').addEventListener('click', () => document.getElementById('notice').remove());`),
  // lacoste: a promo bar whose close button never closes it, beside a consent modal no step names.
  // The bar sits above the backdrop (a real mouse click reaches it) at z-index 1000, which today's
  // `body > div` removal rule (z-index above 1000) leaves alone.
  '/promo-consent': fixturePage('',
    `<div id="promo" class="promo-bar" style="position:fixed;top:0;left:0;right:0;z-index:1000;background:#222;color:#fff;padding:8px">Free delivery <button id="promo-close" aria-label="Close">×</button></div>
     <div id="consent-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:900"></div>
     <div id="consent" role="dialog" aria-modal="true" style="position:fixed;top:200px;left:340px;width:600px;height:400px;z-index:950;background:#fff">
       <p>We use cookies</p><button id="consent-agree">Agree</button></div>`,
    `document.getElementById('consent-agree').addEventListener('click', () => { document.getElementById('consent').remove(); document.getElementById('consent-backdrop').remove(); });`),
  // puma DE: a location popup with no role, a fixed full-window box and a "Schließen" button.
  '/geo': fixturePage('',
    `<section id="geo" style="position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.4)">
       <div style="margin:200px auto;width:500px;background:#fff;padding:20px">Standort wählen <button id="geo-close"><span>Schließen</span></button></div></section>`,
    `document.getElementById('geo-close').addEventListener('click', () => document.getElementById('geo').remove());`),
  // skullcandy: the cookie bar's close sits under the modal's backdrop (a click lands on the
  // backdrop and changes nothing); the modal's own close has no name, only a class. The dead click
  // must not end the round: the modal is closed by its own button in the same round (the removal
  // pass would only hide it, so its absence from the DOM proves the click).
  '/backdrop-dead-close': fixturePage('',
    `<div id="cookiebar" style="position:fixed;left:0;right:0;bottom:0;height:80px;background:#eee;z-index:10">Cookies <button id="cookieclose" aria-label="Close">×</button></div>
     <div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:900"></div>
     <div id="sk-modal" role="dialog" style="position:fixed;top:200px;left:390px;width:500px;height:300px;z-index:950;background:#fff">
       We don't ship to Malaysia <button id="sk-close" class="modal-close" style="width:32px;height:32px"></button></div>`,
    `document.getElementById('cookieclose').addEventListener('click', () => { window.__flags.cookieClosed = true; });
     document.getElementById('sk-close').addEventListener('click', () => { document.getElementById('sk-modal').remove(); document.querySelector('[style*="rgba(0,0,0,.5)"]').remove(); });`),
  // A wrapper whose text reads "Close" (it holds the button) is not the control: its button is.
  '/close-wrapper': fixturePage('',
    `<div id="wrap-modal" role="dialog" style="position:fixed;top:200px;left:340px;width:600px;height:300px;z-index:50;background:#fff">
       <div id="close-wrap" aria-label="Close area" style="width:400px;height:60px"><button id="wrap-close">Close</button></div></div>`,
    `document.getElementById('wrap-close').addEventListener('click', () => document.getElementById('wrap-modal').remove());`),
  // A clean page, and the same page with seven off-canvas drawers (cart, menu, search, …) parked
  // off the window by a transform, each with a Close button. Nothing is over the product: no
  // click, and no time spent on dead clicks (§5.5).
  '/clean': fixturePage(''),
  '/drawers': fixturePage('', [1, 2, 3, 4, 5, 6, 7].map((i) =>
    `<div id="drawer-${i}" style="position:fixed;top:0;right:0;width:400px;height:100%;transform:translateX(100%);background:#fff;z-index:60">Drawer ${i} <button id="drawer-close-${i}" aria-label="Close">×</button></div>`).join('')),
  // Review Focus 1: the whole page in a fixed full-window container.
  '/app-shell': `<!doctype html><html><head><meta charset="utf-8"><title>Lamp</title></head><body style="margin:0">
    <div id="shell" style="position:fixed;inset:0;overflow:auto"><main id="product"><h1>Lamp</h1><p id="price">PRICE_40</p><div style="height:3000px"></div></main></div>
    <script>${TRACK_SCRIPT}</script></body></html>`,
  // Review Focus 2: a fixed buy box covering a third of the window, holding the price.
  '/buy-box': fixturePage('<div id="gallery" style="height:1600px;background:#eee">Gallery</div>',
    `<aside id="buybox" style="position:fixed;top:0;right:0;width:420px;height:800px;background:#fff"><p>PRICE_EUR_129</p><button id="add">Add to bag</button></aside>`),
  // Final review I2: a fixed buy box in a column whose space the page reserves, holding the title,
  // the price and a role=radio swatch, on a page whose first h1 is the header's logo. It sits on
  // top of nothing, so it is the page's own column, not an overlay: nothing hides it.
  '/buybox-logo-h1': `<!doctype html><html><head><meta charset="utf-8"><title>Lamp</title></head><body style="margin:0;font:16px sans-serif">
    <header style="height:80px;margin-right:420px"><h1 id="logo">ShopLogo</h1></header>
    <main id="product" style="margin-right:420px;min-height:2400px"><p>Gallery</p></main>
    <aside id="bb" style="position:fixed;top:0;right:0;width:420px;height:100vh;background:#fff">
      <div id="bb-title">BB_TITLE_LAMP</div><p id="bb-price">BB_PRICE_129</p>
      <div role="radiogroup" aria-label="Colour"><span id="bb-swatch" role="radio" aria-checked="true" style="display:inline-block;width:30px;height:30px;background:#c33">Red</span></div>
    </aside>
    <script>${TRACK_SCRIPT}</script></body></html>`,
  // Live check 2026-10-19, puma DE: the location popup is a fixed <section> of 384×374 at the
  // bottom right (14 % of the window, under §3.1's quarter), over the sizes. No role; an h1, a ×
  // button whose label "Schließen" is a span, a link-wrapped "switch shop" and two more buttons.
  '/small-geo': fixturePage(
    `<div style="display:flex"><div style="flex:1;height:1200px;background:#eee">Gallery</div>
       <div id="sizes" style="width:420px;height:1200px"><button id="size-42">42</button><button id="size-43">43</button></div></div>`,
    `<section id="small-geo" style="position:fixed;right:20px;bottom:20px;width:384px;height:374px;z-index:60;background:#fff;border:1px solid #ccc">
       <div><h1>Standort wählen</h1><button id="small-geo-close" type="button"><svg width="16" height="16" aria-hidden="true"><path d="M0 0L16 16"/></svg><span>Schließen</span></button></div>
       <p>Du befindest dich scheinbar in Malaysia.</p>
       <a href="/other-shop"><button id="small-geo-switch" type="button">Wechseln zu Malaysia</button></a>
       <button id="small-geo-stay" type="button">Bleiben Germany</button>
       <button id="small-geo-choose" type="button">Standort wählen</button></section>`,
    `document.getElementById('small-geo-close').addEventListener('click', () => document.getElementById('small-geo').remove());`),
  // Live check 2026-10-19, colourpop: a floating cookie banner of 384×144 (5 % of the window) in a
  // zero-height role=dialog wrapper; "Preferences" opens the preference centre, "Accept" (its
  // aria-label "allow cookies") closes it. Neither name was on the whole-name list.
  '/cookie-accept': fixturePage(SWATCHES,
    `<div id="cc-wrap" role="dialog" aria-label="cookieconsent" style="height:0">
       <div id="cc-window" class="cc-window cc-floating" style="position:fixed;left:441px;top:640px;width:384px;height:144px;z-index:2147483647;background:#fff">
         <span>This website uses cookies to ensure you get the best experience.</span>
         <button id="cc-prefs" aria-label="settings cookies">Preferences</button> <button id="cc-accept" aria-label="allow cookies">Accept</button></div></div>
     <div id="prefs" role="dialog" style="display:none;position:fixed;inset:10%;background:#fff;z-index:20">Preference centre</div>`,
    `${SWATCH_SCRIPT}
     document.getElementById('cc-prefs').addEventListener('click', () => openLayer('prefs'));
     document.getElementById('cc-accept').addEventListener('click', () => document.getElementById('cc-wrap').remove());`),
  // The same banner with no aria-label: the bare visible name "Accept".
  '/cookie-accept-bare': fixturePage('',
    `<div id="cc-window" class="cc-window" style="position:fixed;left:441px;top:640px;width:384px;height:144px;z-index:99;background:#fff">
       <span>We use cookies.</span> <button id="cc-prefs">Preferences</button> <button id="cc-accept">Accept</button></div>
     <div id="prefs" role="dialog" style="display:none;position:fixed;inset:10%;background:#fff;z-index:20">Preference centre</div>`,
    `document.getElementById('cc-prefs').addEventListener('click', () => openLayer('prefs'));
     document.getElementById('cc-accept').addEventListener('click', () => document.getElementById('cc-window').remove());`),
  // Live check 2026-10-19, kith: a welcome modal open on load (role=dialog, no close word, one
  // "Shop now" button) whose page adds body.modal-open, and the scrim is body::before. Hiding the
  // modal left the scrim over the whole first window; Escape closes it the page's own way.
  '/scrim-escape': fixturePage(PRODUCT_COPY,
    `<style>body.modal-open::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3}</style>
     <div id="mat" role="dialog" style="position:fixed;top:250px;left:350px;width:580px;height:300px;z-index:10;background:#fff">Welcome. We ship to you. <button id="mat-shop" type="button" aria-expanded="true" aria-controls="mat">Shop now</button></div>`,
    `document.body.classList.add('modal-open');
     document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; window.__flags.escaped = true; const m = document.getElementById('mat'); if (m) m.remove(); document.body.classList.remove('modal-open'); });`),
  // The same with no Escape handler: hiding the modal leaves the scrim, which is then not painted.
  '/scrim-stuck': fixturePage(PRODUCT_COPY,
    `<style>body.modal-open::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3}</style>
     <div id="mat" role="dialog" style="position:fixed;top:250px;left:350px;width:580px;height:300px;z-index:10;background:#fff">Welcome. We ship to you. <button id="mat-shop" type="button">Shop now</button></div>`,
    `document.body.classList.add('modal-open');`),
  // The welcome modal and its scrim over a cookie bar: the bar's OK sits under the scrim, so a click
  // on it lands on body until Escape has closed the modal (found by the live check's self-test).
  '/scrim-over-banner': fixturePage(PRODUCT_COPY,
    `<style>body.modal-open::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:3}</style>
     <div id="notice" style="position:fixed;left:0;right:0;bottom:0;height:100px;background:#fff">We use cookies. <button id="notice-ok">OK</button></div>
     <div id="mat" role="dialog" style="position:fixed;top:250px;left:350px;width:580px;height:300px;z-index:10;background:#fff">Welcome. We ship to you. <button id="mat-shop" type="button">Shop now</button></div>`,
    `document.body.classList.add('modal-open');
     document.getElementById('notice-ok').addEventListener('click', () => document.getElementById('notice').remove());
     document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; window.__flags.escaped = true; const m = document.getElementById('mat'); if (m) m.remove(); document.body.classList.remove('modal-open'); });`),
  // A page-wide decorative background drawn by body::before, behind the page: not a scrim.
  '/body-backdrop': fixturePage('',
    `<style>body::before{content:'';position:fixed;inset:0;background:rgba(240,230,220,.8);z-index:-1}</style>`),
  // Review round 1 (I1): the page's own "Accept" buttons are not consent. A bare "Accept" in the
  // flow, and form-submitting "Accept" / "Accept all" in the buy box: none is clicked, no form is sent.
  '/page-accept': fixturePage(
    `<div id="buy"><button id="terms-accept" type="button">Accept</button>
       <form action="/accepted" method="get"><input type="hidden" name="q" value="1"><button id="form-accept">Accept</button></form>
       <form action="/accepted-all" method="get"><button id="form-accept-all">Accept all</button></form></div>`),
  // Review round 1 (I2): after a consent modal is closed, an opaque body::before (a page background
  // at z-index 0) and a faint grain body::after are the page's own: both stay painted.
  '/opaque-pseudo': fixturePage(PRODUCT_COPY,
    `<style>body::before{content:'';position:fixed;inset:0;background:#fafafa;z-index:0;pointer-events:none}
       body::after{content:'';position:fixed;inset:0;opacity:.05;background-color:rgba(0,0,0,.5);background-image:linear-gradient(45deg,#000 25%,transparent 25%);pointer-events:none;z-index:1}</style>
     <div id="consent" role="dialog" style="position:fixed;top:200px;left:340px;width:600px;height:300px;z-index:50;background:#fff">We use cookies <button id="consent-accept">Accept all cookies</button></div>`,
    `document.getElementById('consent-accept').addEventListener('click', () => document.getElementById('consent').remove());`),
  // Review round 1 (I2): a translucent body::before with nothing closed in this capture is the
  // page's own look: left painted.
  '/scrim-alone': fixturePage(PRODUCT_COPY,
    `<style>body::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:3;pointer-events:none}</style>`),
  // Review round 1 (Minor 4): a consent dialog whose accept button has a consent name: clicked,
  // with no Escape first (the page may treat Escape as "reject").
  '/consent-no-escape': fixturePage(PRODUCT_COPY,
    `<div id="consent" role="dialog" style="position:fixed;top:200px;left:340px;width:600px;height:300px;z-index:50;background:#fff">We use cookies <button id="consent-accept">Accept all cookies</button></div>`,
    `document.getElementById('consent-accept').addEventListener('click', () => document.getElementById('consent').remove());
     document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__flags.escaped = true; });`),
  // Review Focus 3: a consent banner inside an open shadow root.
  '/shadow-consent': fixturePage('', `<div id="cmp-host"></div>`,
    `const root = document.getElementById('cmp-host').attachShadow({ mode: 'open' });
     root.innerHTML = '<div style="position:fixed;left:0;right:0;bottom:0;height:150px;background:#fff"><button id="accept">Accept all</button></div>';
     root.getElementById('accept').addEventListener('click', () => { window.__flags.accepted = true; document.getElementById('cmp-host').remove(); });`),
};

const IDS = ['cookie-banner', 'prefs', 'notice', 'promo', 'consent', 'consent-backdrop', 'geo', 'shell', 'buybox', 'cmp-host', 'sk-modal', 'wrap-modal', 'bb', 'bb-swatch',
  'small-geo', 'cc-window', 'mat'];

let browser: PlaywrightBrowser;
let site: HtmlSite;
beforeAll(async () => {
  site = await serveHtml(PAGES);
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await site?.close();
});

async function capture(path: string) {
  const c = await browser.capture(`${site.baseUrl}${path}`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1, annotate: pageState(IDS) });
  return { c, s: c.annotation as PageState };
}

describe('dismissal closes overlays without touching the page (spec 2026-10-19 §3.3)', () => {
  it('"Cookie settings" is never clicked; "OK" closes the banner; the swatch is untouched (ikea)', async () => {
    const { s } = await capture('/cookie-settings');
    expect(s.clicks).toEqual(['cookie-ok']);
    expect(s.opened).toEqual({});
    expect(s.exists['cookie-banner']).toBe(false);
    expect(s.pressed).toEqual({ 'swatch-black': 'true', 'swatch-rosy': 'false' });
  }, 60_000);

  it('"look" and "Rosy Outlook" are not "OK": only the real OK is clicked (skullcandy, puma)', async () => {
    const { s } = await capture('/names');
    expect(s.clicks).toEqual(['notice-ok']);
    expect(s.exists.notice).toBe(false);
    expect(s.pressed).toEqual({ 'swatch-black': 'true', 'swatch-rosy': 'false' });
  }, 60_000);

  it('a close button that changes nothing is clicked once; the removal pass still closes the consent (lacoste)', async () => {
    const { s } = await capture('/promo-consent');
    expect(s.clicks.filter((id) => id === 'promo-close')).toHaveLength(1);
    expect(s.shown.consent).toBe(false);
    expect(s.shown['consent-backdrop']).toBe(false);
    expect(s.shown.promo).toBe(true);
    expect(s.centre).toBe('product');
  }, 60_000);

  it('the topmost layer is closed by its own close word — "Schließen" (puma DE)', async () => {
    const { s } = await capture('/geo');
    expect(s.clicks).toContain('geo-close');
    expect(s.exists.geo).toBe(false);
    expect(s.centre).toBe('product');
  }, 60_000);

  it('a dead close under the backdrop does not end the round: the modal\'s own close follows (skullcandy)', async () => {
    const { s } = await capture('/backdrop-dead-close');
    expect(s.flags.cookieClosed).toBeUndefined();
    expect(s.clicks).toEqual(['sk-close']);
    expect(s.exists['sk-modal']).toBe(false);
    expect(s.centre).toBe('product');
  }, 60_000);

  it('a wrapper whose text is "Close" is not clicked; its button is', async () => {
    const { s } = await capture('/close-wrapper');
    expect(s.clicks).toEqual(['wrap-close']);
    expect(s.exists['wrap-modal']).toBe(false);
  }, 60_000);

  it('off-canvas drawers are not candidates: no click, and no time spent (§5.5)', async () => {
    const timed = async (path: string) => {
      const t = Date.now();
      const r = await capture(path);
      return { ms: Date.now() - t, s: r.s };
    };
    // The faster of two runs each, so one slow capture does not decide it.
    const clean = Math.min((await timed('/clean')).ms, (await timed('/clean')).ms);
    const a = await timed('/drawers');
    const b = await timed('/drawers');
    expect(a.s.clicks).toEqual([]);
    expect(b.s.clicks).toEqual([]);
    expect(Math.min(a.ms, b.ms) - clean).toBeLessThan(500);
  }, 120_000);

  it('an app shell is the page, not an overlay: nothing is hidden (Review Focus 1)', async () => {
    const { c, s } = await capture('/app-shell');
    expect(s.shown.shell).toBe(true);
    expect(c.html).toContain('PRICE_40');
  }, 60_000);

  it('a fixed buy box is hidden from the screenshot but its price stays in the HTML (Review Focus 2)', async () => {
    const { c, s } = await capture('/buy-box');
    expect(s.shown.buybox).toBe(false);
    expect(c.html).toContain('PRICE_EUR_129');
  }, 60_000);

  it('a fixed buy box in a column the page reserves is not an overlay, even when the first h1 is the logo (final review I2)', async () => {
    const { s } = await capture('/buybox-logo-h1');
    expect(s.shown.bb).toBe(true);
    expect(s.shown['bb-swatch']).toBe(true); // the box map and the variant read still see it
    expect(s.clicks).toEqual([]);
  }, 60_000);

  it('a location popup smaller than a quarter of the window is closed by its own × — nothing else in it is clicked (puma DE, live check)', async () => {
    const { s } = await capture('/small-geo');
    expect(s.clicks).toEqual(['small-geo-close']);
    expect(s.exists['small-geo']).toBe(false);
    expect(site.requested).not.toContain('/other-shop');
  }, 60_000);

  it('a floating cookie banner\'s "Accept" is clicked, its "Preferences" never (colourpop, live check)', async () => {
    const { s } = await capture('/cookie-accept');
    expect(s.clicks).toEqual(['cc-accept']);
    expect(s.opened).toEqual({});
    expect(s.exists['cc-window']).toBe(false);
    expect(s.pressed).toEqual({ 'swatch-black': 'true', 'swatch-rosy': 'false' });
  }, 60_000);

  it('a bare visible "Accept" is a whole accept name too', async () => {
    const { s } = await capture('/cookie-accept-bare');
    expect(s.clicks).toEqual(['cc-accept']);
    expect(s.opened).toEqual({});
    expect(s.exists['cc-window']).toBe(false);
  }, 60_000);

  it('a modal with no close word is closed with Escape, so the page takes its scrim away too (kith, live check)', async () => {
    const { s } = await capture('/scrim-escape');
    expect(s.flags.escaped).toBe(true);
    expect(s.exists.mat).toBe(false);
    expect(s.pseudoPainted).toBe(false);
    expect(s.centre).toBe('product');
  }, 60_000);

  it('when Escape does not close it, the modal is hidden and the scrim its page drew on body is not painted', async () => {
    const { s } = await capture('/scrim-stuck');
    expect(s.shown.mat).toBe(false);
    expect(s.pseudoPainted).toBe(false);
    expect(s.centre).toBe('product');
  }, 60_000);

  it('Escape comes before a page-wide click when the topmost overlay has no close: the banner under its scrim is then accepted', async () => {
    const { s } = await capture('/scrim-over-banner');
    expect(s.flags.escaped).toBe(true);
    expect(s.clicks).toEqual(['notice-ok']);
    expect(s.exists.notice).toBe(false);
    expect(s.pseudoPainted).toBe(false);
  }, 60_000);

  it('a decorative body::before behind the page is left alone', async () => {
    const { s } = await capture('/body-backdrop');
    expect(s.pseudoPainted).toBe(true);
    expect(s.clicks).toEqual([]);
  }, 60_000);

  it('the page\'s own "Accept" buttons are never clicked and no form is sent (review I1)', async () => {
    const { s } = await capture('/page-accept');
    expect(s.clicks).toEqual([]);
    expect(site.requested).not.toContain('/accepted');
    expect(site.requested).not.toContain('/accepted-all');
  }, 60_000);

  it('an opaque body::before and a faint grain body::after stay painted after a consent closes (review I2)', async () => {
    const { s } = await capture('/opaque-pseudo');
    expect(s.clicks).toEqual(['consent-accept']);
    expect(s.pseudo['body::before']).toBe(true);
    expect(s.pseudo['body::after']).toBe(true);
  }, 60_000);

  it('a translucent body::before is left alone when nothing was closed (review I2)', async () => {
    const { s } = await capture('/scrim-alone');
    expect(s.pseudo['body::before']).toBe(true);
  }, 60_000);

  it('a consent dialog with an accept name is clicked without an Escape first (review minor 4)', async () => {
    const { s } = await capture('/consent-no-escape');
    expect(s.clicks).toEqual(['consent-accept']);
    expect(s.flags.escaped).toBeUndefined();
  }, 60_000);

  it('the mouse rests at the window\'s corner for the screenshot, not on what dismissal clicked (review minor 1)', async () => {
    const { s } = await capture('/consent-no-escape');
    expect(s.mouse).toEqual([0, 0]);
  }, 60_000);

  it('a consent banner inside an open shadow root is still accepted (Review Focus 3)', async () => {
    const { s } = await capture('/shadow-consent');
    expect(s.flags.accepted).toBe(true);
    expect(s.exists['cmp-host']).toBe(false);
  }, 60_000);
});
