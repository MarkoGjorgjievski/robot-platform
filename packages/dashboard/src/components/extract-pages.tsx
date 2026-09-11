// packages/dashboard/src/components/extract-pages.tsx
// Step 1 of the Extract tab: where the products come from.
//
// Two shapes, one section. Either the customer gives listing pages we walk
// (and each one gets checked, in place, for product links and a pager), or
// they give the product URLs directly and there is nothing to walk. The
// segmented control is the only thing that switches between them; everything
// below it is the chosen shape's own editor plus the one Save button.
import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { listingCheckLabel, productUrlCounts, type ExtractMode } from '../lib/extract-view';
import { parseUrlLines } from '../lib/parse-url-lines';

/**
 * A listing page's check, as the parent holds it. `{ saved: true }` is a page
 * that came back from the database and has never been checked in this session
 * — the state that keeps opening the tab from launching a browser per saved
 * page. `null` (or a missing key) means a check is in flight.
 */
export type ListingCheck =
  | { productLinks: number; pagerSeen: boolean }
  | { error: string }
  | { saved: true }
  | null;

/** The check label's tone, on the status tokens (spec 7). */
const CHECK_TONE: Record<'ok' | 'warn' | 'error' | 'pending', string> = {
  ok: 'text-pass',
  warn: 'text-warn',
  error: 'text-fail',
  pending: 'text-gray-600',
};

/**
 * A URL box. Every URL is a value, so it is set in mono at table size; the
 * focus ring comes from the base layer rather than a per-field border colour.
 */
