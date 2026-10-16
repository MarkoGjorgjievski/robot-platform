// Jev at Verify, in shadow (spec 2026-10-16 §6): what the Verification tab says
// about a reading. Pure; mirrors @robot/api's JevAnswers (never imported).
// Read-only: nothing here touches the board.
import { normalize } from '@robot/scraper/normalize';
import type { Board, Field, Suggestions } from './verification-model';

export type JevAnswersLike = {
  fields: Record<string, { candidates: Array<{ id: string; value: string }>; pick: string; p: number }>;
  variant?: { entries: Array<{ id: string; label: string }>; pick: string; p: number; pageMatch: string | null };
};
export type JevReadingLike = { status: 'running' | 'done' | 'failed'; answers: JevAnswersLike | null };
export const JEV_NOTE_P = 0.6;
export const JEV_FIELD_NOTE = (value: string, field: string, n: number) => `Jev reads ${value} as the ${field} on product ${n}`;
export const JEV_VARIANT_NOTE = (label: string, n: number) => `Jev reads the selected variant as ${label} on product ${n}`;

const VARIANT_LIST_STEP = /(^|[.\]])(offers|hasVariant|variants|variant|skus|items|products|options)\[(\d+|page)\]/i;
export function readsVariantList(path: string | undefined): boolean {
  return !!path && VARIANT_LIST_STEP.test(path);
}

function same(field: Field, a: string, b: string): boolean {
  if (field.type === 'money' || field.type === 'number') { const x = normalize(field.type, a); return x !== null && x === normalize(field.type, b); }
  return a.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase() === b.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function jevNote(field: Field, board: Board, live: Suggestions, readings: Record<string, JevReadingLike | undefined>, readsVariant: boolean): string | null {
  let variantNote: string | null = null;
  for (const [i, card] of board.cards.entries()) {
    const r = readings[card.url];
    if (!r || r.status !== 'done' || !r.answers) continue;
    const a = r.answers.fields[field.key];
    if (a && a.pick !== 'none' && a.p >= JEV_NOTE_P) {
      const jev = a.candidates.find((c) => c.id === a.pick)?.value;
      const theirs = board.answers[field.key]?.[card.url]?.value ?? live[field.key]?.[card.url]?.value;
      if (jev && theirs && !same(field, jev, theirs)) return JEV_FIELD_NOTE(jev, field.name, i + 1);
    }
    const v = r.answers.variant;
    if (readsVariant && !variantNote && v && v.pick !== 'none' && v.p >= JEV_NOTE_P && v.pick !== v.pageMatch) {
      const label = v.entries.find((e) => e.id === v.pick)?.label;
      if (label) variantNote = JEV_VARIANT_NOTE(label, i + 1);
    }
  }
  return variantNote;
}

export function jevDetailText(reading: JevReadingLike | undefined, fieldKey: string): string {
  const a = reading?.status === 'done' ? reading.answers?.fields[fieldKey] : undefined;
  if (!a) return 'Jev: not read';
  if (a.pick === 'none') return `Jev: none of these (${a.p.toFixed(2)})`;
  const v = a.candidates.find((c) => c.id === a.pick)?.value;
  return v ? `Jev: ${v} (${a.p.toFixed(2)})` : 'Jev: not read';
}

/** How often the tab re-asks for readings, while it should. */
export const JEV_POLL_MS = 3000;
/**
 * A capture lands as `captured` a few queries before its reading row is
 * written, so a first answer can miss a reading that is about to start: a
 * capture with no row is re-asked this many times, then taken as "no
 * reading" (the switch off, the budget spent, nothing to ask).
 */
export const JEV_MISSING_FETCHES = 3;

/**
 * The polled `sources.jevReadings` query's interval: every `JEV_POLL_MS` while
 * a reading runs, or while a capture has no row and the query has answered
 * fewer than `JEV_MISSING_FETCHES` times; otherwise stop. An error (NOT_FOUND
 * for a capture that is no longer this website's) stops it too.
 */
export function jevPollMs(
  data: Record<string, JevReadingLike | undefined> | undefined,
  captureIds: string[],
  state: { errored: boolean; fetches: number },
): number | false {
  if (state.errored || captureIds.length === 0) return false;
  if (!data) return JEV_POLL_MS;
  if (captureIds.some((id) => data[id]?.status === 'running')) return JEV_POLL_MS;
  if (captureIds.some((id) => !data[id]) && state.fetches < JEV_MISSING_FETCHES) return JEV_POLL_MS;
  return false;
}
