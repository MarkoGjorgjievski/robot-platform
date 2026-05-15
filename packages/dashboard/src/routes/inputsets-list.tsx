import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../components/placeholder';
export default function InputSetsList() {
  const { project } = useParams({ from: '/p/$project/inputs' });
  return <Placeholder title="Input Sets" phase="Phase 3" params={{ project }} />;
}
