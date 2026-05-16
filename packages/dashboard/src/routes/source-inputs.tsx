import { useParams } from '@tanstack/react-router';
import { EmptyState } from '../components/page-states';

export default function SourceInputs() {
  const { source: sourceSlug } = useParams({ from: '/p/$project/sources/$source/inputs' });
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-gray-700">Inputs</h2>
      <p className="mt-1 text-xs text-gray-500">Values fed to this source's URL template. Source: <span className="font-mono">{sourceSlug}</span></p>
      <EmptyState
        title="InputSet display coming in Phase 3b"
        description="The full InputSet management UI (paste CSV, edit rows, swap InputSets) is part of the Phase 3b editing surfaces."
      />
    </div>
  );
}
