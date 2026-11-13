import { PRODUCTS_MIN } from './verification-model';

/** One step of the Verification tab's rail: done, the one to work on now, or still ahead. */
export type VerifyStep = { name: string; sub: string; state: 'done' | 'now' | 'next' };

/**
 * The rail above the verification table: Products → Check values → Verify →
 * Extract. Exactly one step is `now` — the first that is not done — so the
 * customer always reads where they are; the bar's one filled button is that
 * step's action.
 */
export function verifySteps(a: {
  /** Product columns that have a page. */
  products: number;
  /** Fields whose row is accepted, of `total`. */
  accepted: number;
  total: number;
  /** A Verify is running; `stage` is its line, in customer words. */
  busy: boolean;
  stage: string | null;
  /** Extraction is unlocked (the last verification stands). */
  extract: boolean;
  /** This website's variants must be verified too. */
  variants: boolean;
  /** When the verification that stands finished, as shown ("13 Nov, 20:32"). */
  verifiedAt?: string | null;
}): VerifyStep[] {
  const productsDone = a.products >= PRODUCTS_MIN;
  const checkDone = productsDone && a.total > 0 && a.accepted === a.total;
  const verifyDone = checkDone && a.extract && !a.busy;
  const done = [productsDone, checkDone, verifyDone];
  const first = done.indexOf(false);
  const now = first === -1 ? 3 : first;
  const state = (i: number): VerifyStep['state'] => (i === now ? 'now' : done[i] ? 'done' : 'next');

  return [
    { name: 'Products', sub: productsDone ? `${a.products} products` : `${a.products} of ${PRODUCTS_MIN}`, state: state(0) },
    { name: 'Check values', sub: `${a.accepted} of ${a.total} accepted`, state: state(1) },
    { name: 'Verify', sub: a.busy ? (a.stage ?? 'Verifying…') : verifyDone ? (a.verifiedAt ? `Verified ${a.verifiedAt}` : 'Verified') : a.variants ? 'Fields and variants' : 'Every field', state: state(2) },
    { name: 'Extract', sub: a.extract ? 'Ready' : 'After Verify', state: state(3) },
  ];
}
