// One product's proof-page capture as the cards and the screenshot panel show it (spec 2026-10-20
// §3.5.5): never "stalled", never a raw start error, and a poll that errors stops "taking
// screenshot…". Pure; `use-proof-captures.ts` feeds it.
import { captureWords } from '../capture-words';
import type { Box } from './verification-model';
import { SCREENSHOT_COULD_NOT_START, captureErrorText } from './verify-messages';

/** The proof-page ladder's fields (spec 2026-10-28 §3.1): where a turned-away page stands across its tries. */
export type LadderFields = {
  /** When this try started (capturing, waiting), or the last try's start on a given-up row: the give-up sentence's clock ends there. */
  startedAt?: string;
  /** When the next try starts (waiting). */
  retryAt?: string;
  /** The try running (capturing) or coming next (waiting). */
  attempt?: number;
  /** How many tries in all (4). */
  of?: number;
  /** The route the try takes, by name: it only picks "Trying another way in" (and staff's route note). */
  via?: 'direct' | 'fallback';
  /** Set only when the ladder ran out on walls. */
  gaveUp?: true;
  /** The tries actually made, on a given-up row (0–4). */
  attempts?: number;
  /** The first try's start: the give-up sentence's clock. */
  firstStartedAt?: string;
};

export type ProofCapture = LadderFields & {
  captureId: string;
  /** `waiting`: turned away, its next try queued (spec 2026-10-28 §3.1). */
  status: 'starting' | 'capturing' | 'waiting' | 'captured' | 'failed';
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
export type ProofPoll = LadderFields & {
  status: 'capturing' | 'captured' | 'failed' | 'waiting';
  error?: string;
  verdict?: { kind: string };
  title?: string;
  tiles: string[];
  boxes: Box[];
  pageHeight: number;
  capturedHeight: number;
};

/** How often one capture is read again (spec 2026-10-28 §3.6): every 2 s while it runs, every 5 s while it waits for its next try, else never. */
export const CAPTURING_POLL_MS = 2000;
export const WAITING_POLL_MS = 5000;
export function capturePollMs(status: string | undefined): number | false {
  return status === 'capturing' ? CAPTURING_POLL_MS : status === 'waiting' ? WAITING_POLL_MS : false;
}

export const EMPTY_CAPTURE:Pick<ProofCapture, 'tiles' | 'boxes' | 'pageHeight' | 'capturedHeight'> = { tiles: [], boxes: [], pageHeight: 0, capturedHeight: 0 };

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
  const error = captureErrorText(data.error === undefined ? undefined : captureWords(data.error, args.staff));
  return {
    captureId: args.captureId,
    status: data.status,
    ...(error ? { error } : {}),
    ...(data.verdict ? { verdict: { kind: data.verdict.kind } } : {}),
    ...(data.title ? { title: data.title } : {}),
    ...ladderOf(data),
    tiles: data.tiles,
    boxes: data.boxes,
    pageHeight: data.pageHeight,
    capturedHeight: data.capturedHeight,
  };
}

const LADDER_KEYS = ['startedAt', 'retryAt', 'attempt', 'of', 'via', 'gaveUp', 'attempts', 'firstStartedAt'] as const;

/** The ladder fields the answer carries, and only those (spec 2026-10-28 §3.6: the card's clock, countdown and try). */
function ladderOf(data: ProofPoll): LadderFields {
  const out: Record<string, unknown> = {};
  for (const k of LADDER_KEYS) if (data[k] !== undefined && data[k] !== null) out[k] = data[k];
  return out as LadderFields;
}
