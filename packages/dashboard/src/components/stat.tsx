// packages/dashboard/src/components/stat.tsx
/**
 * One fact of a facts row: the label above, the value in mono below.
 *
 * `'value'` is the table-sized default every ordinary fact uses. `'figure'`
 * is the 18px reading reserved for the probe gate's four evidence counts,
 * where the number itself is the thing being judged.
 *
 * Lifted out of `source-run-detail.tsx` because three screens had grown their
 * own copy and two of them had drifted off the tokens — a value in Public Sans
 * `font-medium` rather than in mono, which is the one thing spec 7 is explicit
 * about for numbers and keys.
 */
export function Stat({ label, value, size = 'value' }: { label: string; value: string; size?: 'value' | 'figure' }) {
  return (
    <div className="min-w-0">
      <dt className="label-soft">{label}</dt>
      <dd
        className={`mt-1 truncate font-mono text-gray-900 ${size === 'figure' ? 'text-lg' : 'text-[13px]'}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
