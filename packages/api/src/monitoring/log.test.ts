// Spec 2026-10-25 monitoring §2.2 and §3.1: formats, levels, and redaction of keys, URLs and errors.
import { describe, expect, it } from 'vitest';
import { createLog, formatLine, logLevel, type LogLevel } from './log.js';
import { isSecretKey, MASK, redactText, redactValue } from './redact.js';

const T = new Date('2026-10-25T12:00:00.000Z');
function capture(env: Record<string, string>) {
  const lines: Array<{ line: string; level: LogLevel }> = [];
  return { lines, log: createLog('test', { env, sink: (line, level) => lines.push({ line, level }) }) };
}

describe('the logger (spec 2026-10-25 monitoring §2.2)', () => {
  it('json: one object per line — t, level, scope, msg, then the fields', () => {
    expect(formatLine('info', 'jobs', 'claimed verify j1', { jobId: 'j1', attempt: 1 }, 'json', T))
      .toBe('{"t":"2026-10-25T12:00:00.000Z","level":"info","scope":"jobs","msg":"claimed verify j1","jobId":"j1","attempt":1}');
  });

  it('json: a field named like a reserved key never overwrites it', () => {
    expect(JSON.parse(formatLine('warn', 'x', 'm', { level: 'debug', msg: 'other', t: 1, scope: 'y' }, 'json', T))).toEqual({
      t: '2026-10-25T12:00:00.000Z', level: 'warn', scope: 'x', msg: 'm', field_level: 'debug', field_msg: 'other', field_t: 1, field_scope: 'y',
    });
  });

  it('text: [scope] msg key=value, quoted when needed; warn and error say so', () => {
    expect(formatLine('info', 'jobs', 'done verify j1', { jobId: 'j1', ms: 12, note: 'two words', gone: undefined }, 'text', T))
      .toBe('[jobs] done verify j1 jobId=j1 ms=12 note="two words"');
    expect(formatLine('warn', 'watchdog', 'silent', undefined, 'text', T)).toBe('[watchdog] WARN silent');
    expect(formatLine('error', 'errors', 'boom', { o: { a: 1 } }, 'text', T)).toBe('[errors] ERROR boom o={"a":1}');
  });

  it('LOG_LEVEL filters (default info, nonsense is info); LOG_FORMAT picks the format (default text)', () => {
    const d = capture({});
    d.log.debug('hidden'); d.log.info('shown');
    expect(d.lines.map((l) => l.line)).toEqual(['[test] shown']);
    const w = capture({ LOG_LEVEL: 'warn', LOG_FORMAT: 'json' });
    w.log.info('hidden'); w.log.warn('shown'); w.log.error('also');
    expect(w.lines.map((l) => [l.level, JSON.parse(l.line).msg])).toEqual([['warn', 'shown'], ['error', 'also']]);
    const n = capture({ LOG_LEVEL: 'loud', LOG_FORMAT: 'xml' });
    n.log.debug('x'); n.log.info('y');
    expect(n.lines.map((l) => l.line)).toEqual(['[test] y']);
  });

  it('redacts secret keys at any depth, URL userinfo in the message and the fields, and errors as name/message/stack', () => {
    const { lines, log } = capture({ LOG_FORMAT: 'json' });
    const err = new Error('connect to http://proxy-user:proxy-pass@gate.test:7000 failed');
    log.error('could not reach smtp://mail-user:mail-pass@smtp.test:587', {
      password: 'pw-one', apiToken: 'tok-one', Authorization: 'bearer-one', cookie: 'robot_session=sess-one', sig: 'sig-one',
      webhookSecret: 'hook-one', nested: { deeper: { pass: 'pw-two' } }, url: 'socks5://u:socks-pass@s.test:1080', error: err,
    });
    const out = lines[0]!.line;
    for (const s of ['pw-one', 'tok-one', 'bearer-one', 'sess-one', 'sig-one', 'hook-one', 'pw-two', 'proxy-pass', 'mail-pass', 'socks-pass', 'proxy-user', 'mail-user']) {
      expect(out).not.toContain(s);
    }
    const o = JSON.parse(out);
    expect(o).toMatchObject({
      msg: 'could not reach smtp://***@smtp.test:587', password: '***', apiToken: '***', Authorization: '***', cookie: '***', sig: '***',
      webhookSecret: '***', nested: { deeper: { pass: '***' } }, url: 'socks5://***@s.test:1080',
      error: { name: 'Error', message: 'connect to http://***@gate.test:7000 failed' },
    });
    expect(o.error.stack).toContain('http://***@gate.test:7000');
  });

  it('RF2: secrets in places no key names — a Postgres URL in a cause, a signed link, a Bearer header in text, a key from the environment', () => {
    const { lines, log } = capture({ LOG_FORMAT: 'json', ANTHROPIC_API_KEY: 'sk-ant-live-0123456789' });
    const cause = new Error('password authentication failed for postgresql://robot:db-pass-9@db.test:5432/robot');
    log.error('export link failed', {
      link: 'http://localhost:4000/export/run/r1?exp=1&sig=deadbeefcafe', header: 'Authorization: Bearer abc.def.ghi',
      note: 'key sk-ant-live-0123456789 rejected', error: new Error('outer', { cause }),
    });
    const out = lines[0]!.line;
    for (const s of ['db-pass-9', 'deadbeefcafe', 'abc.def.ghi', 'sk-ant-live-0123456789']) expect(out).not.toContain(s);
    const o = JSON.parse(out);
    expect(o.error.cause.message).toBe('password authentication failed for postgresql://***@db.test:5432/robot');
    expect(o.link).toBe('http://localhost:4000/export/run/r1?exp=1&sig=***');
    expect(o.header).toBe('Authorization: Bearer ***');
    expect(o.note).toBe('key *** rejected');
  });

  it('RF3: a field that cannot be serialised still writes the line, and never throws', () => {
    const { lines, log } = capture({ LOG_FORMAT: 'json' });
    const loop: Record<string, unknown> = { name: 'loop' };
    loop.self = loop;
    const getter = Object.defineProperty({}, 'boom', { enumerable: true, get() { throw new Error('getter'); } });
    expect(() => log.warn('odd fields', { loop, big: 10n, getter, fn: () => 1 })).not.toThrow();
    const o = JSON.parse(lines[0]!.line);
    expect(o).toMatchObject({ msg: 'odd fields', loop: { name: 'loop', self: '[circular]' }, big: '10', getter: { boom: '[unreadable]' } });
    expect('fn' in o).toBe(false);
    const text = capture({});
    text.log.info('text too', { loop, big: 10n });
    expect(text.lines[0]!.line).toBe('[test] text too loop={"name":"loop","self":"[circular]"} big=10');
    const throwing = createLog('test', { env: {}, sink: () => { throw new Error('disk full'); } });
    expect(() => throwing.error('still fine')).not.toThrow();
  });
});

