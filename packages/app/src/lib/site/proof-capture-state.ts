// One product's proof-page capture as the cards and the screenshot panel show it (spec 2026-10-20
// §3.5.5): never "stalled", never a raw start error, and a poll that errors stops "taking
// screenshot…". Pure; `use-proof-captures.ts` feeds it.
import { captureWords } from '../capture-words';
import type { Box } from './verification-model';
import { SCREENSHOT_COULD_NOT_START, captureErrorText } from './verify-messages';

export type ProofCapture = {
  captureId: string;
  status: 'starting' | 'capturing' | 'captured' | 'failed';
  error?: string;
  /** A failed capture's verdict (spec 2026-10-09 §A1/§A2): `refused` / `challenge` name the row's words. Absent for other failures. */
  verdict?: { kind: string };
  tiles: string[];
  boxes: Box[];
  pageHeight: number;
  capturedHeight: number;
  /** The captured page's `<title>`, when it reported one and this capture landed. */
  title?: string;
};

/** The part of `sources.proofPageCapture`'s answer this reads. */
export type ProofPoll = {
  /** `waiting`: turned away, its next try queued (spec 2026-10-28 §3.1). Until the card has its own words for it, it reads as still capturing. */
  status: 'capturing' | 'captured' | 'failed' | 'waiting';
  error?: string;
  verdict?: { kind: string };
  title?: string;
  tiles: string[];
  boxes: Box[];
  pageHeight: number;
  capturedHeight: number;
};

export const EMPTY_CAPTURE: Pick<ProofCapture, 'tiles' | 'boxes' | 'pageHeight' | 'capturedHeight'> = { tiles: [], boxes: [], pageHeight: 0, capturedHeight: 0 };

/** `staff` (`showsMoney`, spec 2026-10-21): staff read a failed capture's stored sentence; a customer reads it through `captureWords`. */
export function proofCaptureState(args: { startError?: string; captureId: string | null; poll?: { data?: ProofPoll; isError: boolean }; staff?: boolean }): ProofCapture {
  if (args.startError !== undefined) return { captureId: '', status: 'failed', error: SCREENSHOT_COULD_NOT_START, ...EMPTY_CAPTURE };
  if (!args.captureId) return { captureId: '', status: 'starting', ...EMPTY_CAPTURE };
  const data = args.poll?.data;
  if (!data) {
    return args.poll?.isError
      ? { captureId: args.captureId, status: 'failed', error: SCREENSHOT_COULD_NOT_START, ...EMPTY_CAPTURE }
      : { captureId: args.captureId, status: 'starting', ...EMPTY_CAPTURE };
  }
  // A capture waiting for its next try is still on its way: no failure, no error sentence yet.
  if (data.status === 'waiting') return { captureId: args.captureId, status: 'capturing', ...EMPTY_CAPTURE };
  const error = captureErrorText(data.error === undefined ? undefined : captureWords(data.error, args.staff));
  return {
    captureId: args.captureId,
    status: data.status,
    ...(error ? { error } : {}),
    ...(data.verdict ? { verdict: { kind: data.verdict.kind } } : {}),
    ...(data.title ? { title: data.title } : {}),
    tiles: data.tiles,
    boxes: data.boxes,
    pageHeight: data.pageHeight,
    capturedHeight: data.capturedHeight,
  };
}
