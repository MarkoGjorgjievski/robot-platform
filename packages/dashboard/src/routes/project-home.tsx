import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../components/placeholder';
export default function ProjectHome() {
  const { project } = useParams({ from: '/p/$project' });
  return <Placeholder title="Project Home" phase="Phase 3" params={{ project }} />;
}
