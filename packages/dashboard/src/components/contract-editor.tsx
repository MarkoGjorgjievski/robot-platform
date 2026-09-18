// packages/dashboard/src/components/contract-editor.tsx
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Loader2, Trash2 } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { FIELD_TYPES, type GridFieldType } from '../lib/schema-grid';
import { Dialog } from './dialog';
import { InlineRename } from './inline-rename';
import { FieldCatalogue, type CatalogueEntry } from './field-catalogue';
import { addNote } from '../lib/schema-stepper-view';

type Field = { key: string; name: string; type: string; concept?: string };

/** The project's field list (spec 5.3): the columns of the output, edited in place. */
export function ContractEditor({ datasetId, projectSlug, websiteCount }: { datasetId: string; projectSlug: string; websiteCount: number }) {
  const utils = trpc.useUtils();
  const fieldsQuery = trpc.datasets.fieldStatus.useQuery({ datasetId });
  const contractQuery = trpc.datasets.getContract.useQuery({ datasetId });
  const invalidate = () => { utils.datasets.invalidate(); utils.sources.invalidate(); utils.projects.list.invalidate(); };
  const [lastError, setLastError] = useState<string | null>(null);
  const add = trpc.datasets.addField.useMutation({ onSuccess: () => { setLastError(null); invalidate(); }, onError: (e) => setLastError(e.message) });
  const rename = trpc.datasets.renameField.useMutation({ onSuccess: () => { setLastError(null); invalidate(); }, onError: (e) => setLastError(e.message) });
  const retype = trpc.datasets.retypeField.useMutation();
  const del = trpc.datasets.deleteField.useMutation({ onSuccess: () => { setLastError(null); invalidate(); }, onError: (e) => setLastError(e.message) });
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<GridFieldType>('text');
  const [deleting, setDeleting] = useState<Field | null>(null);
  const [pendingType, setPendingType] = useState<Record<string, GridFieldType>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const fields = (contractQuery.data ?? []) as Field[];
  const status = fieldsQuery.data ?? {};

  function submitNew() {
    const name = newName.trim();
    if (!name) return;
    add.mutate({ datasetId, name, type: newType }, { onSuccess: () => { setNewName(''); setNewType('text'); } });
  }

  // From the catalogue: one mutation per chip click, carrying its
  // description (default location hint) and concept (engine vocabulary).
  function addFromCatalogue(en: CatalogueEntry) {
    setPendingKey(en.key);
    add.mutate({ datasetId, name: en.name, type: en.type as GridFieldType, description: en.description, concept: en.concept }, { onSettled: () => setPendingKey(null) });
  }

  return (
    <div>
      <table className="sheet">
        <thead><tr className="sheet-head sheet-row"><th className="py-1 text-left font-semibold">Field</th><th className="py-1 text-left font-semibold">Type</th><th className="py-1 text-left font-semibold">Verified on</th><th /></tr></thead>
        <tbody>
          {fields.map((f) => {
            const s = status[f.key];
            const locked = !!s && s.verified > 0;
            return (
              <tr key={f.key} className="sheet-row h-8">
                {/*
                  A field name is a name the customer chose, so it reads like the
                  grid's Field column: Public Sans 500 ink, never mono — mono is
                  for keys, types and values. That is what `variant="plain"` is.
                */}
                <td className="py-1.5"><InlineRename value={f.name} variant="plain" className="text-[13px] font-medium text-gray-900" onSave={(name) => rename.mutate({ datasetId, key: f.key, name })} /></td>
                <td className="py-1.5">
                  <select value={pendingType[f.key] ?? f.type} disabled={locked || f.key in pendingType} title={locked ? 'A verified website uses this type. Delete and re-add the field to change it.' : undefined}
                    onChange={(e) => {
                      const next = e.target.value as GridFieldType;
                      setPendingType((p) => ({ ...p, [f.key]: next }));
                      retype.mutate({ datasetId, key: f.key, type: next }, {
                        onSuccess: () => { setLastError(null); invalidate(); },
                        onError: (err) => setLastError(`${f.name}: ${err.message}`),
                        onSettled: () => setPendingType((p) => { const { [f.key]: _, ...rest } = p; return rest; }),
                      });
                    }} className="rounded-md border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs disabled:opacity-60">
                    {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td className="py-1.5 text-xs">
                  {!s || s.total === 0 ? <span className="text-gray-600">no websites yet</span> : (
                    <span className="inline-flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${s.verified === s.total ? 'bg-pass' : s.verified === 0 ? 'bg-changed' : 'bg-warn'}`} />
                      {s.verified} of {s.total} websites
                      {s.verified < s.total && s.websites.filter((w) => !w.verified).slice(0, 1).map((w) => (
                        <Link key={w.sourceId} to="/projects/$project/sources/$source" params={{ project: projectSlug, source: w.slug }} className="underline-offset-2 hover:underline">{w.name}</Link>
                      ))}
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-right"><button type="button" aria-label={`Delete ${f.name}`} title="Delete field" onClick={() => setDeleting(f)} className="text-gray-600 hover:text-fail"><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            );
          })}
          <tr className="sheet-row h-8">
            <td className="py-1.5"><input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitNew(); }} placeholder="field name" className="w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-0.5 text-[13px] font-medium text-gray-900" aria-label="New field name" /></td>
            <td className="py-1.5"><select value={newType} onChange={(e) => setNewType(e.target.value as GridFieldType)} className="rounded-md border border-gray-300 bg-gray-50 px-2 py-0.5 text-xs">{FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></td>
            <td className="py-1.5" colSpan={2}><button type="button" aria-label="Add your own" className="btn-quiet h-7" disabled={!newName.trim() || add.isPending} onClick={submitNew}>{add.isPending && <Loader2 className="h-3 w-3 animate-spin" />}Add field</button></td>
          </tr>
        </tbody>
      </table>
      <p className="label-soft mt-2">Add a field here and every website gets a new column to verify. Renaming is free. A type locks once a website has verified it.</p>
      {lastError && <p className="mt-2 text-xs text-fail">{lastError} <button type="button" className="underline-offset-2 hover:underline" onClick={() => setLastError(null)}>Dismiss</button></p>}

      <h4 className="name mt-6 text-base">Add from the catalogue</h4>
      <p className="label-soft">Pick what this kind of page usually has. Each one becomes a field on every website in the project.</p>
      <div className="mt-2">
        <FieldCatalogue existingKeys={new Set(fields.map((f) => f.key))} onAdd={addFromCatalogue} pendingKey={pendingKey} note={addNote(websiteCount)} />
      </div>

      <Dialog open={!!deleting} title={deleting ? `Delete ${deleting.name}?` : ''} onClose={() => { if (!del.isPending) setDeleting(null); }} preventClose={del.isPending}>
        {deleting && (
          <div className="text-sm text-gray-700">
            <p>The column disappears from the output and from every website in this project.</p>
            {(status[deleting.key]?.websites ?? []).length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-gray-600">
                {status[deleting.key]!.websites.map((w) => <li key={w.sourceId}>{w.name}{w.verified ? ' (verified)' : ''}</li>)}
              </ul>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-quiet h-9" disabled={del.isPending} onClick={() => setDeleting(null)}>Cancel</button>
              <button type="button" className="btn-primary h-9 bg-fail hover:bg-fail/90" disabled={del.isPending} onClick={() => del.mutate({ datasetId, key: deleting.key }, { onSuccess: () => setDeleting(null) })}>
                {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Delete field
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
