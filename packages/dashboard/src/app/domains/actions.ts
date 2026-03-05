"use server";

import { api } from "@/trpc/server";
import { redirect } from "next/navigation";

export async function createDomain(formData: FormData) {
  const domain = await api.domains.create({
    name: formData.get("name") as string,
    prefix: (formData.get("prefix") as string) || null,
    hasGotoOverride: formData.get("hasGotoOverride") === "on",
    hasSetZipCodeOverride: formData.get("hasSetZipCodeOverride") === "on",
  });
  redirect(`/domains/${domain.id}`);
}

export async function updateDomain(formData: FormData) {
  const id = formData.get("id") as string;
  await api.domains.update({
    id,
    name: formData.get("name") as string,
    prefix: (formData.get("prefix") as string) || null,
    hasGotoOverride: formData.get("hasGotoOverride") === "on",
    hasSetZipCodeOverride: formData.get("hasSetZipCodeOverride") === "on",
  });
  redirect(`/domains/${id}`);
}
