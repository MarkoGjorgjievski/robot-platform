import { describe, it, expect } from 'vitest';
import { listFixtures, loadFixture } from './load.js';
import { runFixtureReplay } from './replay.js';

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
        if (expected === null) {
          expect(result.resolved[field], `${field}: expected absent`).toBeUndefined();
        } else {
          expect(result.resolved[field], `${field}: expected ${JSON.stringify(expected)}`).toEqual(expected);
        }
      }
    }, 60_000);
  }
});
