import { useMemo, useState, type ChangeEvent } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { listingCheckLabel, productUrlCounts, type ExtractMode } from '../../lib/site/extract-view';
import { productCountsSentence } from '../../lib/site/extract-screen-view';
import { parseUrlLines } from '../../lib/site/parse-url-lines';

/**
 * Step 1: where the products come from.
 *
 * Two shapes, one section. Either the customer gives listing pages we walk (and
 * each one is checked, in place, for product links and a pager), or they give
 * the product URLs directly and there is nothing to walk. The segmented control
 * is the only thing that switches between them; everything below it is the
 * chosen shape's own editor plus the one Save button.
 */

/**
 * A listing page's check, as the tab holds it. `{ saved: true }` is a page that
 * came back from the database and has never been checked in this session — the
 * state that keeps opening the tab from launching a browser per saved page.
 * `null` (or a missing key) means a check is in flight.
 */
export type ListingCheck =
  | { productLinks: number; pagerSeen: boolean }
  | { error: string }
  | { saved: true }
  | null;

/** State as a dot, never a wash (spec §4). The words beside it carry the meaning, so the dot is decoration. */
const CHECK_DOT: Record<'ok' | 'warn' | 'error' | 'pending', string> = {
  ok: 'bg-pass',
  warn: 'bg-warn',
  error: 'bg-fail',
  pending: 'bg-faint',
};

/** The segmented control's options, in tab order. */
const MODE_OPTIONS = [
  ['listing', 'Listing pages'],
  ['detail', 'Product URLs'],
] as const satisfies ReadonlyArray<readonly [ExtractMode, string]>;

const ROVING_KEYS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];

