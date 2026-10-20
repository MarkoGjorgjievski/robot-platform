// Spec 2026-10-20 §3.2: `sources.verify` refuses with structured problems — the field's name, the
// product number (the proof page's position) and a reason — and the app writes the sentence. The
// raw problem text (field keys, full addresses, "@") stays in the server log.
import { TRPCError } from '@trpc/server';
import type { BindingProblem } from './binding-input.js';

export type VerifyProblem =
  | { reason: 'blank'; field: string; product: number }
  | { reason: 'too_few_values'; field: string }
  | { reason: 'no_fields' }
  | { reason: 'variants' }
  | { reason: 'other' };

/** A refused Verify's cause: the formatter in trpc.ts copies `problems` onto `error.data.verifyProblems`. */
export class VerifyRefusal extends Error {
  constructor(public readonly problems: VerifyProblem[]) {
    super('Verify refused');
    this.name = 'VerifyRefusal';
  }
}

/** The message of a refusal whose problems the app writes itself: neutral, no field key, no address. */
export const VERIFY_REFUSED = 'Verify could not start';

/** Binding problems as the app needs them: blank and too-few problems by name and product, everything else one `other`, last. */
export function refusalProblems(list: BindingProblem[]): VerifyProblem[] {
  const named: VerifyProblem[] = [];
  let other = false;
  for (const p of list) {
    if (p.reason === 'blank' && p.field && p.product) named.push({ reason: 'blank', field: p.field, product: p.product });
    else if (p.reason === 'too_few_values' && p.field) named.push({ reason: 'too_few_values', field: p.field });
    else other = true;
  }
  return other ? [...named, { reason: 'other' }] : named;
}

/** The PRECONDITION_FAILED a refused Verify throws; `log` (the raw problem text) goes to the server log only. */
export function refuseVerify(problems: VerifyProblem[], log: string[], message: string = VERIFY_REFUSED): TRPCError {
  if (log.length) console.warn(`[sources.verify] refused:\n  ${log.join('\n  ')}`);
  return new TRPCError({ code: 'PRECONDITION_FAILED', message, cause: new VerifyRefusal(problems) });
}
