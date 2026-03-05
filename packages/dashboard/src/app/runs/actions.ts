"use server";

import { api } from "@/trpc/server";
import { redirect } from "next/navigation";

export async function createRun(formData: FormData) {
  const extractorId = formData.get("extractorId") as string;
  const inputLabel = formData.get("inputLabel") as string | null;
  const run = await api.runs.create({
    extractorId,
    inputLabel: inputLabel || undefined,
  });
  redirect(`/runs/${run.id}`);
}
