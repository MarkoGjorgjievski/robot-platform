// Look-only browser check of step 1 of the Schema tab's stepper (spec
// 2026-09-18 §2.1): the field catalogue, the chips it adds, and the interim
// step 2 (today's proof sheet) they land in. Never touches a customer's real
// website — the throwaway website it creates points at example.com and nothing
// here ever clicks Verify, so no page is ever fetched.
//
// Run from packages/browser so `playwright` resolves:
//   cp docs/testing/ui-check-schema-step1.mts packages/browser/src/__ui-check.mts && cd packages/browser && pnpm exec tsx src/__ui-check.mts <outDir> ; rm src/__ui-check.mts
// Needs the user's dev servers already running (dashboard :3456, api :4000). Do not start or stop them.
import { chromium } from 'playwright';

const out = process.argv[2] ?? '.';
const DASH = 'http://localhost:3456';
const API = 'http://localhost:4000';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
};

/** tRPC-HTTP with superjson on the wire: `{json: …}` in, `{result:{data:{json: …}}}` out. */
async function trpc<T>(path: string, input: unknown): Promise<T> {
  const res = await fetch(`${API}/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const body = (await res.json()) as { result?: { data?: { json?: T } }; error?: { json?: { message?: string } } };
  if (!res.ok || body.error) throw new Error(`${path}: ${body.error?.json?.message ?? res.status}`);
  return body.result!.data!.json as T;
}

const stamp = Date.now();
const project = await trpc<{ id: string; slug: string; datasetId: string }>('projects.create', { name: `UI check ${stamp}` });
const site = await trpc<{ sourceId: string; sourceSlug: string }>('sources.createInProject', {
  projectSlug: project.slug,
  name: 'Check site',
  url: 'https://example.com/',
});
console.log(`throwaway project ${project.slug}, website ${site.sourceSlug}`);

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
const errors: string[] = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/favicon|React DevTools/i.test(t)) return;
  errors.push('console: ' + t.slice(0, 200));
});

try {
  const route = `/projects/${project.slug}/sources/${site.sourceSlug}`;

  // 1. The Schema tab with no fields at all: step 1 is the only step there is.
  await p.goto(DASH + route, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  let body = await p.locator('body').innerText();
  check('empty: the strip names both steps', body.includes('Fields') && body.includes('Pages and values'));
  check('empty: Product is the selected schema type', (await p.getByRole('tab', { name: 'Product' }).getAttribute('aria-selected')) === 'true');
  check('empty: "Next: pages" is disabled', await p.getByRole('button', { name: 'Next: pages' }).isDisabled());
  check('empty: section 2 says why it is out of reach', body.includes('Add a field first'));
  await p.screenshot({ path: `${out}/schema-step1-empty.png`, fullPage: true });

  // 2. Three chips from the Product catalogue.
  for (const name of ['Title', 'Price', 'Main image']) {
    await p.getByLabel(`Add ${name}`, { exact: true }).click();
    await p.getByLabel(`${name} (added)`, { exact: true }).waitFor({ timeout: 20_000 });
  }
  await p.waitForTimeout(800);
  const list = p.locator('section[aria-labelledby="extract-step-1"] table.sheet');
  for (const name of ['Title', 'Price', 'Main image']) {
    check(`added: "${name}" is in the field list`, (await list.getByText(name, { exact: true }).count()) > 0);
    check(`added: the "${name}" chip reads added and is disabled`, await p.getByLabel(`${name} (added)`, { exact: true }).isDisabled());
  }
  check('added: "Next: pages" is enabled', !(await p.getByRole('button', { name: 'Next: pages' }).isDisabled()));
  await p.screenshot({ path: `${out}/schema-step1-added.png`, fullPage: true });

  // 3. Another schema type: the chips swap, the field list does not.
  await p.getByRole('tab', { name: 'Article' }).click();
  await p.waitForTimeout(500);
  check('article: Article is now the selected schema type', (await p.getByRole('tab', { name: 'Article' }).getAttribute('aria-selected')) === 'true');
  check('article: the Article chips are on screen', (await p.getByLabel('Add Headline', { exact: true }).count()) > 0);
  check('article: the three added fields are still in the list', (await list.getByText('Title', { exact: true }).count()) > 0);
  await p.screenshot({ path: `${out}/schema-step1-article.png`, fullPage: true });

  // 4. On to the interim step 2: the proof sheet, with a row per field.
  await p.getByRole('button', { name: 'Next: pages' }).click();
  await p.waitForFunction(() => new URL(location.href).searchParams.get('step') === 'pages', undefined, { timeout: 10_000 }).catch(() => {});
  check('step 2: the url says step=pages', new URL(p.url()).searchParams.get('step') === 'pages');
  await p.waitForTimeout(1000);
  const sheet = p.locator('section[aria-labelledby="extract-step-2"]');
  check('step 2: the grid is open', (await sheet.getByText('Where it is on this website').count()) > 0);
  for (const name of ['Title', 'Price', 'Main image']) {
    check(`step 2: the grid has a row for "${name}"`, (await sheet.getByText(name, { exact: true }).count()) > 0);
  }
  // The catalogue's description is the website's default location hint: it is
  // the live value of the row's "Where it is on this website" input (a
  // controlled React input, so read the property, not the attribute).
  const hints = await sheet.locator('input').evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  for (const [name, hint] of [
    ['Title', 'The product name as shown in the page heading'],
    ['Price', 'The price the customer pays now'],
    ['Main image', 'The primary product photo'],
  ] as const) {
    check(`step 2: "${name}"'s hint is pre-filled from the catalogue`, hints.includes(hint), hint);
  }
  await p.screenshot({ path: `${out}/schema-step2-interim.png`, fullPage: true });

  // 5. The same catalogue on the project home.
  await p.goto(`${DASH}/projects/${project.slug}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  body = await p.locator('body').innerText();
  check('project home: the catalogue is offered', body.includes('Add from the catalogue'));
  for (const name of ['Title', 'Price', 'Main image']) {
    check(`project home: the "${name}" chip reads added`, await p.getByLabel(`${name} (added)`, { exact: true }).isDisabled());
  }
  await p.screenshot({ path: `${out}/project-home-catalogue.png`, fullPage: true });

  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await b.close();
  await trpc('projects.delete', { projectId: project.id }).catch((e) => console.error('cleanup failed:', e));
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
