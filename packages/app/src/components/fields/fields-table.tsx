import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Skeleton } from '../ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { DeleteFieldDialog } from './delete-field-dialog';
import { FIELD_TYPES, TYPE_LABELS, nameRefusal, sharedNote, type FieldType, type FieldView } from '../../lib/fields-view';
import { trpc } from '../../lib/trpc';

/**
 * The contract editor: one row per field, edited in place.
 *
 * Nothing here is a form. A field's name and its type are single values a
 * customer corrects in passing, so the row *is* the editor — the name is an
 * input that looks like text until the pointer or the keyboard reaches it, and
 * the type is a select with the same manners. A Save button over a two-column
 * table would be furniture around two values.
 */

/** The one message every failed change falls back to (cause-neutral, as on /projects). */
const GENERIC = 'That change could not be saved.';

/**
 * What a failure says. `PRECONDITION_FAILED` is the API refusing to retype a
 * field a website has certified, and its message is already written for the
 * customer ("Alpha has verified this field; delete and re-add it to change its
 * type") — passing it through is better than any sentence invented here.
 * Everything else names no cause: from the browser a failure could be the
 * network, the api-server, the database or a bug.
 */
function failureMessage(error: unknown): string {
  const e = error as { data?: { code?: string }; message?: string };
  return e?.data?.code === 'PRECONDITION_FAILED' && e.message ? e.message : GENERIC;
}

