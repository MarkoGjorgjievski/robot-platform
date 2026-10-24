// Real pages, read only (spec 2026-10-23 run speed §5.4): for a few of Marko's certified websites, today's capture
// and the lean one on the same product pages, in alternating order, one browser. READS the certification and the
// latest done run-item URLs; writes no row (no run, no stats, no capture): every database session of this process is
// opened read only (`default_transaction_read_only=on`), so a write would fail, not land. Free, keyless.
//   cd packages/worker && ANTHROPIC_API_KEY= JEV_SHADOW= TYPESAFE_API_KEY= npx tsx src/bench/real-sites.ts [sourceId …] [--per 5] [--no-run-like]
//
// Per page: today's capture, and the lean one with a fresh state past its check items (this page alone decides lean
// or lean+full). Where they differ, the lean capture's HTML is also evaluated today's way (rendered again, offline),
// which says whether a difference came from the live probe or from the page itself. Then, per site, a run-like pass:
// one lean state with its check items over the same pages, as a certified run takes them (counts and any switch).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import type { CaptureOptions, IBrowser, PageCapture } from '@robot/browser';
import type { LeanOutcome, LeanRunState, VerifiedExtractionResult, VerifiedField } from '@robot/scraper';
process.env.ANTHROPIC_API_KEY = ''; process.env.JEV_SHADOW = ''; process.env.TYPESAFE_API_KEY = '';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..', '..', '..', '..');
const out = join(repo, 'docs', 'testing', 'results', '2026-10-23-run-speed');
const { values: a, positionals } = parseArgs({ allowPositionals: true, options: { per: { type: 'string', default: '5' }, 'no-run-like': { type: 'boolean', default: false } } });
const ids = positionals.length > 0 ? positionals : [
  '104e5e56-3d48-47af-80f7-8846f9ee672b', // www.ikea.com
  '7f5cde3b-d233-4ee9-b8ee-25483a06c07d', // www.gymshark.com
  'f210ced9-645e-4b82-8c10-2e9683a2098f', // www.skullcandy.com
];

// Before anything imports @robot/db: every session this process opens is read only.
try { loadEnvFile(join(repo, '.env')); } catch { /* no .env: the default URL below */ }
const dbUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://localhost:5432/robot_platform');
dbUrl.searchParams.set('default_transaction_read_only', 'on');
process.env.DATABASE_URL = dbUrl.toString();

const { db, runs, runItems } = await import('@robot/db');
const { and, desc, eq, sql } = await import('drizzle-orm');
const { PlaywrightBrowser, setBrowserOwner } = await import('@robot/browser');
const { runVerifiedExtraction, newLeanRunState, leanSummary, buildXPathProbeScript } = await import('@robot/scraper');
const { loadCurrentCertification } = await import('@robot/api/verify/current-certification');
const { chromiumMb } = await import('./measure.js');

const ro = await db.execute(sql`show default_transaction_read_only`);
const roValue = (ro as unknown as Array<{ default_transaction_read_only: string }>)[0]?.default_transaction_read_only;
if (roValue !== 'on') throw new Error(`the database session is not read only (${roValue}); refusing to run`);

type Diff = { field: string; today: unknown; lean: unknown; leanRerendered?: unknown; cause: string; probe?: Record<string, { live: unknown; rerendered: unknown }> };
type Row = {
  site: string; sourceId: string; url: string; order: 'today-first' | 'lean-first';
  todayMs: number; leanMs: number; todayCaptureMs: number | null; leanCaptureMs: number | null;
  lean: LeanOutcome | null; switched: string | null; leanFullDisagreed: Diff[];
  valueDiffs: Diff[]; shownDiffs: Array<{ field: string; today: unknown; lean: unknown }>;
  today: { data: Record<string, unknown>; shown: Record<string, unknown> } | null;
  leanResult: { data: Record<string, unknown>; shown: Record<string, unknown> } | null;
  chromiumMb: number; error?: string;
};
type RunLike = { site: string; sourceId: string; items: Array<{ url: string; lean: LeanOutcome | null; error?: string; valueDiffs: string[]; shownDiffs: string[] }>; summary: string; switched: string | null };

