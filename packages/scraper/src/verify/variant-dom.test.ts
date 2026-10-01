import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { buildVariantLinksScript, buildVariantPickerScript, type VariantLinks, type VariantPicker } from './variant-dom.js';

let browser: PlaywrightBrowser;
beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

const html = `<html><body>
  <nav><a href="/c/chairs">Chairs</a><a href="/c/tables">Tables</a></nav>
  <div class="product-swatches" aria-label="Colour">
    <a href="/p/shoe?color=black"><img alt="Black"></a>
    <a href="/p/shoe?color=red" title="Red"></a>
    <a href="/p/shoe?color=white">White</a>
  </div>
  <div class="size-selector"><label for="sz">Size</label><select id="sz"><option value="">Choose</option><option>8</option><option>9</option></select></div>
  <section class="related-products"><div class="swatch"><a href="/p/other-1">A</a><a href="/p/other-2">B</a></div></section>
</body></html>`;

describe('buildVariantLinksScript', () => {
  it('finds the colour links, not the navigation or related products', async () => {
    const links = await browser.setContentEvaluate<VariantLinks[]>(html, buildVariantLinksScript('https://s.example/p/shoe?color=black'));
    expect(links).toHaveLength(1);
    expect(links[0]!.links.map((l) => l.label)).toEqual(['Black', 'Red', 'White']);
    expect(links[0]!.count).toBe(3);
  });
});

describe('buildVariantPickerScript', () => {
  it('finds the size picker', async () => {
    const pickers = await browser.setContentEvaluate<VariantPicker[]>(html, buildVariantPickerScript());
    expect(pickers).toEqual([{ axis: 'size', options: ['8', '9'] }]);
  });

  it('finds a button group as a picker, with the axis from the matching data-* value', async () => {
    const buttonsHtml = `<html><body>
      <div data-option="color">
        <button>Black</button>
        <button>Red</button>
        <button>White</button>
      </div>
    </body></html>`;
    const pickers = await browser.setContentEvaluate<VariantPicker[]>(buttonsHtml, buildVariantPickerScript());
    expect(pickers).toEqual([{ axis: 'color', options: ['Black', 'Red', 'White'] }]);
  });
});

describe('exclusion', () => {
  it('finds nothing — from either script — when every candidate control sits inside a footer', async () => {
    const footerHtml = `<html><body>
      <footer>
        <div class="product-swatches" aria-label="Colour">
          <a href="/p/shoe?color=black">Black</a>
          <a href="/p/shoe?color=red">Red</a>
        </div>
        <div class="size-selector"><select id="sz"><option>8</option><option>9</option></select></div>
      </footer>
    </body></html>`;
    const links = await browser.setContentEvaluate<VariantLinks[]>(footerHtml, buildVariantLinksScript('https://s.example/p/shoe'));
    const pickers = await browser.setContentEvaluate<VariantPicker[]>(footerHtml, buildVariantPickerScript());
    expect(links).toEqual([]);
    expect(pickers).toEqual([]);
  });
});
