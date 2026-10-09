import { describe, expect, it } from 'vitest';
import { verdictSentence } from './verdict-copy.js';

const U = 'https://www.scan.co.uk/shop/ssd';
describe('verdictSentence', () => {
  it('refused names the host, status and vendor', () => {
    expect(verdictSentence({ kind: 'refused', status: 403, vendor: 'cloudflare' }, U)).toBe("scan.co.uk refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet.");
    expect(verdictSentence({ kind: 'refused', status: 429 }, U)).toBe("scan.co.uk refused the browser (HTTP 429). We can't read this website from here yet.");
  });
  it('the other kinds', () => {
    expect(verdictSentence({ kind: 'challenge', status: 200, vendor: 'aws-waf' }, U)).toBe("scan.co.uk asked for a human check (CAPTCHA). Wait a few minutes and try again; pasting product pages won't help, they are behind the same check.");
    expect(verdictSentence({ kind: 'not-found', status: 404 }, U)).toBe("That page doesn't exist on scan.co.uk (404). Check the address.");
    expect(verdictSentence({ kind: 'redirected', status: 200, to: 'login.other.example' }, U)).toBe('That address led to login.other.example. Paste a page on scan.co.uk.');
    expect(verdictSentence({ kind: 'blank', status: 200 }, U)).toBe('scan.co.uk sent an empty page. Try again.');
    expect(verdictSentence({ kind: 'crashed' }, U)).toBe('The browser crashed on this page. It will be retried.');
    expect(verdictSentence({ kind: 'unreachable' }, U)).toBe('scan.co.uk could not be reached (no response).');
    expect(verdictSentence({ kind: 'timeout' }, U)).toBe('scan.co.uk did not answer in time.');
    expect(verdictSentence({ kind: 'ok', status: 200 }, U)).toBe('Reached scan.co.uk (HTTP 200).');
  });
  it('strips a leading www. from the host', () => {
    expect(verdictSentence({ kind: 'blank', status: 200 }, 'https://www.otto.de/p/1')).toBe('otto.de sent an empty page. Try again.');
  });
});