describe('redaction, adversarial (spec 2026-10-25 monitoring §3.1)', () => {
  const env = {};

  it('userinfo with @ : / % in the password, in any scheme, encoded or not', () => {
    const cases: Array<[string, string, string[]]> = [
      ['postgres://robot:p@ss:w0rd@db.test:5432/x', 'postgres://***@db.test:5432/x', ['p@ss', 'w0rd', 'robot']],
      ['redis://u:a%2Fb%40c%3Ad@cache.test', 'redis://***@cache.test', ['a%2Fb', '%40c', 'u:']],
      ['https://user:pa/ss@host.test/x', 'https://***@host.test/x', ['pa/ss', 'user']],
      ['amqp://only-a-token@mq.test', 'amqp://***@mq.test', ['only-a-token']],
      ['next=https%3A%2F%2Fu%3Asecret-pw%40host.test%2Fx', 'next=https%3A%2F%2F***%40host.test%2Fx', ['secret-pw']],
    ];
    for (const [input, want, gone] of cases) {
      const out = redactText(input, env);
      expect(out).toBe(want);
      for (const s of gone) expect(out).not.toContain(s);
    }
    // An @ in a path or a query is not userinfo: left alone.
    expect(redactText('see https://medium.test/@writer and mailto a@b.test', env)).toBe('see https://medium.test/@writer and mailto a@b.test');
    expect(redactText('see http://host.test:8080/x?e=a@b.test', env)).toBe('see http://host.test:8080/x?e=a@b.test');
  });

  it('secret parameters, plain and URL-encoded; headers and JSON text in a message', () => {
    expect(redactText('GET /x?token=abc123&page=2&api_key=k-9&X-Amz-Signature=f00', env)).toBe('GET /x?token=***&page=2&api_key=***&X-Amz-Signature=***');
    expect(redactText('u=%2Fexport%3Fsig%3Ddeadbeef%26exp%3D1', env)).toBe('u=%2Fexport%3Fsig%3D***%26exp%3D1');
    expect(redactText('authorization: bearer tok.en-1', env)).toBe('authorization: bearer ***');
    expect(redactText('Authorization: rawtoken123', env)).toBe('Authorization: ***');
    expect(redactText('Cookie: a=1; robot_session=sess-xyz', env)).toBe('Cookie: ***');
    expect(redactText('Basic dXNlcjpwYXNz', env)).toBe('Basic ***');
    expect(redactText('body {"user":"m","password":"p\\"w","apiToken":"t1","n":1}', env)).toBe('body {"user":"m","password":"***","apiToken":"***","n":1}');
  });

  it('the known secret env values, also URL-encoded; short values are not keys', () => {
    const e = { TYPESAFE_API_KEY: 'ts+key/0123456789', ERROR_REPORT_TOKEN: 'report-token-42', ANTHROPIC_API_KEY: 'short' };
    const out = redactText('a ts+key/0123456789 b ts%2Bkey%2F0123456789 c report-token-42 d short', e);
    expect(out).toBe('a *** b *** c *** d short');
  });

  it('nested objects and arrays, header objects, keys that carry a secret themselves', () => {
    const v = redactValue({
      request: { headers: { Authorization: 'Bearer x1', 'content-type': 'json', 'Set-Cookie': ['a=1'] } },
      list: [{ password: 'p1' }, ['postgres://u:p2@h.test/db'], { deep: [{ clientSecret: 'p3' }] }],
      ['https://u:keypart@h.test']: 1,
    }, env) as Record<string, unknown>;
    const s = JSON.stringify(v);
    for (const x of ['x1', 'p1', 'p2', 'p3', 'keypart', 'a=1']) expect(s).not.toContain(x);
    expect(v).toMatchObject({ request: { headers: { Authorization: MASK, 'content-type': 'json', 'Set-Cookie': MASK } }, list: [{ password: MASK }, ['postgres://***@h.test/db'], { deep: [{ clientSecret: MASK }] }] });
  });

  it('Error: cause chains, AggregateError, a throwing getter, a non-string message, a cyclic cause', () => {
    const inner = new Error('postgres://a:deep-pw@h.test');
    const agg = new AggregateError([new Error('token=t-agg')], '');
    const mid = new Error('mid', { cause: agg });
    (agg as { cause?: unknown }).cause = inner;
    const out = JSON.stringify(redactValue(new Error('top', { cause: mid }), env));
    for (const s of ['deep-pw', 't-agg']) expect(out).not.toContain(s);
    expect(out).toContain('"name":"AggregateError"');
    const bad = new Error('x');
    Object.defineProperty(bad, 'stack', { get() { throw new Error('no'); } });
    expect(redactValue(bad, env)).toMatchObject({ name: 'Error', message: 'x', stack: '[unreadable]' });
    const odd = new Error('y');
    (odd as { message: unknown }).message = { toString: () => 'secret=s1' };
    expect(JSON.stringify(redactValue(odd, env))).not.toContain('s1');
    const cyclic = new Error('c');
    (cyclic as { cause?: unknown }).cause = cyclic;
    expect(redactValue(cyclic, env)).toMatchObject({ message: 'c', cause: '[circular]' });
  });

  it('a shared (not cyclic) object is written twice; depth, width and arrays are capped', () => {
    const shared = { a: 1 };
    expect(redactValue({ x: shared, y: shared }, env)).toEqual({ x: { a: 1 }, y: { a: 1 } });
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 10; i++) deep = { d: deep };
    expect(JSON.stringify(redactValue(deep, env))).toContain('[too deep]');
    expect((redactValue(Array.from({ length: 500 }, (_, i) => i), env) as unknown[]).length).toBe(50);
    const wide = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(redactValue(wide, env) as object).length).toBeLessThanOrEqual(101);
  });

  it('Buffers and typed arrays are summarised, Map/Set/Proxy never throw, very long strings are cut after redaction and fast', () => {
    expect(redactValue({ b: Buffer.from('postgres://u:buf-pw@h'), u: new Uint8Array(4), ab: new ArrayBuffer(8) }, env))
      .toEqual({ b: '[binary 21 bytes]', u: '[binary 4 bytes]', ab: '[binary 8 bytes]' });
    const hostile = new Proxy({}, { ownKeys() { throw new Error('trap'); } });
    expect(redactValue({ hostile }, env)).toEqual({ hostile: '[unreadable]' });
    expect(JSON.stringify(redactValue({ m: new Map([['password', 'mapped-pw']]), s: new Set(['x']) }, env))).not.toContain('mapped-pw');
    const long = 'a.b-'.repeat(250_000) + ' https://u:tail-pw@h.test';
    const t0 = Date.now();
    const out = redactValue(long, env) as string;
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(out.length).toBeLessThan(20_000);
    expect(out).not.toContain('tail-pw');
    expect(redactText(long, env)).toContain('https://***@h.test');
  });

  it('LOG_LEVEL of an inherited property name is not a level; a message whose toString throws still writes a line', () => {
    expect(logLevel({ LOG_LEVEL: 'constructor' })).toBe('info');
    expect(logLevel({ LOG_LEVEL: ' WARN ' })).toBe('warn');
    const lines: string[] = [];
    const log = createLog('t', { env: {}, sink: (l) => lines.push(l) });
    log.error({ toString() { throw new Error('no'); } } as unknown as string, { password: 'p' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('=p');
    // A text line never spans two lines (a message cannot forge another line).
    log.info('one\n[jobs] forged');
    expect(lines[1]).toBe('[t] one\\n[jobs] forged');
  });

  it('the default sink: warn/error to stderr, info/debug to stdout; the env is read at each call', () => {
    const env2: Record<string, string | undefined> = { LOG_LEVEL: 'debug' };
    const out: string[] = [];
    const err: string[] = [];
    const ol = console.log;
    const oe = console.error;
    console.log = (l: string) => { out.push(l); };
    console.error = (l: string) => { err.push(l); };
    try {
      const log = createLog('s', { env: env2 });
      log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
      env2.LOG_LEVEL = 'error';
      log.warn('hidden now');
    } finally {
      console.log = ol;
      console.error = oe;
    }
    expect(out).toEqual(['[s] d', '[s] i']);
    expect(err).toEqual(['[s] WARN w', '[s] ERROR e']);
  });
});

