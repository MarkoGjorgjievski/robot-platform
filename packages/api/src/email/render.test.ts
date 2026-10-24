// The five messages (spec 2026-10-24 email §3.1, §4.4): what each says, the same content in text and HTML, and the
// customer-copy sweep over every subject, text and HTML body.
import { describe, it, expect } from 'vitest';
import { attentionSentence } from '@robot/scraper/customer-copy';
import { publicAppUrl } from './config.js';
import {
  attentionEmail, removedEmail, roleChangedEmail, runFailedEmail, staffAccessEmail, type Place, type RenderedEmail,
} from './render.js';

const BASE = 'http://localhost:3000';
const RUN = '3f1c2b4a-1111-4111-8111-111111111111';
const PLACE: Place = { base: BASE, org: 'Acme', project: 'Spring catalogue', website: 'Lamp shop', projectSlug: 'spring-catalogue', siteSlug: 'lamp-shop' };
const REASON = attentionSentence({ fields: ['price'], fieldNames: { price: 'Price' }, goneProducts: [2], heldSince: new Date(2026, 9, 8), runnable: true })!;
/** Stored run sentences as the engine writes them — hosts, codes and library text a customer must never read. */
const STORED = [
  "That page doesn't exist on shop.example.com (404). Check the address.",
  'page.goto: Timeout 30000ms exceeded.\nCall log:\n  - navigating to "https://shop.example.com/p/1"',
  "shop.example.com refused the browser (HTTP 403, cloudflare). We can't read this website from here yet.",
  'This run stopped before it finished. Extract again to pick up where it left off.',
  null,
];

const ALL: Array<[string, RenderedEmail]> = [
  ['attention', attentionEmail({ ...PLACE, reason: REASON })],
  ...STORED.map((stored): [string, RenderedEmail] => [`run-failed (${stored?.slice(0, 20) ?? 'no sentence'})`, runFailedEmail({ ...PLACE, runId: RUN, stored })]),
  ['staff-access', staffAccessEmail({ base: BASE, org: 'Acme', website: 'Lamp shop', project: 'Spring catalogue' })],
  ['staff-access, no website', staffAccessEmail({ base: BASE, org: 'Acme', website: null, project: null })],
  ...(['owner', 'admin', 'member'] as const).map((role): [string, RenderedEmail] => [`role-changed ${role}`, roleChangedEmail({ base: BASE, org: 'Acme', role })]),
  ['removed', removedEmail({ base: BASE, org: 'Acme' })],
];

