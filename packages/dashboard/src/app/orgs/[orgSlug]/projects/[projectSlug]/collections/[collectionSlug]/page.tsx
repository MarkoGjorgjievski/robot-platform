import { redirect } from "next/navigation";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectSlug: string; collectionSlug: string }>;
}) {
  const { orgSlug, projectSlug, collectionSlug } = await params;
  redirect(`/orgs/${orgSlug}/projects/${projectSlug}/collections/${collectionSlug}/sources`);
}
