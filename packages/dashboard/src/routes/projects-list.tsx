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
        <table className="sheet mt-6">
          <thead>
            <tr className="sheet-row">
              <th className="sheet-head px-3 py-2 text-left">Name</th>
              <th className="sheet-head px-3 py-2 text-left">Websites</th>
              <th className="sheet-head px-3 py-2 text-left">Fields</th>
              <th className="sheet-head px-3 py-2 text-left">Last extraction</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className="sheet-row h-8">
                <td className="px-3">
                  <Link to="/projects/$project" params={{ project: p.slug }} className="name text-[15px] hover:underline">{p.name}</Link>
                  {p.description && <span className="ml-2 text-xs text-gray-600">{p.description}</span>}
                </td>
                <td className="px-3">
                  {p.sourceCount === 0 ? <span className="text-gray-600">none yet</span> : (
                    <span className="inline-flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${p.verifiedSourceCount === p.sourceCount ? 'bg-pass' : p.verifiedSourceCount === 0 ? 'bg-gray-400' : 'bg-warn'}`} />
                      <span className="font-mono">{p.verifiedSourceCount} of {p.sourceCount}</span> verified
                    </span>
                  )}
                </td>
                <td className="px-3 font-mono">{p.fieldCount}</td>
                <td className="px-3 text-gray-600">
                  {p.lastRun ? <><span className="font-mono">{formatDate(new Date(p.lastRun.createdAt))}</span>{p.lastRun.resultCount != null && <>, <span className="font-mono">{p.lastRun.resultCount}</span> rows</>}</> : 'never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
        <p className="mt-2 text-xs text-gray-600">Fields and websites come next, on the project page.</p>
        {create.isError && <p className="mt-2 text-xs text-fail">{create.error.message}</p>}
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
