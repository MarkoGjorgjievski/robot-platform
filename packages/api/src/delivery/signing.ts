// packages/api/src/delivery/signing.ts
// The webhook's signatures (spec 2026-10-24 §3.3–§3.4): `X-Robot-Signature: sha256=<hex HMAC-SHA256(secret, raw body)>`,
// and a file link's `sig = HMAC-SHA256(secret, "<runId>.<fmt>.<expires>")`, `expires` in unix seconds. Pure.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Links in a webhook expire after 7 days. */
export const LINK_TTL_S = 7 * 86_400;

/** 32 random bytes, hex. */
export function newWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

export function bodySignature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function fileSignature(secret: string, runId: string, format: string, expires: number): string {
  return createHmac('sha256', secret).update(`${runId}.${format}.${expires}`).digest('hex');
}

export function signedFileUrl(base: string, secret: string, runId: string, format: string, expires: number): string {
  return `${base.replace(/\/+$/, '')}/export/runs/${runId}.${format}?expires=${expires}&sig=${fileSignature(secret, runId, format, expires)}`;
}

/**
 * Whether a link opens this run's file in this format: the website's current secret, and not expired. The
 * signature is compared in constant time; a run id or format with a dot in it is refused, so the separator
 * cannot be shifted between them.
 */
export function checkFileSignature(a: { secret: string | null; runId: string; format: string; expires: string | undefined; sig: string | undefined; nowS?: number }): boolean {
  if (!a.secret || !a.expires || !a.sig) return false;
  if (a.runId.includes('.') || a.format.includes('.')) return false;
  if (!/^\d{1,12}$/.test(a.expires) || !/^[0-9a-f]{64}$/i.test(a.sig)) return false;
  const expires = Number(a.expires);
  if (expires <= (a.nowS ?? Math.floor(Date.now() / 1000))) return false;
  const want = Buffer.from(fileSignature(a.secret, a.runId, a.format, expires), 'hex');
  return timingSafeEqual(want, Buffer.from(a.sig, 'hex'));
}

/** The api-server as a webhook's receiver reaches it: the file links are built on it. */
export function publicApiUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '') || 'http://localhost:4000';
}
