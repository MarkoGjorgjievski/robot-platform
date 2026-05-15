import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../components/placeholder';
export default function SourceDetail() {
  const { project, source } = useParams({ from: '/p/$project/sources/$source' });
  return <Placeholder title="Source Detail" phase="Phase 3" params={{ project, source }} />;
}
