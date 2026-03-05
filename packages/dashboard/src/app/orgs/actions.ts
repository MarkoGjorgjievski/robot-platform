"use server";

import { api } from "@/trpc/server";
import { redirect } from "next/navigation";

export async function createOrg(formData: FormData) {
  const org = await api.orgs.create({
    name: formData.get("name") as string,
    slug: formData.get("slug") as string,
    description: (formData.get("description") as string) || null,
  });
  redirect(`/orgs/${org.id}`);
}

export async function updateOrg(formData: FormData) {
  const id = formData.get("id") as string;
  await api.orgs.update({
    id,
    name: formData.get("name") as string,
    slug: formData.get("slug") as string,
    description: (formData.get("description") as string) || null,
  });
  redirect(`/orgs/${id}`);
}
