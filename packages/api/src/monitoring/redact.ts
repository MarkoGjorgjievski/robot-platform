// What every log line and error report passes through (spec 2026-10-25 monitoring §2.2 "Redaction", §3.1): URL
// userinfo (redactProxy, redactSmtp, then any scheme, also URL-encoded), secret query parameters, Authorization /
// Cookie headers, JSON text and Bearer/Basic tokens in text, the values of the known secret env variables, and keys
// that name a secret. Never throws; the result is JSON-safe. Every pattern is bounded, so a long string stays linear.
import { redactProxy } from '../proxy/proxy-url.js';
import { redactSmtp } from '../email/smtp.js';

type Env = Record<string, string | undefined>;

export const MASK = '***';

// A secret name is judged by its words, never by a substring (ruling, fix round 1): `signal`, `design`, `passed`,
// `bypass` and `dedupeKey` stay readable; `apiKey`, `X-Auth-Token`, `DB_PASSWORD` and `client_secret` do not.
// `session` is the app's own cookie (`robot_session`). A session's id is its token (the sessions table is keyed by
// it), so `sessionId` stays a secret; `sessions` and `sessionCount` are readable.
const SECRET_WORDS = new Set(['password', 'passwd', 'pwd', 'pass', 'passphrase', 'secret', 'token', 'authorization', 'auth',
  'cookie', 'cookies', 'session', 'jwt', 'otp', 'dsn', 'credential', 'credentials', 'sig', 'signature', 'apikey', 'privatekey',
  'accesskey', 'signingkey', 'encryptionkey', 'masterkey', 'connectionstring']);
const SECRET_PAIRS = new Set(['api key', 'access key', 'private key', 'client secret', 'signing key', 'encryption key',
  'master key', 'connection string']);
/** A key with no separators (accesstoken, clientsecret, refreshtoken). */
const SECRET_ENDING = /(?:token|secret|password|passwd|apikey|signature)$/;
/** A number of things is not a credential: tokenCount, passCount, passwordLength. */
const QUANTITY = new Set(['count', 'counts', 'total', 'length', 'len', 'size', 'limit', 'max', 'min']);
const WORD = /[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g;

/** True when a key (an object key, a query parameter, a header or a JSON name) names a secret. */
export function isSecretKey(key: string): boolean {
  let k: string;
  try { k = String(key).slice(0, 200); } catch { return false; }
  const words = (k.match(WORD) ?? []).map((w) => w.toLowerCase());
  if (words.length === 0) return false;
  if (words.length > 1 && QUANTITY.has(words[words.length - 1]!)) return false;
  if (words.some((w) => SECRET_WORDS.has(w))) return true;
  for (let i = 1; i < words.length; i++) if (SECRET_PAIRS.has(`${words[i - 1]} ${words[i]}`)) return true;
  return SECRET_ENDING.test(words.join(''));
}

/**
 * Rewrites each `re` match that `decide` judges secret. `re` (global) consumes only a name and its separator, so a
 * pair judged harmless never hides a secret inside its value: scanning resumes after the separator. `decide` returns the replacement for the match and how many characters after it to drop, or null.
 */
function scan(text: string, re: RegExp, decide: (m: RegExpExecArray, text: string) => { out: string; skip: number } | null): string {
  re.lastIndex = 0;
  let out = '';
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const r = decide(m, text);
    if (r) {
      out += text.slice(last, m.index) + r.out;
      last = m.index + m[0].length + r.skip;
      re.lastIndex = last;
    }
    if (m[0].length === 0) re.lastIndex++;
  }
  return out + text.slice(last);
}
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_KEYS = 100;
const MAX_NODES = 5_000;
/** A redacted string longer than this is cut, after it was redacted (a cut can never leave half a secret behind). */
const MAX_STRING = 10_000;
/** A string is cut to this before it is redacted, so a 10 MB page in a message costs no more than 64 KB. Whatever a
 *  cut at 64 KB could split lies past MAX_STRING and is cut away after redaction. */
const PRE_CUT = 64 * 1024;

const SCHEME = '[a-z][a-z0-9+.-]{0,30}';
/** scheme://userinfo@ — up to the last @ before a / ? # or space. */
const ANY_USERINFO = new RegExp(`\\b(${SCHEME}:\\/\\/)[^\\s/?#]*@`, 'gi');
/** scheme://user:pa/ss@ — a raw / ? or # in a password: a colon after the user, then anything up to an @ (but
 *  host:8080/path?e=a@b is a port and a path, not a password). */
