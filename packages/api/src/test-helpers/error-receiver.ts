// A local error receiver for tests and the monitoring live check (spec 2026-10-25 §4): records every POST (body,
// raw text, headers) as soon as its body has arrived, then answers `status` (default 204), after `delayMs` if given.
import { createServer, type IncomingHttpHeaders } from 'node:http';

export type ReceivedReport = { body: any; raw: string; headers: IncomingHttpHeaders };

export async function startErrorReceiver(opts: { status?: number; delayMs?: number } = {}): Promise<{ url: string; reports: ReceivedReport[]; close(): Promise<void> }> {
  const reports: ReceivedReport[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { raw += chunk; });
    req.on('end', () => {
      let body: unknown = null;
      try { body = JSON.parse(raw); } catch { /* kept raw */ }
      reports.push({ body, raw, headers: req.headers });
      const answer = () => { if (!res.writableEnded) { res.writeHead(opts.status ?? 204); res.end(); } };
      if (opts.delayMs) setTimeout(answer, opts.delayMs).unref(); else answer();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/report`,
    reports,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
