import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../components/placeholder';
export default function SourceConfig() {
  const { project, source } = useParams({ from: '/p/$project/sources/$source/config' });
  return <Placeholder title="Source Config" phase="Phase 3" params={{ project, source }} />;
}