/** What a reader sees of the HTML: tags gone, entities decoded. */
const visible = (html: string) => html.replace(/<br>/g, '\n').replace(/<\/p>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
/** The app's own links are allowed; everything else is swept. */
const withoutAppLinks = (s: string) => s.replace(/http:\/\/localhost:3000[^\s"<]*/g, 'APP');

const FORBIDDEN: Array<[string, RegExp]> = [
  ['money', /[$€£]|\b(?:USD|EUR|GBP|cost|costs|spend|spent|credits?|invoice)\b/i],
  ['an HTTP code', /\bHTTP\b|\(\d{3}\)|\bstatus \d{3}\b|\b[1-5]\d{2}\b/],
  ['budget', /\bbudget\b/i],
  ['internals', /\b(?:Jev|TypeSafe|Claude|Anthropic|models?|AI|jobs?|queues?|workers?|lanes?|SMTP|drift|holds?|held|xpath|json|paths?|CAPTCHA|browser|Playwright|timeout)\b/i],
  ['a host', /https?:\/\/|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b|localhost|\b\d{1,3}(?:\.\d{1,3}){3}\b/i],
];

describe('the messages (spec §3.1)', () => {
  it('attention: the subject, the banner sentence, the names, the Verification link and the footer', () => {
    const m = attentionEmail({ ...PLACE, reason: REASON });
    expect(m.subject).toBe('Lamp shop needs your attention');
    expect(m.text).toContain('Price needs you and product 2 no longer loads — runs go on with what you verified on 8 Oct.');
    expect(m.text).toContain('Website: Lamp shop\nProject: Spring catalogue\nOrganisation: Acme');
    expect(m.text).toContain('Open the website: http://localhost:3000/projects/spring-catalogue/sites/lamp-shop');
    expect(m.text).toContain('You get this because you look after Acme. Choose which emails you get: http://localhost:3000/account');
  });
  it('run-failed: the run page, and the stored sentence in customer words', () => {
    const m = runFailedEmail({ ...PLACE, runId: RUN, stored: STORED[0]! });
    expect(m.subject).toBe('A run of Lamp shop failed');
    expect(m.text).toContain("That page doesn't exist. Check the address.");
    expect(m.text).toContain(`Open the run: http://localhost:3000/projects/spring-catalogue/sites/lamp-shop/runs/${RUN}`);
    expect(m.text).toContain('Choose which emails you get: http://localhost:3000/account');
    expect(runFailedEmail({ ...PLACE, runId: RUN, stored: null }).text).toContain('A run of Lamp shop failed.');
  });
  it('staff-access, role-changed and removed: account messages, always sent, so no footer', () => {
    const staff = staffAccessEmail({ base: BASE, org: 'Acme', website: 'Lamp shop', project: 'Spring catalogue' });
    expect(staff.subject).toBe('Our team is working in your organisation');
    expect(staff.text).toContain('Open Settings: http://localhost:3000/settings');
    expect(staff.text).toContain('Website: Lamp shop');
    expect(staffAccessEmail({ base: BASE, org: 'Acme', website: null, project: null }).text).not.toContain('Website:');
    const role = roleChangedEmail({ base: BASE, org: 'Acme', role: 'admin' });
    expect(role.subject).toBe('Your role in Acme changed');
    expect(role.text).toContain('You are now an admin of Acme.');
    expect(roleChangedEmail({ base: BASE, org: 'Acme', role: 'member' }).text).toContain('You are now a member of Acme.');
    const removed = removedEmail({ base: BASE, org: 'Acme' });
    expect(removed.subject).toBe('You were removed from Acme');
    expect(removed.text).toContain('Sign in: http://localhost:3000/login');
    for (const m of [staff, role, removed]) expect(m.text).not.toContain('Choose which emails you get');
  });
  it('the links are built on PUBLIC_APP_URL, default http://localhost:3000, never with a trailing slash', () => {
    expect(publicAppUrl({})).toBe('http://localhost:3000');
    expect(publicAppUrl({ PUBLIC_APP_URL: ' https://app.example.com/ ' })).toBe('https://app.example.com');
    const m = removedEmail({ base: publicAppUrl({ PUBLIC_APP_URL: 'https://app.example.com/' }), org: 'Acme' });
    expect(m.text).toContain('Sign in: https://app.example.com/login');
  });
});

describe('text and HTML say the same (spec §3.1)', () => {
  it.each(ALL)('%s', (_name, m) => {
    const seen = squash(visible(m.html));
    for (const line of m.text.split('\n').filter((l) => l.trim() !== '' && l !== '--')) expect(seen).toContain(squash(line));
    for (const href of hrefs(m.html)) expect(href.startsWith(`${BASE}/`)).toBe(true);
  });
});

describe('customer-copy sweep (spec §4.4)', () => {
  it.each(ALL)('%s carries no money, code, host, budget or internal', (_name, m) => {
    for (const part of [m.subject, m.text, visible(m.html)]) {
      const body = withoutAppLinks(part);
      for (const [what, re] of FORBIDDEN) expect(body, `${what} in: ${body}`).not.toMatch(re);
    }
  });
});

describe('RF2: names with markup and line breaks are escaped in HTML and kept on one line', () => {
  it('a hostile website, project and organisation name', () => {
    const evil = "Tom & Jerry's <b>Shop</b>\r\nBcc: x@example.com";
    const m = attentionEmail({ ...PLACE, website: evil, project: `${evil} p`, org: `${evil} o`, reason: REASON });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toBe("Tom & Jerry's <b>Shop</b> Bcc: x@example.com needs your attention");
    expect(m.html).not.toContain('<b>');
    expect(m.html).toContain('Tom &amp; Jerry&#39;s &lt;b&gt;Shop&lt;/b&gt; Bcc: x@example.com');
    expect(m.text).toContain("Website: Tom & Jerry's <b>Shop</b> Bcc: x@example.com\n");
    expect(m.text.split('\n').filter((l) => l.startsWith('Bcc:'))).toEqual([]);
  });
});
