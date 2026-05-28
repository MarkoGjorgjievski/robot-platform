import { describe, it, expect } from 'vitest';
import { listFixtures, loadFixture } from './load.js';
import { runFixtureReplay } from './replay.js';

type Variant = Record<string, unknown>;

/** Unordered variant-array match. Each expected variant must have a matching
 * actual variant (by sku if present, else by first non-null discovered axis).
 * Asserts that every expected key on the matched actual variant equals
 * the expected value (modulo URL whitespace trim). */
function expectVariantsMatch(actualUnknown: unknown, expected: Variant[]) {
  expect(Array.isArray(actualUnknown), 'variants field should be an array').toBe(true);
  const actual = actualUnknown as Variant[];
  expect(actual.length, 'variants length').toBe(expected.length);

  const norm = (v: unknown) => (typeof v === 'string' ? v.trim() : v);

  for (const exp of expected) {
    // Pick a discriminating key from the expected entry.
    const keyName = exp.sku != null
      ? 'sku'
      : (Object.entries(exp).find(([, v]) => v !== null && v !== '') ?? ['', ''])[0];
    const keyVal = exp[keyName];
    const match = actual.find((a) => norm(a[keyName]) === norm(keyVal));
    expect(match, `no actual variant with ${keyName}=${JSON.stringify(keyVal)}`).toBeDefined();
    for (const [k, v] of Object.entries(exp)) {
      if (v === null) continue;
      expect(norm(match![k]), `variants[${keyName}=${JSON.stringify(keyVal)}].${k}`).toEqual(norm(v));
    }
  }
}

describe('extraction fixture corpus (Tier 1 deterministic gate)', () => {
  const labels = listFixtures();
  if (labels.length === 0) {
    it.skip('no fixtures yet — add one with capture-fixture', () => {});
    return;
  }

  for (const label of labels) {
    it(`replays ${label} to its golden expected values`, async () => {
      const fixture = loadFixture(label);
      const result = await runFixtureReplay(fixture);
      for (const [field, expected] of Object.entries(fixture.expected)) {
        // Keys starting with `_` are fixture metadata (e.g. `_note_variants`), not goldens.
        if (field.startsWith('_')) continue;
        if (expected === null) {
          expect(result.resolved[field]).toBeUndefined();
        } else if (Array.isArray(expected) && expected.length > 0
                   && typeof expected[0] === 'object' && expected[0] !== null
                   && !Array.isArray(expected[0])) {
          expectVariantsMatch(result.resolved[field], expected as Variant[]);
        } else {
          expect(result.resolved[field]).toEqual(expected);
        }
      }
    }, 30_000);
  }
});
