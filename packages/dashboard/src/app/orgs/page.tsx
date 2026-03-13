import { api } from '@/trpc/server';
import { FolderGlossary } from '@/components/folder-glossary';

export default async function OrgsPage() {
  const orgs = await api.orgs.list();

  const items = orgs.map((org) => ({
    name: org.name,
    href: `/orgs/${org.slug}/projects`,
    count: org.extractorCount,
    description: org.description,
  }));

  return (
    <FolderGlossary
      title="Organizations"
      description="Select an organization to browse its projects and collections."
      items={items}
      breadcrumbs={[{ label: "Organizations" }]}
    />
  );
}
