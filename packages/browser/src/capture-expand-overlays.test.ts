// Spec 2026-10-19 §3.2: the expand pass reveals what belongs in the page and never leaves an
// overlay over it. The four expand-pass sites of campaign 2 (colourpop, mejuri, kith, thomann),
// mejuri's single-open accordion and the tabs that followed links (thomann, ikea), as fixtures.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from './playwright-browser.js';
import type { CaptureOptions } from './types.js';
import { fixturePage, pageState, serveHtml, type HtmlSite, type PageState } from './__fixtures__/overlay-pages.js';

const ZOOM_MODAL = `<modal-dialog id="zoom-modal" style="display:none;position:fixed;inset:0;z-index:100;background:#000;color:#fff">Zoomed image</modal-dialog>`;
const OPEN_ZOOM = `document.getElementById('zoom').addEventListener('click', () => { openLayer('zoom-modal'); document.body.style.overflow = 'hidden'; });`;

const PAGES: Record<string, string> = {
  // colourpop: a Zoom button that says nothing about the lightbox it opens; Escape closes it.
  '/zoom': fixturePage(`<button id="zoom" aria-expanded="false">Zoom</button>`, ZOOM_MODAL,
    `${OPEN_ZOOM}
     document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { shutLayer('zoom-modal'); document.body.style.overflow = ''; window.__flags.escaped = true; } });`),
  // The same lightbox, deaf to Escape: removed, and the scroll lock lifted.
  '/zoom-deaf': fixturePage(`<button id="zoom" aria-expanded="false">Zoom</button>`, ZOOM_MODAL, OPEN_ZOOM),
  // mejuri, thomann, kith: controls that declare the layer they open.
  '/dialog-triggers': fixturePage(
    `<button id="sg" aria-haspopup="dialog" aria-expanded="false">Size guide</button>
     <a id="warn" href="#" aria-haspopup="dialog" aria-expanded="false">Safety and warnings</a>
     <button id="drawer-btn" aria-expanded="false" aria-controls="size-drawer">View size guide</button>
     <button id="fit-btn" aria-expanded="false" aria-controls="fit-modal">Don't see your size?</button>`,
    `<div id="sg-dialog" role="dialog" style="display:none;position:fixed;inset:10%;background:#fff;z-index:50">Size guide</div>
     <s-drawer id="size-drawer" role="dialog" style="display:none;position:fixed;top:0;right:0;width:480px;height:100%;background:#fff;z-index:50">Drawer</s-drawer>
     <div id="fit-modal" class="fit-modal" style="display:none;position:fixed;inset:20%;background:#fff;z-index:50">Fit</div>`,
    `document.getElementById('sg').addEventListener('click', () => openLayer('sg-dialog'));
     document.getElementById('warn').addEventListener('click', (e) => { e.preventDefault(); openLayer('sg-dialog'); });
     document.getElementById('drawer-btn').addEventListener('click', () => openLayer('size-drawer'));
     document.getElementById('fit-btn').addEventListener('click', () => openLayer('fit-modal'));`),
  // What belongs in the page: an accordion panel, a <details>, tabs. Two tabs are links: another
  // page, and a PDF in a new tab. Neither is followed.
  '/accordion': fixturePage(
    `<button id="acc" aria-expanded="false" aria-controls="acc-panel">Materials</button>
     <div id="acc-panel" hidden>MATERIALS_TEXT</div>
     <details id="det"><summary>Care</summary>CARE_TEXT</details>
     <div role="tablist">
       <button role="tab" id="t1" aria-selected="true">Description</button>
       <button role="tab" id="t2" aria-selected="false">Specs</button>
       <a role="tab" id="t3" href="/service">Service</a>
       <a role="tab" id="t4" href="/files/manual.pdf" target="_blank">Manual</a>
     </div>`, '',
    `document.getElementById('acc').addEventListener('click', function () {
       const open = this.getAttribute('aria-expanded') !== 'true';
       this.setAttribute('aria-expanded', String(open));
       document.getElementById('acc-panel').hidden = !open;
     });`),
  // A tab that opens a video layer (the undo net covers the tabs step too: plan departure 3).
  '/tab-video': fixturePage(
    `<div role="tablist"><button role="tab" id="tv1" aria-selected="true">Overview</button><button role="tab" id="tv2">Video</button></div>`,
    `<div id="video-modal" style="display:none;position:fixed;inset:0;z-index:100;background:#000"></div>`,
    `document.getElementById('tv2').addEventListener('click', () => openLayer('video-modal'));`),
  // mejuri: a single-open accordion. Opening Materials closes Description.
  '/single-open': fixturePage(
    `<button id="desc-btn" class="acc" aria-expanded="true" aria-controls="desc">Description</button><div id="desc">DESCRIPTION_TEXT</div>
     <button id="mat-btn" class="acc" aria-expanded="false" aria-controls="mat">Materials &amp; Specifications</button><div id="mat" hidden>MATERIALS_TEXT</div>`, '',
    `document.querySelectorAll('.acc').forEach((b) => b.addEventListener('click', () => {
       const opening = b.getAttribute('aria-expanded') !== 'true';
       document.querySelectorAll('.acc').forEach((o) => { o.setAttribute('aria-expanded', 'false'); document.getElementById(o.getAttribute('aria-controls')).hidden = true; });
       if (opening) { b.setAttribute('aria-expanded', 'true'); document.getElementById(b.getAttribute('aria-controls')).hidden = false; }
     }));`),
  // Twelve tabs; the twelfth opens a layer. Only ten are clicked, so every click lands before the
  // undo check (review fix: staggered clicks after the wait escaped the undo).
  '/many-tabs': fixturePage(
    `<div role="tablist">${Array.from({ length: 12 }, (_, i) => `<button role="tab" id="mt${i + 1}">Tab ${i + 1}</button>`).join('')}</div>`,
    `<div id="tab12-layer" style="display:none;position:fixed;inset:0;z-index:100;background:#000"></div>`,
    `document.getElementById('mt12').addEventListener('click', () => openLayer('tab12-layer'));`),
  // Swatches built as [data-tab] buttons in a radiogroup: the tabs step must not pick a variant (§5.1).
  '/swatch-tabs': fixturePage(
    `<div role="radiogroup" aria-label="Colour">
       <button data-tab="red" id="sw-red" aria-checked="true">Red</button>
       <button data-tab="blue" id="sw-blue" aria-checked="false">Blue</button>
     </div>
     <div role="tablist"><button role="tab" id="real-tab">Specs</button></div>`, '',
    `window.__flags.selected = 'sw-red';
     document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { window.__flags.selected = b.id; }));`),
  // Ten layer triggers before a real accordion: the eleventh control is still reached.
  '/eleventh': fixturePage(
    `${Array.from({ length: 10 }, (_, i) => `<button id="d${i + 1}" aria-haspopup="dialog" aria-expanded="false">Guide ${i + 1}</button>`).join('')}
     <button id="acc11" aria-expanded="false" aria-controls="p11">Materials</button><div id="p11" hidden>P11_TEXT</div>`, '',
    `document.getElementById('acc11').addEventListener('click', () => { document.getElementById('p11').hidden = false; });`),
  // A swatch that is also a disclosure (aria-expanded) in a radiogroup: the expand rounds must not
  // pick it either (§5.1 applies to the whole capture); the accordion beside it is still opened.
  '/swatch-expand': fixturePage(
    `<div role="radiogroup" aria-label="Colour">
       <button id="swx-red" aria-expanded="false">Red</button>
       <button id="swx-more" aria-expanded="false">Show more</button>
     </div>
     <button id="accx" aria-expanded="false" aria-controls="px">Materials</button><div id="px" hidden>PX_TEXT</div>`, '',
    `window.__flags.selected = 'none';
     document.querySelectorAll('[role=radiogroup] button').forEach((b) => b.addEventListener('click', () => { window.__flags.selected = b.id; }));
     document.getElementById('accx').addEventListener('click', () => { document.getElementById('px').hidden = false; });`),
  // A page-wide <form><fieldset> holding both the swatches and, five levels down, a specs
  // accordion: only a group within three ancestors makes a control a variant choice.
  '/fieldset-page': fixturePage(
    `<form><fieldset>
       <div role="radiogroup" aria-label="Size"><button type="button" id="fsw-s" aria-expanded="false">S</button><button type="button" id="fsw-m" aria-expanded="false">M</button></div>
       <div><div><div><div><div>
         <button type="button" id="spec-acc" aria-expanded="false" aria-controls="spec-p">Specifications</button><div id="spec-p" hidden>SPEC_TEXT</div>
       </div></div></div></div></div>
     </fieldset></form>`, '',
    `window.__flags.selected = 'none';
     document.querySelectorAll('[role=radiogroup] button').forEach((b) => b.addEventListener('click', () => { window.__flags.selected = b.id; }));
     document.getElementById('spec-acc').addEventListener('click', () => { document.getElementById('spec-p').hidden = false; });`),
  // A listing with category tabs: crawl() expands page 1 but never clicks a tab (controller ruling).
  '/listing-tabs': fixturePage(
    `<button id="lacc" aria-expanded="false" aria-controls="lpanel">Filters</button><div id="lpanel" hidden>F</div>
     <div role="tablist"><button role="tab" id="cat1" aria-selected="true">All</button><button role="tab" id="cat2">Sale</button></div>`),
};

