import { useEffect, useRef, useState } from 'react';
import { trpc } from '../../lib/trpc';
import { projectNameProblem } from '../../lib/project-settings-view';

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
/**
 * `'title'` is the page header's long-standing look (20 px, well over the size
 * below which iOS Safari zooms on focus — no floor needed). `'row'` is the
 * Settings tab's Name row: the same 13 px/12 px body this system's other rows
 * read at, with the Fields table's own `text-[16px] … md:text-base` floor
 * below `md` for the same iOS-zoom reason — a definition-list row is exactly
 * as narrow on a phone as a table cell is.
 */
const SIZE: Record<'title' | 'row', string> = {
  title: 'text-2xl font-semibold tracking-[-0.011em]',
  row: 'text-[16px] font-medium md:text-base',
};

export function InlineRename({
  sourceId,
  name,
  // The Settings tab's Name row embeds this same editor beside the page
  // title's own copy of it (spec: "the same InlineRename"), so the two need
  // distinct accessible names — otherwise a screen reader, or a test, cannot
  // tell them apart. The title keeps its long-standing label by default.
  ariaLabel = 'Website name',
  size = 'title',
}: {
  sourceId: string;
  name: string;
  ariaLabel?: string;
  size?: 'title' | 'row';
}) {
  const utils = trpc.useUtils();
  const rename = trpc.sources.rename.useMutation();
  return (
    <RenameField
      name={name}
      ariaLabel={ariaLabel}
      size={size}
      onCommit={async (next) => {
        await rename.mutateAsync({ sourceId, name: next });
        // The name is on this page, on the project's websites table and on the
        // sidebar's website line — two queries hold all three.
        await Promise.all([utils.sources.get.invalidate(), utils.projects.get.invalidate()]);
      }}
    />
  );
}

/**
 * The project's name, edited the same way (cut-over Task 1): the project
 * Settings page's Name row embeds this beside `InlineRename`'s own kind,
 * owning `projects.rename` the way `InlineRename` owns `sources.rename`. The
 * project's rename is a page of its own rather than a title-row edit, so
 * nothing calls this at `size="title"` yet — but the same component is ready
 * for that the day a project page grows one. `projects.rename` works in the
 * session's org, so no org is passed.
 */
export function ProjectInlineRename({
  projectId,
  name,
  ariaLabel = 'Project name',
  size = 'title',
}: {
  projectId: string;
  name: string;
  ariaLabel?: string;
  size?: 'title' | 'row';
}) {
  const utils = trpc.useUtils();
  const rename = trpc.projects.rename.useMutation();
  return (
    <RenameField
      name={name}
      ariaLabel={ariaLabel}
      size={size}
      problem={projectNameProblem}
      onCommit={async (next) => {
        await rename.mutateAsync({ projectId, name: next });
        await Promise.all([utils.projects.get.invalidate(), utils.projects.list.invalidate()]);
      }}
    />
  );
}

/**
 * The shared editor both `InlineRename` and `ProjectInlineRename` render: a
 * borderless input inheriting its caller's type, committing on blur. Each
 * caller owns its own mutation and invalidation — this owns only the draft,
 * the Escape-to-revert handling, and the one failure message every rename
 * shares.
 *
 * `problem`, when given, is checked before `onCommit` and shown instead of
 * saving — the project rename's "Enter a name" rather than the website's
 * long-standing silent revert on an empty or unchanged edit.
 */
function RenameField({
  name,
  ariaLabel,
  size,
  onCommit,
  problem,
}: {
  name: string;
  ariaLabel: string;
  size: 'title' | 'row';
  onCommit: (next: string) => Promise<void>;
  problem?: (next: string) => string | null;
}) {
  const sizeClass = SIZE[size];

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
    // Cleared first, not just before the call: leaving the field at all — with
    // Escape, or having put the old name back — is the customer answering the
    // message, and a refusal of text that is no longer there is a lie.
    setError(null);
    if (escaped.current) {
      escaped.current = false;
      setDraft(name);
      return;
    }
    const next = draft.trim();
    if (problem) {
      const reason = problem(next);
      if (reason) {
        setError(reason);
        return;
      }
    } else if (!next) {
      setDraft(name);
      return;
    }
    if (next === name) {
      setDraft(name);
      return;
    }
    try {
      await onCommit(next);
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
    //
    // `min-w-0` here and `overflow-hidden` on the sizer are what keep a long
    // name from widening the page on a phone: a grid track's automatic minimum
    // is its items' min-content, which for the sizer would be the longest word
    // in the name. With overflow hidden that minimum is zero, so the track
    // stops at the room the title row actually has and the input ellipsises.
    //
    // `max-w-[calc(100%+0.5rem)]`, not `max-w-full`: the `-ml-2` above pulls
    // this box half a rem left so the name starts on the page's left edge,
    // which means the room it actually has is the `h1`'s width PLUS that half
    // rem — 6.5 px against this app's 13 px root, not the 8 px a 16 px root
    // would give. Capped at `100%` it was that much short of its own content,
    // the grid column was clamped to the smaller figure, and `text-ellipsis` ate whole
    // characters — "Example" rendered "Exam…" on a page with half a screen of
    // free space beside it. The cap still exists, so a long name truncates and
    // nothing widens the page.
    <span className="-ml-2 inline-grid max-w-[calc(100%+0.5rem)] min-w-0 align-bottom">
      <span
        aria-hidden
        className={`invisible col-start-1 row-start-1 min-w-0 overflow-hidden border border-transparent px-2 whitespace-pre ${sizeClass}`}
      >
        {draft || name || ' '}
      </span>
      {/* `'title'` needs no 16 px floor: the page title is 20 px, well over the
          size below which iOS Safari zooms on focus. `'row'` carries its own
          floor in `SIZE.row` instead, the same one the Fields table uses. */}
      <input
        ref={input}
        size={1}
        value={draft}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            escaped.current = true;
            e.currentTarget.blur();
          }
        }}
        // `text-ellipsis`: an input that is narrower than its value shows the
        // ellipsis at rest and the caret's end of the text once it is focused,
        // which is exactly the behaviour a truncated title wants.
        className={`col-start-1 row-start-1 w-full min-w-0 overflow-hidden rounded-md border border-transparent bg-transparent px-2 text-ellipsis text-text outline-none hover:border-line-hover focus:border-text focus:bg-bg ${sizeClass}`}
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
