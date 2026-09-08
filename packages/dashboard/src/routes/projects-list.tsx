import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { formatDate } from '../lib/format';
import { Spinner, ErrorBanner, EmptyState } from '../components/page-states';
import { PageHeader } from '../components/page-header';
import { Dialog, fieldClass, labelClass } from '../components/dialog';

/** Home (spec 5.1): every project, what is proven in it, when it last ran. */
export default function ProjectsList() {
  const listQuery = trpc.projects.list.useQuery();
  const [creating, setCreating] = useState(false);

  if (listQuery.isLoading) return <Spinner label="Loading projects..." />;
  if (listQuery.isError) return <ErrorBanner message={listQuery.error.message} />;
  const projects = listQuery.data ?? [];

  const newButton = (
    <button type="button" className="btn-primary h-9" onClick={() => setCreating(true)}>New project</button>
  );

  return (
    <div>
      <PageHeader title="Projects" actions={newButton} />

      {projects.length === 0 ? (
        <EmptyState title="No projects yet" description="A project holds the fields you want and the websites to get them from." action={newButton} />
      ) : (
        <div className="card mt-6 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Project</th>
                <th className="px-4 py-2 text-left font-medium">Websites</th>
                <th className="px-4 py-2 text-left font-medium">Fields</th>
                <th className="px-4 py-2 text-left font-medium">Last extraction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <Link to="/projects/$project" params={{ project: p.slug }} className="font-medium text-gray-900 hover:underline">{p.name}</Link>
                    {p.description && <div className="truncate text-xs text-gray-500">{p.description}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {p.sourceCount === 0 ? <span className="text-gray-400">none yet</span> : (
                      <span className="inline-flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${p.verifiedSourceCount === p.sourceCount ? 'bg-emerald-600' : p.verifiedSourceCount === 0 ? 'bg-gray-400' : 'bg-amber-500'}`} />
                        {p.verifiedSourceCount} of {p.sourceCount} verified
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{p.fieldCount}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {p.lastRun ? <>{formatDate(new Date(p.lastRun.createdAt))}{p.lastRun.resultCount != null && <>, {p.lastRun.resultCount} rows</>}</> : 'never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = trpc.projects.create.useMutation({
    onSuccess: (p) => {
      utils.projects.list.invalidate();
      onClose();
      navigate({ to: '/projects/$project', params: { project: p.slug } });
    },
  });

  useEffect(() => {
    if (!open) { setName(''); setDescription(''); create.reset(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const closeIfIdle = () => { if (!create.isPending) onClose(); };

  return (
    <Dialog open={open} title="New project" onClose={closeIfIdle} preventClose={create.isPending}>
      <form onSubmit={(e) => { e.preventDefault(); create.mutate({ name, description: description || undefined }); }}>
        <label className={labelClass}>Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} placeholder="AbeBooks Q3" />
        </label>
        <label className={`${labelClass} mt-3`}>What is it for <span className="text-gray-400">(optional)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={fieldClass} placeholder="mountaineering books, prices and authors" />
        </label>
        <p className="mt-2 text-xs text-gray-500">Fields and websites come next, on the project page.</p>
        {create.isError && <p className="mt-2 text-xs text-red-700">{create.error.message}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-quiet h-9" disabled={create.isPending} onClick={closeIfIdle}>Cancel</button>
          <button type="submit" className="btn-primary h-9" disabled={!name.trim() || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Create project
          </button>
        </div>
      </form>
    </Dialog>
  );
}
