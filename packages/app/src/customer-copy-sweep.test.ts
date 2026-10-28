// Customer copy never says "budget", an HTTP code, or a verdict's staff wording (spec 2026-10-21 §6).
// Reads every shipped .ts/.tsx under src with the TypeScript parser — string literals, template
// text and JSX text only, so identifiers and comments never count. Staff screens are exempt.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('.', import.meta.url));
const STAFF = [
  /^routes\/_app\/ops\//,
  /^components\/ops\//,
  /^lib\/ops-view\.ts$/,
  /^components\/settings\/network-panel\.tsx$/,
  /^lib\/site\/network-view\.ts$/,
];
// The customer sentences the app and the emails share live in @robot/scraper (spec 2026-10-24 email §3.1):
// swept here too, with no exemption.
const SHARED = [fileURLToPath(new URL('../../scraper/src/customer-copy.ts', import.meta.url))];
const FORBIDDEN = [/\bbudget\b/i, /\bHTTP \d/, /refused the browser/, /CAPTCHA/, /\bproxy\b/i];
// Spec 2026-10-24 proxy §2.3: "proxy" is staff-only. The Network panel and its view are staff files; diagnose-run.ts's
// staff branch keeps its one sentence (pinned by diagnose-run.test.ts: a customer never reads it).
// Spec 2026-10-28 §3.6: lib/site/turned-away.ts adds the route to a card's stored sentence for staff only (pinned by
// turned-away.test.ts: no customer line says proxy).
const STAFF_TEXT = new Set([' — wait and retry; long-term this needs the proxy line item.', ' (via fallback proxy)']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && !n.endsWith('routeTree.gen.ts') ? [p] : [];
  });
}

function texts(path: string): string[] {
  const sf = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const walk = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    else if (ts.isJsxText(n)) out.push(n.getText());
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

describe('customer copy sweep', () => {
  it('the shared customer copy is read', () => {
    expect(texts(SHARED[0]!).length).toBeGreaterThan(20);
  });

  it('no customer string says budget, an HTTP code or a verdict\'s staff wording', () => {
    const hits: string[] = [];
    for (const f of files(SRC)) {
      const rel = relative(SRC, f).split(sep).join('/');
      if (STAFF.some((re) => re.test(rel))) continue;
      for (const t of texts(f)) if (!STAFF_TEXT.has(t) && FORBIDDEN.some((re) => re.test(t))) hits.push(`${rel}: ${t.trim().slice(0, 80)}`);
    }
    for (const f of SHARED) for (const t of texts(f)) if (!STAFF_TEXT.has(t) && FORBIDDEN.some((re) => re.test(t))) hits.push(`scraper/customer-copy.ts: ${t.trim().slice(0, 80)}`);
    expect(hits).toEqual([]);
  });
});
