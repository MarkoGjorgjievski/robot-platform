import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../components/placeholder';
export default function ProjectDomainsList() {
  const { project } = useParams({ from: '/p/$project/domains' });
  return <Placeholder title="Project Domains" phase="Phase 5" params={{ project }} />;
}
