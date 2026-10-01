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

describe('buildVariantLinksScript — one normal form for links', () => {
  it('returns absolute, fragment-free hrefs, and two hrefs differing only by fragment are one link', async () => {
    const fragHtml = `<html><body>
      <div class="product-swatches" aria-label="Colour">
        <a href="/p/shoe?color=black#pdp">Black</a>
        <a href="/p/shoe?color=red#main">Red</a>
        <a href="/p/shoe?color=red">Red again</a>
        <a href="/p/shoe?color=white#pdp">White</a>
      </div>
    </body></html>`;
    const links = await browser.setContentEvaluate<VariantLinks[]>(fragHtml, buildVariantLinksScript('https://s.example/p/shoe?color=black'));
    expect(links).toHaveLength(1);
    expect(links[0]!.links.map((l) => l.href)).toEqual([
      'https://s.example/p/shoe?color=black',
      'https://s.example/p/shoe?color=red',
      'https://s.example/p/shoe?color=white',
    ]);
    expect(links[0]!.count).toBe(3);
  });
});

describe('buildVariantPickerScript', () => {
  it('finds the size picker', async () => {
    const pickers = await browser.setContentEvaluate<VariantPicker[]>(html, buildVariantPickerScript());
    expect(pickers).toEqual([{ axis: 'size', options: ['8', '9'] }]);
  });

  it('finds a select that is itself the matching control, in a plain div', async () => {
    const selectHtml = `<html><body>
      <div><label for="variant-size">Size</label><select id="variant-size"><option value="">Choose</option><option>S</option><option>M</option></select></div>
    </body></html>`;
    const pickers = await browser.setContentEvaluate<VariantPicker[]>(selectHtml, buildVariantPickerScript());
    expect(pickers).toEqual([{ axis: 'size', options: ['S', 'M'] }]);
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

  it('never mistakes a filter/facet/sort/refine/pagination/tabs control for a variant picker', async () => {
    const filterHtml = `<html><body>
      <div class="filter-options">
        <button>New</button>
        <button>Sale</button>
        <button>Clearance</button>
      </div>
    </body></html>`;
    const pickers = await browser.setContentEvaluate<VariantPicker[]>(filterHtml, buildVariantPickerScript());
    expect(pickers).toEqual([]);
  });

  it('does not exclude a control merely because its class contains one of those words as a substring (fix round 2)', async () => {
    const substringHtml = `<html><body>
      <div class="size-table">
        <a href="/p/shoe?size=8">8</a>
        <a href="/p/shoe?size=9">9</a>
      </div>
    </body></html>`;
    const links = await browser.setContentEvaluate<VariantLinks[]>(substringHtml, buildVariantLinksScript('https://s.example/p/shoe'));
    expect(links).toHaveLength(1);
    expect(links[0]!.links.map((l) => l.label)).toEqual(['8', '9']);
  });
});

describe('radio-group pickers (fix round 1, #1 and #2)', () => {
  it('reports every radio group in the control, with the axis from the shared name — never from an option\'s own label[for]', async () => {
    const radiosHtml = `<html><body>
      <fieldset class="variant-options">
        <div>
          <input type="radio" name="color" id="color-black"><label for="color-black">Black</label>
          <input type="radio" name="color" id="color-red"><label for="color-red">Red</label>
        </div>
        <div>
          <input type="radio" name="size" id="size-8"><label for="size-8">8</label>
          <input type="radio" name="size" id="size-9"><label for="size-9">9</label>
        </div>
      </fieldset>
    </body></html>`;
    const pickers = await browser.setContentEvaluate<VariantPicker[]>(radiosHtml, buildVariantPickerScript());
    expect(pickers).toEqual([
      { axis: 'color', options: ['Black', 'Red'] },
      { axis: 'size', options: ['8', '9'] },
    ]);
  });

  it('prefers a group-specific fieldset legend over the shared name', async () => {
    const radiosHtml = `<html><body>
      <div class="variant-options">
        <fieldset><legend>Colour</legend>
          <input type="radio" name="color" id="c-black"><label for="c-black">Black</label>
          <input type="radio" name="color" id="c-red"><label for="c-red">Red</label>
        </fieldset>
      </div>
    </body></html>`;
    const pickers = await browser.setContentEvaluate<VariantPicker[]>(radiosHtml, buildVariantPickerScript());
    expect(pickers).toEqual([{ axis: 'colour', options: ['Black', 'Red'] }]);
  });
});

describe('select placeholders (fix round 1, #3)', () => {
  it('drops a disabled placeholder option', async () => {
    const selectHtml = `<html><body>
      <div class="size-selector">
        <select><option disabled selected>Select Size</option><option>8</option><option>9</option></select>
      </div>
    </body></html>`;
    const pickers = await browser.setContentEvaluate<VariantPicker[]>(selectHtml, buildVariantPickerScript());
    expect(pickers).toEqual([{ axis: 'size', options: ['8', '9'] }]);
  });
});

describe('hidden duplicates (fix round 1, #4)', () => {
  it('skips a hidden swatch group and reports only its visible duplicate', async () => {
    const dupHtml = `<html><body>
      <div class="swatches mobile-only" style="visibility:hidden">
        <a href="/p?c=1">Black</a>
        <a href="/p?c=2">Red</a>
      </div>
      <div class="swatches desktop-only">
        <a href="/p?c=1">Black</a>
        <a href="/p?c=2">Red</a>
      </div>
    </body></html>`;
    const links = await browser.setContentEvaluate<VariantLinks[]>(dupHtml, buildVariantLinksScript('https://s.example/p'));
    expect(links).toHaveLength(1);
    expect(links[0]!.links.map((l) => l.label)).toEqual(['Black', 'Red']);
  });
});
