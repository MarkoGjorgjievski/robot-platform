// packages/scraper/src/customer-copy.ts
// Customer sentences shared by the app (display) and the api (emails, spec 2026-10-24 email §3.1). Pure; imports
// nothing, so the app's browser bundle can import it (`@robot/scraper/customer-copy`) as it does `/normalize`.
//
// Capture-failure sentences in customer words (spec 2026-10-21). The stored text — the sentence `verdictSentence`
// (packages/browser/src/verdict-copy.ts) wrote, which drift and the run diagnosis read as is — never changes; this
// maps it at display time. Staff (`showsMoney`: an operator, or a staff session in the org) read the stored text.

export const PAGE_NOT_READ_SENTENCE = "We couldn't read this page. Try again.";
/** The blocked-run diagnosis's fallback when its evidence is not one of our verdict sentences. */
export const BLOCKED_SENTENCE = 'This website turned us away for now. Wait a few minutes and try again.';

/** Spec 2026-10-24 metering §2.3: the one sentence a customer reads when the organisation's monthly limit stops
 *  automatic setup (planning a run; a legacy website's pages). It names no AI, no money and no mechanism. */
export const CAP_REACHED_MESSAGE = "This organisation has reached this month's limit for automatic setup. Ask us to raise it.";

/** One rule per verdict sentence shape in verdict-copy.ts; `.+` is the host (or the raw URL when it did not parse). */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Reached .+ \(HTTP \d+\)\.$/, 'This website opens normally.'],
  [/^.+ refused the browser \(HTTP \d+(?:, [^)]*)?\)\. We can't read this website from here yet\.$/, "This website turned us away, so we can't read it yet."],
  // Spec 2026-10-24 proxy §2.2: a page the proxy would not carry is a blocked page to a customer — the same sentence,
  // and never the word "proxy". (@robot/browser's PROXY_REFUSED.)
  [/^The proxy refused the connection\.$/, "This website turned us away, so we can't read it yet."],
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

/** "a", "a and b", "a, b and c". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `d MMM`, e.g. "26 Sep" — locale-free, like the rest of the app's dates (the process's own time zone). */
export function formatDMMM(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export type AttentionSentenceArgs = {
  fields: string[];
  fieldNames: Record<string, string>;
  goneProducts: number[];
  heldSince: Date | string | null;
  runnable: boolean;
};

/**
 * What needs the customer on a website that changed (spec 2026-10-21 §5): the Verification banner's sentence, and
 * the reason a "needs your attention" email gives. Never names a path, a source, a check, a hold, a model or money.
 */
export function attentionSentence(args: AttentionSentenceArgs): string | null {
  const parts: string[] = [];
  if (args.fields.length > 0) {
    const names = args.fields.map((k) => args.fieldNames[k] ?? k);
    parts.push(`${joinList(names)} ${names.length === 1 ? 'needs' : 'need'} you`);
  }
  if (args.goneProducts.length === 1) parts.push(`product ${args.goneProducts[0]} no longer loads`);
  else if (args.goneProducts.length > 1) parts.push(`products ${joinList(args.goneProducts.map(String))} no longer load`);
  if (parts.length === 0) return null;
  const subject = joinList(parts);
  const tail = !args.runnable
    ? 'extraction waits for you.'
    : args.heldSince
      ? `runs go on with what you verified on ${formatDMMM(new Date(args.heldSince))}.`
      : 'runs go on as before.';
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} — ${tail}`;
}