const RAW_USERINFO = new RegExp(`\\b(${SCHEME}:\\/\\/)[^\\s/?#@:]{0,256}:(?!\\d{1,5}[/?#])[^\\s@]{0,256}@`, 'gi');
/** The same, URL-encoded (a redirect parameter): scheme%3A%2F%2F…%40, never past an encoded / ? #. */
const ENCODED_USERINFO = new RegExp(`\\b(${SCHEME}%3A%2F%2F)(?:(?!%2F|%3F|%23)[^\\s&/?#]){0,512}%40`, 'gi');
/** user:pass@host:port with no scheme (how proxy vendors and server strings write it): only before a host:port. */
const BARE_USERINFO = /(?<=^|[\s"'=(,;<[{])[^\s:@/"'=]{1,64}:[^\s/]{1,256}@(?=[\w.-]{1,253}:\d{1,5}\b)/g;
// The pair rules consume only a name and its separator; the value is read (sticky, bounded) only when the name is
// secret, so text full of harmless pairs costs one pass.
/** name=value (a query parameter); the name is judged by isSecretKey. */
const PARAM = /(?<![\w.-])([\w.-]{1,80})=/g;
const PARAM_VALUE = /[^\s&"',;]{1,4096}/y;
/** The same, URL-encoded: name%3Dvalue up to %26, the name right after an encoded ? or & (or a separator). */
const ENCODED_PARAM = /(?:(?<=%[0-9a-f]{2})|(?<![\w.%-]))([\w.-]{1,80})%3D/gi;
const ENCODED_VALUE = /(?:(?!%26)[^\s&"',;]){1,4096}/iy;
const KEY_PARAM = /([?&;]key)=([^\s&"',;]+)/gi;
/** "name": then a string, a number or an array in JSON text (the value is read by maskValue). */
const JSON_PAIR = /"([^"\\]{1,80})"\s*:\s*(?=["[\d-])/g;
const DQ_VALUE = /(?:[^"\\\r\n]|\\.){0,4096}(?=")/y;
const SQ_VALUE = /(?:[^'\\\r\n]|\\.){0,4096}(?=')/y;
/** name: 'value', 'name':'value', name = "value", secret: ['a'], 'otp': 123456 (Node's util.inspect, single-quoted
 *  JSON, config text). */
const QUOTED_PAIR = /(?<![\w.-])(['"]?)([\w.-]{1,80})\1\s*[:=]\s*(?=['"[\d-])/g;
/** name: value, name = value, X-Auth-Token: value — a bare value, up to a space or a separator. */
const BARE_PAIR = /(?<![\w.-])([\w.-]{1,80})\s*[:=]\s*/g;
const BARE_VALUE = /[^\s'",;&}\])<>]{1,4096}/y;

function valueAt(re: RegExp, text: string, at: number): string {
  re.lastIndex = at;
  return re.exec(text)?.[0] ?? '';
}
type Decide = (m: RegExpExecArray, text: string) => { out: string; skip: number } | null;
const masked = (m: RegExpExecArray, value: string) => (value ? { out: m[0] + MASK, skip: value.length } : null);
const maskParam: Decide = (m, t) => (isSecretKey(m[1]!) ? masked(m, valueAt(PARAM_VALUE, t, m.index + m[0].length)) : null);
const maskEncoded: Decide = (m, t) => (isSecretKey(m[1]!) ? masked(m, valueAt(ENCODED_VALUE, t, m.index + m[0].length)) : null);
const NUM_VALUE = /-?\d[\d.eE+-]{0,63}/y;
/** An array up to its matching bracket, at most 4096 characters (unclosed by then or by the line's end: that far). */
function arrayLength(t: string, at: number): number {
  const end = Math.min(t.length, at + 4096);
  let depth = 0;
  for (let i = at; i < end; i++) {
    const c = t[i];
    if (c === '\n' || c === '\r') return i - at;
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i - at + 1;
  }
  return end - at;
}
/** The value right after a secret name's separator: a quoted string (its quotes kept), an array (whole) or a number. */
const maskValue: Decide = (m, t) => {
  const at = m.index + m[0].length;
  const c = t[at];
  if (c === '"' || c === "'") {
    const v = valueAt(c === "'" ? SQ_VALUE : DQ_VALUE, t, at + 1);
    return v ? { out: m[0] + c + MASK, skip: 1 + v.length } : null;
  }
  if (c === '[') return { out: m[0] + MASK, skip: arrayLength(t, at) };
  return masked(m, valueAt(NUM_VALUE, t, at));
};
const maskJson: Decide = (m, t) => (isSecretKey(m[1]!) ? maskValue(m, t) : null);
const maskQuoted: Decide = (m, t) => (isSecretKey(m[2]!) ? maskValue(m, t) : null);
/** A value already masked, or the scheme word of a masked Bearer/Basic token, is left as it is. */
const maskBare: Decide = (m, t) => {
  if (!isSecretKey(m[1]!)) return null;
  const v = valueAt(BARE_VALUE, t, m.index + m[0].length);
  return v === MASK || /^(?:bearer|basic)$/i.test(v) ? null : masked(m, v);
};
/** The whole token, punctuation included, up to the next space. */
const BEARER = /\b(Bearer)\s+\S+/gi;
const BASIC = /\b(Basic)\s+(?=\S{6,})\S+/g;
/** A header in text: everything after it on the line (a Bearer/Basic scheme word is kept). */
const HEADER = /\b((?:proxy-)?authorization|(?:set-)?cookie|x-api-key|api-key)(\s*:\s*)([^\r\n]{1,4096})/gi;
const headerValue = (_m: string, name: string, sep: string, value: string) =>
  `${name}${sep}${/^(?:bearer|basic)\s/i.test(value) ? `${value.split(/\s/, 1)[0]} ` : ''}${MASK}`;
/** Their values are replaced wherever they appear (a key quoted in an error message). */
const ENV_SECRETS = ['ANTHROPIC_API_KEY', 'TYPESAFE_API_KEY', 'ERROR_REPORT_TOKEN'];
/** The password inside each of these URLs is replaced wherever it appears, raw, decoded and encoded. */
const ENV_URLS = ['SMTP_URL', 'DATABASE_URL', 'DEFAULT_PROXY_URL'];
/** Shorter than this: not a secret worth masking everywhere (it would mangle ordinary words). */
const MIN_SECRET = 6;

type Redactor = (text: string) => string;

/** A password equal to its user name is left out: masking it would mask the user name everywhere (postgres:postgres). */
function urlPassword(url: string): string {
  let user = '';
  let pass = '';
  try {
    const u = new URL(url);
    user = u.username;
    pass = u.password;
  } catch {
    const m = /^[a-z][\w+.-]*:\/\/([^:@/\s]*):([^\s]*)@/i.exec(url); // not a URL a parser takes: read it by hand
    user = m?.[1] ?? '';
    pass = m?.[2] ?? '';
  }
  return pass && pass !== user ? pass : '';
}

function addSecret(secrets: Set<string>, value: string): void {
  const forms = [value];
  try { forms.push(decodeURIComponent(value)); } catch { /* not percent-encoded: the raw form is enough */ }
  for (const f of [...forms]) { try { forms.push(encodeURIComponent(f)); } catch { /* a lone surrogate */ } }
  for (const f of forms) if (f.trim().length >= MIN_SECRET) secrets.add(f.trim());
}

let cached: { key: string; redact: Redactor } | null = null;

function redactor(env: Env): Redactor {
  const values = [...ENV_SECRETS, ...ENV_URLS].map((n) => String(env[n] ?? ''));
  const key = values.join('\u0000');
  if (cached?.key === key) return cached.redact;
  const secrets = new Set<string>();
  for (const name of ENV_SECRETS) addSecret(secrets, String(env[name] ?? '').trim());
  for (const name of ENV_URLS) addSecret(secrets, urlPassword(String(env[name] ?? '').trim()));
  const ordered = [...secrets].sort((a, b) => b.length - a.length);
  const redact: Redactor = (input) => {
    let out = input;
    for (const s of ordered) out = out.split(s).join(MASK);
    // redactSmtp without the URL: its pattern only. SMTP_URL's password is in `ordered`; its username is never
    // sprayed over text (a one-letter or "apikey" username would mask ordinary words).
    out = redactSmtp(redactProxy(out));
    out = out
      .replace(ANY_USERINFO, `$1${MASK}@`)
      .replace(RAW_USERINFO, `$1${MASK}@`)
      .replace(ENCODED_USERINFO, `$1${MASK}%40`)
      .replace(BARE_USERINFO, `${MASK}@`)
      .replace(BEARER, `$1 ${MASK}`)
      .replace(BASIC, `$1 ${MASK}`)
      .replace(HEADER, headerValue);
    out = scan(out, JSON_PAIR, maskJson);
    out = scan(out, QUOTED_PAIR, maskQuoted);
    out = scan(out, BARE_PAIR, maskBare);
    out = scan(out, PARAM, maskParam);
    out = scan(out, ENCODED_PARAM, maskEncoded);
    return out.replace(KEY_PARAM, `$1=${MASK}`);
  };
  cached = { key, redact };
  return redact;
}

/** Cut to PRE_CUT, redacted, then cut to MAX_STRING with a note of how much was left out. */
/** Drizzle puts a failed query's values on a `params:` line of the message and the stack (session tokens, secrets,
 *  customer input): the line is masked whole (Task 3 review). */
const QUERY_PARAMS = /(^|\n)([ \t]*params:)[^\n]*/g;

function bounded(r: Redactor, s: string): string {
  const cut = (s.length > PRE_CUT ? s.slice(0, PRE_CUT) : s).replace(QUERY_PARAMS, `$1$2 ${MASK}`);
  const red = r(cut);
  const over = s.length > PRE_CUT ? s.length - MAX_STRING : red.length - MAX_STRING;
  return over > 0 ? `${red.slice(0, MAX_STRING)}…[+${over} chars]` : red;
}

/**
 * Text with every secret the rules above know taken out, at most 10 000 characters (plus a note of the rest).
 * Never throws (a non-string is turned into one first).
 */
export function redactText(text: string, env: Env = process.env): string {
  let s: string;
  try { s = String(text); } catch { return '[unreadable]'; }
  try { return bounded(redactor(env), s); } catch { return '[unreadable]'; }
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
  const text = (s: string) => bounded(r, s);
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
        if (isSecretKey(k)) { setKey(out, name, MASK); continue; }
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