export function FieldsTable({
  datasetId,
  fields,
  websiteCount,
  loading,
}: {
  datasetId: string;
  fields: FieldView[];
  websiteCount: number;
  loading: boolean;
}) {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FieldView | null>(null);

  /**
   * A field belongs to the project, not to a website, so every change here has
   * to reach `projects.get` (the contract this screen reads, the project home's
   * field count and the sidebar) and `fieldStatus` (the Verified on column).
   */
  async function refresh() {
    await Promise.all([utils.projects.get.invalidate(), utils.datasets.fieldStatus.invalidate({ datasetId })]);
  }

  const note = sharedNote(websiteCount);

  return (
    // Two rules, both for the phone, both about the 560 px floor below:
    // `min-w-0` because a grid item's default minimum is its content, so the
    // table would set the column's width instead of scrolling inside its own
    // container (spec §3); and `overflow-x-clip` because even then Chromium
    // still counts that floor into the document's scroll area through the grid
    // — a page that scrolls 126 px sideways onto nothing. `clip`, not `hidden`:
    // `hidden` would make this a scrollport and take the sticky head with it.
    <div className="rise min-w-0 overflow-x-clip">
      <div className="rounded-[6px] border border-line bg-panel [box-shadow:var(--shadow)]">
        {/* Below `md` the table keeps its real width and the container scrolls
            (spec §3), so a long field name never squeezes the type out. */}
        <div className="overflow-x-auto rounded-[6px] md:overflow-x-visible">
          <table className="w-full min-w-[560px] border-collapse text-base md:min-w-0">
            <colgroup>
              <col />
              <col className="w-[150px]" />
              <col className="w-[148px]" />
              <col className="w-[52px]" />
            </colgroup>
            <thead>
              {/* Sticky only from `md`, for the reason the websites table gives:
                  below it the head sits in a scroll container and would ride
                  down over the first row. */}
              <tr className="[&>th]:z-10 [&>th]:border-b [&>th]:border-line [&>th]:bg-panel [&>th]:py-2 [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground md:[&>th]:sticky md:[&>th]:top-12">
                <th className="px-4 text-left text-sm">Name</th>
                <th className="px-3 text-left text-sm">Type</th>
                <th className="px-3 text-left text-sm">Verified on</th>
                <th className="pr-3">
                  <span className="sr-only">Delete</span>
                </th>
              </tr>
            </thead>

            <tbody>
              {/* Said once, under the head, rather than in every row: the whole
                  table is the shared list, not one field in it. */}
              {note && !loading ? (
                <tr className="border-b border-line">
                  <td colSpan={4} className="px-4 py-1.5 text-sm text-muted-foreground">
                    {note}
                  </td>
                </tr>
              ) : null}

              {loading ? <LoadingRows /> : null}

              {!loading &&
                fields.map((field) => (
                  <FieldRow
                    key={field.key}
                    datasetId={datasetId}
                    field={field}
                    onDelete={() => setDeleting(field)}
                    onError={setError}
                    onSettled={refresh}
                  />
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-fail">
          {error}
        </p>
      ) : null}

      <DeleteFieldDialog
        datasetId={datasetId}
        field={deleting}
        websiteCount={websiteCount}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      />
    </div>
  );
}

function FieldRow({
  datasetId,
  field,
  onDelete,
  onError,
  onSettled,
}: {
  datasetId: string;
  field: FieldView;
  onDelete: () => void;
  onError: (message: string | null) => void;
  onSettled: () => Promise<void>;
}) {
  const rename = trpc.datasets.renameField.useMutation();
  const retype = trpc.datasets.retypeField.useMutation();

  const [draft, setDraft] = useState(field.name);
  const input = useRef<HTMLInputElement>(null);
  // Escape has to undo the edit *and* leave the field, and the blur it causes
  // arrives before React has re-rendered with the restored draft — so the blur
  // handler would read the abandoned text and save it. A ref, not state: it is
  // read in the same tick it is written.
  const escaped = useRef(false);

  // The server is the authority on the name: after a rename lands, or a refetch
  // brings someone else's, the input follows — unless the customer is typing in
  // it, in which case their text is the thing that matters.
  useEffect(() => {
    if (document.activeElement !== input.current) setDraft(field.name);
  }, [field.name]);

  async function commitName() {
    if (escaped.current) {
      escaped.current = false;
      setDraft(field.name);
      return;
    }
    const name = draft.trim();
    if (!name || name === field.name) {
      setDraft(field.name);
      return;
    }
    onError(null);
    try {
      await rename.mutateAsync({ datasetId, key: field.key, name });
      await onSettled();
    } catch (err) {
      // A name clash is the customer's to fix and is said as such, in the same
      // words the Add your own dialog uses; everything else names no cause.
      onError(nameRefusal(err, name) ?? GENERIC);
      setDraft(field.name);
    }
  }

  async function commitType(type: FieldType) {
    onError(null);
    try {
      await retype.mutateAsync({ datasetId, key: field.key, type });
      await onSettled();
    } catch (err) {
      onError(failureMessage(err));
    }
  }

  const typeSelect = (
    <Select value={field.type} onValueChange={(t) => void commitType(t as FieldType)} disabled={field.retypeLocked}>
      <SelectTrigger
        size="sm"
        aria-label={`Type of ${field.name}`}
        // The same manners as the name input: a hairline on row hover, the text
        // colour while open. Locked, it keeps its value at full strength and
        // only the chevron dims — the type is data the customer still has to
        // read, and `disabled:opacity-50` over a 13 px label would put it under
        // 4.5:1. The affordance is what goes away: it never lights up on hover.
        // Hugging its value rather than filling the column: a chevron parked at
        // the far edge of a 115 px box, a word's width away from the word it
        // belongs to, reads as two things instead of one control.
        className="-mx-2 h-7 max-w-full gap-1 border-transparent px-2 hover:border-line-hover disabled:cursor-default disabled:opacity-100 disabled:hover:border-transparent disabled:[&_svg]:opacity-25 group-hover/row:border-line"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FIELD_TYPES.map((t) => (
          <SelectItem key={t} value={t}>
            {TYPE_LABELS[t]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <tr className="group/row border-b border-line transition-colors last:border-0 hover:bg-raised">
      <td className="px-4 py-2">
        {/* An input, not a text node that swaps for one on click: a customer who
            clicks a name expects the caret where they clicked, and a swap loses
            it. Borderless and inheriting the row's type, so at rest the column
            reads as a list of names; the hairline on hover and the text-colour
            border on focus are the whole affordance. The negative margin keeps
            the text on the header's x at rest.

            `size={1}`: an input's intrinsic width is 20 characters, which as a
            table cell's minimum would set the Name column's width and leave
            `w-full` resolving against it. At 1 the cell is free to take the
            room the other three columns do not want, and the field fills it. */}
        <input
          ref={input}
          size={1}
          value={draft}
          aria-label={`Name of ${field.name}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commitName()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              escaped.current = true;
              e.currentTarget.blur();
            }
          }}
          // `text-[16px]` below `md`, as `ui/input.tsx` pins it and for the same
          // reason: anything under 16 px makes iOS Safari zoom the page on
          // focus, and this field lives inside the below-`md` scroll container,
          // where a zoom would leave the customer mid-table sideways.
          className="-mx-2 h-7 w-full rounded-md border border-transparent bg-transparent px-2 text-[16px] font-medium text-text outline-none hover:border-line-hover focus:border-text focus:bg-bg group-hover/row:border-line md:text-base"
        />
      </td>

      <td className="px-3 py-2">
        {field.retypeLocked ? (
          <Tooltip>
            {/* A disabled button fires no pointer events, so the tooltip hangs
                off a wrapper that can be reached by pointer and by keyboard. */}
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-block rounded-md outline-none focus-visible:outline-1 focus-visible:outline-text">
                {typeSelect}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Verified on {field.verifiedOn.join(', ')}. Delete and re-add it to change its type.
            </TooltipContent>
          </Tooltip>
        ) : (
          typeSelect
        )}
      </td>

      <td className="px-3 py-2 whitespace-nowrap">
        {field.verifiedOn.length > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* The dotted rule is the only "there is more here" mark in this
                  system; it is `--muted`, which is a divider colour. */}
              <span className="cursor-default underline decoration-faint decoration-dotted underline-offset-4">
                {field.verifiedLabel}
              </span>
            </TooltipTrigger>
            <TooltipContent>{field.verifiedOn.join(', ')}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-muted-foreground">{field.verifiedLabel}</span>
        )}
      </td>

      <td className="py-2 pr-3 text-right">
        {/* Quiet but always there: hiding it until hover would put deleting a
            field out of reach on a touch screen. */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${field.name}`}
          onClick={onDelete}
          className="text-muted-foreground hover:text-fail"
        >
          <Trash2 />
        </Button>
      </td>
    </tr>
  );
}

/** Three rows the shape of real ones, so nothing jumps when the contract lands. */
function LoadingRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i} className="border-b border-line last:border-0">
          <td className="px-4 py-2">
            <Skeleton className="h-[22px] w-40 bg-raised" />
          </td>
          <td className="px-3 py-2">
            <Skeleton className="h-[22px] w-20 bg-raised" />
          </td>
          <td colSpan={2} />
        </tr>
      ))}
    </>
  );
}
