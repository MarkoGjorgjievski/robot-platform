export type PathProposal = { source: 'api' | 'json-ld' | 'meta' | 'xpath'; path: string; transform: 'identity' | 'cents_to_units' | 'first_of_list' };
export type ProposePathsAgent = { proposePaths(userText: string): Promise<PathProposal[]> };

const SOURCES = new Set(['api', 'json-ld', 'meta', 'xpath']);
const TRANSFORMS = new Set(['identity', 'cents_to_units', 'first_of_list']);

export function parsePathProposals(input: unknown): PathProposal[] {
  const list = (input as { proposals?: unknown } | null)?.proposals;
  if (!Array.isArray(list)) return [];
  const out: PathProposal[] = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const { source, path, transform } = p as Record<string, unknown>;
    if (typeof source !== 'string' || !SOURCES.has(source) || typeof path !== 'string' || path.trim() === '') continue;
    out.push({ source: source as PathProposal['source'], path: path.trim(), transform: typeof transform === 'string' && TRANSFORMS.has(transform) ? (transform as PathProposal['transform']) : 'identity' });
  }
  return out;
}

export const PROPOSE_PATHS_SYSTEM = `You locate one field's value on product pages and return STRUCTURAL extraction paths.
Rules: a path must work on every page shown, so anchor on ids, data-* attributes, class names or JSON keys — never on the value text. Do not write contains(text(), '<value>'). Prefer api, then json-ld, then meta, then xpath. Return at most 5 proposals.`;
