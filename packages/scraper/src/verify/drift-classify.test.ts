import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { classifyDrift, markFromXPath, type DriftCapture, type DriftDeps } from './drift-classify.js';
import { buildDomSearchScript, buildXPathProbeScript, type DomHit, type DomNeedle, type XPathProbeResult } from './dom-scripts.js';
import { buildBoxMapScript, type Box } from './box-map.js';
import { loadShopExample, SHOP_EXAMPLE_URLS as U } from '../__fixtures__/verify/load.js';
import type { CertifiedPath, SchemaDefinitionField } from './types.js';

const priceField: SchemaDefinitionField = { key: 'price', name: 'Price', type: 'money', description: 'green number', concept: 'price' };
const priceCertified: CertifiedPath[] = [{ source: 'json-ld', path: 'offers.price', transform: 'identity' }];
const priceExpected = { [U[0]!]: '129.99', [U[1]!]: '219.99', [U[2]!]: '149.00' };

let browser: PlaywrightBrowser;
beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); }, 60_000);
afterAll(async () => { await browser.close(); });

function deps(): DriftDeps {
  return {
    evalXPaths: (html: string, xpaths: string[]) => browser.setContentEvaluate<XPathProbeResult>(html, buildXPathProbeScript(xpaths)),
    runDomSearch: (html: string, needles: DomNeedle[], pageUrl: string) => browser.setContentEvaluate<DomHit[]>(html, buildDomSearchScript(needles, pageUrl)),
  };
}

async function boxesFor(html: string): Promise<Box[]> {
  return browser.setContentEvaluate<Box[]>(html, buildBoxMapScript());
}

/** Shop-example captures, narrowed to what classifyDrift needs. */
function baseCaptures(): Record<string, DriftCapture> {
  const loaded = loadShopExample();
  return Object.fromEntries(U.map((u) => [u, loaded[u]!]));
}

/** Strip every currently-correct source of `price` (json-ld, meta, api) from one capture, in place, leaving the DOM span untouched — the "nothing left but the DOM" starting point moved/changed/lost build on. */
function stripPriceSources(c: DriftCapture): DriftCapture {
  const ldJson = c.structuredData.ldJson.map((block) => {
    const b = block as Record<string, unknown>;
    const offers = { ...(b.offers as Record<string, unknown>) };
    delete offers.price;
    return { ...b, offers };
  });
  const meta = { ...c.structuredData.meta };
  delete meta['product:price:amount'];
  const interceptedRequests = c.interceptedRequests.map((r) => {
    if (!r.parsedJson) return r;
    const body = r.parsedJson as { item?: Record<string, unknown> };
    if (!body.item) return r;
    const item = { ...body.item };
    delete item.priceCents;
    return { ...r, parsedJson: { ...body, item } };
  });
  return { ...c, structuredData: { ...c.structuredData, ldJson, meta }, interceptedRequests };
}