describe('secret key names are whole words (fix round 1, ruling)', () => {
  const readable = ['signal', 'stopSignal', 'design', 'passed', 'bypass', 'assignee', 'tokenCount', 'passCount', 'dedupeKey', 'fieldKey', 'keys', 'sourceId', 'author', 'maxTokens'];
  const secret = ['password', 'apiKey', 'api_key', 'x-api-key', 'X-API-KEY', 'accessKey', 'privateKey', 'credentials', 'auth', 'Pwd', 'authToken',
    'X-Auth-Token', 'sessionToken', 'client_secret', 'clientSecret', 'AUTHORIZATION', 'DB_PASSWORD', 'passwd', 'pwd', 'accesstoken', 'set-cookie',
    'proxy-authorization', 'sig', 'X-Amz-Signature', 'apiToken', 'webhookSecret', 'pass', 'cookie', 'refreshtoken'];

  it('isSecretKey: the two lists', () => {
    for (const k of readable) expect([k, isSecretKey(k)]).toEqual([k, false]);
    for (const k of secret) expect([k, isSecretKey(k)]).toEqual([k, true]);
  });

  it('object keys follow it', () => {
    const v = redactValue(Object.fromEntries([...readable, ...secret].map((k) => [k, 'v'])), {}) as Record<string, string>;
    for (const k of readable) expect([k, v[k]]).toEqual([k, 'v']);
    for (const k of secret) expect([k, v[k]]).toEqual([k, MASK]);
  });

  it('query parameters and JSON names follow it, auth= included', () => {
    expect(redactText('/x?signal=1&design=a&auth=s1&apiKey=s2&tokenCount=3&access_token=s3', {})).toBe('/x?signal=1&design=a&auth=***&apiKey=***&tokenCount=3&access_token=***');
    expect(redactText('{"design":"a","passCount":2,"clientSecret":"s4"}', {})).toBe('{"design":"a","passCount":2,"clientSecret":"***"}');
    expect(redactText('u=%2Fx%3Fdesign%3Da%26auth%3Ds5', {})).toBe('u=%2Fx%3Fdesign%3Da%26auth%3D***');
  });
});

