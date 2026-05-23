import { PlaywrightBrowser } from '@robot/browser';
import {
  resolveApiPathsFromCache,
  resolveFromCache,
  buildCachedXPathScript,
} from '../domain-cache.js';
import { extractFromStructuredData } from '../structured-extractor.js';
import { validateFieldShape } from '../shape-validator.js';
import type { Fixture } from './types.js';

export type ReplayResult = {
  resolved: Record<string, unknown>;
  sources: Record<string, string>;
};

export async function runFixtureReplay(fixture: Fixture): Promise<ReplayResult> {
  const fieldNames = Object.keys(fixture.expected);
  const finalData: Record<string, unknown> = {};
  const sources: Record<string, string> = {};

  function tryAssign(name: string, value: unknown, source: string): boolean {
    if (finalData[name] !== undefined) return false;
    if (value === undefined || value === null || value === '') return false;
    const v = validateFieldShape(value, 'string', { fieldName: name });
    if (!v.ok) return false;
    finalData[name] = v.normalized;
    sources[name] = source;
    return true;
  }

  // 1. Mechanical / structured-data flattening
  // Field hints shape matches FieldRequest in structured-extractor.ts:
  //   { name, type, description?, sourceHint?: 'api' | 'json-ld' | 'meta' | 'page' }
  const fieldsWithHints = fieldNames.map((name) => ({
    name,
    type: 'string',
    description: '',
    sourceHint: undefined as 'api' | 'json-ld' | 'meta' | 'page' | undefined,
  }));
  const mech = extractFromStructuredData(
    fixture.structuredData,
    fieldsWithHints,
    fixture.interceptedRequests,
  );
  for (const [name, val] of Object.entries(mech.data)) {
    tryAssign(name, val, mech.sources[name] ?? 'mechanical');
  }

  // 2. Cached API dot-paths against intercepted JSON
  const apiRes = resolveApiPathsFromCache(
    fixture.fieldPaths,
    fixture.interceptedRequests,
    fieldNames,
  );
  for (const [n, r] of Object.entries(apiRes.resolved)) tryAssign(n, r.value, r.source);

  // 3. Cached XPaths replayed offline via setContent + prod Chromium engine
  const stillMissing = fieldNames.filter((n) => finalData[n] === undefined);
  const cachedScript = buildCachedXPathScript(fixture.fieldPaths, stillMissing);
  if (cachedScript) {
    const browser = new PlaywrightBrowser();
    await browser.launch({ headless: true });
    try {
      const result = await browser.setContentEvaluate<{ data: Record<string, unknown>[] }>(
        fixture.html,
        cachedScript.script,
      );
      if (result.data.length > 0) {
        for (const [n, v] of Object.entries(result.data[0])) tryAssign(n, v, 'xpath-cached');
      }
    } finally {
      await browser.close();
    }
  }

  // 4. resolveFromCache cross-validation over whatever we've gathered
  const cr = resolveFromCache(fixture.fieldPaths, finalData, fieldNames);
  for (const [n, r] of Object.entries(cr.resolved)) {
    if (finalData[n] === undefined) tryAssign(n, r.value, r.source);
  }

  return { resolved: finalData, sources };
}
