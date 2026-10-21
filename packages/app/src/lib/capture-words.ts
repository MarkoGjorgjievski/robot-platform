// Capture-failure sentences in customer words (spec 2026-10-21). The stored text — the sentence
// `verdictSentence` (packages/browser/src/verdict-copy.ts) wrote, which drift and the run
// diagnosis read as is — never changes; this maps it at display time. Staff (`showsMoney`: an
// operator, or a staff session in the org) read the stored text. Pure.

export const PAGE_NOT_READ_SENTENCE = "We couldn't read this page. Try again.";
/** The blocked-run diagnosis's fallback when its evidence is not one of our verdict sentences. */
export const BLOCKED_SENTENCE = 'This website turned us away for now. Wait a few minutes and try again.';

/** One rule per verdict sentence shape in verdict-copy.ts; `.+` is the host (or the raw URL when it did not parse). */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Reached .+ \(HTTP \d+\)\.$/, 'This website opens normally.'],
  [/^.+ refused the browser \(HTTP \d+(?:, [^)]*)?\)\. We can't read this website from here yet\.$/, "This website turned us away, so we can't read it yet."],
  [/^.+ asked for a human check \(CAPTCHA\)\. /, 'This website asked for a human check. Wait a few minutes and try again; its other pages are behind the same check.'],
  [/^That page doesn't exist on .+ \(404\)\. Check the address\.$/, "That page doesn't exist. Check the address."],
  [/^That address led to \S+\. Paste a page on .+\.$/, 'That address opened a page on another website. Paste a page from this website.'],
  [/^.+ sent an empty page\. Try again\.$/, 'The page came back empty. Try again.'],
  [/^The page did not show the variant the address names \([\s\S]*\)\.$/, 'The page did not show the variant its address names. Check the address, or use another product.'],
  [/^The browser crashed on this page\. Try again\.$/, 'The page stopped loading before we could read it. Try again.'],
  [/^.+ could not be reached \(no response\)\.$/, 'This website did not respond. Check the address, or try again later.'],
  [/^.+ did not answer in time\.$/, 'This website took too long to answer. Try again.'],
  [/^redirected to \S+$/i, 'That address opened a different page. Check the link, or use another product.'],
];

/**
 * Our own sentences that would otherwise trip LEAK ("browser"). A copy of `BROWSER_UNAVAILABLE` in
 * packages/browser/src/verdict-copy.ts — the shipped app imports nothing from @robot/browser; the
 * capture-words test pins that it passes through.
 */
const OWN = new Set(["We couldn't open a browser to read this page. Try again in a minute."]);

/** Wrappers a customer keeps, with the text inside them mapped: record-outcome's and the execute guard's (api crawl/execute-guard.ts). */
const KEPT_PREFIXES = ['Not tried: ', 'This run failed while planning: '];
/** extraction-orchestrator.ts's wrapper: internal wording, dropped for a customer (the inner text is mapped, or becomes the fallback). */
const DROPPED_PREFIX = /^Page blocked or unusable:\s*/i;
const WAITING = /\s*(Waiting \d+ min before trying again\.)$/;
const HOST = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i;
const LEAK = new RegExp(
  [
    /https?:\/\//,
    /\bHTTP\b/,
    /\(\d{3}\)/,
    /status \d{3}/,
    /\b(?:Cloudflare|Akamai|PerimeterX|DataDome|AWS WAF|CAPTCHA)\b/,
    /\b(?:Error|Exception)\b/,
    /net::ERR_/,
    /localhost/,
    /\n/,
    // Playwright and library text (verify-messages.ts RAW's patterns, and more).
    /Timeout \d+ms/,
    /\bpage\.\w+/,
    /browserType/,
    /Target (?:page|closed)/,
    /\s at /,
    /\b[a-z]\w*\.[a-z]\w*: /,
    /\bbrowser\b/,
    /crashed!/,
    /\b\d{1,3}(?:\.\d{1,3}){3}\b/,
  ].map((r) => r.source).join('|'),
  'i',
);
/** A system error code (ECONNREFUSED, ETIMEDOUT, …): case-sensitive, so our own capitalised words never match. */
const ERROR_CODE = /\bE[A-Z]{3,}\b/;

function leaks(body: string): boolean {
  return HOST.test(body) || LEAK.test(body) || ERROR_CODE.test(body);
}

/** A stored capture text as `staff` reads it (unchanged) or as a customer does (spec §3's table). */
export function captureWords(text: string, staff = false, fallback = PAGE_NOT_READ_SENTENCE): string {
  if (staff) return text;
  let body = text.trim();
  let prefix = '';
  for (let found = true; found; ) {
    found = false;
    for (const p of KEPT_PREFIXES) {
      if (body.startsWith(p)) {
        prefix += p;
        body = body.slice(p.length);
        found = true;
      }
    }
  }
  const wait = WAITING.exec(body);
  const suffix = wait ? ` ${wait[1]}` : '';
  if (wait) body = body.slice(0, wait.index);
  const dropped = DROPPED_PREFIX.exec(body);
  if (dropped) body = body.slice(dropped[0].length);
  const rule = RULES.find(([re]) => re.test(body));
  const sentence = rule ? rule[1] : dropped || (!OWN.has(body) && leaks(body)) ? fallback : body;
  return `${prefix}${sentence}${suffix}`;
}
