// Token accounting for everything this package sends to Claude.
//
// The cost model in docs/project-overview.md ("~$0.12 per URL") has been carried
// forward since it was measured on a model that no longer exists, and nothing has
// re-measured it because nothing recorded `usage` from any response. The table is
// currently annotated as unverified for exactly that reason.
//
// Tokens are the fact; dollars are an estimate at the rates below. Both are
// reported, and the rates are stated wherever a cost is shown, so a stale price
// table produces a wrong number that is obviously traceable rather than a
// confident one that is not.

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  requests: number;
};

export type UsageByModel = Record<string, TokenUsage>;

const EMPTY: TokenUsage = {
  inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, requests: 0,
};

/**
 * Per-model list pricing, USD per million tokens.
 *
 * Deliberately LIST price, not the promotional rate: Sonnet 5 carries a $2/$10
 * introductory rate through 2026-08-31, and encoding a date-dependent discount
 * would silently start over-reporting the moment it lapses. Erring high means a
 * cost estimate is a ceiling, which is the safer direction for a budget figure.
 */
const PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-8': { input: 5, output: 25 },
};

let usage: UsageByModel = {};

/** Shape of the `usage` block on a Messages API response. */
export type ApiUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function recordUsage(model: string, apiUsage: ApiUsage | null | undefined): void {
  if (!apiUsage) return;
  const current = usage[model] ?? { ...EMPTY };
  usage[model] = {
    inputTokens: current.inputTokens + (apiUsage.input_tokens ?? 0),
    outputTokens: current.outputTokens + (apiUsage.output_tokens ?? 0),
    cacheCreationTokens: current.cacheCreationTokens + (apiUsage.cache_creation_input_tokens ?? 0),
    cacheReadTokens: current.cacheReadTokens + (apiUsage.cache_read_input_tokens ?? 0),
    requests: current.requests + 1,
  };
}

/** A copy of the totals so far — safe to hold and diff against a later snapshot. */
export function snapshotUsage(): UsageByModel {
  return Object.fromEntries(Object.entries(usage).map(([m, u]) => [m, { ...u }]));
}

export function resetUsage(): void {
  usage = {};
}

/** `after` minus `before`, per model. Used to attribute spend to one unit of work. */
export function diffUsage(before: UsageByModel, after: UsageByModel): UsageByModel {
  const out: UsageByModel = {};
  for (const [model, a] of Object.entries(after)) {
    const b = before[model] ?? EMPTY;
    const d: TokenUsage = {
      inputTokens: a.inputTokens - b.inputTokens,
      outputTokens: a.outputTokens - b.outputTokens,
      cacheCreationTokens: a.cacheCreationTokens - b.cacheCreationTokens,
      cacheReadTokens: a.cacheReadTokens - b.cacheReadTokens,
      requests: a.requests - b.requests,
    };
    if (d.requests > 0 || d.inputTokens > 0 || d.outputTokens > 0) out[model] = d;
  }
  return out;
}

/**
 * Estimated USD at the list rates above. Cache writes bill at ~1.25x input and
 * cache reads at ~0.1x; an unknown model contributes 0 rather than guessing, and
 * `models` names anything that was skipped so a silent zero is impossible.
 */
export function estimateCostUsd(byModel: UsageByModel): { usd: number; unpricedModels: string[] } {
  let usd = 0;
  const unpricedModels: string[] = [];
  for (const [model, u] of Object.entries(byModel)) {
    const price = PRICING_USD_PER_MTOK[model];
    if (!price) { unpricedModels.push(model); continue; }
    const billedInput = u.inputTokens + u.cacheCreationTokens * 1.25 + u.cacheReadTokens * 0.1;
    usd += (billedInput / 1_000_000) * price.input + (u.outputTokens / 1_000_000) * price.output;
  }
  return { usd, unpricedModels };
}

/** One-line-per-model summary for logs and reports. */
export function formatUsage(byModel: UsageByModel): string {
  const entries = Object.entries(byModel);
  if (entries.length === 0) return 'no API calls recorded';
  const { usd, unpricedModels } = estimateCostUsd(byModel);
  const lines = entries.map(([model, u]) =>
    `${model}: ${u.requests} req, ${u.inputTokens.toLocaleString()} in / ${u.outputTokens.toLocaleString()} out`
    + (u.cacheReadTokens > 0 ? ` (${u.cacheReadTokens.toLocaleString()} cached)` : ''),
  );
  lines.push(`estimated $${usd.toFixed(4)} at list rates`);
  if (unpricedModels.length > 0) lines.push(`NOT PRICED (excluded from the estimate): ${unpricedModels.join(', ')}`);
  return lines.join('\n');
}
