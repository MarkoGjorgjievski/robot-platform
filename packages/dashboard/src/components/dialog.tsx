import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Native <dialog>: focus trapping, Escape, and the backdrop come from the
 * browser. Body content is the form; the caller owns the footer buttons.
 */
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
      className="w-[26rem] max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-0 shadow-xl backdrop:bg-gray-900/30"
    >
      <div className="px-5 pt-4 pb-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </dialog>
  );
}

export const fieldClass = 'mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100';
export const labelClass = 'block text-xs text-gray-600';
