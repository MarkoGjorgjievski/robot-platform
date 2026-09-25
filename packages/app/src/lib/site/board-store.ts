// What the Verification tab last pushed to its autosave, per website, kept
// for the life of the page (final review I3). A tab left and reopened before
// its flush-on-unmount save and refetch finish would otherwise seed from the
// stale `sources.get` cache, and its next edit would overwrite the lost tick
// on the server. The route writes here; a new mount reads `seedDecision`.
import type { Board } from './verification-model';

export type StoredBoard = {
  /** The latest board pushed to the saver. */
  board: Board;
  /** When it was pushed (ms since epoch), to compare with the cache's fetch time. */
  pushedAt: number;
  /** True once a save of exactly this board has landed and been written into the cache. */
  confirmed: boolean;
  /** The save (or unmount flush) still in flight, or null. */
  pending: Promise<void> | null;
};

export type SeedDecision = { kind: 'server' } | { kind: 'wait' } | { kind: 'stored'; board: Board; resave: boolean };

/**
 * Where a new mount's board comes from. `serverUpdatedAt` is the cached
 * `sources.get` copy's fetch time (react-query's `dataUpdatedAt`).
 *
 * - a save still in flight: wait for it (the caller shows the skeleton);
 * - the latest push never landed: the stored board, saved again;
 * - the latest push is newer than the cached copy: the stored board;
 * - otherwise the server's copy, which is at least as new.
 */
export function seedDecision(entry: StoredBoard | undefined, serverUpdatedAt: number): SeedDecision {
  if (!entry) return { kind: 'server' };
  if (entry.pending) return { kind: 'wait' };
  if (!entry.confirmed) return { kind: 'stored', board: entry.board, resave: true };
  if (entry.pushedAt > serverUpdatedAt) return { kind: 'stored', board: entry.board, resave: false };
  return { kind: 'server' };
}

export function createBoardStore() {
  const entries = new Map<string, StoredBoard>();
  return {
    get: (sourceId: string): StoredBoard | undefined => entries.get(sourceId),
    pushed(sourceId: string, board: Board, at: number = Date.now()) {
      const prev = entries.get(sourceId);
      entries.set(sourceId, { board, pushedAt: at, confirmed: false, pending: prev?.pending ?? null });
    },
    /** Tracks a save or flush; `pending` clears when the latest one tracked settles. */
    saving(sourceId: string, p: Promise<void>) {
      const entry = entries.get(sourceId);
      if (!entry) return;
      entry.pending = p;
      const settle = () => {
        const now = entries.get(sourceId);
        if (now && now.pending === p) now.pending = null;
      };
      p.then(settle, settle);
    },
    /** A save of `board` landed; it confirms the entry only if nothing newer was pushed since. */
    saved(sourceId: string, board: Board) {
      const entry = entries.get(sourceId);
      if (entry && entry.board === board) entry.confirmed = true;
    },
  };
}

/** The page-wide store the Verification route uses. */
export const boardStore = createBoardStore();
