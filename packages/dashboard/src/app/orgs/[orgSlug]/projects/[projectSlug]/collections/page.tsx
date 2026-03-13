import { api } from '@/trpc/server';
import { FolderGlossary } from '@/components/folder-glossary';
import { notFound } from 'next/navigation';
import { CreateCollectionForm } from './create-form';

export default async function CollectionsPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectSlug: string }>;
}) {
  const { orgSlug, projectSlug } = await params;

  const project = await api.projects.getBySlug({ orgSlug, projectSlug }).catch(() => null);
  if (!project) notFound();

  const collections = await api.collections.listByProject({ projectId: project.id }).catch(() => []);

  const items = collections.map((c) => ({
    name: c.name,
    href: `/orgs/${orgSlug}/projects/${projectSlug}/collections/${c.slug}`,
    count: c.sourceCount,
    description: c.description,
  }));

  return (
    <FolderGlossary
      title={`${project.name} — Collections`}
      description="Each collection defines a schema shared by all its sources."
      items={items}
      breadcrumbs={[
        { label: "Organizations", href: "/orgs" },
        { label: orgSlug, href: `/orgs/${orgSlug}/projects` },
        { label: "Projects", href: `/orgs/${orgSlug}/projects` },
        { label: project.name, href: `/orgs/${orgSlug}/projects/${projectSlug}/collections` },
        { label: "Collections" },
      ]}
    >
      <CreateCollectionForm
        projectId={project.id}
        existingNames={collections.map((c) => c.name)}
      />
    </FolderGlossary>
  );
}