describe('classifyDrift', () => {
  it('still working: unchanged captures → other-layout', async () => {
    const captures = baseCaptures();
    const r = await classifyDrift({ field: priceField, expected: priceExpected, certified: priceCertified, captures }, deps());
    expect(r.result).toBe('other-layout');
    expect(r.pages[U[0]!]).toEqual({ status: 'ok', value: '129.99' });
    expect(r.pages[U[1]!]).toEqual({ status: 'ok', value: '219.99' });
    expect(r.pages[U[2]!]).toEqual({ status: 'ok', value: '149.00' });
  }, 30_000);

  it('moved price: a new DOM location, nothing else carrying it → moved, with an XPath path and marks', async () => {
    const captures = baseCaptures();
    for (const u of U) {
      const stripped = stripPriceSources(captures[u]!);
      // Move the price out of the "now" span into a differently-classed element.
      const match = stripped.html.match(/<span class="now">(\$[\d.]+)<\/span>/);
      if (!match) throw new Error('fixture missing the "now" price span');
      const withoutOld = stripped.html.replace(match[0]!, '');
      const html = withoutOld.replace('<p class="stock">', `<div class="sale-price">${match[1]!}</div><p class="stock">`);
      expect(html).not.toBe(stripped.html);
      const boxes = await boxesFor(html);
      captures[u] = { ...stripped, html, boxes };
    }
    const r = await classifyDrift({ field: priceField, expected: priceExpected, certified: priceCertified, captures }, deps());
    expect(r.result).toBe('moved');
    expect(r.path?.source).toBe('xpath');
    for (const u of U) {
      const page = r.pages[u];
      expect(page.status).toBe('ok');
      if (page.status === 'ok') {
        expect(page.value).toBe(`$${priceExpected[u]}`); // the DOM's own raw text, as certify's `found` shows it
        expect(page.mark).toBeDefined();
        expect(page.mark?.xpaths).toContain(r.path!.path);
      }
    }
  }, 60_000);

  it('changed price: a new number on page 2, same place everywhere else → changed, with the old path and the new value', async () => {
    const captures = baseCaptures();
    const p2 = U[1]!;
    const c2 = captures[p2]!;
    const ldJson = c2.structuredData.ldJson.map((block) => {
      const b = block as Record<string, unknown>;
      return { ...b, offers: { ...(b.offers as Record<string, unknown>), price: '229.99' } };
    });
    const meta = { ...c2.structuredData.meta, 'product:price:amount': '229.99' };
    const interceptedRequests = c2.interceptedRequests.map((r) => {
      if (!r.parsedJson) return r;
      const body = r.parsedJson as { item?: Record<string, unknown> };
      if (!body.item) return r;
      return { ...r, parsedJson: { ...body, item: { ...body.item, priceCents: 22999 } } };
    });
    const html = c2.html.replace('$219.99', '$229.99');
    captures[p2] = { ...c2, html, structuredData: { ...c2.structuredData, ldJson, meta }, interceptedRequests };

    const r = await classifyDrift({ field: priceField, expected: priceExpected, certified: priceCertified, captures }, deps());
    expect(r.result).toBe('changed');
    expect(r.path).toEqual(priceCertified[0]);
    expect(r.pages[U[0]!]).toEqual({ status: 'ok', value: '129.99' });
    expect(r.pages[p2]).toEqual({ status: 'ok', value: '229.99' });
    expect(r.pages[U[2]!]).toEqual({ status: 'ok', value: '149.00' });
  }, 30_000);

  it('changed to a new key: price moved to offers.salePrice with new values on every page, the old key gone everywhere → changed', async () => {
    const captures = baseCaptures();
    const newPrices: Record<string, string> = { [U[0]!]: '139.99', [U[1]!]: '229.99', [U[2]!]: '159.00' };
    for (const u of U) {
      const stripped = stripPriceSources(captures[u]!);
      const html = stripped.html.replace(/<span class="now">\$[\d.]+<\/span>/, '');
      const ldJson = stripped.structuredData.ldJson.map((block) => {
        const b = block as Record<string, unknown>;
        return { ...b, offers: { ...(b.offers as Record<string, unknown>), salePrice: newPrices[u]! } };
      });
      captures[u] = { ...stripped, html, structuredData: { ...stripped.structuredData, ldJson } };
    }
    const r = await classifyDrift({ field: priceField, expected: priceExpected, certified: priceCertified, captures }, deps());
    expect(r.result).toBe('changed');
    expect(r.path).toEqual({ source: 'json-ld', path: 'offers.salePrice', transform: 'identity' });
    for (const u of U) expect(r.pages[u]).toEqual({ status: 'ok', value: newPrices[u] });
  }, 30_000);

  it('missing field: removed from data and DOM on every page → lost', async () => {
    const captures = baseCaptures();
    for (const u of U) {
      const stripped = stripPriceSources(captures[u]!);
      const html = stripped.html.replace(/<span class="now">\$[\d.]+<\/span>/, '');
      captures[u] = { ...stripped, html };
    }
    const r = await classifyDrift({ field: priceField, expected: priceExpected, certified: priceCertified, captures }, deps());
    expect(r.result).toBe('lost');
    for (const u of U) expect(r.pages[u]).toEqual({ status: 'ok', value: null });
  }, 30_000);

  it('page gone: page 3 null → page-gone for page 3, the others still deciding', async () => {
    const captures = baseCaptures();
    const withGone: Record<string, DriftCapture | null> = { ...captures, [U[2]!]: null };
    const r = await classifyDrift({ field: priceField, expected: priceExpected, certified: priceCertified, captures: withGone }, deps());
    expect(r.pages[U[2]!]).toEqual({ status: 'page-gone' });
    expect(r.result).toBe('other-layout');
    expect(r.pages[U[0]!]).toEqual({ status: 'ok', value: '129.99' });
    expect(r.pages[U[1]!]).toEqual({ status: 'ok', value: '219.99' });
  }, 30_000);

  it('Review Focus 4: a weak boolean field never calls a random same-everywhere value "moved"', async () => {
    const inStockField: SchemaDefinitionField = { key: 'in_stock', name: 'In stock', type: 'boolean', description: 'availability line', concept: 'availability' };
    const inStockCertified: CertifiedPath[] = [{ source: 'json-ld', path: 'offers.availability', transform: 'identity' }];
    // Same expected value everywhere, so only a concept-fitting/confirmed/marked path may certify it (qualifiesForWeak).
    const inStockExpected = { [U[0]!]: 'yes', [U[1]!]: 'yes', [U[2]!]: 'yes' };
    const captures = baseCaptures();
    for (const u of U) {
      const c = captures[u]!;
      const ldJson = c.structuredData.ldJson.map((block) => {
        const b = block as Record<string, unknown>;
        const offers = { ...(b.offers as Record<string, unknown>) };
        delete offers.availability;
        // An unrelated field that happens to be `true` everywhere — never a stand-in for availability.
        return { ...b, offers, featured: true };
      });
      captures[u] = { ...c, structuredData: { ...c.structuredData, ldJson } };
    }
    const r = await classifyDrift({ field: inStockField, expected: inStockExpected, certified: inStockCertified, captures }, deps());
    expect(r.result).not.toBe('moved');
    expect(r.result).toBe('lost');
    expect(r.path).toBeUndefined();
  }, 30_000);
});

describe('markFromXPath', () => {
  it('finds the box whose xpaths include the given one', () => {
    const boxes: Box[] = [
      { xpaths: ['//a', '//b'], text: 'hello', rect: { x: 1, y: 2, w: 3, h: 4 }, tag: 'span', kind: 'text' },
      { xpaths: ['//c'], text: 'other', rect: { x: 5, y: 6, w: 7, h: 8 }, tag: 'span', kind: 'text' },
    ];
    expect(markFromXPath(boxes, '//b')).toEqual({ xpaths: ['//a', '//b'], text: 'hello', rect: { x: 1, y: 2, w: 3, h: 4 } });
    expect(markFromXPath(boxes, '//z')).toBeUndefined();
  });
});
