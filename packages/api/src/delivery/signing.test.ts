// Spec 2026-10-24 §3.3–§3.4: the body signature and the signed file links. Pure.
import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { bodySignature, checkFileSignature, fileSignature, LINK_TTL_S, newWebhookSecret, publicApiUrl, signedFileUrl } from './signing.js';

const SECRET = 'a'.repeat(64);
const RUN = '3f1c2b4a-1111-4111-8111-111111111111';
const EXP = 2_000_000_000;

describe('signing', () => {
  it('the body signature is sha256= and the hex HMAC-SHA256 of the raw body', () => {
    expect(bodySignature(SECRET, '{"a":1}')).toBe(`sha256=${createHmac('sha256', SECRET).update('{"a":1}').digest('hex')}`);
  });
  it('a file signature is the HMAC of "<runId>.<fmt>.<expires>"', () => {
    expect(fileSignature(SECRET, RUN, 'csv', EXP)).toBe(createHmac('sha256', SECRET).update(`${RUN}.csv.${EXP}`).digest('hex'));
  });
  it('a signed link is absolute, names the run and format, and checks back', () => {
    const url = signedFileUrl('http://api.test/', SECRET, RUN, 'csv', EXP);
    expect(url).toBe(`http://api.test/export/runs/${RUN}.csv?expires=${EXP}&sig=${fileSignature(SECRET, RUN, 'csv', EXP)}`);
    const q = new URL(url).searchParams;
    expect(checkFileSignature({ secret: SECRET, runId: RUN, format: 'csv', expires: q.get('expires')!, sig: q.get('sig')!, nowS: EXP - 1 })).toBe(true);
  });
  const good = { secret: SECRET as string | null, runId: RUN, format: 'csv', expires: String(EXP) as string | undefined, sig: fileSignature(SECRET, RUN, 'csv', EXP) as string | undefined, nowS: EXP - 60 };
  it.each([
    ['another run', { runId: '9a8b7c6d-2222-4222-8222-222222222222' }],
    ['another format', { format: 'json' }],
    ['a replaced secret', { secret: 'b'.repeat(64) }],
    ['no secret', { secret: null }],
    ['an empty secret', { secret: '' }],
    ['expired', { nowS: EXP }],
    ['a tampered signature', { sig: `${good.sig!.slice(0, -1)}${good.sig!.endsWith('0') ? '1' : '0'}` }],
    ['a short signature', { sig: 'abc' }],
    ['a long signature', { sig: `${good.sig!}00` }],
    ['a signature that is not hex', { sig: `${good.sig!.slice(0, -1)}g` }],
    ['an empty signature', { sig: '' }],
    ['no signature', { sig: undefined }],
    ['no expiry', { expires: undefined }],
    ['an expiry that is not a whole number', { expires: '2e9' }],
    ['a signed expiry', { expires: `+${EXP}` }],
    ['a padded expiry', { expires: ` ${EXP}` }],
    ['a later expiry under the old signature', { expires: String(EXP + 1) }],
  ])('refuses %s', (_why, change) => {
    expect(checkFileSignature({ ...good, ...change })).toBe(false);
  });
  it('the dot separator cannot be shifted between run and format', () => {
    const sig = fileSignature(SECRET, 'a.b', 'csv', EXP);
    expect(checkFileSignature({ secret: SECRET, runId: 'a', format: 'b.csv', expires: String(EXP), sig, nowS: 0 })).toBe(false);
    expect(checkFileSignature({ secret: SECRET, runId: 'a.b', format: 'csv', expires: String(EXP), sig, nowS: 0 })).toBe(false);
  });
  it('an upper-case signature is the same signature', () => {
    expect(checkFileSignature({ ...good, sig: good.sig!.toUpperCase() })).toBe(true);
  });
  it('links live seven days', () => expect(LINK_TTL_S).toBe(7 * 86_400));
  it('a secret is 32 random bytes, hex', () => {
    const a = newWebhookSecret();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newWebhookSecret()).not.toBe(a);
  });
  it('PUBLIC_API_URL, default http://localhost:4000, without a trailing slash', () => {
    expect(publicApiUrl({})).toBe('http://localhost:4000');
    expect(publicApiUrl({ PUBLIC_API_URL: 'https://api.example.com/ ' })).toBe('https://api.example.com');
  });
});
