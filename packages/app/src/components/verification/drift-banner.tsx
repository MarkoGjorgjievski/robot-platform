import { driftBanner, type DriftCheckView } from '../../lib/site/drift-view';

/**
 * The Verification tab's drift banner (plan 2026-10-05, Task 3), above the
 * table: it is the first thing a customer sees when a field that used to
 * extract has stopped. All the text logic lives in `drift-view.ts`; this only
 * renders its result, in the same warn rail the tab's other notices use
 * (`index.tsx`'s own `runNote` paragraph). `role="status"`, not `alert`: it is a
 * persistent notice present at page load, not an interruption to announce on
 * every visit.
 *
 * With nothing drifted, `attention` (spec 2026-10-21 §5, `attentionBanner`)
 * speaks in the same rail: what needs the customer, and that runs go on.
 */
export function DriftBanner({
  driftedFields,
  fieldNames,
  check,
  attention,
}: {
  driftedFields: string[] | null;
  fieldNames: Record<string, string>;
  check: DriftCheckView | null;
  attention: string | null;
}) {
  const banner = driftBanner({ driftedFields, fieldNames, check });
  if (banner.kind === 'none') {
    return attention ? (
      <p role="status" className="border-l-2 border-warn pl-3 text-sm text-warn">
        {attention}
      </p>
    ) : null;
  }
  return (
    <p role="status" className="border-l-2 border-warn pl-3 text-sm text-warn">
      {banner.text}
    </p>
  );
}
