"use server";

import { api } from "@/trpc/server";

export async function createSource(data: {
  collectionId: string;
  name: string;
  slug: string;
  country: string;
  locale?: string | null;
  currency?: string | null;
  dataCenter?: string | null;
  proxyType?: string | null;
  loginPool?: string | null;
  maximumInputs?: number | null;
  runnerFramework?: string | null;
  domainId?: string | null;
  variant?: string;
  robotTemplate?: string;
  schemaValues?: Record<string, string>;
}): Promise<{ slug: string }> {
  const source = await api.sources.create(data);
  return { slug: source.slug };
}

export async function createDomain(name: string): Promise<{ id: string; name: string }> {
  const prefix = name.charAt(0).toLowerCase();
  const domain = await api.domains.create({ name, prefix });
  return { id: domain.id, name: domain.name };
}
