import { useParams } from '@tanstack/react-router';
import { Placeholder } from '../components/placeholder';
export default function ProjectDomainDetail() {
  const { project, domain } = useParams({ from: '/p/$project/domains/$domain' });
  return <Placeholder title="Project Domain Detail" phase="Phase 5" params={{ project, domain }} />;
}
