const SCHEMA_KEYS = new Set([
  'name', 'title', 'price', 'description', 'sku', 'image', 'images',
  'brand', 'category', 'availability', 'rating', 'reviews', 'product',
  'variants', 'sizes', 'colors', 'flavours', 'options',
]);

const MAX_DEPTH = 12;
const MAX_ARRAY_SCAN = 20;
const MIN_SCORE_FLOOR = 2;

export type EntitySubtree = {
  path: string;
  score: number;
  value: unknown;
};

function scoreObject(obj: Record<string, unknown>): number {
  let score = 0;
  for (const key of Object.keys(obj)) {
    if (SCHEMA_KEYS.has(key.toLowerCase())) score++;
  }
  return score;
}

function walk(value: unknown, path: string, depth: number, best: EntitySubtree): EntitySubtree {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return best;

  if (Array.isArray(value)) {
    const limit = Math.min(value.length, MAX_ARRAY_SCAN);
    for (let i = 0; i < limit; i++) {
      best = walk(value[i], `${path}[${i}]`, depth + 1, best);
    }
    return best;
  }

  const obj = value as Record<string, unknown>;
  const score = scoreObject(obj);
  if (score >= MIN_SCORE_FLOOR && score > best.score) {
    best = { path, score, value: obj };
  }
  for (const [k, v] of Object.entries(obj)) {
    best = walk(v, `${path}.${k}`, depth + 1, best);
  }
  return best;
}

export function findEntitySubtree(blob: unknown): EntitySubtree {
  const initial: EntitySubtree = { path: '$', score: 0, value: blob };
  if (blob === null || typeof blob !== 'object') return initial;
  return walk(blob, '$', 0, initial);
}
