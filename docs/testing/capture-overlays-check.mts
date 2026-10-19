// Live check for "captures without overlays" (spec docs/superpowers/specs/2026-10-19-capture-overlays-design.md §6).
// Re-captures campaign 2's group 2 proof pages with the real PlaywrightBrowser and writes, beside the
// before screenshots (`<site>-<n>-A.png`, probe.mts mode A, 2026-10-19):
//   <site>-<n>-after.png    the first tile, as a proof page gets it
//   <site>-<n>-after.json   what covers the centre, the visible dialogs, what stayed expanded, the
//                           variant before and after, whether the box map sees the title and price
//   after.md                one table, every page
// Each page is captured as a proof page is (packages/scraper/src/verify/proof-page-capture.ts):
// waitUntil load, network interception, the proof-page ready check (after the expand pass), the
// variant-dom selection script, six tiles, and the box map, composed here with this check's probe.
// The picker's selection is also read once at the document's load event, before any dismissal or
// expand click, so the table says whether the capture left the variant as navigation found it (§5.1).
// Free and keyless: no API, no server, no database query, one browser at a time. Never run two at once.
//
// Run from packages/browser, so `playwright` resolves:
//   npx tsx ../../docs/testing/capture-overlays-check.mts                  every site
//   npx tsx ../../docs/testing/capture-overlays-check.mts ikea,pumade      some sites
//   npx tsx ../../docs/testing/capture-overlays-check.mts --self-test      a local page, no network
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from 'playwright';
import { PlaywrightBrowser } from '../../packages/browser/src/playwright-browser.ts';
import { CENTRE_OVERLAY_SCRIPT, type OverlayDescription } from '../../packages/browser/src/overlays.ts';
import { boxesFromAnnotation, buildBoxMapScript } from '../../packages/scraper/src/verify/box-map.ts';
import { buildSelectionScript } from '../../packages/scraper/src/verify/variant-dom.ts';
import { buildProofPageReadyCheck } from '../../packages/scraper/src/verify/proof-page-ready.ts';
import { captureProblem } from '../../packages/scraper/src/verify/capture-check.ts';
import { PROOF_PAGE_MAX_TILES } from '../../packages/scraper/src/verify/constants.ts';

const SITES: Array<[string, string[]]> = [
  ['colourpop', ['https://colourpop.com/products/aurora-stuck-shadow-palette', 'https://colourpop.com/products/fade-to-hue-pressed-powder-makeup-palette']],
  ['mejuri', ['https://mejuri.com/my/en/products/stacker-ring?Material=10k+Yellow+Gold', 'https://mejuri.com/my/en/products/diamonds-band?Material=14k+Yellow+Gold&Stone=Natural+Diamond']],
  ['kith', ['https://kith.com/collections/kith-women-sweatshirts/products/khwa030083-338', 'https://kith.com/collections/kith-women-sweatshirts/products/khwa030103-2017']],
  ['skullcandy', ['https://www.skullcandy.com/products/crusher-evo-sensory-bass-headphones-with-personal-sound', 'https://www.skullcandy.com/products/grom-wireless-headphones-for-kids']],
  ['lacoste', ['https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00.html?color=001', 'https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH5522-00.html?color=031']],
  ['pumade', ['https://eu.puma.com/de/de/pd/suede-classic-sneakers-unisex/399781?swatch=07', 'https://eu.puma.com/de/de/pd/palermo-sneakers-unisex/396463?swatch=98']],
  ['thomann', ['https://www.thomann.de/de/taylor_814ce_n.htm?type=category', 'https://www.thomann.de/de/taylor_112ce_n.htm?type=category', 'https://www.thomann.de/de/taylor_314ce_n.htm?type=category']],
  ['ikea', ['https://www.ikea.com/my/en/p/glostad-2-seat-sofa-knisa-dark-grey-10489009/', 'https://www.ikea.com/my/en/p/kivik-2-seat-sofa-tibbleby-beige-grey-s19440594/']],
];

