// CLI: displayed-verification — ask the judge which candidate a screenshot
// visibly shows, per concept, and record the verdict on the domain's
// candidate catalogue.
//
//   pnpm --filter @robot/api exec tsx src/verify-displayed.ts <domain> <pageType> <screenshotPath>
//
// Only concepts with 2+ candidates are worth judging — a single-candidate
// concept has nothing to disambiguate. Every judged concept is recorded via
// `markDisplayed`, including a `null` verdict ("none of the candidates is
// what the page shows") — that still stamps `verifiedAt`, so a concept the
// judge genuinely can't call isn't re-judged (and re-paid-for) every run.
//
// @robot/db loads the repo-root .env on import, so DATABASE_URL and
// ANTHROPIC_API_KEY resolve without exporting anything in the shell.

import { readFileSync } from 'node:fs';
import { lookupDomainCache, markDisplayed } from '@robot/scraper';
import { judgeDisplayedCandidate } from '@robot/agent';

const [domain, pageType, screenshotPath] = process.argv.slice(2);
if (!domain || !pageType || !screenshotPath) {
  console.error('usage: verify-displayed <domain> <pageType> <screenshotPath>');
  process.exit(1);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY required');
  process.exit(1);
}

const cache = await lookupDomainCache(domain, pageType);
if (!cache) {
  console.error(`No domain cache for ${domain}/${pageType}`);
  process.exit(1);
}

const concepts = Object.entries(cache.candidateCatalogue).filter(([, candidates]) => candidates.length >= 2);
if (concepts.length === 0) {
  console.log(`No concept in ${domain}/${pageType}'s catalogue has 2+ candidates — nothing to verify.`);
  process.exit(0);
}

const screenshot = readFileSync(screenshotPath);

console.log(`Verifying ${concepts.length} concept(s) for ${domain}/${pageType}\n`);

for (const [concept, candidates] of concepts) {
  const verdict = await judgeDisplayedCandidate({
    screenshot,
    concept,
    candidates: candidates.map((c) => ({ label: c.label, value: c.sampleValue })),
    apiKey,
  });
  await markDisplayed(domain, pageType, concept, verdict);
  console.log(`  ${concept}: ${verdict ?? 'NONE (no candidate matched what the screenshot shows)'}`);
}

process.exit(0);