const URL_FIELD =
  'mt-1 w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-1.5 font-mono text-[13px] text-gray-900';

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
      // Each new page is checked on its own — the parent owns the request, so
      // a URL that was already on the list is never re-checked.
      for (const url of added) onCheck(url);
    }
    // Whatever could not be parsed stays in the box, so the operator can fix
    // it in place instead of hunting for which line was dropped.
    setDraft(invalid.join('\n'));
  }

  // Memoised: this walks every pasted line with a `new URL()`, and at the
  // 5,000-URL ceiling an unmemoised call is 5,000 constructions on every
  // render — of which a keystroke in the textarea causes one, and the route
  // pays for a second set of its own.
  const productLines = useMemo(() => productText.split('\n'), [productText]);
  const counts = useMemo(
    () => productUrlCounts(productLines, proofUrls, host),
    [productLines, proofUrls, host],
  );

  const emptyList = mode === 'detail' ? counts.total === 0 : listing.length === 0;
  const saveLabel = mode === 'detail' ? 'Save URLs' : 'Save pages';
  const saveReason = mode === 'detail' ? 'Add at least one URL' : 'Add at least one listing page';

  return (
    <div className="space-y-3">
      {/* A radiogroup is one tab stop: the arrow keys move between the
          options and Tab leaves the group. Before this, both buttons were
          tabbable, which is the tablist/toolbar model, not the radio one. With
          no mode chosen yet neither option is checked, so the first one carries
          the tab stop — otherwise the group would be unreachable by keyboard. */}
      <div
        role="radiogroup"
        aria-label="Where the products come from"
        className="inline-flex overflow-hidden rounded-md border border-gray-300"
      >
        {MODE_OPTIONS.map(([value, label], i) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            tabIndex={mode === value || (mode === null && i === 0) ? 0 : -1}
            disabled={readOnly}
            onClick={() => onMode(value)}
            onKeyDown={(e) => {
              if (!ROVING_KEYS.includes(e.key)) return;
              e.preventDefault();
              const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
              const next = MODE_OPTIONS[(i + step + MODE_OPTIONS.length) % MODE_OPTIONS.length]![0];
              onMode(next);
              e.currentTarget.parentElement?.querySelectorAll('button')[MODE_OPTIONS.findIndex(([v]) => v === next)]?.focus();
            }}
            className={`px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-45 ${
              mode === value ? 'bg-accent-50 text-gray-900' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === null && <p className="text-xs text-gray-600">Pick one to carry on.</p>}

      {mode === 'listing' && (
        <>
          {listing.length > 0 && (
            <table className="sheet">
              <thead>
                <tr className="sheet-head sheet-row h-8 text-left">
                  <th className="w-[55%] px-2 font-semibold">Listing page</th>
                  <th className="px-2 font-semibold">Check</th>
                  <th className="w-20 px-2" />
                </tr>
              </thead>
              <tbody>
                {listing.map((url) => {
                  const check = checks[url] ?? null;
                  const label = listingCheckLabel(check);
                  // A page is checked when someone asks. Never on load: the
                  // check is a real page load on the api-server, and opening
                  // the tab must not spend one per saved page. Anything but
                  // "checking…" (`null`) can be asked again — a listing that
                  // checked cleanly an hour ago, before the pages were
                  // edited, is exactly when a re-check is wanted.
                  const askable = check !== null;
                  return (
                    <tr key={url} className="sheet-row h-8 last:border-b-0">
                      <td className="max-w-0 px-2">
                        <span className="block truncate font-mono text-[13px] text-gray-900" title={url}>
                          {url}
                        </span>
                      </td>
                      <td className={`px-2 text-xs ${CHECK_TONE[label.tone]}`}>
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 truncate" title={label.text}>{label.text}</span>
                          {askable && (
                            <button
                              type="button"
                              className="btn-quiet flex-shrink-0 py-0.5"
                              disabled={readOnly}
                              onClick={() => onCheck(url)}
                            >
                              Check
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="px-2 text-right">
                        <button
                          type="button"
                          aria-label="Remove listing page"
                          disabled={readOnly}
                          onClick={() => onListing(listing.filter((u) => u !== url))}
                          className="text-xs text-gray-600 transition-colors hover:text-gray-900 disabled:opacity-45"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div>
            <textarea
              aria-label="Listing pages to add"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                // The note names lines that are no longer on screen the moment
                // the box is edited, so it must not outlive the edit.
                setRejected([]);
              }}
              disabled={readOnly}
              rows={2}
              placeholder="paste one or more listing URLs"
              className={URL_FIELD}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-quiet"
                disabled={readOnly || draft.trim() === ''}
                onClick={addListingUrls}
              >
                Add
              </button>
              {rejected.length > 0 && (
                <span className="text-xs text-warn">
                  {rejected.length === 1
                    ? 'One line is not a URL, so it was left in the box.'
                    : `${rejected.length} lines are not URLs, so they were left in the box.`}
                </span>
              )}
            </div>
          </div>
        </>
      )}

      {mode === 'detail' && (
        <div>
          <textarea
            aria-label="Product URLs"
            value={productText}
            onChange={(e) => onProductText(e.target.value)}
            disabled={readOnly}
            rows={6}
            placeholder="paste one or more product URLs"
            className={URL_FIELD}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {/* The file input is `sr-only`, so the base layer's focus ring paints
                on a 1px clip nobody can see. `focus-within` moves the same ring
                onto the label, which is the control the customer sees. */}
            <label className={`btn-quiet focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-500 ${readOnly ? 'opacity-45' : 'cursor-pointer'}`}>
              Import CSV
              <input
                type="file"
                accept=".csv"
                className="sr-only"
                disabled={readOnly}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImportCsv(file);
                  // Let the same file be picked again after a failed import.
                  e.target.value = '';
                }}
              />
            </label>
            {/* Sentences, not a middle-dot chain (spec 6): this is not a strip
                and there can be three facts, so joining them with `·` put two
                separators on one line. */}
            <span className="text-xs text-gray-600">
              {[
                `${counts.total} ${counts.total === 1 ? 'URL' : 'URLs'}.`,
                counts.proof > 0
                  ? counts.proof === 1
                    ? '1 is a proof page.'
                    : `${counts.proof} are the proof pages.`
                  : null,
                counts.offHost > 0
                  ? counts.offHost === 1
                    ? '1 is off this website and will be skipped.'
                    : `${counts.offHost} are off this website and will be skipped.`
                  : null,
              ]
                .filter((part): part is string => part !== null)
                .join(' ')}
            </span>
          </div>
        </div>
      )}

      {mode !== null && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary h-8"
            disabled={readOnly || saving || emptyList}
            onClick={onSave}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saveLabel}
          </button>
          {emptyList && <span className="text-xs text-gray-600">{saveReason}</span>}
        </div>
      )}
    </div>
  );
}
