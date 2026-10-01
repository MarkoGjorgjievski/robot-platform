import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Skeleton } from '../ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { DeleteFieldDialog } from './delete-field-dialog';
import { FIELD_TYPES, LEVEL_LABELS, TYPE_LABELS, nameRefusal, sharedNote, type FieldLevel, type FieldType, type FieldView } from '../../lib/fields-view';
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

/** A field's level as `datasets.variants` reports it: `isDefault` while it is still the one its concept implies. */
export type FieldLevels = Record<string, { level: FieldLevel; isDefault: boolean }>;

export function FieldsTable({
  datasetId,
  fields,
  websiteCount,
  loading,
  levels,
}: {
  datasetId: string;
  fields: FieldView[];
  websiteCount: number;
  loading: boolean;
  /** Present only while the project wants variants: then every row also says whether the field differs per variant. */
  levels?: FieldLevels;
}) {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FieldView | null>(null);

  /**
   * A field belongs to the project, not to a website, so every change here has
   * to reach `projects.get` (the contract this screen reads, the project home's
   * field count and the sidebar), `fieldStatus` (the Verified on column) and
   * `projects.output`, whose header is the contract's field names.
   */
  async function refresh() {
    await Promise.all([
      utils.projects.get.invalidate(),
      utils.datasets.fieldStatus.invalidate({ datasetId }),
      utils.projects.output.invalidate(),
      utils.datasets.variants.invalidate({ datasetId }),
    ]);
  }

  const columns = levels ? 5 : 4;

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
          <table className={`w-full border-collapse text-base md:min-w-0 ${levels ? 'min-w-[760px]' : 'min-w-[560px]'}`}>
            <colgroup>
              <col />
              <col className="w-[150px]" />
              {levels ? <col className="w-[214px]" /> : null}
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
                {levels ? <th className="px-3 text-left text-sm">Variants</th> : null}
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
                  <td colSpan={columns} className="px-4 py-1.5 text-sm text-muted-foreground">
                    {note}
                  </td>
                </tr>
              ) : null}

              {loading ? <LoadingRows columns={columns} /> : null}

              {!loading &&
                fields.map((field) => (
                  <FieldRow
                    key={field.key}
                    datasetId={datasetId}
                    field={field}
                    // `null` when there is no Variants column; `undefined` for a field
                    // added a moment ago whose level has not been read back yet.
                    level={levels ? levels[field.key] : null}
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
  level,
  onDelete,
  onError,
  onSettled,
}: {
  datasetId: string;
  field: FieldView;
  level: { level: FieldLevel; isDefault: boolean } | undefined | null;
  onDelete: () => void;
  onError: (message: string | null) => void;
  onSettled: () => Promise<void>;
}) {
  const rename = trpc.datasets.renameField.useMutation();
  const retype = trpc.datasets.retypeField.useMutation();
  const setLevel = trpc.datasets.setFieldLevel.useMutation();

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

  async function commitLevel(next: FieldLevel) {
    onError(null);
    try {
      await setLevel.mutateAsync({ datasetId, key: field.key, level: next });
      await onSettled();
    } catch {
      onError(GENERIC);
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
                off a wrapper that can be reached by pointer and by keyboard.

                `block`, not `inline-block`: a shrink-to-fit box cannot measure a
                `w-fit` flex child whose own max-width is a percentage —
                Chromium sized this wrapper 13 px narrower than the trigger
                wanted and the trigger's `max-w-full` then clamped the value to
                it, so every locked row read "Mon", "Te", "Numb". Filling the
                cell instead leaves the trigger free to hug its value, which is
                what it does on an unlocked row.

                The ring then has to move with it: app.css draws the app's one
                focus idiom on anything focusable, which here is this box, and a
                ring spanning the whole column when the control inside is 71 px
                wide would read as the cell being focused rather than the type.
                So the box waives it and hands the same outline to the trigger —
                written out rather than as `outline-1`, because the trigger's own
                `outline-none` has already set the outline *style* to none and a
                width alone draws nothing. */}
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="block outline-none focus-visible:[&>[data-slot=select-trigger]]:[outline:1px_solid_var(--text)] focus-visible:[&>[data-slot=select-trigger]]:[outline-offset:2px]"
              >
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

      {level === null ? null : level === undefined ? (
        <td className="px-3 py-2" />
      ) : (
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Select value={level.level} onValueChange={(v) => void commitLevel(v as FieldLevel)} disabled={setLevel.isPending}>
              <SelectTrigger
                size="sm"
                aria-label={`Variants of ${field.name}`}
                // The type select's manners: a hairline on row hover, hugging its value.
                className="-mx-2 h-7 max-w-full gap-1 border-transparent px-2 hover:border-line-hover group-hover/row:border-line"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['product', 'variant'] as const).map((l) => (
                  <SelectItem key={l} value={l}>
                    {LEVEL_LABELS[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Until the customer picks, the level is the one the field's kind
                implies (a price differs per variant, a title does not). */}
            {level.isDefault ? <span className="text-xs text-muted-foreground">default</span> : null}
          </div>
        </td>
      )}

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
function LoadingRows({ columns }: { columns: number }) {
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
          <td colSpan={columns - 2} />
        </tr>
      ))}
    </>
  );
}
