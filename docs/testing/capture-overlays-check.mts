// Live check for "captures without overlays" (spec docs/superpowers/specs/2026-10-19-capture-overlays-design.md §6).
// Re-captures campaign 2's group 2 proof pages with the real PlaywrightBrowser and writes, beside the
// before screenshots (`<site>-<n>-A.png`, probe.mts mode A, 2026-10-19):
//   <site>-<n>-after.png    the first tile, as a proof page gets it
//   <site>-<n>-after.json   what covers the centre, the visible dialogs, what stayed expanded
//   after.md                one table, every page
// Free and keyless: no API, no server, one browser at a time. Never run two of these at once.
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
import { PlaywrightBrowser } from '../../packages/browser/src/playwright-browser.ts';
import { CENTRE_OVERLAY_SCRIPT, type OverlayDescription } from '../../packages/browser/src/overlays.ts';

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
  };
})()`;

interface Row {
  page: string;
  url: string;
  verdict: string;
  centre: string;
  dialogs: number;
  scrollY: number;
  expanded: string;
  warnings: string[];
  error?: string;
}

const cell = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ');

async function checkPage(b: PlaywrightBrowser, page: string, url: string, outDir: string): Promise<Row> {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); warn(...args); };
  try {
    const c = await b.capture(url, { interceptNetworkRequests: false, maxTiles: 1, timeout: 60_000, annotate: PROBE });
    writeFileSync(join(outDir, `${page}-after.png`), c.screenshotTiles[0] ?? c.screenshot);
    writeFileSync(join(outDir, `${page}-after.json`), JSON.stringify({ url, finalUrl: c.url, verdict: c.verdict, probe: c.annotation, warnings }, null, 1));
    const p = c.annotation as Probe | undefined;
    return {
      page, url, verdict: c.verdict.kind,
      centre: p?.centre ? `${p.centre.tag}${p.centre.id ? '#' + p.centre.id : ''} «${p.centre.text}»` : (p ? 'none' : '?'),
      dialogs: p?.dialogs.length ?? -1,
      scrollY: p?.scrollY ?? -1,
      expanded: p ? `${p.expanded.aria} / ${p.expanded.details} / ${p.expanded.tabs.join(', ') || '–'}` : '?',
      warnings,
    };
  } catch (err) {
    return { page, url, verdict: 'failed', centre: '?', dialogs: -1, scrollY: -1, expanded: '?', warnings, error: (err as Error).message.split('\n')[0].slice(0, 160) };
  } finally {
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
    'Expected per page (spec §6): no overlay at the window\'s centre, and the §5.3 accordions and tabs still open.',
    '',
    '| Page | Verdict | Overlay at the centre | Visible dialogs | scrollY | Expanded (aria / details / selected tabs) | Overlay warnings | Before | After |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.page} | ${cell(r.verdict)}${r.error ? ` (${cell(r.error)})` : ''} | ${cell(r.centre)} | ${r.dialogs} | ${r.scrollY} | ${cell(r.expanded)} | ${r.warnings.filter((w) => w.includes('overlay still covers')).length} | [before](${r.page}-A.png) | [after](${r.page}-after.png) |`),
    '',
    '## Reading',
    '',
  ].join('\n') + '\n';
}

async function selfTest(): Promise<void> {
  // A lightbox behind a Zoom button, an accordion, and a banner with "Cookie settings" before "OK".
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Widget</title></head><body style="margin:0">
<main style="min-height:2400px"><h1>Widget</h1><p>$12.50</p>
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
    const ok = row.verdict !== 'failed' && row.centre === 'none' && row.expanded.startsWith('1 ');
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
