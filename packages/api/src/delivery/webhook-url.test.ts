// Spec 2026-10-24 §3.4 "Safety", when saving: which addresses a webhook may name. Pure.
import { describe, it, expect } from 'vitest';
import { checkWebhookUrl, hostIsPrivateLiteral, isPrivateAddress, PUBLIC_ADDRESS_MESSAGE, webhookPrivateAllowed } from './webhook-url.js';

describe('isPrivateAddress — the range table', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254',
    '100.64.0.1', '100.127.255.255', '0.0.0.0', '224.0.0.1', '239.255.255.255', '255.255.255.255',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:a00:1', '::ffff:192.168.1.1',
    'not-an-address',
  ])('%s is refused', (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '93.184.216.34', '2606:4700::1111', '::ffff:8.8.8.8', '2001:4860:4860::8888'])(
    '%s is public', (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('isPrivateAddress — bypass spellings', () => {
  it.each([
    // upper case, written out in full
    'FE80::1', '0000:0000:0000:0000:0000:0000:0000:0001', '0:0:0:0:0:FFFF:7F00:1',
    // zone ids: BlockList reads fe80::1%eth0 as public, so any scoped address is refused
    'fe80::1%eth0', '::ffff:127.0.0.1%1', '2606:4700::1111%1',
    // IPv4-compatible, IPv4-translated (RFC 2765), NAT64 well-known and local-use, 6to4 embedding a private v4
    '::127.0.0.1', '::ffff:0:7f00:1', '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '64:ff9b::169.254.169.254', '64:ff9b:1::1',
    '2002:7f00:1::', '2002:c0a8:101::1', '2002:a9fe:a9fe::1',
    // Teredo, discard, site-local; reserved v4 (protocol assignments, benchmarking, 240/4)
    '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '100::1', 'fec0::1', '192.0.0.8', '198.18.0.1', '198.19.255.255', '240.0.0.1',
    // not addresses at all
    '', ' 127.0.0.1', '127.0.0.1 ', '[::1]', '2130706433', '0x7f.0.0.1', '127.1', '1.2.3.4.5',
  ])('%s is refused', (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(['64:ff9b::808:808', '64:ff9b::8.8.8.8', '2002:808:808::1', '::ffff:1.1.1.1', '2a00:1450:4001:80b::200e'])(
    '%s is public', (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('checkWebhookUrl', () => {
  it('accepts a public address and hands it back normalised', () => {
    expect(checkWebhookUrl('  HTTPS://Hooks.Example.com/robot?x=1 ')).toEqual({ ok: true, url: 'https://hooks.example.com/robot?x=1' });
    expect(checkWebhookUrl('http://8.8.8.8:8080/hook').ok).toBe(true);
    expect(checkWebhookUrl('http://[2606:4700::1111]/hook').ok).toBe(true);
  });
  it.each([
    'http://127.0.0.1/hook', 'http://localhost:8080/hook', 'http://LOCALHOST./hook', 'http://app.localhost/', 'http://10.1.2.3/',
    'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data', 'http://100.64.0.1/', 'http://0.0.0.0/', 'http://224.0.0.1/',
    'http://[::1]/', 'http://[::]/', 'http://[fe80::1]/', 'http://[fd00::1]/', 'http://[ff02::1]/',
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a00:1]/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://127.1/',
  ])('refuses %s', (u) => expect(checkWebhookUrl(u)).toEqual({ ok: false, message: PUBLIC_ADDRESS_MESSAGE }));
  it.each([
    'http://0177.0.0.1/', 'http://0x7f000001/', 'http://017700000001/', 'http://127.0.0.1./', 'http://0/', 'http://0x0/',
    'HTTP://LocalHost/', 'http://localhost../', 'http://ｌｏｃａｌｈｏｓｔ/', 'http://a.b.LOCALHOST./',
    'http://[::ffff:7f00:1]/', 'http://[0:0:0:0:0:ffff:127.0.0.1]/', 'http://[::127.0.0.1]/', 'http://[64:ff9b::127.0.0.1]/',
    'http://[2002:7f00:1::]/', 'http://[::]:80/', 'http://[FE80::1]/', 'https://169.254.169.254:443/',
    'http://127.0.0.1\\@hooks.example.com/', 'http://127.0.0.1#@hooks.example.com/', 'http://127.0.0.1?@hooks.example.com/',
  ])('refuses the spelling %s', (u) => expect(checkWebhookUrl(u)).toEqual({ ok: false, message: PUBLIC_ADDRESS_MESSAGE }));
  it('a zone id is not a valid address at all', () => {
    expect(checkWebhookUrl('http://[fe80::1%25eth0]/').ok).toBe(false);
  });
  it.each([
    ['', 'Enter a web address.'],
    ['   ', 'Enter a web address.'],
    ['hooks.example.com/robot', 'Enter the full web address, starting with http or https.'],
    ['ftp://hooks.example.com/robot', 'Enter the full web address, starting with http or https.'],
    ['javascript:alert(1)', 'Enter the full web address, starting with http or https.'],
    ['file:///etc/passwd', 'Enter the full web address, starting with http or https.'],
    ['https://user:pass@hooks.example.com/robot', 'Leave the user name and password out of the address.'],
    ['https://user@hooks.example.com/robot', 'Leave the user name and password out of the address.'],
    ['https://:pass@hooks.example.com/robot', 'Leave the user name and password out of the address.'],
    ['http://hooks.example.com@127.0.0.1/', 'Leave the user name and password out of the address.'],
    [`https://hooks.example.com/${'a'.repeat(2000)}`, 'Use a web address of at most 2,000 characters.'],
  ])('%s → %s', (u, message) => expect(checkWebhookUrl(u)).toEqual({ ok: false, message }));
  it('WEBHOOK_ALLOW_PRIVATE lifts the range check only', () => {
    expect(checkWebhookUrl('http://127.0.0.1:9/x', { allowPrivate: true })).toEqual({ ok: true, url: 'http://127.0.0.1:9/x' });
    expect(checkWebhookUrl('ftp://127.0.0.1/x', { allowPrivate: true }).ok).toBe(false);
    expect(checkWebhookUrl('http://u@127.0.0.1/x', { allowPrivate: true }).ok).toBe(false);
    expect(webhookPrivateAllowed({ WEBHOOK_ALLOW_PRIVATE: 'on' })).toBe(true);
    expect(webhookPrivateAllowed({ WEBHOOK_ALLOW_PRIVATE: ' ON ' })).toBe(true);
    expect(webhookPrivateAllowed({ WEBHOOK_ALLOW_PRIVATE: '1' })).toBe(false);
    expect(webhookPrivateAllowed({})).toBe(false);
  });
  it('hostIsPrivateLiteral leaves names to the send-time lookup', () => {
    expect(hostIsPrivateLiteral('hooks.example.com')).toBe(false);
    expect(hostIsPrivateLiteral('[::1]')).toBe(true);
  });
  it('hostIsPrivateLiteral reads a raw hostname in any spelling', () => {
    for (const h of ['2130706433', '0x7f.1', '0177.0.0.1', '127.1', 'LOCALHOST.', 'x.localhost', '[::ffff:127.0.0.1]', '::ffff:7f00:1', 'fe80::1%eth0', '[fe80::1%25eth0]', '0', '']) {
      expect(hostIsPrivateLiteral(h), h).toBe(true);
    }
    for (const h of ['8.8.8.8', '[2606:4700::1111]', 'localhost.example.com', 'hooks.example.com.']) {
      expect(hostIsPrivateLiteral(h), h).toBe(false);
    }
  });
});
