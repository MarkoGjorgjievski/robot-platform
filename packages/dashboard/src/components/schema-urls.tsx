import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { URL_COUNT, type GridState } from '../lib/schema-grid';

type Props = {
  state: GridState;
  onChange: (next: GridState) => void;
  disabled?: boolean;
  /**
   * Runs the listing-page crawl behind "Find product pages" and resolves to
   * the candidate URLs. Optional: without it the button (and the candidate
   * chooser it fills) is not rendered at all, which is what a screen that
   * cannot afford a live fetch should pass.
   */
  onFindProductPages?: (listingUrl: string) => Promise<string[]>;
};

/**
 * The verification URL block — three product URLs, the optional listing URL,
 * and the "Find product pages" chooser that fills them.
 *
 * Shared by BOTH schema screens (C2). It used to live only in the New Source
 * wizard, which meant the Schema tab could edit every field of the schema
 * except the three URLs those fields are verified against — and a Source
 * created any other way (`quickCreate`, or anything predating this feature)
 * had no screen at all that could give it URLs. Same component, same state
 * shape, so an edit here is an ordinary grid edit on either screen: it marks
 * the grid dirty, Verify saves it through `updateSchema`, and the changed
 * `definitionHash` invalidates the old certification by itself.
 */
export function SchemaUrls({ state, onChange, disabled, onFindProductPages }: Props) {
  const [candidates, setCandidates] = useState<string[]>([]);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);

  const setUrl = (i: number, value: string) =>
    onChange({ ...state, urls: state.urls.map((u, j) => (j === i ? value : u)) });

  async function handleFind() {
    if (!onFindProductPages) return;
    setFindError(null);
    setCandidates([]);
    setFinding(true);
    try {
      setCandidates(await onFindProductPages(state.listingUrl.trim()));
    } catch (err) {
      setFindError(err instanceof Error ? err.message : String(err));
    } finally {
      setFinding(false);
    }
  }

  return (
    <div className="card space-y-3 p-4">
      <div>
        <label className="micro-label">Listing URL (optional)</label>
        <div className="mt-1.5 flex gap-2">
          <input
            value={state.listingUrl}
            disabled={disabled}
            onChange={(e) => onChange({ ...state, listingUrl: e.target.value })}
            placeholder="https://shop.example/category/sofas"
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
          />
          {onFindProductPages && (
            <button
              type="button"
              className="btn-quiet h-9 flex-shrink-0"
              disabled={disabled || finding || !state.listingUrl.trim()}
              onClick={handleFind}
            >
              {finding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Find product pages
            </button>
          )}
        </div>
      </div>

      {findError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{findError}</div>
      )}

      {candidates.length > 0 && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <p className="micro-label">Candidate product pages</p>
          <ul className="mt-1.5 space-y-1.5">
            {candidates.map((u) => (
              <li key={u} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-mono text-gray-600" title={u}>{u}</span>
                {Array.from({ length: URL_COUNT }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    className="btn-quiet flex-shrink-0 px-2 py-0.5 text-[10px]"
                    disabled={disabled}
                    onClick={() => setUrl(i, u)}
                  >
                    Use as URL {i + 1}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.urls.map((u, i) => (
        <div key={i}>
          <label className="micro-label">Product URL {i + 1}</label>
          <input
            value={u}
            disabled={disabled}
            onChange={(e) => setUrl(i, e.target.value)}
            placeholder="https://shop.example/p/kivik-sofa-30575629"
            className="mt-1.5 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
          />
        </div>
      ))}
    </div>
  );
}
