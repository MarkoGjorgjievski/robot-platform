/**
 * What a table cell shows while a Verify runs (Marko 2026-11-13: the table is the progress bar):
 * `scan` — this is what is being read right now; `wait` — not reached yet; `still` — nothing to say.
 *
 * A running Verify reports one stage line, not a result per cell, so this says only what the stage
 * says: the product whose screenshot is being taken, every cell while the values are looked for, the
 * one field that needs a closer look. The verdicts land together when the run ends.
 */
export type LiveCell = 'scan' | 'wait' | 'still';

export function liveCell(stage: string | null, fieldKey: string, product: number): LiveCell {
  if (stage === null) return 'still';
  if (stage === 'starting') return 'wait';
  const capturing = /^capturing (\d+)\/(\d+)$/.exec(stage);
  if (capturing) {
    const at = Number(capturing[1]) - 1;
    return product === at ? 'scan' : product < at ? 'still' : 'wait';
  }
  if (stage === 'searching') return 'scan';
  const asking = /^asking AI for (.+)$/.exec(stage);
  if (asking) return asking[1] === fieldKey ? 'scan' : 'still';
  return 'still';
}
