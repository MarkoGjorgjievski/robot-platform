"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";

interface CreateFolderFormProps {
  placeholder: string;
  existingNames: string[];
  onSubmit: (name: string, slug: string) => Promise<{ slug: string }>;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function CreateFolderForm({
  placeholder,
  existingNames: initialExisting,
  onSubmit,
}: CreateFolderFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<string[]>([]);

  const allExisting = [...initialExisting, ...created];
  const existingSlugs = allExisting.map(toSlug);

  const validate = (value: string): string => {
    if (value.trim().length === 0) return "";
    if (value.trim().length < 2) return "Name must be at least 2 characters.";
    const s = toSlug(value);
    if (existingSlugs.includes(s)) return "Already exists.";
    return "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    const err = validate(trimmed);
    if (err) {
      setError(err);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(trimmed, toSlug(trimmed));
      setCreated((prev) => [...prev, trimmed]);
      setName("");
      router.refresh();
    } catch {
      setError("Failed to create. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <div className="relative flex-1 max-w-sm">
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(validate(e.target.value));
          }}
          placeholder={placeholder}
          className="w-full rounded px-3 py-1.5 text-xs"
          style={{
            background: "var(--ws-surface)",
            border: `1px solid ${error ? "var(--ws-danger)" : "var(--ws-border)"}`,
            color: "var(--ws-text)",
          }}
        />
        {error && (
          <p className="absolute -bottom-4 left-0 text-[0.6rem]" style={{ color: "var(--ws-danger)" }}>
            {error}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={submitting || !name.trim() || !!error}
        className="flex items-center gap-1 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-40"
        style={{ background: "var(--ws-accent)", color: "#fff" }}
      >
        <PlusIcon className="size-3" />
        {submitting ? "Creating..." : "Create"}
      </button>
    </form>
  );
}