interface Probe {
  url: string;
  scrollY: number;
  width: number;
  centre: OverlayDescription | null;
  dialogs: string[];
  expanded: { aria: number; details: number; tabs: string[] };
  /** The first h1 outside a dialog: its text, and whether it (or an ancestor) is display:none. */
  title: { text: string; hidden: boolean } | null;
}

// Read after the capture's last pass (annotate runs after it, just before the screenshot).
const PROBE = `(() => {
  const txt = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  const vis = (el) => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) <= 0) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight; };
  const desc = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
  return {
    url: location.href,
    scrollY: Math.round(scrollY),
    width: document.documentElement.scrollWidth,
    centre: ${CENTRE_OVERLAY_SCRIPT},
    dialogs: [...document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal=true],dialog[open]')].filter(vis).map((d) => desc(d) + ' «' + txt(d).slice(0, 50) + '»'),
    expanded: {
      aria: document.querySelectorAll('main [aria-expanded="true"], article [aria-expanded="true"]').length,
      details: document.querySelectorAll('details[open]').length,
      tabs: [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].map((t) => txt(t).slice(0, 30)),
    },
    title: (() => {
      const h1 = [...document.querySelectorAll('h1')].find((h) => !h.closest('[role=dialog],[role=alertdialog],[aria-modal=true],dialog'));
      if (!h1) return null;
      let hidden = false;
      for (let a = h1; a && a !== document.documentElement; a = a.parentElement) if (getComputedStyle(a).display === 'none') hidden = true;
      return { text: txt(h1), hidden };
    })(),
  };
})()`;

const SELECTION = buildSelectionScript();
/** The proof page's box map and this check's probe, read at the same moment (annotate runs once). */
const ANNOTATE = `(() => ({ probe: ${PROBE}, boxes: ${buildBoxMapScript()}, selection: ${SELECTION} }))()`;

