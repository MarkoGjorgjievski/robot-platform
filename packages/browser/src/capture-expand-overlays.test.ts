// Spec 2026-10-19 §3.2: the expand pass reveals what belongs in the page and never leaves an
// overlay over it. The four expand-pass sites of campaign 2 (colourpop, mejuri, kith, thomann),
// mejuri's single-open accordion and the tabs that followed links (thomann, ikea), as fixtures.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from './playwright-browser.js';
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
};

const IDS = ['zoom-modal', 'sg-dialog', 'size-drawer', 'fit-modal', 'acc-panel', 'video-modal', 'mat', 'desc'];

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
    const { c, s } = await capture('/accordion');
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
    const { s } = await capture('/tab-video');
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
});