describe('secrets written as name: value or name = value in text (fix round 1, I2)', () => {
  it('bare, quoted, inspect and header forms', () => {
    const cases: Array<[string, string]> = [
      ['password: hunter2', 'password: ***'],
      ['token: abc, next: 1', 'token: ***, next: 1'],
      ['password = s3cret then', 'password = *** then'],
      ["{ password: 'x1', apiKey: 'y1', design: 'kept' }", "{ password: '***', apiKey: '***', design: 'kept' }"],
      ["{'password':'x2','n':1}", "{'password':'***','n':1}"],
      ['X-Auth-Token: tok-3', 'X-Auth-Token: ***'],
      ['x-api-key: k-4', 'x-api-key: ***'],
      ['signal: SIGTERM design: a', 'signal: SIGTERM design: a'],
      ['note: "see password: p5 here"', 'note: "see password: *** here"'],
      ['url: http://h.test/?token=t6', 'url: http://h.test/?token=***'],
    ];
    for (const [input, want] of cases) expect(redactText(input, {})).toBe(want);
  });
});

describe('fix round 1, minors', () => {
  it('M1: a Bearer/Basic token is masked to the next space; an Authorization line to its end', () => {
    expect(redactText('Bearer abc!SEKRET next', {})).toBe('Bearer *** next');
    expect(redactText('Basic dXNl:cGFz!x', {})).toBe('Basic ***');
    expect(redactText('Authorization: Bearer abc SEKRET\nnext line', {})).toBe('Authorization: Bearer ***\nnext line');
    expect(redactText('proxy-authorization: Basic dXNlcjpwYXNz more', {})).toBe('proxy-authorization: Basic ***');
  });
});

