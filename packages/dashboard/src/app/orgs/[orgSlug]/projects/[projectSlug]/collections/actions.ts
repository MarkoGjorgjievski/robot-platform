"use server";

import { api } from "@/trpc/server";

export async function createCollection(projectId: string, name: string, slug: string): Promise<{ slug: string }> {
  const collection = await api.collections.create({ projectId, name, slug });
  return { slug: collection.slug };
}

export async function updateCollectionSchema(
  collectionId: string,
  schema: { name: string; type: string; required?: boolean; description?: string }[],
): Promise<void> {
  await api.collections.updateSchema({ collectionId, schema });
}
