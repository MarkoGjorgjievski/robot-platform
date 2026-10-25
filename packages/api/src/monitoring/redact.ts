// What every log line and error report passes through (spec 2026-10-25 monitoring §2.2 "Redaction", §3.1): URL
// userinfo (redactProxy, redactSmtp, then any scheme, also URL-encoded), secret query parameters, Authorization /
// Cookie headers, JSON text and Bearer/Basic tokens in text, the values of the known secret env variables, and keys
// that name a secret. Never throws; the result is JSON-safe. Every pattern is bounded, so a long string stays linear.
import { redactProxy } from '../proxy/proxy-url.js';
import { redactSmtp } from '../email/smtp.js';

type Env = Record<string, string | undefined>;

export const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|sig/i;
export const MASK = '***';
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_KEYS = 100;
const MAX_NODES = 5_000;
/** A string longer than this is cut, after it was redacted (a cut can never leave half a secret behind). */
const MAX_STRING = 10_000;

const SCHEME = '[a-z][a-z0-9+.-]{0,30}';
/** scheme://userinfo@ — up to the last @ before a / ? # or space. */
const ANY_USERINFO = new RegExp(`\\b(${SCHEME}:\\/\\/)[^\\s/?#]*@`, 'gi');
/** scheme://user:pa/ss@ — a raw / ? or # in a password: a colon after the user, then anything up to an @ (but
 *  host:8080/path?e=a@b is a port and a path, not a password). */