const IDS = ['zoom-modal', 'sg-dialog', 'size-drawer', 'fit-modal', 'acc-panel', 'video-modal', 'mat', 'desc', 'tab12-layer', 'p11', 'px', 'spec-p'];

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

/** The tabs step is off by default (final review I3); its own tests turn it on. */
const TABS: CaptureOptions = { expandTabs: true };

async function capture(path: string, options: CaptureOptions = {}) {
  const c = await browser.capture(`${site.baseUrl}${path}`, { waitUntil: 'load', interceptNetworkRequests: false, maxTiles: 1, annotate: pageState(IDS), ...options });
  return { c, s: c.annotation as PageState };
}

describe('the expand pass never leaves an overlay over the product (spec 2026-10-19 §3.2)', () => {
  it('a Zoom button that opened a lightbox is undone with Escape, and is clicked once (colourpop)', async () => {
    const { s } = await capture('/zoom');
    expect(s.opened['zoom-modal']).toBe(1);
    expect(s.flags.escaped).toBe(true);
    expect(s.shown['zoom-modal']).toBe(false);
    expect(s.centre).toBe('product');
    expect(s.clicks.filter((id) => id === 'zoom')).toHaveLength(1);
  }, 60_000);

  it('a lightbox deaf to Escape is removed, and the scroll lock lifted', async () => {
    const { s } = await capture('/zoom-deaf');
    expect(s.opened['zoom-modal']).toBe(1);
    expect(s.exists['zoom-modal']).toBe(false);
    expect(s.bodyOverflowY).not.toBe('hidden');
    expect(s.centre).toBe('product');
  }, 60_000);

  it('controls that declare a layer are never clicked (mejuri, thomann, kith)', async () => {
    const { s } = await capture('/dialog-triggers');
    expect(s.opened).toEqual({});
    for (const id of ['sg', 'warn', 'drawer-btn', 'fit-btn']) expect(s.clicks).not.toContain(id);
    expect(s.centre).toBe('product');
  }, 60_000);

  it('an accordion panel, a <details> and the tabs are still expanded; no tab that is a link is followed', async () => {
    const { c, s } = await capture('/accordion', TABS);
    expect(s.shown['acc-panel']).toBe(true);
    expect(c.html).toContain('MATERIALS_TEXT');
    expect(s.detailsOpen.det).toBe(true);
    expect(s.clicks).toContain('t2');
    expect(s.clicks).not.toContain('t3');
    expect(s.clicks).not.toContain('t4');
    expect(site.requested).not.toContain('/service');
    expect(site.requested).not.toContain('/files/manual.pdf');
    expect(new URL(c.url).pathname).toBe('/accordion');
  }, 60_000);

  it('a tab that opened a layer is undone', async () => {
    const { s } = await capture('/tab-video', TABS);
    expect(s.clicks).toContain('tv2');
    expect(s.opened['video-modal']).toBe(1);
    expect(s.shown['video-modal']).toBe(false);
    expect(s.centre).toBe('product');
  }, 60_000);

  it('a single-open accordion ends with the panel it opened still open (mejuri)', async () => {
    const { s } = await capture('/single-open');
    expect(s.shown.mat).toBe(true);
    expect(s.clicks.filter((id) => id === 'mat-btn')).toHaveLength(1);
    expect(s.clicks).not.toContain('desc-btn');
  }, 60_000);

  it('at most ten tabs are clicked, so a late tab cannot open a layer after the undo check', async () => {
    const { s } = await capture('/many-tabs', TABS);
    expect(s.clicks.filter((id) => /^mt\d+$/.test(id))).toHaveLength(10);
    expect(s.clicks).not.toContain('mt12');
    expect(s.opened['tab12-layer']).toBeUndefined();
    expect(s.shown['tab12-layer']).toBe(false);
    expect(s.centre).toBe('product');
  }, 60_000);

  it('the tabs step never clicks a variant choice — a [data-tab] swatch in a radiogroup (§5.1)', async () => {
    const { s } = await capture('/swatch-tabs', TABS);
    expect(s.clicks).not.toContain('sw-red');
    expect(s.clicks).not.toContain('sw-blue');
    expect(s.flags.selected).toBe('sw-red');
    expect(s.clicks).toContain('real-tab');
  }, 60_000);

  it('a real accordion after ten skipped controls is still reached', async () => {
    const { s } = await capture('/eleventh');
    for (let i = 1; i <= 10; i++) expect(s.clicks).not.toContain(`d${i}`);
    expect(s.shown.p11).toBe(true);
  }, 60_000);

  it('the expand rounds never click a variant choice either — a disclosure swatch in a radiogroup (§5.1)', async () => {
    const { s } = await capture('/swatch-expand');
    expect(s.clicks).not.toContain('swx-red');
    expect(s.clicks).not.toContain('swx-more');
    expect(s.flags.selected).toBe('none');
    expect(s.shown.px).toBe(true);
  }, 60_000);

  it('an accordion deep inside a page-wide fieldset still opens; the swatches beside it are not clicked', async () => {
    const { s } = await capture('/fieldset-page');
    expect(s.shown['spec-p']).toBe(true);
    expect(s.clicks).toContain('spec-acc');
    expect(s.clicks).not.toContain('fsw-s');
    expect(s.clicks).not.toContain('fsw-m');
    expect(s.flags.selected).toBe('none');
  }, 60_000);
});

describe('the tabs step is off unless asked for (final review I3, controller ruling)', () => {
  it('a plain capture opens the accordion and the <details> but clicks no tab', async () => {
    const { s } = await capture('/accordion');
    expect(s.shown['acc-panel']).toBe(true);
    expect(s.detailsOpen.det).toBe(true);
    expect(s.clicks).not.toContain('t1');
    expect(s.clicks).not.toContain('t2');
  }, 60_000);
});

describe('crawl() expands listing page 1 but never clicks its tabs (controller ruling)', () => {
  it('the accordion is clicked, the category tab is not', async () => {
    const pages = [];
    for await (const p of browser.crawl(`${site.baseUrl}/listing-tabs`, {
      maxPages: 1,
      extractionScript: '({ data: [{ clicks: (window.__clicks || []).join(",") }], totalRows: 1 })',
    })) pages.push(p);
    expect(pages).toHaveLength(1);
    const clicks = String(pages[0].data[0].clicks).split(',');
    expect(clicks).toContain('lacc');
    expect(clicks).not.toContain('cat2');
    expect(clicks).not.toContain('cat1');
  }, 60_000);
});
