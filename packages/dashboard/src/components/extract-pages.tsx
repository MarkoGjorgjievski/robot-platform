// packages/dashboard/src/components/extract-pages.tsx
// Step 1 of the Extract tab: where the products come from.
//
// Two shapes, one section. Either the customer gives listing pages we walk
// (and each one gets checked, in place, for product links and a pager), or
// they give the product URLs directly and there is nothing to walk. The
// segmented control is the only thing that switches between them; everything
// below it is the chosen shape's own editor plus the one Save button.
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { listingCheckLabel, productUrlCounts, type ExtractMode } from '../lib/extract-view';
import { parseUrlLines } from '../lib/parse-url-lines';
import { fieldClass } from './dialog';

export type ListingCheck = { productLinks: number; pagerSeen: boolean } | { error: string } | null;

const CHECK_TONE: Record<'ok' | 'warn' | 'error' | 'pending', string> = {
  ok: 'text-emerald-700',
  warn: 'text-amber-700',
  error: 'text-red-600',
  pending: 'text-gray-500',
};

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

  const productLines = productText.split('\n');
  const counts = productUrlCounts(productLines, proofUrls, host);

  const emptyList = mode === 'detail' ? counts.total === 0 : listing.length === 0;
  const saveLabel = mode === 'detail' ? 'Save URLs' : 'Save pages';
  const saveReason = mode === 'detail' ? 'Add at least one URL' : 'Add at least one listing page';

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Where the products come from"
        className="inline-flex overflow-hidden rounded-md border border-gray-300"
      >
        {(
          [
            ['listing', 'Listing pages'],
            ['detail', 'Product URLs'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            disabled={readOnly}
            onClick={() => onMode(value)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
              mode === value ? 'bg-accent-50 text-accent-700' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === null && <p className="text-xs text-gray-500">Pick one to carry on.</p>}

      {mode === 'listing' && (
        <>
          {listing.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="w-[55%] px-2 py-1 text-xs font-medium text-gray-500">Listing page</th>
                  <th className="px-2 py-1 text-xs font-medium text-gray-500">Check</th>
                  <th className="w-20 px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {listing.map((url) => {
                  const label = listingCheckLabel(checks[url] ?? null);
                  return (
                    <tr key={url} className="border-b border-gray-100 last:border-b-0">
                      <td className="max-w-0 px-2 py-1.5">
                        <span className="block truncate font-mono text-xs text-gray-800" title={url}>
                          {url}
                        </span>
                      </td>
                      <td className={`px-2 py-1.5 text-xs ${CHECK_TONE[label.tone]}`}>{label.text}</td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          aria-label="Remove listing page"
                          disabled={readOnly}
                          onClick={() => onListing(listing.filter((u) => u !== url))}
                          className="rounded px-1 text-xs text-gray-500 transition-colors hover:text-gray-800 disabled:opacity-50"
                        >
                          remove
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
                // The amber note names lines that are no longer on screen the
                // moment the box is edited, so it must not outlive the edit.
                setRejected([]);
              }}
              disabled={readOnly}
              rows={2}
              placeholder="paste one or more listing URLs"
              className={`${fieldClass} font-mono text-xs`}
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
                <span className="text-xs text-amber-800">
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
            className={`${fieldClass} font-mono text-xs`}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className={`btn-quiet ${readOnly ? 'opacity-50' : 'cursor-pointer'}`}>
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
            <span className="text-xs text-gray-500">
              {[
                `${counts.total} ${counts.total === 1 ? 'URL' : 'URLs'}`,
                counts.proof > 0 ? `${counts.proof} are the proof pages` : null,
                counts.offHost > 0 ? `${counts.offHost} off this website, skipped` : null,
              ]
                .filter((part): part is string => part !== null)
                .join(' · ')}
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
          {emptyList && <span className="text-xs text-gray-500">{saveReason}</span>}
        </div>
      )}
    </div>
  );
}
