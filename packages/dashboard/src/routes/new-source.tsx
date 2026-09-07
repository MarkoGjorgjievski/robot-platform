import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { emptyState, gridProblems, isComplete, toSchemaInput, URL_COUNT, type GridState } from '../lib/schema-grid';
import { SchemaGrid } from '../components/schema-grid';
import { SchemaImport } from '../components/schema-import';
import { SchemaUrls } from '../components/schema-urls';

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

  const findMutation = trpc.sources.findProductPages.useMutation();

  const createMutation = trpc.sources.createWithSchema.useMutation({
    onSuccess: ({ projectSlug, sourceSlug }) => {
      navigate({ to: '/p/$project/sources/$source', params: { project: projectSlug, source: sourceSlug } });
    },
    onError: (err) => setError(err.message),
  });

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

      <div className="mt-4">
        <SchemaUrls
          state={grid}
          onChange={updateGrid}
          onFindProductPages={async (listingUrl) => (await findMutation.mutateAsync({ listingUrl })).urls}
        />
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
