// A failed mutation's message on a customer screen (spec 2026-10-21). The api words its refusals
// for customers (PRECONDITION_FAILED / BAD_REQUEST / FORBIDDEN with a sentence); anything else — a
// server error, a network failure, library text, an id — is not for a customer to read. Staff
// (`showsMoney`) read the message as sent. Pure.
import { captureWords } from './capture-words';

export const SOMETHING_WENT_WRONG = 'Something went wrong. Try again.';

const WORDED = new Set(['PRECONDITION_FAILED', 'BAD_REQUEST', 'FORBIDDEN']);
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/** The part of a tRPC client error this reads. */
export type MutationErrorLike = { message: string; data?: { code?: string } | null };

export function mutationErrorText(error: MutationErrorLike, staff = false): string {
  if (staff) return error.message;
  const code = error.data?.code;
  if (!code || !WORDED.has(code) || UUID.test(error.message)) return SOMETHING_WENT_WRONG;
  // A worded refusal can still carry a stored capture sentence (the execute guard's); anything
  // holding a host or library text takes the generic sentence.
  return captureWords(error.message, false, SOMETHING_WENT_WRONG);
}
