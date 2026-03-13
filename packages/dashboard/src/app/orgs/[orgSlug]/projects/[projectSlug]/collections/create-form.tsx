"use client";

import { CreateFolderForm } from "@/components/create-folder-form";
import { createCollection } from "./actions";

export function CreateCollectionForm({
  projectId,
  existingNames,
}: {
  projectId: string;
  existingNames: string[];
}) {
  return (
    <CreateFolderForm
      placeholder="New collection name..."
      existingNames={existingNames}
      onSubmit={(name, slug) => createCollection(projectId, name, slug)}
    />
  );
}