setBrowserOwner(String(process.pid));
console.log(`owner pid ${process.pid}; database session read only: ${roValue}`);
const browser = new PlaywrightBrowser();
// Every capture runVerifiedExtraction takes passes through here, so the lean capture of a lean+full page can be read too.
const seen: { lean: PageCapture | null; full: PageCapture | null } = { lean: null, full: null };
const recording: IBrowser = {
  launch: (o) => browser.launch(o),
  capture: async (u: string, o?: CaptureOptions) => { const c = await browser.capture(u, o); if (o?.lean) seen.lean = c; else seen.full = c; return c; },
  evaluate: <T,>(u: string, s: string, o?: CaptureOptions) => browser.evaluate<T>(u, s, o),
  setContentEvaluate: <T,>(h: string, s: string) => browser.setContentEvaluate<T>(h, s),
  close: () => browser.close(),
  crawl: (u, o) => browser.crawl(u, o),
  scrollPages: (u, o) => browser.scrollPages(u, o),
};
await browser.launch({ headless: true });
const rows: Row[] = [];
const runLike: RunLike[] = [];
const skipped: string[] = [];
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const j = (v: unknown) => JSON.stringify(v);
const clip = (v: unknown, n = 300) => (typeof v === 'string' && v.length > n ? `${v.slice(0, n)}…` : v);
const view = (r: VerifiedExtractionResult) => ({ data: r.data, shown: r.shown as Record<string, unknown> });

