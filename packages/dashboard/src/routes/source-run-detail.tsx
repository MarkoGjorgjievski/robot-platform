import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../components/placeholder';
export default function SourceRunDetail() {
  const { project, source, run } = useParams({ from: '/p/$project/sources/$source/runs/$run' });
  return <Placeholder title="Run Detail" phase="Phase 3" params={{ project, source, run }} />;
}
