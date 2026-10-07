// Usage: pnpm --filter @robot/api dogfood
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

// Repo root resolved from this module — portable across machines and OSes.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

try {
  loadEnvFile(join(repoRoot, '.env'));
} catch {
  // .env not present — fall back to whatever is already in process.env
}
process.env.CAPTURES_DIR ??= join(tmpdir(), 'dogfood-captures');

// `scraper.analyze`/`scraper.extract` (the tRPC procedures this script used
// to call) were deleted at cut-over (Task 5) — dead everywhere else, per the
// cut-over audit, but still live here. This now drives the same
// `@robot/scraper` orchestrators those procedures wrapped, directly.
const { SchemaAgent } = await import('@robot/agent');
const { runAnalysis, runExtraction, liveCorpus } = await import('@robot/scraper');
const { judgeFieldExtraction, judgeVariantArray, JudgeUnavailableError, snapshotUsage, diffUsage, formatUsage, resetUsage } = await import('@robot/agent');
type JudgeVerdict = Awaited<ReturnType<typeof judgeFieldExtraction>>;
const { withBrowserSession } = await import('./browser-session.js');
const { persistScreenshot } = await import('./persist-screenshot.js');

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error('ANTHROPIC_API_KEY required'); process.exit(1); }

/**
 * Run a subset of the corpus:  pnpm dogfood -- bn-nook currys
 *
 * Matching is substring, so a prefix is enough. Iterating on one site's bug used
 * to mean paying for the whole corpus — ~$4 a round at eight sites versus ~$0.35
 * for the one site actually under investigation. The harness was the expensive
 * part of the fix-and-measure loop, not the model.
 */
const siteFilter = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const corpus = siteFilter.length > 0
  ? liveCorpus.filter((s) => siteFilter.some((f) => s.label.includes(f)))
  : liveCorpus;