try {
  for (const id of ids) {
    const cert = await loadCurrentCertification(db, id);
    if (!cert) { console.log(`${id}: not certified — skipped`); skipped.push(`${id}: not certified`); continue; }
    const src = await db.query.sources.findFirst({ where: (t, { eq: e }) => e(t.id, id), columns: { schemaDefinition: true } });
    const types = new Map(((src?.schemaDefinition ?? []) as Array<{ key: string; type: VerifiedField['type'] }>).map((f) => [f.key, f.type]));
    const fields: VerifiedField[] = Object.keys(cert.paths).map((k) => ({
      key: k, type: types.get(k) ?? 'text', concept: cert.concepts[k] ?? k, paths: cert.paths[k]!,
      ...(cert.defaults?.[k] !== undefined ? { defaultValue: cert.defaults[k]! } : {}),
    }));
    const xpathsOf = (k: string) => fields.find((f) => f.key === k)?.paths.filter((p) => p.source === 'xpath').map((p) => p.path) ?? [];
    const items = await db.select({ url: runItems.url }).from(runItems).innerJoin(runs, eq(runs.id, runItems.runId))
      .where(and(eq(runs.sourceId, id), eq(runItems.kind, 'detail'), eq(runItems.status, 'done'))).orderBy(desc(runItems.completedAt)).limit(Number(a.per));
    console.log(`\n${cert.hostname} (${id}): ${fields.length} certified fields, ${items.length} pages`);
    const todayBy = new Map<string, VerifiedExtractionResult>();

    /** Why a lean value differs from a reference: the lean HTML evaluated today's way agrees → the live probe; it does not → the page itself. */
    const explain = async (field: string, leanCap: PageCapture | null, rerendered: VerifiedExtractionResult | null, reference: unknown) => {
      const leanRerendered = rerendered ? rerendered.data[field] : undefined;
      const cause = !rerendered ? 'no lean capture to compare'
        : j(leanRerendered) === j(reference) ? 'live probe vs re-rendered text (the lean HTML, evaluated today\'s way, reads the reference value)'
          : 'the page differed between the two loads (the lean HTML, evaluated today\'s way, does not read the reference value either)';
      const xps = xpathsOf(field);
      let probe: Diff['probe'];
      if (leanCap && xps.length > 0) {
        const again = await browser.setContentEvaluate<Record<string, unknown>>(leanCap.html, buildXPathProbeScript(xps)).catch(() => ({} as Record<string, unknown>));
        const live = (leanCap.probe ?? {}) as Record<string, unknown>;
        probe = Object.fromEntries(xps.map((x) => [x, { live: clip(live[x] ?? null), rerendered: clip(again[x] ?? null) }]));
      }
      return { leanRerendered, cause, probe };
    };

    for (const [i, { url }] of items.entries()) {
      const order = i % 2 === 0 ? 'today-first' : 'lean-first';
      try {
        const today = async () => {
          seen.lean = null; seen.full = null;
          const t = Date.now(); const r = await runVerifiedExtraction({ url, fields }, { browser: recording });
          return { r, ms: Date.now() - t };
        };
        // A fresh state past its check items: this page alone decides lean or lean+full.
        const lean = async () => {
          seen.lean = null; seen.full = null;
          const state: LeanRunState = newLeanRunState({ checks: 0 });
          const t = Date.now(); const r = await runVerifiedExtraction({ url, fields }, { browser: recording, lean: state });
          return { r, ms: Date.now() - t, state, leanCap: seen.lean as PageCapture | null };
        };
        let T: Awaited<ReturnType<typeof today>>; let L: Awaited<ReturnType<typeof lean>>;
        if (order === 'today-first') { T = await today(); L = await lean(); } else { L = await lean(); T = await today(); }
        todayBy.set(url, T.r);
        const leanCap = L.leanCap;
        const rerendered = leanCap && leanCap.verdict.kind === 'ok' ? await runVerifiedExtraction({ url, fields }, { browser: recording, capture: leanCap }) : null;

        const valueDiffs: Diff[] = [];
        for (const f of fields) {
          if (j(T.r.data[f.key]) === j(L.r.data[f.key])) continue;
          const cause = L.r.lean?.mode === 'lean'
            ? (await explain(f.key, leanCap, rerendered, T.r.data[f.key]))
            : { cause: `lean took ${L.r.lean?.mode}: its value came from its own full capture (two full loads differ)` };
          valueDiffs.push({ field: f.key, today: T.r.data[f.key], lean: L.r.data[f.key], ...cause });
        }
        const shownDiffs = fields.filter((f) => T.r.shown[f.key] !== L.r.shown[f.key]).map((f) => ({ field: f.key, today: T.r.shown[f.key], lean: L.r.shown[f.key] }));
        // On a lean+full page, what the lean read disagreed on with its own full capture (what would switch a run).
        const leanFullDisagreed: Diff[] = [];
        if (L.r.lean?.mode === 'lean+full' && L.state.mode === 'full') {
          for (const k of L.r.lean.fields) {
            leanFullDisagreed.push({ field: k, today: T.r.data[k], lean: L.r.data[k], ...(await explain(k, leanCap, rerendered, L.r.data[k])) });
          }
        }
        const row: Row = {
          site: cert.hostname, sourceId: id, url, order, todayMs: T.ms, leanMs: L.ms,
          todayCaptureMs: T.r.timings?.totalMs ?? null, leanCaptureMs: L.r.lean?.leanMs ?? null,
          lean: L.r.lean ?? null, switched: L.state.mode === 'full' ? L.state.note : null, leanFullDisagreed,
          valueDiffs, shownDiffs, today: view(T.r), leanResult: view(L.r), chromiumMb: await chromiumMb(process.pid),
        };
        rows.push(row);
        console.log(`${url}\n  today ${row.todayMs} ms | lean ${row.leanMs} ms (${row.lean?.mode}${row.lean?.reason ? `:${row.lean.reason}` : ''}${row.lean?.fields.length ? ` [${row.lean.fields.join(',')}]` : ''})${row.switched ? ` SWITCHED: ${row.switched}` : ''} | values ${valueDiffs.length ? valueDiffs.map((d) => `${d.field}: ${j(d.today)} → ${j(d.lean)} (${d.cause})`).join('; ') : 'same'} | shown ${shownDiffs.length ? shownDiffs.map((d) => `${d.field}: ${d.today} → ${d.lean}`).join(',') : 'same'} | chromium ${row.chromiumMb} MB`);
      } catch (err) {
        rows.push({ site: cert.hostname, sourceId: id, url, order, todayMs: 0, leanMs: 0, todayCaptureMs: null, leanCaptureMs: null, lean: null, switched: null, leanFullDisagreed: [], valueDiffs: [], shownDiffs: [], today: null, leanResult: null, chromiumMb: 0, error: msg(err) });
        console.log(`${url}\n  error: ${msg(err)}`);
      }
    }

    if (a['no-run-like']) continue;
    // A certified run's own state over the same pages: its check items first, then lean, rescues and any switch.
    const state = newLeanRunState();
    const rl: RunLike = { site: cert.hostname, sourceId: id, items: [], summary: '', switched: null };
    for (const { url } of items) {
      try {
        const r = await runVerifiedExtraction({ url, fields }, { browser: recording, lean: state });
        const ref = todayBy.get(url);
        rl.items.push({
          url, lean: r.lean ?? null,
          valueDiffs: ref ? fields.filter((f) => j(ref.data[f.key]) !== j(r.data[f.key])).map((f) => `${f.key}: ${j(ref.data[f.key])} → ${j(r.data[f.key])}`) : [],
          shownDiffs: ref ? fields.filter((f) => ref.shown[f.key] !== r.shown[f.key]).map((f) => `${f.key}: ${ref.shown[f.key]} → ${r.shown[f.key]}`) : [],
        });
      } catch (err) { rl.items.push({ url, lean: null, error: msg(err), valueDiffs: [], shownDiffs: [] }); }
    }
    rl.summary = leanSummary('run-like', state);
    rl.switched = state.mode === 'full' ? state.note : null;
    runLike.push(rl);
    console.log(`  run-like: ${rl.summary}`);
  }
} finally {
  await browser.close();
}

