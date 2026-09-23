import { useEffect, useState } from 'react';
import { Input } from './input';

/**
 * A number box that lets the customer clear it while typing, but never lets
 * the screen disagree with what its owner holds.
 *
 * A plain controlled `value={n}` snaps an emptied box straight back to its old
 * number, so replacing "40" with "5" means selecting the text first or
 * fighting the input. The draft absorbs every keystroke and only a positive
 * integer is ever handed upward — which leaves exactly one gap: an empty, `0`,
 * negative or otherwise unparseable draft is shown while the owner still holds
 * the last good number. Blur closes that gap by snapping the draft back to
 * `value`.
 *
 * Shared by the Extract tab's run sentence and the Settings tab's budget row —
 * both put a number next to an all/custom toggle and want the same forgiving
 * typing behaviour.
 */
export function NumberBox({
  value,
  onValue,
  label,
}: {
  value: number;
  onValue: (n: number) => void;
  label: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  return (
    <Input
      type="number"
      min={1}
      aria-label={label}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = Number.parseInt(e.target.value, 10);
        if (Number.isFinite(parsed) && parsed > 0) onValue(parsed);
      }}
      onBlur={() => {
        const parsed = Number.parseInt(draft, 10);
        if (!Number.isFinite(parsed) || parsed < 1) setDraft(String(value));
      }}
      className="h-8 w-[72px] font-mono"
    />
  );
}
