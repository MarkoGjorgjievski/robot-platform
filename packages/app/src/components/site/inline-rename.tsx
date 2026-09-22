import { useEffect, useRef, useState } from 'react';
import { trpc } from '../../lib/trpc';

/**
 * The website's name, edited where it is read — in the page title.
 *
 * The same manners as the Fields table's name input, for the same reason: a
 * name is a single value a customer corrects in passing, so the title *is* the
 * editor. It is a real input at all times, borderless and inheriting the `h1`'s
 * type, so at rest the row reads as a title; the hairline on hover and the
 * text-colour border on focus are the whole affordance. A text node that swaps
 * for an input on click would lose the caret where they clicked.
 *
 * It sizes itself to its text rather than filling the row: the hostname sits on
 * the right of the same row, and an input stretched between them would put a
 * focus border round half the page.
 */
export function InlineRename({ sourceId, name }: { sourceId: string; name: string }) {
  const utils = trpc.useUtils();
  const rename = trpc.sources.rename.useMutation();

  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Escape has to undo the edit *and* leave the field, and the blur it causes
  // arrives before React has re-rendered with the restored draft — so the blur
  // handler would read the abandoned text and save it. A ref, not state: it is
  // read in the same tick it is written.
  const escaped = useRef(false);

  // The server is the authority on the name: after a rename lands, or a refetch
  // brings someone else's, the title follows — unless the customer is typing in
  // it, in which case their text is the thing that matters.
  useEffect(() => {
    if (document.activeElement !== input.current) setDraft(name);
  }, [name]);

  async function commit() {
    if (escaped.current) {
      escaped.current = false;
      setDraft(name);
      return;
    }
    const next = draft.trim();
    if (!next || next === name) {
      setDraft(name);
      return;
    }
    setError(null);
    try {
      await rename.mutateAsync({ sourceId, name: next });
      // The name is on this page, on the project's websites table and on the
      // sidebar's website line — two queries hold all three.
      await Promise.all([utils.sources.get.invalidate(), utils.projects.get.invalidate()]);
    } catch {
      // No cause is named: from the browser a failure could be the network, the
      // api-server, the database or a bug.
      setError('That name could not be saved.');
      setDraft(name);
    }
  }

  return (
    // The sizer and the input share one grid cell, so the input is exactly as
    // wide as its text. `whitespace-pre` keeps a trailing space measured, and
    // the sizer carries the input's own padding and type so the two agree.
    // Everything here is phrasing content: it lives inside the page's `h1`.
    // `-ml-2` cancels the input's own padding, so at rest the name starts on
    // the page's left edge like every other title.
    <span className="-ml-2 inline-grid max-w-full align-bottom">
      <span
        aria-hidden
        className="invisible col-start-1 row-start-1 border border-transparent px-2 whitespace-pre"
      >
        {draft || name || ' '}
      </span>
      {/* No 16 px floor needed here, unlike the Fields table: the page title is
          20 px, well over the size below which iOS Safari zooms on focus. */}
      <input
        ref={input}
        size={1}
        value={draft}
        aria-label="Website name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            escaped.current = true;
            e.currentTarget.blur();
          }
        }}
        className="col-start-1 row-start-1 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-2xl font-semibold tracking-[-0.011em] text-text outline-none hover:border-line-hover focus:border-text focus:bg-bg"
      />
      {error ? (
        // A `span`, not a `p`: the `h1` above permits phrasing content only.
        <span role="alert" className="col-start-1 row-start-2 px-2 text-sm text-fail">
          {error}
        </span>
      ) : null}
    </span>
  );
}