export function ExtractPages({
  mode,
  onMode,
  listing,
  onListing,
  checks,
  onCheck,
  productText,
  onProductText,
  proofUrls,
  host,
  onImportCsv,
  onSave,
  saving,
  readOnly,
}: {
  mode: ExtractMode | null;
  onMode: (m: ExtractMode) => void;
  listing: string[];
  onListing: (urls: string[]) => void;
  checks: Record<string, ListingCheck>;
  onCheck: (url: string) => void;
  productText: string;
  onProductText: (t: string) => void;
  proofUrls: string[];
  host: string | null;
  onImportCsv: (file: File) => void;
  onSave: () => void;
  saving: boolean;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [rejected, setRejected] = useState<string[]>([]);

  function addListingUrls() {
    const { urls, invalid } = parseUrlLines(draft);
    setRejected(invalid);
    const next = [...listing];
    const added: string[] = [];
    for (const url of urls) {
      if (next.includes(url)) continue;
      next.push(url);
      added.push(url);
    }
    if (added.length > 0) {
      onListing(next);
      // Each new page is checked on its own — the tab owns the request, so a
      // URL that was already on the list is never re-checked.
      for (const url of added) onCheck(url);
    }
    // Whatever could not be parsed stays in the box, so it can be fixed in
    // place instead of hunting for which line was dropped.
    setDraft(invalid.join('\n'));
  }

  // Memoised: this walks every pasted line with a `new URL()`, and at the
  // 5,000-URL ceiling an unmemoised call is 5,000 constructions on every render
  // — of which a keystroke in the box causes one.
  const productLines = useMemo(() => productText.split('\n'), [productText]);
  const counts = useMemo(
    () => productUrlCounts(productLines, proofUrls, host),
    [productLines, proofUrls, host],
  );

  const empty = mode === 'detail' ? counts.total === 0 : listing.length === 0;
  const saveLabel = mode === 'detail' ? 'Save URLs' : 'Save pages';
  const saveReason = mode === 'detail' ? 'Add at least one URL' : 'Add at least one listing page';

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Let the same file be picked again after a failed import.
    e.target.value = '';
    if (file) onImportCsv(file);
  }

  return (
    <div className="space-y-3">
      {/* A radiogroup is one tab stop: the arrow keys move between the options
          and Tab leaves the group. With no mode chosen yet neither option is
          checked, so the first one carries the tab stop — otherwise the group
          would be unreachable by keyboard. */}
      <div
        role="radiogroup"
        aria-label="Where the products come from"
        className="inline-flex gap-0.5 rounded-md border border-line p-0.5"
      >
        {MODE_OPTIONS.map(([value, label], i) => (
          <Button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            tabIndex={mode === value || (mode === null && i === 0) ? 0 : -1}
            variant="outline"
            size="sm"
            disabled={readOnly}
            onClick={() => onMode(value)}
            onKeyDown={(e) => {
              if (!ROVING_KEYS.includes(e.key)) return;
              e.preventDefault();
              const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
              const nextIndex = (i + step + MODE_OPTIONS.length) % MODE_OPTIONS.length;
              onMode(MODE_OPTIONS[nextIndex]![0]);
              e.currentTarget.parentElement?.querySelectorAll('button')[nextIndex]?.focus();
            }}
            // The selected option is the raised one; the other is a hairline-free
            // label so the pair reads as one control rather than two buttons.
            className={mode === value ? 'border-line-hover bg-raised' : 'border-transparent text-muted-foreground'}
          >
            {label}
          </Button>
        ))}
      </div>

      {mode === null ? <p className="text-base text-muted-foreground">Pick one to carry on.</p> : null}

      {mode === 'listing' ? (
        <>
          {listing.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-base">
                {/* The address takes half and truncates; the check result sits
                    beside it rather than across a hand's width of empty table,
                    and the two buttons hug the right edge. */}
                <colgroup>
                  <col className="w-[50%]" />
                  <col />
                  <col className="w-[148px]" />
                </colgroup>
                <thead>
                  <tr className="[&>th]:border-b [&>th]:border-line [&>th]:py-2 [&>th]:text-left [&>th]:text-sm [&>th]:font-normal [&>th]:whitespace-nowrap [&>th]:text-muted-foreground">
                    <th className="pr-3">Listing page</th>
                    <th className="px-3">Check</th>
                    <th className="pl-3" />
                  </tr>
                </thead>
                <tbody>
                  {listing.map((url) => {
                    const check = checks[url] ?? null;
                    const label = listingCheckLabel(check);
                    // A page is checked when someone asks. Never on load: the
                    // check is a real page load on the api-server, and opening
                    // the tab must not spend one per saved page. Anything but
                    // "checking…" (`null`) can be asked again.
                    const askable = check !== null;
                    return (
                      <tr key={url} className="border-b border-line last:border-0">
                        <td className="max-w-0 py-2 pr-3">
                          <span className="block truncate font-mono text-muted-foreground" title={url}>
                            {url}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              aria-hidden
                              className={`inline-block size-[8px] shrink-0 rounded-full ${CHECK_DOT[label.tone]}`}
                            />
                            <span className="min-w-0 truncate" title={label.text}>
                              {label.text}
                            </span>
                          </span>
                        </td>
                        <td className="py-2 pl-3 text-right whitespace-nowrap">
                          {/* Check stays live even while the section is locked:
                              it writes nothing, costs one page load and no AI,
                              and re-checking a page saved an hour ago is exactly
                              when it is wanted. Remove is an edit, so it goes
                              behind "Edit pages" with the rest of them. */}
                          {askable ? (
                            <Button variant="outline" size="xs" onClick={() => onCheck(url)}>
                              Check
                            </Button>
                          ) : null}
                          {readOnly ? null : (
                            <Button
                              variant="ghost"
                              size="xs"
                              className="ml-1 text-muted-foreground hover:text-text"
                              aria-label={`Remove ${url}`}
                              onClick={() => onListing(listing.filter((u) => u !== url))}
                            >
                              Remove
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* The box for new pages is an input, not a record: while the section
              is locked it holds nothing worth keeping on screen, and the
              header's "Edit pages" is the one control that matters. The table
              above — which IS the record — stays either way. */}
          {readOnly ? null : (
            <div>
              <Textarea
                aria-label="Listing pages to add"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  // The note names lines that are no longer on screen the moment
                  // the box is edited, so it must not outlive the edit.
                  setRejected([]);
                }}
                rows={2}
                placeholder="paste one or more listing URLs"
                className="min-h-0 font-mono"
              />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" disabled={draft.trim() === ''} onClick={addListingUrls}>
                  Add
                </Button>
                {draft.trim() === '' ? (
                  <span className="text-base text-muted-foreground">Paste a listing URL to add it</span>
                ) : null}
                {rejected.length > 0 ? (
                  <span className="text-base text-warn">
                    {rejected.length === 1
                      ? 'One line is not a URL, so it was left in the box.'
                      : `${rejected.length} lines are not URLs, so they were left in the box.`}
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </>
      ) : null}

      {mode === 'detail' ? (
        <div>
          {/* Saved, the URLs are a record rather than something being typed: a
              disabled eight-row box would be a screenful of dead grey around
              two lines. The list says the same thing in the space it needs, and
              scrolls at 5,000 of them. */}
          {readOnly ? (
            <ul className="max-h-[220px] overflow-y-auto rounded-md border border-line">
              {parseUrlLines(productText).urls.map((url) => (
                <li key={url} className="truncate border-b border-line px-3 py-1.5 font-mono text-muted-foreground last:border-0" title={url}>
                  {url}
                </li>
              ))}
            </ul>
          ) : (
            <Textarea
              aria-label="Product URLs"
              value={productText}
              onChange={(e) => onProductText(e.target.value)}
              rows={8}
              placeholder="paste one or more product URLs"
              className="min-h-0 font-mono"
            />
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {/* A label wearing the button's clothes: a file picker is the one
                control the browser will only open from a label. */}
            {readOnly ? null : (
              <Button variant="outline" size="sm" asChild>
                <label className="cursor-pointer">
                  <Upload />
                  Import CSV
                  <input type="file" accept=".csv" className="sr-only" onChange={handleFile} />
                </label>
              </Button>
            )}
            <span className="text-base text-muted-foreground">{productCountsSentence(counts)}</span>
          </div>
        </div>
      ) : null}

      {mode !== null && !readOnly ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" disabled={saving || empty} onClick={onSave}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            {saveLabel}
          </Button>
          {/* Every disabled control says why, within a line of it. */}
          {empty ? <span className="text-base text-muted-foreground">{saveReason}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
