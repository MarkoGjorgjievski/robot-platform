// What a website that changed says to its customer (spec 2026-10-21 §5): the
// badge, the Verification banner, the held row word, the refreshed line and
// the Extract tab's line. Pure, so every sentence is tested without a server.
// Never names a path, a source, a check, a hold, a model or money.
import { driftBadge, formatDMMM, joinList } from './drift-view';

export const NEEDS_ATTENTION = 'Needs attention';

const day = (d: Date | string) => formatDMMM(new Date(d));
const needs = (names: string[], suffix = '') => `${joinList(names)} ${names.length === 1 ? 'needs' : 'need'} you${suffix}`;

/** The websites table's and the header's badge: drift first (today's text), then "Needs attention". */
export function websiteBadge(driftedFields: string[] | null, needsAttention: boolean | undefined): string | null {
  return driftBadge(driftedFields) ?? (needsAttention ? NEEDS_ATTENTION : null);
}

/** The Verification tab's banner when nothing is drifted (the drift banner speaks then). */
export function attentionBanner(args: {
  driftedFields: string[] | null;
  fields: string[];
  fieldNames: Record<string, string>;
  goneProducts: number[];
  heldSince: Date | string | null;
  runnable: boolean;
}): string | null {
  if (args.driftedFields && args.driftedFields.length > 0) return null;
  const parts: string[] = [];
  if (args.fields.length > 0) parts.push(needs(args.fields.map((k) => args.fieldNames[k] ?? k)));
  if (args.goneProducts.length === 1) parts.push(`product ${args.goneProducts[0]} no longer loads`);
  else if (args.goneProducts.length > 1) parts.push(`products ${joinList(args.goneProducts.map(String))} no longer load`);
  if (parts.length === 0) return null;
  const subject = joinList(parts);
  const tail = !args.runnable
    ? 'extraction waits for you.'
    : args.heldSince
      ? `runs go on with what you verified on ${day(args.heldSince)}.`
      : 'runs go on as before.';
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} — ${tail}`;
}

/** Beside a held field's badge. */
export function heldWord(verifiedAt: Date | string | undefined): string | null {
  return verifiedAt ? `runs use what you verified on ${day(verifiedAt)}` : null;
}

/** Under a refreshed field's row, pages in product order; pages no longer on the board are left out. */
export function refreshLine(
  r: { at: Date | string; pages: Record<string, { was: string; now: string }> } | undefined,
  urls: string[],
): string | null {
  if (!r) return null;
  const items = urls.flatMap((u, i) => {
    const p = r.pages[u];
    return p ? [`${p.now} on product ${i + 1} (was ${p.was})`] : [];
  });
  return items.length > 0 ? `Updated automatically on ${day(r.at)}: ${items.join('; ')}` : null;
}

/** The Extract tab's line while the website runs with held fields. */
export function extractHeldLine(heldKeys: string[], fieldNames: Record<string, string>, heldSince: Date | string | null): string | null {
  if (heldKeys.length === 0 || !heldSince) return null;
  return `${needs(heldKeys.map((k) => fieldNames[k] ?? k), ' on the Verification tab')} — runs go on with what you verified on ${day(heldSince)}.`;
}
