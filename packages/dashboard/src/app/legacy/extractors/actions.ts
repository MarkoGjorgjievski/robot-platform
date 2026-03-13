"use server";

import { api } from "@/trpc/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export async function createExtractor(formData: FormData) {
  const extractor = await api.extractors.create({
    orgId: formData.get("orgId") as string,
    domainId: formData.get("domainId") as string,
    country: formData.get("country") as string,
    variant: formData.get("variant") as string,
    robotTemplate: (formData.get("robotTemplate") as string) || undefined,
    parameters: JSON.parse((formData.get("parameters") as string) || "{}"),
    isActive: formData.get("isActive") === "on",
  });
  redirect(`/extractors/${extractor.id}`);
}

export async function updateExtractor(formData: FormData) {
  const id = formData.get("id") as string;
  await api.extractors.update({
    id,
    orgId: formData.get("orgId") as string,
    domainId: formData.get("domainId") as string,
    country: formData.get("country") as string,
    variant: formData.get("variant") as string,
    robotTemplate: (formData.get("robotTemplate") as string) || undefined,
    parameters: JSON.parse((formData.get("parameters") as string) || "{}"),
    isActive: formData.get("isActive") === "on",
  });
  redirect(`/extractors/${id}`);
}

export async function updateSchema(formData: FormData) {
  const overrideId = formData.get("overrideId") as string;
  const schemaName = formData.get("schemaName") as string;
  const schema = JSON.parse(formData.get("schema") as string);
  await api.overrides.updateSchema({
    id: overrideId,
    schemaName,
    schema,
  });
  revalidatePath("/extractors");
}
