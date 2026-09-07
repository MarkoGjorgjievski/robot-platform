import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, Search } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { emptyState, gridProblems, isComplete, toSchemaInput, URL_COUNT, type GridState } from '../lib/schema-grid';
import { SchemaGrid } from '../components/schema-grid';
import { SchemaImport } from '../components/schema-import';

// The customer-schema-verification wizard (Task 15 brief): replaces the old
// bare-URL landing.tsx. Instead of "paste URLs, we discover a schema",
// customers describe exactly what they want up front — three verification
// URLs, an optional listing URL, and a typed field table with an expected
// value per URL — which `sources.createWithSchema` turns into a Scratch
// Source whose schema is proven (via the Schema tab's Verify) before any
// extraction runs at all.
export default function NewSource() {
  const navigate = useNavigate();
  const [grid, setGrid] = useState<GridState>(emptyState());
  const [candidates, setCandidates] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Spec 2.1: a hostname mismatch (and friends) is rejected inline, not just
  // silently disabling Save. An untouched, still-empty grid should not
  // scream on first paint, so this only flips true once the operator edits
  // something, or clicks the (possibly disabled) Save button.
  const [touched, setTouched] = useState(false);

  const updateGrid: typeof setGrid = (value) => {
    setTouched(true);
    setGrid(value);
  };

  const findMutation = trpc.sources.findProductPages.useMutation({
    onSuccess: (res) => setCandidates(res.urls),
    onError: (err) => setError(err.message),
  });

  const createMutation = trpc.sources.createWithSchema.useMutation({
    onSuccess: ({ projectSlug, sourceSlug }) => {
      navigate({ to: '/p/$project/sources/$source', params: { project: projectSlug, source: sourceSlug } });
    },
    onError: (err) => setError(err.message),
  });

  const setUrl = (i: number, value: string) => updateGrid((g) => ({ ...g, urls: g.urls.map((u, j) => (j === i ? value : u)) }));

  function handleFindProductPages() {
    setError(null);
    setCandidates([]);
    findMutation.mutate({ listingUrl: grid.listingUrl.trim() });
  }

  function handleSave() {
    setError(null);
    createMutation.mutate(toSchemaInput(grid));
  }

  const problems = gridProblems(grid);
  const showProblems = touched && problems.length > 0;

  return (
    <div className="mt-6 max-w-5xl">
      <p className="text-sm text-gray-600">
        Describe exactly what you need. We'll prove we can get it before extracting anything.
      </p>

      <div className="card mt-4 space-y-3 p-4">
        <div>
          <label className="micro-label">Listing URL (optional)</label>
          <div className="mt-1.5 flex gap-2">
            <input
              value={grid.listingUrl}
              onChange={(e) => updateGrid((g) => ({ ...g, listingUrl: e.target.value }))}
              placeholder="https://shop.example/category/sofas"
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
            />
            <button
              type="button"
              className="btn-quiet h-9 flex-shrink-0"
              disabled={findMutation.isPending || !grid.listingUrl.trim()}
              onClick={handleFindProductPages}
            >
              {findMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Find product pages
            </button>
          </div>
        </div>

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

        {grid.urls.map((u, i) => (
          <div key={i}>
            <label className="micro-label">Product URL {i + 1}</label>
            <input
              value={u}
              onChange={(e) => setUrl(i, e.target.value)}
              placeholder="https://shop.example/p/kivik-sofa-30575629"
              className="mt-1.5 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
            />
          </div>
        ))}
      </div>

      <div className="mt-4">
        <SchemaImport urlCount={URL_COUNT} onRows={(rows) => updateGrid((g) => ({ ...g, rows }))} />
      </div>

      <div className="card mt-4 p-4">
        <SchemaGrid state={grid} onChange={updateGrid} />
      </div>

      {error && (
        <div className="mt-4 whitespace-pre-line rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {showProblems && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-xs">
          <ul className="list-inside list-disc text-red-700">
            {problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-6 flex items-center justify-end">
        {/*
          Wrapping div, not the button itself: a disabled <button> never
          dispatches click at all, not even to ancestors, so clicking a
          disabled Save while incomplete needs a non-disabled element
          underneath to catch the click and reveal `gridProblems` above
          (spec 2.1 - "rejected inline").
        */}
        <div onClick={() => setTouched(true)}>
          <button
            type="button"
            className="btn-primary h-9"
            disabled={!isComplete(grid) || createMutation.isPending}
            onClick={handleSave}
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save schema
          </button>
        </div>
      </div>
    </div>
  );
}