const ok = rows.filter((r) => !r.error);
const med = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
const modeCount = (rs: Row[]) => ({ lean: rs.filter((r) => r.lean?.mode === 'lean').length, full: rs.filter((r) => r.lean?.mode === 'full').length, leanFull: rs.filter((r) => r.lean?.mode === 'lean+full').length });
const summary = {
  pages: rows.length, errors: rows.length - ok.length, todayMedianMs: med(ok.map((r) => r.todayMs)), leanMedianMs: med(ok.map((r) => r.leanMs)),
  modes: modeCount(ok), switchedPages: ok.filter((r) => r.switched).length,
  valueDiffPages: ok.filter((r) => r.valueDiffs.length).length, leanWrittenValueDiffPages: ok.filter((r) => r.lean?.mode === 'lean' && r.valueDiffs.length).length,
  shownDiffPages: ok.filter((r) => r.shownDiffs.length).length, chromiumPeakMb: Math.max(0, ...ok.map((r) => r.chromiumMb)),
  runLike: runLike.map((r) => ({ site: r.site, summary: r.summary, switched: r.switched })),
  skipped,
};
const sites = [...new Set(rows.map((r) => r.site))];
const perSite = sites.map((s) => {
  const rs = ok.filter((r) => r.site === s);
  return { site: s, pages: rows.filter((r) => r.site === s).length, errors: rows.filter((r) => r.site === s && r.error).length, todayMedianMs: med(rs.map((r) => r.todayMs)), leanMedianMs: med(rs.map((r) => r.leanMs)), modes: modeCount(rs), valueDiffPages: rs.filter((r) => r.valueDiffs.length).length, shownDiffPages: rs.filter((r) => r.shownDiffs.length).length };
});
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'real-sites.json'), JSON.stringify({ at: new Date().toISOString(), summary, perSite, rows, runLike }, null, 1));
const leanTook = (o: LeanOutcome | null) => (o ? `${o.mode}${o.reason ? `:${o.reason}` : ''}${o.fields.length ? ` [${o.fields.join(', ')}]` : ''}` : '—');
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
writeFileSync(join(out, 'real-sites.md'), [
  '# Real pages, read only — today\'s capture vs lean (spec 2026-10-23 run speed §5.4)', '',
  `${summary.pages} pages, ${summary.errors} errors. Median today ${summary.todayMedianMs} ms, lean ${summary.leanMedianMs} ms (wall time of each extraction, the domain lock's politeness wait included). Lean took: lean ${summary.modes.lean}, lean+full ${summary.modes.leanFull}, full ${summary.modes.full}; pages whose lean read disagreed with its own full capture (would switch a run): ${summary.switchedPages}. Pages with a value difference: ${summary.valueDiffPages} (of them written by lean: ${summary.leanWrittenValueDiffPages}); with a shown difference: ${summary.shownDiffPages}. Chromium peak ${summary.chromiumPeakMb} MB.`, '',
  ...(skipped.length ? [`Skipped: ${skipped.join('; ')}.`, ''] : []),
  '## Per site', '', '| Site | Pages | Errors | Today median ms | Lean median ms | lean / lean+full / full | Value-diff pages | Shown-diff pages |', '|---|---|---|---|---|---|---|---|',
  ...perSite.map((p) => `| ${p.site} | ${p.pages} | ${p.errors} | ${p.todayMedianMs} | ${p.leanMedianMs} | ${p.modes.lean} / ${p.modes.leanFull} / ${p.modes.full} | ${p.valueDiffPages} | ${p.shownDiffPages} |`), '',
  '## Per page', '',
  '| Site | Page | Order | Today ms | Lean ms | Lean capture ms | Lean took | Switch | Values | Shown |', '|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.site} | ${cell(r.url.replace(/^https?:\/\/[^/]+/, ''))} | ${r.order} | ${r.todayMs} | ${r.leanMs} | ${r.leanCaptureMs ?? '—'} | ${r.error ? `error: ${cell(r.error)}` : cell(leanTook(r.lean))} | ${r.switched ? cell(r.switched) : '—'} | ${r.valueDiffs.length ? cell(r.valueDiffs.map((d) => `${d.field}`).join(', ')) : 'same'} | ${r.shownDiffs.length ? cell(r.shownDiffs.map((d) => `${d.field}: ${d.today} → ${d.lean}`).join('; ')) : 'same'} |`), '',
  '## Every difference, verbatim', '',
  ...(ok.some((r) => r.valueDiffs.length || r.leanFullDisagreed.length) ? ok.flatMap((r) => [
    ...r.valueDiffs.map((d) => `- **${r.site}** ${r.url} — \`${d.field}\` (lean took ${leanTook(r.lean)}): today ${j(d.today)} → lean ${j(d.lean)}${d.leanRerendered !== undefined ? `; the lean HTML evaluated today's way: ${j(d.leanRerendered)}` : ''}. Cause: ${d.cause}.${d.probe ? ` XPaths (live / re-rendered): ${Object.entries(d.probe).map(([x, v]) => `\`${x}\`: ${j(v.live)} / ${j(v.rerendered)}`).join('; ')}` : ''}`),
    ...r.leanFullDisagreed.map((d) => `- **${r.site}** ${r.url} — lean read \`${d.field}\` differently from its own full capture (written: ${j(d.lean)}; the lean HTML evaluated today's way: ${j(d.leanRerendered)}). Cause: ${d.cause}.${d.probe ? ` XPaths (live / re-rendered): ${Object.entries(d.probe).map(([x, v]) => `\`${x}\`: ${j(v.live)} / ${j(v.rerendered)}`).join('; ')}` : ''}`),
  ]) : ['None.']), '',
  ...(runLike.length ? ['## Run-like pass (one lean state per site, its 2 check items first)', '',
    ...runLike.flatMap((r) => [`- **${r.site}**: ${cell(r.summary)}${r.switched ? ` — switched: ${r.switched}` : ''}`,
      ...r.items.map((x) => `  - ${x.url.replace(/^https?:\/\/[^/]+/, '')}: ${x.error ? `error: ${x.error}` : leanTook(x.lean)}${x.valueDiffs.length ? `; values vs today: ${x.valueDiffs.join('; ')}` : ''}${x.shownDiffs.length ? `; shown vs today: ${x.shownDiffs.join('; ')}` : ''}`)]), ''] : []),
].join('\n'));
console.log(JSON.stringify(summary));
process.exit(summary.valueDiffPages === 0 && summary.shownDiffPages === 0 ? 0 : 1);
