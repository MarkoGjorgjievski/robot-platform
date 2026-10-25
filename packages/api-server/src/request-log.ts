// The api-server's request log (spec 2026-10-25 monitoring §2.2): method, path without the query string, status,
// duration and client IP — at info, /healthz and /readyz at debug. Never a query, a body, a header or a cookie.
import type { MiddlewareHandler } from 'hono';
import type { Log } from '@robot/api/log';
import { clientIpOf } from './client-ip.js';

const QUIET = new Set(['/healthz', '/readyz']);

export function requestLog(log: Log): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    try {
      await next();
    } finally {
      const fields = { method: c.req.method, path: c.req.path, status: c.res.status, ms: Math.round(performance.now() - started), ip: clientIpOf(c) };
      (QUIET.has(fields.path) ? log.debug : log.info)(`${fields.method} ${fields.path} ${fields.status} ${fields.ms} ms`, fields);
    }
  };
}
