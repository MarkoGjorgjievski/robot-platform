// Schema tokens matched as case-insensitive SUBSTRINGS of an object's direct
// keys. Real SSR blobs (e.g. Next.js __NEXT_DATA__) use descriptive key names
// like `colorDescription`, `availabilityDate`, `productInfo`, `prices` that
// rarely exact-match a fixed key list — substring matching against tokens
// generalizes across these naming styles without hardcoding site-specific keys.
const SCHEMA_TOKENS = [
  'name', 'title', 'price', 'description', 'sku', 'image', 'brand',
  'category', 'availability', 'rating', 'review', 'color', 'size',
  'variant', 'option', 'product', 'weight', 'dimension', 'model',
  'ingredient', 'material', 'currency',
];

// Keys that, when present on an object, signal it is a deliberately selected
// entity node. Preferred when it scores at or near the best score found, so we
// land on the canonical product object rather than an equally-rich duplicate.
const SELECTION_KEY_TOKENS = ['selected'];

const MAX_DEPTH = 12;
const MAX_ARRAY_SCAN = 20;
const MIN_SCORE_FLOOR = 2;

export type EntitySubtree = {
  path: string;
  score: number;
  value: unknown;
};

// Score = count of DISTINCT schema tokens that appear as a substring of any
// direct key. Distinctness prevents a node from being inflated by many keys
// that all share one token (e.g. several `*Color*` keys count once).
function scoreObject(obj: Record<string, unknown>): number {
  const matched = new Set<string>();
  for (const key of Object.keys(obj)) {
    const lowered = key.toLowerCase();
    for (const token of SCHEMA_TOKENS) {
      if (lowered.includes(token)) matched.add(token);
    }
  }
  return matched.size;
}

function isSelectionKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return SELECTION_KEY_TOKENS.some((token) => lowered.includes(token));
}

type WalkState = {
  best: EntitySubtree;
  /** Best entity reached via an explicit selection key (e.g. `selectedProduct`). */
  selected: EntitySubtree | null;
};

function walk(
  value: unknown,
  path: string,
  depth: number,
  viaSelectionKey: boolean,
  state: WalkState,
): void {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    const limit = Math.min(value.length, MAX_ARRAY_SCAN);
    for (let i = 0; i < limit; i++) {
      walk(value[i], `${path}[${i}]`, depth + 1, false, state);
    }
    return;
  }

  const obj = value as Record<string, unknown>;
  const score = scoreObject(obj);
  if (score >= MIN_SCORE_FLOOR) {
    if (score > state.best.score) {
      state.best = { path, score, value: obj };
    }
    if (viaSelectionKey && (state.selected === null || score > state.selected.score)) {
      state.selected = { path, score, value: obj };
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    walk(v, `${path}.${k}`, depth + 1, isSelectionKey(k), state);
  }
}

export function findEntitySubtree(blob: unknown): EntitySubtree {
  const initial: EntitySubtree = { path: '$', score: 0, value: blob };
  if (blob === null || typeof blob !== 'object') return initial;

  const state: WalkState = { best: initial, selected: null };
  walk(blob, '$', 0, false, state);

  // Prefer an explicitly-selected entity node when it is at least as rich as
  // the global best (within one token). On pages that duplicate the product
  // across a SKU-keyed map this lands us on the canonical `selected*` node.
  if (state.selected && state.selected.score >= state.best.score - 1) {
    return state.selected;
  }
  return state.best;
}
