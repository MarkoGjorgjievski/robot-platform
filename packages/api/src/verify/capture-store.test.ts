import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCaptureFile, readCaptureFile, loadStoredCapture, persistTiles } from './capture-store.js';

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'captures-')); process.env.CAPTURES_DIR = dir; });
afterAll(async () => { delete process.env.CAPTURES_DIR; await rm(dir, { recursive: true, force: true }); });

const capture = { url: 'https://s/p/1', html: '<p>x</p>', markdown: '', title: 't', timestamp: 0, screenshot: Buffer.alloc(0), screenshotTiles: [],
  structuredData: { ldJson: [{ a: 1 }], nextData: null, initialState: null, meta: { description: 'd' } },
  interceptedRequests: [
    { url: 'https://s/api', method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {}, responseBody: '{"k":1}', contentType: 'application/json', bodySize: 7, isJson: true, parsedJson: { k: 1 }, timestamp: 0 },
    { url: 'https://s/x.js', method: 'GET', resourceType: 'script', responseStatus: 200, responseHeaders: {}, responseBody: null, contentType: 'text/javascript', bodySize: 0, isJson: false, parsedJson: null, timestamp: 0 },
  ] };

describe('capture store', () => {
  it('round-trips a capture keeping only the JSON responses', async () => {
    await writeCaptureFile('abc', capture);
    const back = await readCaptureFile('abc');
    expect(back?.html).toBe('<p>x</p>');
    expect(back?.structuredData.ldJson).toEqual([{ a: 1 }]);
    expect(back?.interceptedRequests.map((r) => r.url)).toEqual(['https://s/api']);
  });
  it('readCaptureFile is null for a missing id', async () => { expect(await readCaptureFile('nope')).toBeNull(); });
  it('loadStoredCapture refuses a stale ref', async () => {
    expect(await loadStoredCapture({ captureId: 'abc', capturedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString() })).toBeNull();
    expect(await loadStoredCapture({ captureId: 'abc', capturedAt: new Date().toISOString() })).not.toBeNull();
  });
  it('persistTiles writes one png per tile in order', async () => {
    const urls = await persistTiles([Buffer.from('a'), Buffer.from('b')]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/^\/captures\/.+\.png$/);
  });
});
