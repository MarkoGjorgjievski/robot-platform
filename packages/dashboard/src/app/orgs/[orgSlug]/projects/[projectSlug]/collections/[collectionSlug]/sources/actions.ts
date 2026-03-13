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
  domain?: string | null;
}): Promise<{ slug: string }> {
  const source = await api.sources.create(data);
  return { slug: source.slug };
}