describe('fix round 1, M2', () => {
  it('user:pass@host:port with no scheme', () => {
    expect(redactText('proxy user-de:pa@ss@proxy.test:8080 failed', {})).toBe('proxy ***@proxy.test:8080 failed');
    expect(redactText('server=robot:pw-1@db.test:5432/robot', {})).toBe('server=***@db.test:5432/robot');
    expect(redactText('mail a@b.test:25 at 12:30 by x@y.test', {})).toBe('mail a@b.test:25 at 12:30 by x@y.test');
    expect(redactText('http://u:p@h.test:1', {})).toBe('http://***@h.test:1');
  });
});

describe('fix round 1, M3: secret values from the environment', () => {
  it('SMTP_URL: its password raw, decoded and encoded; an undecodable password still masked; its username never sprayed over text', () => {
    expect(redactText('pw is 100%zz', { SMTP_URL: 'smtp://u:100%zz@m.test' })).toBe('pw is ***');
    expect(redactText('a banana longpass1', { SMTP_URL: 'smtp://a:longpass1@m.test' })).toBe('a banana ***');
    expect(redactText('p@ss-word and p%40ss-word', { SMTP_URL: 'smtp://apikey:p%40ss-word@m.test' })).toBe('*** and ***');
    expect(redactText('apikey user', { SMTP_URL: 'smtp://apikey:p%40ss-word@m.test' })).toBe('apikey user');
  });

  it('values of 6 characters or more are masked; shorter ones are not keys', () => {
    expect(redactText('k abcdef and abcde', { ERROR_REPORT_TOKEN: 'abcdef', TYPESAFE_API_KEY: 'abcde' })).toBe('k *** and abcde');
  });
});

