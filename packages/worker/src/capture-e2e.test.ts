// Spec 2026-10-23 §10: a real proof-page capture through the queue, in a real Chromium under the worker's
// gate, of a page served on 127.0.0.1 — then no browser left open.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signedInCaller } from '@robot/api/test-helpers/identity';
import { createProjectWithSource } from '@robot/api/test-helpers/customer-source';
import { readWorkerConfig } from './config.js';
import { startWorker } from './worker.js';

const PAGE = `<!doctype html><html><head><title>Widget</title><script type="application/ld+json">{"@type":"Product","name":"Widget","offers":{"price":"19.99","priceCurrency":"EUR"}}</script></head><body><main><h1>Widget</h1><p>${'A fine widget. '.repeat(80)}</p><span class="price">19,99 €</span></main></body></html>`;
let server: Server;
let base = '';
const dir = mkdtempSync(join(tmpdir(), 'worker-e2e-'));
beforeAll(async () => {
  process.env.CAPTURES_DIR = dir;
  server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { server.close(); rmSync(dir, { recursive: true, force: true }); });

describe('a capture end to end through the worker', () => {
  it('captures the page and leaves no browser open after stop', async () => {
    const me = await signedInCaller('worker-e2e');
    const f = await createProjectWithSource(me.caller, { tag: 'worker-e2e', fields: [{ name: 'Title', type: 'text' }] });
    const worker = await startWorker({ ...readWorkerConfig({ JOB_QUEUE: process.env.JOB_QUEUE }), browsers: 1, minFreeMb: 0, pollMs: 50, websiteChecks: false });
    try {
      const { captureId } = await me.caller.sources.captureProofPage({ sourceId: f.sourceId, url: `${base}/p/1` });
      let state = await me.caller.sources.proofPageCapture({ captureId });
      const t = Date.now() + 90_000;
      while (state.status === 'capturing' && Date.now() < t) { await new Promise((r) => setTimeout(r, 250)); state = await me.caller.sources.proofPageCapture({ captureId }); }
      expect(state.status).toBe('captured');
      expect(state.tiles.length).toBeGreaterThan(0);
    } finally {
      await worker.stop();
      expect(worker.gate.open()).toBe(0);
      await f.cleanup();
      await me.cleanup();
    }
  });
});