const RAW_USERINFO = new RegExp(`\\b(${SCHEME}:\\/\\/)[^\\s/?#@:]{0,256}:(?!\\d{1,5}[/?#])[^\\s@]{0,256}@`, 'gi');
/** The same, URL-encoded (a redirect parameter): scheme%3A%2F%2F…%40, never past an encoded / ? #. */
const ENCODED_USERINFO = new RegExp(`\\b(${SCHEME}%3A%2F%2F)(?:(?!%2F|%3F|%23)[^\\s&/?#]){0,512}%40`, 'gi');
const PARAM_NAME = '[\\w-]{0,40}(?:pass(?:word)?|secret|token|sig|authorization|cookie|credential|api[_-]?key|access[_-]?key|private[_-]?key)[\\w-]{0,40}';
const SECRET_PARAM = new RegExp(`\\b(${PARAM_NAME})=([^\\s&"',;]+)`, 'gi');
const ENCODED_PARAM = new RegExp(`\\b(${PARAM_NAME})%3D(?:(?!%26)[^\\s&"',;]){1,4096}`, 'gi');
const KEY_PARAM = /([?&;]key)=([^\s&"',;]+)/gi;
const JSON_SECRET = new RegExp(`"(${PARAM_NAME})"(\\s*:\\s*)"(?:[^"\\\\]|\\\\.){0,4096}"`, 'gi');
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const BASIC = /\b(Basic)\s+[A-Za-z0-9+/=]{6,}/g;
/** A header in text: everything after it on the line, unless it is already a masked Bearer/Basic token. */
const HEADER = /\b((?:proxy-)?authorization|(?:set-)?cookie|x-api-key|api-key)(\s*:\s*)(?!\s*(?:bearer|basic)\s+\*\*\*)[^\r\n]{1,4096}/gi;
/** Their values are replaced wherever they appear (a key quoted in an error message). Shorter than 8: not a key. */
const ENV_SECRETS = ['ANTHROPIC_API_KEY', 'TYPESAFE_API_KEY', 'ERROR_REPORT_TOKEN'];

type Redactor = (text: string) => string;

function redactor(env: Env): Redactor {
  const secrets = new Set<string>();
  for (const name of ENV_SECRETS) {
    const v = String(env[name] ?? '').trim();
    if (v.length < 8) continue;
    secrets.add(v);
    try { secrets.add(encodeURIComponent(v)); } catch { /* a lone surrogate: the raw value is enough */ }
  }
  const ordered = [...secrets].sort((a, b) => b.length - a.length);
  const smtpUrl = env.SMTP_URL ?? null;
  return (input) => {
    let out = input;
    for (const s of ordered) out = out.split(s).join(MASK);
    out = redactSmtp(redactProxy(out), smtpUrl);
    return out
      .replace(ANY_USERINFO, `$1${MASK}@`)
      .replace(RAW_USERINFO, `$1${MASK}@`)
      .replace(ENCODED_USERINFO, `$1${MASK}%40`)
      .replace(JSON_SECRET, `"$1"$2"${MASK}"`)
      .replace(SECRET_PARAM, `$1=${MASK}`)
      .replace(ENCODED_PARAM, `$1%3D${MASK}`)
      .replace(KEY_PARAM, `$1=${MASK}`)
      .replace(BEARER, `$1 ${MASK}`)
      .replace(BASIC, `$1 ${MASK}`)
      .replace(HEADER, `$1$2${MASK}`);
  };
}

/** Text with every secret the rules above know taken out. Never throws (a non-string is turned into one first). */
export function redactText(text: string, env: Env = process.env): string {
  let s: string;
  try { s = String(text); } catch { return '[unreadable]'; }
  try { return redactor(env)(s); } catch { return '[unreadable]'; }
}

function cut(s: string): string {
  return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…[+${s.length - MAX_STRING} chars]` : s;
}

function setKey(out: Record<string, unknown>, k: string, v: unknown): void {
  // defineProperty, so a key named __proto__ is an ordinary key and never a prototype.
  Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
}

/**
 * A JSON-safe copy with every string redacted and every secret-named key masked: Error → { name, message, stack,
 * cause?, errors? }, Date → ISO, bigint → string, Buffer / typed array → "[binary N bytes]", Map → object, Set → array,
 * functions and symbols → undefined, cycles → "[circular]", depth > 6 → "[too deep]", a throwing getter →
 * "[unreadable]", arrays capped at 50 items and objects at 100 keys, strings at 10 000 characters.
 */
export function redactValue(value: unknown, env: Env = process.env): unknown {
  let r: Redactor;
  try { r = redactor(env); } catch { return '[unreadable]'; }
  const text = (s: string) => cut(r(s));
  const ancestors = new Set<object>();
  let nodes = 0;
  const read = (f: () => unknown): unknown => { try { return f(); } catch { return '[unreadable]'; } };

  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return text(v);
    if (typeof v === 'bigint') return v.toString();
    if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'function' || typeof v === 'symbol') return undefined;
    if (typeof v !== 'object') return text(String(v));
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString();
    if (ancestors.has(v)) return '[circular]';
    if (depth >= MAX_DEPTH) return '[too deep]';
    if (++nodes > MAX_NODES) return '[too big]';
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return `[binary ${(v as ArrayBuffer).byteLength} bytes]`;
    ancestors.add(v);
    try {
      if (v instanceof Error || Object.prototype.toString.call(v) === '[object Error]') {
        const e = v as Error & { cause?: unknown; errors?: unknown };
        const str = (f: () => unknown) => { const x = read(f); return x === undefined ? undefined : text(String(x)); };
        const out: Record<string, unknown> = { name: str(() => e.name), message: str(() => e.message), stack: str(() => e.stack) };
        const cause = read(() => e.cause);
        if (cause !== undefined) out.cause = walk(cause, depth + 1);
        const errors = read(() => e.errors);
        if (Array.isArray(errors)) out.errors = walk(errors, depth + 1);
        return out;
      }
      if (Array.isArray(v)) return v.slice(0, MAX_ARRAY).map((x) => walk(x, depth + 1));
      if (v instanceof Map) {
        const o: Record<string, unknown> = {};
        let i = 0;
        for (const [k, x] of v) { if (i++ >= MAX_KEYS) break; setKey(o, String(k), x); }
        return walk(o, depth);
      }
      if (v instanceof Set) return walk([...v].slice(0, MAX_ARRAY), depth);
      const toJSON = read(() => (v as { toJSON?: unknown }).toJSON);
      if (typeof toJSON === 'function') return walk(read(() => (toJSON as () => unknown).call(v)), depth + 1);
      const keys = Object.keys(v);
      const out: Record<string, unknown> = {};
      for (const k of keys.slice(0, MAX_KEYS)) {
        const name = text(k);
        if (SECRET_KEY.test(k)) { setKey(out, name, MASK); continue; }
        setKey(out, name, walk(read(() => (v as Record<string, unknown>)[k]), depth + 1));
      }
      if (keys.length > MAX_KEYS) setKey(out, '…', `${keys.length - MAX_KEYS} more keys`);
      return out;
    } catch {
      return '[unreadable]';
    } finally {
      ancestors.delete(v);
    }
  };
  try { return walk(value, 0); } catch { return '[unreadable]'; }
}
