import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../components/placeholder';
export default function SourceRuns() {
  const { project, source } = useParams({ from: '/p/$project/sources/$source/runs' });
  return <Placeholder title="Source Runs" phase="Phase 3" params={{ project, source }} />;
}
