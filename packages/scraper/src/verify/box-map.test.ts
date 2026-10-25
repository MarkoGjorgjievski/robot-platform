import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { buildBoxMapScript, boxesFromAnnotation, type Box } from './box-map.js';
import { buildXPathProbeScript, type XPathProbeResult } from './dom-scripts.js';
import { suggestMarks } from './suggest-marks.js';
import { loadVerifyFixture } from '../__fixtures__/verify/load.js';

const HTML = `<html><body>
<div id="main">
  <h1 class="title">Widget A</h1>
  <div class="price-box"><span class="was">$149.00</span><span class="now">$129.99</span></div>
  <p class="stock">In <b>stock</b></p>
  <img class="hero" src="/img/a.jpg" alt="hero">
  <a class="buy" href="/checkout?p=1">Buy</a>
  <span class="hidden" style="display:none">secret</span>
  <script>var x = 'not text';</script>
</div>
</body></html>`;

let browser: PlaywrightBrowser;
beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

async function boxMap(html: string): Promise<Box[]> {
  return boxesFromAnnotation(await browser.setContentEvaluate<unknown>(html, buildBoxMapScript()));
}

describe('buildBoxMapScript', () => {
  it('records every visible element with text of its own (its whole text), plus images and links', async () => {
    const boxes = await boxMap(HTML);
    const byText = Object.fromEntries(boxes.map((b) => [b.text, b]));
    expect(byText['Widget A']).toMatchObject({ tag: 'h1', kind: 'text' });
    expect(byText['Widget A']!.xpaths[0]).toBe('//*[@id="main"]/h1[@class="title"]');            // nearest anchor first
    expect(byText['Widget A']!.xpaths.at(-1)).toMatch(/^\/\/body\//);                             // body-rooted last
    expect(byText['$129.99']!.xpaths[0]).toBe('//*[@id="main"]/div[@class="price-box"]/span[@class="now"]');
    // Whole text: the <p> holds "In stock", the <b> holds "stock".
    expect(byText['In stock']).toMatchObject({ tag: 'p' });
    expect(byText['stock']).toMatchObject({ tag: 'b' });
    expect(boxes.find((b) => b.kind === 'image')).toMatchObject({ tag: 'img', src: expect.stringMatching(/\/img\/a\.jpg$/) });
    expect(boxes.find((b) => b.kind === 'link')).toMatchObject({ tag: 'a', text: 'Buy', href: expect.stringMatching(/\/checkout\?p=1$/) });
    expect(boxes.some((b) => b.text === 'secret')).toBe(false);
    expect(boxes.some((b) => b.text.includes('not text'))).toBe(false);
  });

  it('rects are positive page-pixel boxes', async () => {
    const boxes = await boxMap(HTML);
    for (const b of boxes) {
      expect(b.rect.w).toBeGreaterThan(0);
      expect(b.rect.h).toBeGreaterThan(0);
      expect(b.rect.x).toBeGreaterThanOrEqual(0);
      expect(b.rect.y).toBeGreaterThanOrEqual(0);
    }
    const title = boxes.find((b) => b.text === 'Widget A')!;
    const price = boxes.find((b) => b.text === '$129.99')!;
    expect(price.rect.y).toBeGreaterThan(title.rect.y); // document order top to bottom
  });

  it('every xpath resolves back to an element with the same text', async () => {
    const boxes = await boxMap(HTML);
    const textBoxes = boxes.filter((b) => b.kind === 'text');
    const probe = await browser.setContentEvaluate<XPathProbeResult>(HTML, buildXPathProbeScript(textBoxes.flatMap((b) => b.xpaths)));
    for (const b of textBoxes) for (const xp of b.xpaths) expect(probe[xp]).toContain(b.text);
  });

  it('boxesFromAnnotation rejects anything that is not a box map', () => {
    expect(boxesFromAnnotation(undefined)).toEqual([]);
    expect(boxesFromAnnotation({ price: 1 })).toEqual([]);
    expect(boxesFromAnnotation([{ nope: true }])).toEqual([]);
  });
});

describe('suggestMarks over a real box map', () => {
  it('finds the shop-example price and title elements on p1', async () => {
    const p1 = loadVerifyFixture('shop-example', 'p1');
    const boxes = await boxMap(p1.html);
    const r = suggestMarks(p1, boxes, [
      { key: 'price', name: 'Price', type: 'money', description: '', concept: 'price' },
      { key: 'title', name: 'Title', type: 'text', description: '', concept: 'product_name' },
    ]);
    expect(r.price!.boxes.map((i) => boxes[i]!.text)).toEqual(['$129.99']);
    expect(r.title!.boxes.map((i) => boxes[i]!.text)).toEqual(['Widget A']);
    expect(boxes[r.price!.boxes[0]!]!.xpaths[0]).toBe('//*[@id="main"]/div[@class="price-box"]/span[@class="now"]');
  });
});

describe('box map text and images (spec 2026-10-17 §6)', () => {
  it('a paragraph with a link keeps the link\'s words; an image with a srcset reports its src', async () => {
    const boxes = await boxMap(`<html><body>
      <p class="d">Soft cotton, <a href="/care">machine washable</a>, made to last.</p>
      <img class="h" src="https://shop.example/img/a.jpg" srcset="https://shop.example/img/a-916.jpg?w=916 916w" sizes="916px" width="200" height="200">
    </body></html>`);
    expect(boxes.find((b) => b.tag === 'p')!.text).toBe('Soft cotton, machine washable, made to last.');
    expect(boxes.find((b) => b.kind === 'image')!.src).toMatch(/\/img\/a\.jpg$/);
  });

  it('a heading with no text of its own is a box, with its whole text (IKEA\'s h1, first run 2026-10-25)', async () => {
    // The real IKEA markup, trimmed: the h1's text is all in two spans and the space between them.
    const html = `<html><body><div class="pipcom-price-module__information"><h1 class="pipcom-text pipcom-typography-heading-s"><span class="pipcom-price-module__name-decorator notranslate">GLOSTAD</span> <span class="pipcom-text pipcom-typography-label-l pipcom-typography-regular pipcom-price-module__description">3-seat sofa, Knisa dark grey</span></h1></div>
      <div class="card"><div><span>no own text</span></div></div></body></html>`;
    const boxes = await boxMap(html);
    const h1 = boxes.find((b) => b.tag === 'h1');
    expect(h1).toMatchObject({ kind: 'text', text: 'GLOSTAD 3-seat sofa, Knisa dark grey' });
    expect(boxes.filter((b) => b.tag === 'span').map((b) => b.text)).toEqual(['GLOSTAD', '3-seat sofa, Knisa dark grey', 'no own text']);
    expect(boxes.some((b) => b.tag === 'div')).toBe(false); // other elements still need text of their own
    const probe = await browser.setContentEvaluate<XPathProbeResult>(html, buildXPathProbeScript(h1!.xpaths));
    for (const xp of h1!.xpaths) expect(probe[xp]).toContain('GLOSTAD 3-seat sofa, Knisa dark grey');
  });
});
