"use server";

import { api } from "@/trpc/server";

export async function createProject(orgId: string, name: string, slug: string): Promise<{ slug: string }> {
  const project = await api.projects.create({ orgId, name, slug });
  return { slug: project.slug };
}