/** The first `price` in the page's JSON-LD, as text, or null. */
function ldPrice(ld: unknown[], depth = 0): string | null {
  for (const v of ld) {
    if (!v || typeof v !== 'object' || depth > 6) continue;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'price' && (typeof x === 'string' || typeof x === 'number')) return String(x);
      const inner = ldPrice(Array.isArray(x) ? x : [x], depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}

interface Row {
  page: string;
  url: string;
  verdict: string;
  centre: string;
  dialogs: number;
  scrollY: number;
  expanded: string;
  /** The picker's selection at load and after the capture; same = the capture left the variant alone. */
  variant: { before: unknown; after: unknown; same: boolean; pageVariant: unknown };
  /** Boxes in the proof page's box map holding the h1's text / the JSON-LD price's digits (rough). */
  titleBoxes: number;
  priceBoxes: number | null;
  titleHidden: boolean | null;
  /** What captureProofPage would refuse the page for, or null. */
  problem: string | null;
  warnings: string[];
  error?: string;
}

const cell = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ');

async function checkPage(b: PlaywrightBrowser, page: string, url: string, outDir: string): Promise<Row> {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); warn(...args); };
  // The selection at the document's load event: before the first dismissal pass (which waits
  // 1.5 s after navigation) and before any expand click. The browser's context is private; a check
  // script may reach it.
  const ctx = (b as unknown as { context: BrowserContext | null }).context;
  let before: unknown;
  const onPage = (p: Page) => {
    p.on('load', () => {
      if (before !== undefined || p.url() === 'about:blank') return; // the new tab's blank page loads first
      p.evaluate(SELECTION).then((v) => { if (before === undefined) before = v ?? null; }).catch(() => {});
    });
  };
  ctx?.on('page', onPage);
  try {
    const c = await b.capture(url, {
      waitUntil: 'load',
      interceptNetworkRequests: true,
      ready: buildProofPageReadyCheck(url),
      annotate: ANNOTATE,
      maxTiles: PROOF_PAGE_MAX_TILES,
      selection: SELECTION,
      timeout: 60_000,
    });
    const ann = c.annotation as { probe?: Probe; boxes?: unknown; selection?: unknown } | undefined;
    const p = ann?.probe;
    const boxes = boxesFromAnnotation(ann?.boxes);
    const title = p?.title?.text.slice(0, 40) ?? '';
    const price = ldPrice(c.structuredData.ldJson);
    const priceDigits = price ? price.split(/[.,]/)[0].replace(/\D/g, '') : '';
    const after = ann?.selection ?? null;
    const variant = { before: before ?? null, after, same: JSON.stringify(before ?? null) === JSON.stringify(after), pageVariant: c.pageVariant ?? null };
    const problem = captureProblem(c, url)?.reason ?? null;
    writeFileSync(join(outDir, `${page}-after.png`), c.screenshotTiles[0] ?? c.screenshot);
    const row: Row = {
      page, url, verdict: c.verdict.kind,
      centre: p?.centre ? `${p.centre.tag}${p.centre.id ? '#' + p.centre.id : ''} «${p.centre.text}»` : (p ? 'none' : '?'),
      dialogs: p?.dialogs.length ?? -1,
      scrollY: p?.scrollY ?? -1,
      expanded: p ? `${p.expanded.aria} / ${p.expanded.details} / ${p.expanded.tabs.join(', ') || '–'}` : '?',
      variant,
      titleBoxes: title ? boxes.filter((x) => x.text.includes(title)).length : 0,
      priceBoxes: priceDigits ? boxes.filter((x) => x.text.replace(/\D/g, '').includes(priceDigits)).length : null,
      titleHidden: p?.title ? p.title.hidden : null,
      problem,
      warnings,
    };
    writeFileSync(join(outDir, `${page}-after.json`), JSON.stringify({ url, finalUrl: c.url, verdict: c.verdict, probe: p, price, boxCount: boxes.length, row, warnings }, null, 1));
    return row;
  } catch (err) {
    return {
      page, url, verdict: 'failed', centre: '?', dialogs: -1, scrollY: -1, expanded: '?',
      variant: { before: before ?? null, after: null, same: false, pageVariant: null },
      titleBoxes: 0, priceBoxes: null, titleHidden: null, problem: null,
      warnings, error: (err as Error).message.split('\n')[0].slice(0, 160),
    };
  } finally {
    ctx?.off('page', onPage);
    console.warn = warn;
  }
}

function table(rows: Row[]): string {
  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a checkout */ }
  return [
    '# Capture overlays — after (live check)',
    '',
    `Run on ${new Date().toISOString().slice(0, 10)} at \`${commit}\` with \`docs/testing/capture-overlays-check.mts\` (free, keyless, one browser; the browser is wherever this machine is).`,
    'Before: `<site>-<n>-A.png` (probe.mts mode A, 2026-10-19). After: `<site>-<n>-after.png`.',
    'Expected per page (spec §6): no overlay at the window\'s centre, the §5.3 accordions still open (the tabs step is off by default), the variant as navigation found it (§5.1), and the title and price in the box map.',
    'Captured as a proof page is (`captureProofPage`\'s options). "Variant kept": the picker\'s selection at load equals the one after the capture. Title / price boxes: box-map entries holding the h1\'s text / the JSON-LD price\'s digits (rough).',
    '',
    '| Page | Verdict | Problem | Overlay at the centre | Visible dialogs | scrollY | Expanded (aria / details / selected tabs) | Variant kept | Title boxes (h1 hidden?) | Price boxes | Overlay warnings | Before | After |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.page} | ${cell(r.verdict)}${r.error ? ` (${cell(r.error)})` : ''} | ${cell(r.problem ?? '–')} | ${cell(r.centre)} | ${r.dialogs} | ${r.scrollY} | ${cell(r.expanded)} | ${r.variant.same ? 'yes' : `no: ${cell(JSON.stringify(r.variant.before))} → ${cell(JSON.stringify(r.variant.after))}`} | ${r.titleBoxes}${r.titleHidden ? ' (hidden!)' : ''} | ${r.priceBoxes ?? '–'} | ${r.warnings.filter((w) => w.includes('overlay still covers')).length} | [before](${r.page}-A.png) | [after](${r.page}-after.png) |`),
    '',
    '## Reading',
    '',
  ].join('\n') + '\n';
}

