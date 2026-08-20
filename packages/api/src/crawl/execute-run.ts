// packages/api/src/crawl/execute-run.ts
// Phase 2: turn a work list into data, one item at a time.
//
// Sequential on purpose. A Source is one domain, and `runExtraction` already
// serialises same-domain work behind the per-domain lock plus a 2s politeness
// delay — so parallelism here would only fight the politeness rule that keeps us
// welcome on the site.
//
// Every collaborator is injected. The loop's logic — keep going after a failure,
// stop when cancelled, count what actually happened — is then testable without a
// browser, an API key, or a database.

import type { ClaimedItem } from './claim-item.js';

export type ExecuteDeps = {
  claim: (runId: string) => Promise<ClaimedItem | null>;
  extractItem: (item: ClaimedItem) => Promise<{ row: Record<string, unknown>; extractionId: string | null }>;
  onDone: (itemId: string, extractionId: string | null) => Promise<void>;
  onFailed: (itemId: string, message: string) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  finalise: (rowCount: number) => Promise<string>;
};

export type ExecuteOutcome = {
  extracted: number;
  failed: number;
  cancelled: boolean;
  status: string;
};

export async function executeRun(runId: string, deps: ExecuteDeps): Promise<ExecuteOutcome> {
  let extracted = 0;
  let failed = 0;
  let cancelled = false;

  for (;;) {
    // Between items, never mid-item: a cancelled run leaves clean state, and an
    // item already claimed is finished rather than abandoned as `running`.
    if (await deps.isCancelled()) {
      cancelled = true;
      break;
    }

    const item = await deps.claim(runId);
    if (!item) break;

    try {
      const { extractionId } = await deps.extractItem(item);
      await deps.onDone(item.id, extractionId);
      extracted++;
    } catch (err) {
      // One blocked page must never cost the other 299 in the run.
      await deps.onFailed(item.id, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  const status = await deps.finalise(extracted);
  return { extracted, failed, cancelled, status };
}