if (corpus.length === 0) {
  console.error(`No corpus site matches ${JSON.stringify(siteFilter)}. Available: ${liveCorpus.map((s) => s.label).join(', ')}`);
  process.exit(1);
}
if (siteFilter.length > 0) {
  console.log(`[dogfood] running ${corpus.length} of ${liveCorpus.length} sites: ${corpus.map((s) => s.label).join(', ')}`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const lines: string[] = [
  `# Dogfood ${stamp}`,
  '',
  ...(siteFilter.length > 0
    // A partial run must never be mistaken for a full one when someone reads the
    // aggregate later.
    ? [`> **PARTIAL RUN** — ${corpus.length} of ${liveCorpus.length} corpus sites (filter: ${siteFilter.join(', ')}).`,
       '> The aggregate below covers only these sites.', '']
    : []),
];

const unjudgedSites: string[] = [];
/** Per-site PIPELINE usage, so the cost table can be built from production spend
 *  rather than from a total inflated by the judge. */
const pipelineTotal: Array<Record<string, { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; requests: number }>> = [];
let totalResolved = 0, totalWrong = 0, totalNotOnPage = 0, totalUnverifiable = 0, totalError = 0, totalAbsent = 0, totalFields = 0;

resetUsage();

for (const site of corpus) {
  const usageBefore = snapshotUsage();
  lines.push(`## ${site.label} — ${site.url}`, '');

  try {
    const analysis = await withBrowserSession((browser) =>
      runAnalysis({ url: site.url, pageType: site.pageType }, { browser, agent: new SchemaAgent(), persistScreenshot }),
    );
    const fields = (analysis.schema.fields as Array<{ name: string; type: string; description?: string; tier?: 'requested' | 'discovered'; example_value?: string }>)
      .map((f) => ({ name: f.name, type: f.type, description: f.description, tier: f.tier, example_value: f.example_value }));

    // Ensure variants is requested even when discovery / cache didn't propose it,
    // and force the type to variant_array — a cache hit may have returned the
    // field as 'string' (cache type-inference is heuristic, not authoritative).
    const variantsField = fields.find((f) => f.name === 'variants');
    if (variantsField) {
      variantsField.type = 'variant_array';
    } else {
      fields.push({ name: 'variants', type: 'variant_array', description: 'Product variants (color/size/capacity/etc.)', tier: 'requested' as 'requested' | 'discovered' | undefined, example_value: undefined });
    }

    const result = await withBrowserSession((browser) =>
      runExtraction({ url: site.url, fields, pageType: site.pageType }, { browser, agent: new SchemaAgent() }),
    );

    // Split here: everything before this line is what PRODUCTION pays per URL.
    // Everything after is the Tier 2 judge, which ships to nobody. Reporting one
    // combined number would put ~18 screenshot-bearing judge calls into a figure
    // the cost model treats as extraction cost.
    const usageAfterPipeline = snapshotUsage();

    // Screenshot for the judge — extract just wrote one to CAPTURES_DIR (via the cache-miss path or analyze cache-hit).
    // The captureId returned by analyze is the filename stem; if extract recapped, use the one analyze persisted.
    const screenshotPath = analysis.screenshotUrl
      ? join(process.env.CAPTURES_DIR!, analysis.screenshotUrl.replace(/^\/captures\//, ''))
      : null;
    const screenshot = screenshotPath ? readFileSync(screenshotPath) : null;

    lines.push(`Resolved: ${result.fieldCount.found}/${result.fieldCount.total} (${Math.round(result.confidence * 100)}%)`, '');
    totalFields += result.fieldCount.total;

    // Without a screenshot the judge cannot form an opinion about anything, and
    // every field silently becomes 'error'. That once produced a report headlining
    // "18/18 resolved (100%)" in which not one verdict meant anything. Say so at
    // the top of the section, and make the run exit non-zero — an unjudged site is
    // a broken measurement, not a passing one.
    if (!screenshot) {
      unjudgedSites.push(site.label);
      lines.push(
        '> **UNJUDGED — no screenshot was captured for this page.**',
        '> Every verdict below is `error` for that reason alone and says nothing',
        '> about extraction quality. Check the run log for a capture failure.',
        '',
      );
    }

    const rows = [...result.fieldsByTier.requested, ...result.fieldsByTier.discovered];
    for (const row of rows) {
      if (row.value == null) {
        const absent = site.knownAbsentFields?.includes(row.name) ?? false;
        lines.push(`- [${absent ? 'absent' : 'miss'}] ${row.name}: —`);
        if (absent) totalAbsent++;
        continue;
      }
      totalResolved++;

      // Detect variant_array by value shape (the extract response carries source
      // but not type; safe inference: array of plain objects with a 'sku' or
      // 'price' key on at least one entry).
      const isVariantArray = Array.isArray(row.value)
        && row.value.length > 0
        && typeof row.value[0] === 'object'
        && row.value[0] !== null
        && !Array.isArray(row.value[0])
        && (row.value as Array<Record<string, unknown>>).some((v) => 'sku' in v || 'price' in v || 'image_url' in v);

      let verdict: JudgeVerdict;
      if (!screenshot) {
        verdict = 'error';
      } else if (isVariantArray) {
        verdict = await judgeVariantArray({ screenshot, variants: row.value as Array<Record<string, unknown>>, apiKey });
      } else {
        verdict = await judgeFieldExtraction({ screenshot, field: row.name, value: row.value, apiKey });
      }
      if (verdict === 'wrong') totalWrong++;
      if (verdict === 'not-on-page') totalNotOnPage++;
      if (verdict === 'unverifiable') totalUnverifiable++;
      if (verdict === 'error') totalError++;

      // Render: scalars get JSON.stringify truncated to 100; variant arrays get a condensed summary.
      let valStr: string;
      if (isVariantArray) {
        const arr = row.value as Array<Record<string, unknown>>;
        const summary = arr.slice(0, 3).map((v) => {
          const axis = v.color ?? v.size ?? v.capacity ?? v.sku ?? '?';
          return `${axis}${v.price != null ? ` @${v.price}` : ''}`;
        }).join(', ');
        valStr = `${arr.length} variants: [${summary}${arr.length > 3 ? ', ...' : ''}]`;
      } else {
        valStr = String(JSON.stringify(row.value)).slice(0, 100);
      }
      lines.push(`- [${verdict}] ${row.name}: ${valStr} (src=${row.source})`);
    }

    // Per-site spend, split by who actually pays it. The PIPELINE figure is the
    // one docs/project-overview.md's cost model is about; the JUDGE figure is this
    // harness measuring itself and ships to nobody. They are not close — judging
    // sends a full screenshot per field, so it can dominate a combined total and
    // make extraction look several times more expensive than it is.
    const afterJudge = snapshotUsage();
    lines.push('', '<details><summary>Tokens for this site</summary>', '');
    lines.push('```');
    lines.push('PIPELINE (what production pays per URL):');
    lines.push(formatUsage(diffUsage(usageBefore, usageAfterPipeline)));
    lines.push('');
    lines.push('JUDGE (this harness only, not a product cost):');
    lines.push(formatUsage(diffUsage(usageAfterPipeline, afterJudge)));
    lines.push('```');
    lines.push('</details>', '');
    pipelineTotal.push(diffUsage(usageBefore, usageAfterPipeline));
  } catch (err) {
    // The judge being unavailable (no credit, bad key) is not a site failure and
    // must not be swallowed per-site: every remaining field would fail the same
    // way and the report would read as a measurement. Abort without writing one.
    if (err instanceof JudgeUnavailableError) {
      console.error(`\n[dogfood] ABORTED — the judge is unavailable: ${err.message}`);
      console.error('[dogfood] No report written; a partially-judged run is not a measurement.');
      process.exit(2);
    }
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`- [error] site processing failed: ${msg}`);
    lines.push('');
    continue;
  }
}

lines.push('## Aggregate', '');
lines.push(`- Total fields requested: ${totalFields}`);
lines.push(`- Resolved: ${totalResolved}`);
lines.push(`- Resolved but wrong: ${totalWrong}`);
lines.push(`- Resolved but not on page: ${totalNotOnPage}`);
lines.push(`- Resolved but not confirmable from a screenshot (URLs, IDs, metadata): ${totalUnverifiable}`);
lines.push(`- Judge failed to return a verdict (error / no screenshot): ${totalError}`);
lines.push(`- Legitimately absent: ${totalAbsent}`);

const pipelineSum = pipelineTotal.reduce((acc, u) => {
  for (const [model, t] of Object.entries(u)) {
    const a = acc[model] ?? { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, requests: 0 };
    acc[model] = {
      inputTokens: a.inputTokens + t.inputTokens,
      outputTokens: a.outputTokens + t.outputTokens,
      cacheCreationTokens: a.cacheCreationTokens + t.cacheCreationTokens,
      cacheReadTokens: a.cacheReadTokens + t.cacheReadTokens,
      requests: a.requests + t.requests,
    };
  }
  return acc;
}, {} as (typeof pipelineTotal)[number]);

lines.push('', '### Cost', '');
lines.push(`**Pipeline only — what production pays.** This is the figure for the cost model in`,
  `docs/project-overview.md. Across ${pipelineTotal.length} successfully processed URLs.`, '');
lines.push('```', formatUsage(pipelineSum), '```');
lines.push('',
  'These were mostly cache-warm runs. A cold first run on an unknown domain pays for',
  'schema discovery and selector generation too, and costs considerably more — that',
  'case still needs measuring separately.', '');
lines.push('Including the Tier 2 judge (this harness measuring itself — not a product cost):', '');
lines.push('```', formatUsage(snapshotUsage()), '```');

if (unjudgedSites.length > 0) {
  lines.push('', `> **${unjudgedSites.length} of ${liveCorpus.length} sites were UNJUDGED** (no screenshot): ${unjudgedSites.join(', ')}.`);
  lines.push('> Their fields count toward "resolved" but none of their verdicts are meaningful.');
}

const outDir = join(repoRoot, 'docs', 'testing', 'results');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${stamp}-dogfood.md`);
writeFileSync(outPath, lines.join('\n'));
console.log(`wrote ${outPath}`);

// An unjudged site is a broken measurement, not a passing run — exit non-zero so
// it cannot be mistaken for success by a human skimming or by CI.
if (unjudgedSites.length > 0) {
  console.error(`[dogfood] ${unjudgedSites.length} site(s) UNJUDGED — no screenshot: ${unjudgedSites.join(', ')}`);
  process.exit(1);
}
process.exit(0);
