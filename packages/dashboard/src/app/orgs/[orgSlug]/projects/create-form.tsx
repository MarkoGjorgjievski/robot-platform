"use client";

import { CreateFolderForm } from "@/components/create-folder-form";
import { createProject } from "./actions";

export function CreateProjectForm({
  orgId,
  existingNames,
}: {
  orgId: string;
  existingNames: string[];
}) {
  return (
    <CreateFolderForm
      placeholder="New project name..."
      existingNames={existingNames}
      onSubmit={(name, slug) => createProject(orgId, name, slug)}
    />
  );
}
