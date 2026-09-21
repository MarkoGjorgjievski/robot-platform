// packages/dashboard/src/components/field-catalogue.tsx
// Step 1's catalogue (spec 2026-09-18 §2.1): a row of schema types, then that
// type's groups as chips. A chip already in the contract reads "added" and is
// disabled; clicking any other adds it with one mutation. On the paper, no
// card: the type row is a set of quiet buttons with a 2px rail under the
// chosen one (the stepper's language), the groups are labelled rows of chips.
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { trpc } from '../lib/trpc';

export type CatalogueEntry = { key: string; name: string; type: string; description: string; concept: string };
type SchemaType = 'product' | 'listing_item' | 'article' | 'job' | 'property' | 'event' | 'custom';

export function FieldCatalogue({ existingKeys, onAdd, pendingKey, note }: {
  existingKeys: Set<string>;
  onAdd: (entry: CatalogueEntry) => void;
  pendingKey: string | null;
  note: string | null;
}) {
  const catalogue = trpc.datasets.catalogue.useQuery();
  const [type, setType] = useState<SchemaType>('product');
  const types = catalogue.data ? (Object.keys(catalogue.data) as SchemaType[]) : [];
  const current = catalogue.data?.[type];
  return (
    <div>
      <div role="tablist" aria-label="Schema type" className="flex flex-wrap gap-3">
        {types.map((t) => (
          <button key={t} role="tab" type="button" aria-selected={t === type} onClick={() => setType(t)}
            className={`border-b-2 pb-1 text-xs ${t === type ? 'border-accent-600 text-gray-900' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
            {catalogue.data![t].label}
          </button>
        ))}
      </div>
      {current && current.groups.length === 0 && <p className="label-soft mt-3">No suggestions for a custom schema. Add your own fields below.</p>}
      {current?.groups.map((g) => (
        // The group label is its own column and the chips wrap inside theirs:
        // one flat `flex-wrap` row put the label in the flow, so on a narrow
        // column (the project home's left half) a wrapped second line of chips
        // started under the label instead of under the chips above it.
        <div key={g.name} className="mt-3 flex items-baseline gap-2">
          <span className="label-soft w-24 flex-shrink-0">{g.name}</span>
          <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          {g.entries.map((en) => {
            const added = existingKeys.has(en.key);
            const pending = pendingKey === en.key;
            // Every chip goes dead while ANY add is in flight, not just the pending
            // one: two overlapping `addField` calls raced on the contract until the
            // mutations took a row lock, and there is one `pendingKey` slot, so a
            // second spinner had nowhere to show. One add at a time also keeps the
            // chips honest — the second chip's "added" state only arrives with the
            // refetch the first one triggers.
            return (
              <button key={en.key} type="button" disabled={added || pendingKey !== null} title={en.description} aria-label={added ? `${en.name} (added)` : `Add ${en.name}`}
                onClick={() => onAdd(en)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${added ? 'border-gray-200 text-gray-600' : 'border-gray-300 text-gray-900 hover:border-accent-600'}`}>
                {pending && <Loader2 className="h-3 w-3 animate-spin" />}
                {en.name}<span className="font-mono text-[10px] text-gray-600">{en.type}</span>
                {added && <span className="text-[10px] text-gray-600">added</span>}
              </button>
            );
          })}
          </div>
        </div>
      ))}
      {note && <p className="label-soft mt-3">{note}</p>}
    </div>
  );
}
