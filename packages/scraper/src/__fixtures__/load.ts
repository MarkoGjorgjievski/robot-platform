import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import type { Fixture } from './types.js';

const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'corpus');

export function loadFixture(label: string): Fixture {
  const path = join(CORPUS_DIR, `${label}.json`);
  return JSON.parse(readFileSync(path, 'utf-8')) as Fixture;
}

export function listFixtures(): string[] {
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}