describe('fix round 1, M4', () => {
  it('the passwords inside DATABASE_URL and DEFAULT_PROXY_URL, wherever they appear; a password equal to its user name is not', () => {
    const env = { DATABASE_URL: 'postgresql://robot:db-pass-77@db.test/x', DEFAULT_PROXY_URL: 'http://user-country-{country}:proxy-pw-9@gate.test:7000' };
    expect(redactText('auth failed (db-pass-77) then proxy-pw-9', env)).toBe('auth failed (***) then ***');
    expect(redactText('the postgres user', { DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/robot_platform' })).toBe('the postgres user');
  });
});

describe('fix round 1, text format', () => {
  const T2 = new Date('2026-10-25T12:00:00.000Z');
  it('M5: C0/C1 controls, DEL, U+2028/2029 are escaped in the message and in values (a value carrying one is quoted)', () => {
    expect(formatLine('info', 't', 'a\x1b[2Jb\u2028c\u0085d\x7fe\tf', undefined, 'text', T2, {})).toBe('[t] a\\u001b[2Jb\\u2028c\\u0085d\\u007fe\\tf');
    expect(formatLine('info', 't', 'm', { v: 'x\x1by', w: 'p\u2029q', o: { a: '\u0085' } }, 'text', T2, {}))
      .toBe('[t] m v="x\\u001by" w="p\\u2029q" o={"a":"\\u0085"}');
  });
});

describe('fix round 1, keys in a line', () => {
  const T3 = new Date('2026-10-25T12:00:00.000Z');
  it('M6: a text key that is not a plain name is quoted, so it cannot forge a field', () => {
    expect(formatLine('info', 't', 'm', { 'a b=c': 1, ok: 2, 'x.y-z_1': 3 }, 'text', T3, {})).toBe('[t] m "a b=c"=1 ok=2 x.y-z_1=3');
  });
});

describe('fix round 1, M7', () => {
  it('a field named __proto__ is kept in a JSON line, prefixed like a reserved name', () => {
    const fields = JSON.parse('{"__proto__":{"x":1},"n":2}') as Record<string, unknown>;
    const o = JSON.parse(formatLine('info', 't', 'm', fields, 'json', new Date('2026-10-25T12:00:00.000Z'), {}));
    expect(o).toEqual({ t: '2026-10-25T12:00:00.000Z', level: 'info', scope: 't', msg: 'm', field___proto__: { x: 1 }, n: 2 });
  });
});
