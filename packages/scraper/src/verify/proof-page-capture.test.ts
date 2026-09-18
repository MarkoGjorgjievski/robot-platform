import { describe, it, expect, vi } from 'vitest';
import type { IBrowser, PageCapture, CaptureOptions } from '@robot/browser';
import { captureProofPage } from './proof-page-capture.js';
import { PROOF_PAGE_MAX_TILES } from './constants.js';
import { loadVerifyFixture } from '../__fixtures__/verify/load.js';

const box = { xpaths: ['//*[@id="main"]/h1'], text: 'Widget A', rect: { x: 0, y: 0, w: 10, h: 10 }, tag: 'h1', kind: 'text' as const };
// The p1 fixture's html is a terse ~66-char snippet built for path/value
// searches, not for checkPageHealth's own "almost no content" floor (<100
// chars of visible text) — captureProblem calls checkPageHealth for real
// (unlike run-verification.test.ts, which injects fixtures via `captures`
// and never exercises that check), so the happy-path cases here pad it.
const withEnoughText = (html: string) => html.replace('</body>', `<p>${'a lovely product '.repeat(10)}</p></body>`);

function fakeBrowser(capture: PageCapture): IBrowser & { options: CaptureOptions[] } {
  const options: CaptureOptions[] = [];
  return {
    options,
    launch: async () => {}, close: async () => {},
    capture: async (_url: string, o: CaptureOptions = {}) => { options.push(o); return capture; },
    evaluate: async () => { throw new Error('unused'); },
    setContentEvaluate: async () => { throw new Error('unused'); },
    crawl: async function* () {}, scrollPages: async function* () {},
  } as unknown as IBrowser & { options: CaptureOptions[] };
}

describe('captureProofPage', () => {
  it('captures with load + the proof-page ready check + the box-map annotate + six tiles, and returns the boxes', async () => {
    const fixture = loadVerifyFixture('shop-example', 'p1');
    const c = { ...fixture, html: withEnoughText(fixture.html), title: 'Widget A', annotation: [box] };
    const b = fakeBrowser(c);
    const r = await captureProofPage(b, 'https://shop.example/p/1');
    expect(r.boxes).toEqual([box]);
    expect(r.capture).toBe(c);
    const o = b.options[0]!;
    expect(o.waitUntil).toBe('load');
    expect(o.interceptNetworkRequests).toBe(true);
    expect(o.maxTiles).toBe(PROOF_PAGE_MAX_TILES);
    expect(o.ready?.when).toBe('after-expand');
    expect(o.annotate).toContain('getBoundingClientRect');
  });
  it('throws the capture problem for a redirect', async () => {
    const c = { ...loadVerifyFixture('shop-example', 'p1'), url: 'https://shop.example/category', title: 'Cat' };
    await expect(captureProofPage(fakeBrowser(c), 'https://shop.example/p/1')).rejects.toThrow('redirected to https://shop.example/category');
  });
  it('an annotation that is not a box map yields no boxes rather than an error', async () => {
    const fixture = loadVerifyFixture('shop-example', 'p1');
    const c = { ...fixture, html: withEnoughText(fixture.html), title: 'Widget A', annotation: { nope: 1 } };
    const r = await captureProofPage(fakeBrowser(c), 'https://shop.example/p/1');
    expect(r.boxes).toEqual([]);
  });
});
