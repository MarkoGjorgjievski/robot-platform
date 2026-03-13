import { api } from "@/trpc/server";
import { notFound } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";
import { CollectionSchemaEditor } from "@/components/collection-schema-editor";
import { updateCollectionSchema } from "../../actions";

interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export default async function SchemaPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectSlug: string; collectionSlug: string }>;
}) {
  const { orgSlug, projectSlug, collectionSlug } = await params;

  const collection = await api.collections
    .getBySlug({ orgSlug, projectSlug, collectionSlug })
    .catch(() => null);
  if (!collection) notFound();

  const schemaFields: SchemaField[] = Array.isArray(collection.schema)
    ? (collection.schema as SchemaField[]).map((f) => ({
        name: f.name ?? "",
        type: f.type ?? "string",
        required: f.required ?? true,
        description: f.description ?? "",
      }))
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      {schemaFields.length === 0 && (
        <div
          className="mb-4 flex items-center gap-2 rounded px-3 py-2"
          style={{ background: "rgba(234, 179, 8, 0.08)", border: "1px solid rgba(234, 179, 8, 0.2)" }}
        >
          <AlertTriangleIcon className="size-3 shrink-0" style={{ color: "var(--ws-warning)" }} />
          <span className="text-[0.65rem]" style={{ color: "var(--ws-warning)" }}>
            No schema defined yet. Source workspaces won&apos;t have predefined fields until you create one.
          </span>
        </div>
      )}

      <CollectionSchemaEditor
        collectionId={collection.id}
        initialFields={schemaFields}
        onSave={updateCollectionSchema}
      />
    </div>
  );
}
