// The structured logger (spec 2026-10-25 monitoring §2.2): `createLog(scope)` → { debug, info, warn, error }(message,
// fields?). LOG_FORMAT=json writes one object per line ({ t, level, scope, msg, ...fields }); the default text writes
// `[scope] msg key=value …` (warn and error with their level after the scope, so they can be found). LOG_LEVEL
// (default info) filters. Every message and field is redacted first (./redact.ts). A log line never throws.
import { redactText, redactValue } from './redact.js';

type Env = Record<string, string | undefined>;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;
export type Log = Record<LogLevel, (message: string, fields?: LogFields) => void>;
export type LogSink = (line: string, level: LogLevel) => void;

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
/** Names a field cannot take in a JSON line: the line's own, and __proto__ (an assignment would drop it). */
const RESERVED = new Set(['t', 'level', 'scope', 'msg', '__proto__']);

export function logLevel(env: Env = process.env): LogLevel {
  const v = String(env.LOG_LEVEL ?? '').trim().toLowerCase();
  return Object.hasOwn(RANK, v) ? (v as LogLevel) : 'info';
}

export function logFormat(env: Env = process.env): 'json' | 'text' {
  return String(env.LOG_FORMAT ?? '').trim().toLowerCase() === 'json' ? 'json' : 'text';
}

const defaultSink: LogSink = (line, level) => {
  if (level === 'warn' || level === 'error') console.error(line);
  else console.log(line);
};

function safeJson(v: unknown): string {
  try { return JSON.stringify(v) ?? 'null'; } catch { return '"[unserialisable]"'; }
}

// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
// eslint-disable-next-line no-control-regex
const HAS_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const SHORT: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };

/** One text line stays one line, and a terminal never runs page text: C0/C1 controls, DEL, U+2028/2029 escaped. */
function oneLine(s: string): string {
  return s.replace(CONTROLS, (c) => SHORT[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** A key that is not a plain name (a remote header, a Map key) is quoted, so `a b=c` cannot forge a `b=c` field. */
function textKey(k: string): string {
  return /^[\w.-]+$/.test(k) ? k : oneLine(JSON.stringify(k));
}

function textValue(v: unknown): string {
  if (typeof v === 'string') return /^[^\s"=]+$/.test(v) && !HAS_CONTROL.test(v) ? v : oneLine(JSON.stringify(v));
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return oneLine(safeJson(v));
}

export function formatLine(level: LogLevel, scope: string, message: string, fields: LogFields | undefined, format: 'json' | 'text', now: Date = new Date(), env: Env = process.env): string {
  let raw: string;
  try { raw = String(message); } catch { raw = '[unreadable message]'; }
  const msg = redactText(raw, env);
  const clean = fields ? redactValue(fields, env) : {};
  const entries = Object.entries(clean && typeof clean === 'object' && !Array.isArray(clean) ? clean : { fields: clean })
    .filter(([, v]) => v !== undefined);
  if (format === 'json') {
    const out: LogFields = { t: now.toISOString(), level, scope, msg };
    for (const [k, v] of entries) out[RESERVED.has(k) ? `field_${k}` : k] = v;
    return safeJson(out);
  }
  const head = level === 'warn' || level === 'error' ? `[${scope}] ${level.toUpperCase()} ${oneLine(msg)}` : `[${scope}] ${oneLine(msg)}`;
  return entries.length ? `${head} ${entries.map(([k, v]) => `${textKey(k)}=${textValue(v)}`).join(' ')}` : head;
}

export function createLog(scope: string, opts: { sink?: LogSink; env?: Env } = {}): Log {
  const write = (level: LogLevel) => (message: string, fields?: LogFields) => {
    try {
      const env = opts.env ?? process.env;
      if (RANK[level] < RANK[logLevel(env)]) return;
      const format = logFormat(env);
      let line: string;
      try { line = formatLine(level, scope, message, fields, format, new Date(), env); }
      catch { line = formatLine(level, scope, '[this log line could not be written]', undefined, format, new Date(), env); }
      (opts.sink ?? defaultSink)(line, level);
    } catch { /* a log line never throws into its caller */ }
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}
