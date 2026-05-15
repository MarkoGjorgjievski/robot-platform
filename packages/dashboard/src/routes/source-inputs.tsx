import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../components/placeholder';
export default function SourceInputs() {
  const { project, source } = useParams({ from: '/p/$project/sources/$source/inputs' });
  return <Placeholder title="Source Inputs" phase="Phase 3" params={{ project, source }} />;
}
