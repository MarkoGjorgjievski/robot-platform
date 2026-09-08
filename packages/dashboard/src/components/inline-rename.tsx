import { useEffect, useRef, useState } from 'react';
import { Pencil, Loader2 } from 'lucide-react';

/** A title the customer can rename in place. Enter saves, Escape cancels, blur saves. */
export function InlineRename({ value, onSave, pending, className }: { value: string; onSave: (name: string) => void; pending?: boolean; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const settled = useRef(false);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  function commit() {
    if (settled.current) return;
    settled.current = true;
    const next = draft.trim();
    setEditing(false);
    if (next && next !== value) onSave(next);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.preventDefault(); settled.current = true; setEditing(false); } }}
        className={`rounded-md border border-gray-300 px-2 py-0.5 focus:border-accent-500 focus:outline-none ${className ?? ''}`}
        aria-label="Name"
        title="Name"
      />
    );
  }
  return (
    <button type="button" onClick={() => { settled.current = false; setEditing(true); }} className={`group inline-flex items-center gap-2 text-left ${className ?? ''}`} title="Rename" aria-label="Rename">
      <span>{value}</span>
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" /> : <Pencil className="h-3.5 w-3.5 text-gray-300 group-hover:text-gray-500" />}
    </button>
  );
}
