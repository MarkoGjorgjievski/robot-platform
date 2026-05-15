import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../components/placeholder';
export default function SourcesList() {
  const { project } = useParams({ from: '/p/$project/sources' });
  return <Placeholder title="Sources" phase="Phase 3" params={{ project }} />;
}
