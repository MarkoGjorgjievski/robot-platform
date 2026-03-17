"use server";

import { api } from "@/trpc/server";
import { revalidatePath } from "next/cache";

export async function createSourceInput(sourceId: string, label: string, inputData: Record<string, unknown>) {
  const result = await api.sourceInputs.create({ sourceId, label, inputData });
  revalidatePath(".");
  return result;
}

export async function updateSourceInput(id: string, label: string, inputData: Record<string, unknown>) {
  const result = await api.sourceInputs.update({ id, label, inputData });
  revalidatePath(".");
  return result;
}

export async function deleteSourceInput(id: string) {
  const result = await api.sourceInputs.delete({ id });
  revalidatePath(".");
  return result;
}

export async function createSourceRun(sourceId: string, inputLabel: string) {
  const result = await api.runs.create({ sourceId, inputLabel });
  revalidatePath(".");
  return result;
}

export async function fetchRunData(runId: string) {
  return api.runs.getHtml({ id: runId });
}

export async function updateSource(data: {
  id: string;
  isActive?: boolean;
  parameters?: Record<string, unknown>;
  domainId?: string | null;
  country?: string;
  variant?: string;
  robotTemplate?: string;
}) {
  await api.sources.update(data);
  revalidatePath(".");
}
