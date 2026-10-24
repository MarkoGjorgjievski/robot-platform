// packages/api/src/email/render.ts
// The five messages (spec 2026-10-24 email §3.1): plain text and a simple HTML version with the same content —
// what happened in customer words, the names, one link into the app and, for the kinds a person can turn off, the
// footer. Pure. Customer copy: no money, no HTTP codes, no hosts but the app link, never "budget", no internals
// (render.test.ts sweeps every kind).
import type { MembershipRole } from '@robot/db';
import { captureWords } from '@robot/scraper/customer-copy';

export type RenderedEmail = { subject: string; text: string; html: string };
/** A website's place in the app: the names a message gives and the slugs its link is built from. */
export type Place = { base: string; org: string; project: string; website: string; projectSlug: string; siteSlug: string };

type Body = {
  subject: string;
  paragraphs: string[];
  facts: Array<[label: string, value: string]>;
  link: { label: string; url: string };
  /** The organisation a person looks after, for the footer of a kind they can turn off; null: always sent. */
  footerOrg: string | null;
};

/** One line: a name with a line break never adds a header, a paragraph or a fact. */
export function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function accountUrl(base: string): string {
  return `${base}/account`;
}

/** The website's Verification tab. */
export function websiteUrl(p: Place): string {
  return `${p.base}/projects/${encodeURIComponent(p.projectSlug)}/sites/${encodeURIComponent(p.siteSlug)}`;
}

const FONT = 'font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5';
const MUTED = 'color:#555555';

function layout(b: Body, base: string): RenderedEmail {
  const paragraphs = b.paragraphs.map(oneLine).filter((p) => p !== '');
  const facts = b.facts.map(([k, v]) => [k, oneLine(v)] as const);
  const footer = b.footerOrg === null ? null : { org: oneLine(b.footerOrg), url: accountUrl(base) };
  const text = [
    ...paragraphs,
    facts.map(([k, v]) => `${k}: ${v}`).join('\n'),
    `${b.link.label}: ${b.link.url}`,
    ...(footer ? [`--\nYou get this because you look after ${footer.org}. Choose which emails you get: ${footer.url}`] : []),
  ].filter((s) => s !== '').join('\n\n') + '\n';
  const e = escapeHtml;
  const html = [
    '<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;color:#111111;', FONT, '">',
    ...paragraphs.map((p) => `<p style="margin:0 0 16px">${e(p)}</p>`),
    facts.length > 0 ? `<p style="margin:0 0 16px">${facts.map(([k, v]) => `<span style="${MUTED}">${e(k)}:</span> ${e(v)}`).join('<br>')}</p>` : '',
    `<p style="margin:0 0 24px"><a href="${e(b.link.url)}" style="color:#111111">${e(b.link.label)}</a>: ${e(b.link.url)}</p>`,
    footer
      ? `<p style="margin:0;padding-top:12px;border-top:1px solid #dddddd;${MUTED};font-size:13px">You get this because you look after ${e(footer.org)}. Choose which emails you get: <a href="${e(footer.url)}" style="${MUTED}">${e(footer.url)}</a></p>`
      : '',
    '</body></html>',
  ].join('');
  return { subject: oneLine(b.subject), text, html };
}

const placeFacts = (p: Place): Body['facts'] => [['Website', p.website], ['Project', p.project], ['Organisation', p.org]];

export function attentionEmail(p: Place & { reason: string }): RenderedEmail {
  return layout({
    subject: `${p.website} needs your attention`,
    paragraphs: [p.reason, 'Open the website to see what changed and what it needs from you.'],
    facts: placeFacts(p),
    link: { label: 'Open the website', url: websiteUrl(p) },
    footerOrg: p.org,
  }, p.base);
}

export function runFailedEmail(p: Place & { runId: string; stored: string | null }): RenderedEmail {
  const why = p.stored && p.stored.trim() !== '' ? captureWords(p.stored, false) : null;
  return layout({
    subject: `A run of ${p.website} failed`,
    paragraphs: [`A run of ${p.website} failed.`, ...(why ? [why] : []), 'Open the run to see what happened.'],
    facts: placeFacts(p),
    link: { label: 'Open the run', url: `${websiteUrl(p)}/runs/${encodeURIComponent(p.runId)}` },
    footerOrg: p.org,
  }, p.base);
}

export function staffAccessEmail(p: { base: string; org: string; website: string | null; project: string | null }): RenderedEmail {
  return layout({
    subject: 'Our team is working in your organisation',
    paragraphs: [
      `Someone from our team started working in ${p.org}.`,
      "Everything they change is listed in your organisation's Settings, and each visit lasts at most 8 hours.",
    ],
    facts: [
      ...(p.website ? [['Website', p.website] as [string, string]] : []),
      ...(p.project ? [['Project', p.project] as [string, string]] : []),
      ['Organisation', p.org],
    ],
    link: { label: 'Open Settings', url: `${p.base}/settings` },
    footerOrg: null,
  }, p.base);
}

const ROLE_WORDS: Record<MembershipRole, string> = { owner: 'an owner', admin: 'an admin', member: 'a member' };
const ROLE_LABELS: Record<MembershipRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export function roleChangedEmail(p: { base: string; org: string; role: MembershipRole }): RenderedEmail {
  return layout({
    subject: `Your role in ${p.org} changed`,
    paragraphs: [`You are now ${ROLE_WORDS[p.role]} of ${p.org}.`],
    facts: [['Organisation', p.org], ['Your role', ROLE_LABELS[p.role]]],
    link: { label: 'Open Settings', url: `${p.base}/settings` },
    footerOrg: null,
  }, p.base);
}

export function removedEmail(p: { base: string; org: string }): RenderedEmail {
  return layout({
    subject: `You were removed from ${p.org}`,
    paragraphs: [
      `You are no longer a member of ${p.org}, so its projects and websites are no longer open to you.`,
      `If you think this is a mistake, ask an owner or admin of ${p.org}.`,
    ],
    facts: [['Organisation', p.org]],
    link: { label: 'Sign in', url: `${p.base}/login` },
    footerOrg: null,
  }, p.base);
}