async function selfTest(): Promise<void> {
  // A lightbox behind a Zoom button, an accordion, a colour swatch, JSON-LD with the price, and a
  // banner with "Cookie settings" before "OK".
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Widget</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Widget","offers":{"@type":"Offer","price":"12.50","priceCurrency":"USD"}}</script></head><body style="margin:0">
<main style="min-height:2400px"><h1>Widget</h1><p>$12.50</p>
<p>A small brass widget for the kitchen drawer: solid, polished, made to last, with a two-year warranty and free returns.</p>
<div role="radiogroup" aria-label="Colour"><button role="radio" aria-checked="true" aria-label="Red">Red</button><button role="radio" aria-checked="false" aria-label="Blue">Blue</button></div>
<button id="zoom" aria-expanded="false">Zoom</button>
<button id="acc" aria-expanded="false" aria-controls="panel">Materials</button><div id="panel" hidden>Cotton</div></main>
<modal-dialog id="zoom-modal" style="display:none;position:fixed;inset:0;background:#000"></modal-dialog>
<div class="cookie-banner" style="position:fixed;left:0;right:0;bottom:0;height:120px;background:#fff"><button id="s">Cookie settings</button><button id="ok">OK</button></div>
<script>
document.getElementById('zoom').onclick = () => { document.getElementById('zoom-modal').style.display = 'block'; };
document.getElementById('acc').onclick = function () { this.setAttribute('aria-expanded', 'true'); document.getElementById('panel').hidden = false; };
document.getElementById('ok').onclick = () => document.querySelector('.cookie-banner').remove();
</script></body></html>`;
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/p/1`;
  const out = join(tmpdir(), 'capture-overlays-self-test');
  mkdirSync(out, { recursive: true });
  const b = new PlaywrightBrowser();
  await b.launch({ headless: true });
  try {
    const row = await checkPage(b, 'self-1', url, out);
    console.log(JSON.stringify(row, null, 1));
    const ok = row.verdict !== 'failed' && row.problem === null && row.centre === 'none' && row.expanded.startsWith('1 ')
      && row.variant.same && row.variant.before !== null && row.titleBoxes > 0 && (row.priceBoxes ?? 0) > 0 && row.titleHidden === false;
    console.log(ok ? `self-test passed; files in ${out}` : 'self-test FAILED');
    process.exitCode = ok ? 0 : 1;
  } finally {
    await b.close();
    server.close();
  }
}

if (process.argv[2] === '--self-test') {
  await selfTest();
} else {
  const outDir = fileURLToPath(new URL('./results/2026-10-19-capture-overlays/', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const only = process.argv[2]?.split(',');
  const rows: Row[] = [];
  for (const [site, urls] of SITES) {
    if (only && !only.includes(site)) continue;
    const b = new PlaywrightBrowser();
    await b.launch({ headless: true });
    try {
      for (const [i, url] of urls.entries()) {
        const row = await checkPage(b, `${site}-${i + 1}`, url, outDir);
        rows.push(row);
        console.log(`${row.page} ${row.verdict} centre=${row.centre} dialogs=${row.dialogs} scrollY=${row.scrollY} expanded=${row.expanded}${row.error ? ` error=${row.error}` : ''}`);
      }
    } finally {
      await b.close();
    }
  }
  const name = only ? `after-${only.join('-')}.md` : 'after.md';
  writeFileSync(join(outDir, name), table(rows));
  console.log(`wrote ${join(outDir, name)}`);
}
