"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, TrashIcon, SaveIcon, XIcon, ChevronDownIcon } from "lucide-react";

interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface CollectionSchemaEditorProps {
  collectionId: string;
  initialFields: SchemaField[];
  onSave: (collectionId: string, schema: SchemaField[]) => Promise<void>;
}

const BASE_TYPES = ["string", "number", "boolean", "url", "array", "null"];

function parseTypeParts(type: string): string[] {
  return type.split("|").map((t) => t.trim()).filter(Boolean);
}

function joinTypeParts(parts: string[]): string {
  return parts.join(" | ");
}

function TypeBuilder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parts = parseTypeParts(value);
  const [customInput, setCustomInput] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const addPart = (part: string) => {
    if (part === "custom") {
      setShowCustom(true);
      return;
    }
    if (!parts.includes(part)) {
      onChange(joinTypeParts([...parts, part]));
    }
  };

  const removePart = (index: number) => {
    const next = parts.filter((_, i) => i !== index);
    onChange(next.length > 0 ? joinTypeParts(next) : "string");
  };

  const addCustom = () => {
    const trimmed = customInput.trim();
    if (trimmed && !parts.includes(trimmed)) {
      onChange(joinTypeParts([...parts, trimmed]));
    }
    setCustomInput("");
    setShowCustom(false);
  };

  const available = BASE_TYPES.filter((t) => !parts.includes(t));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {parts.map((part, i) => (
        <span
          key={i}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[0.6rem] font-mono"
          style={{ background: "var(--ws-accent-surface)", color: "var(--ws-accent)", border: "1px solid var(--ws-accent-muted)" }}
        >
          {part}
          {parts.length > 1 && (
            <button type="button" onClick={() => removePart(i)} className="hover:opacity-70">
              <XIcon className="size-2.5" />
            </button>
          )}
        </span>
      ))}

      {parts.length > 0 && (
        <span className="text-[0.55rem] font-mono" style={{ color: "var(--ws-text-dim)" }}>|</span>
      )}

      {showCustom ? (
        <span className="flex items-center gap-1">
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
            placeholder="custom type"
            autoFocus
            className="w-24 rounded px-1.5 py-0.5 text-[0.6rem] font-mono outline-none"
            style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)", color: "var(--ws-text)" }}
          />
          <button type="button" onClick={addCustom} className="text-[0.6rem] font-medium" style={{ color: "var(--ws-accent)" }}>
            Add
          </button>
          <button type="button" onClick={() => { setShowCustom(false); setCustomInput(""); }} className="text-[0.6rem]" style={{ color: "var(--ws-text-dim)" }}>
            Cancel
          </button>
        </span>
      ) : (
        <div className="relative">
          <select
            value=""
            onChange={(e) => { if (e.target.value) addPart(e.target.value); }}
            className="appearance-none rounded px-2 py-0.5 pr-5 text-[0.6rem] outline-none cursor-pointer"
            style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)", color: "var(--ws-text-muted)" }}
          >
            <option value="">add type...</option>
            {available.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
            <option value="custom">custom...</option>
          </select>
          <ChevronDownIcon
            className="pointer-events-none absolute right-1 top-1/2 size-2.5 -translate-y-1/2"
            style={{ color: "var(--ws-text-dim)" }}
          />
        </div>
      )}
    </div>
  );
}

export function CollectionSchemaEditor({
  collectionId,
  initialFields,
  onSave,
}: CollectionSchemaEditorProps) {
  const router = useRouter();
  const [fields, setFields] = useState<SchemaField[]>(
    initialFields.length > 0
      ? initialFields
      : [{ name: "", type: "string", required: true, description: "" }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const addField = () => {
    setFields([...fields, { name: "", type: "string", required: true, description: "" }]);
    setSaved(false);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
    setSaved(false);
  };

  const updateField = (index: number, updates: Partial<SchemaField>) => {
    const next = [...fields];
    next[index] = { ...next[index], ...updates };
    setFields(next);
    setSaved(false);
  };

  const validate = (): string => {
    const nonEmpty = fields.filter((f) => f.name.trim());
    if (nonEmpty.length === 0) return "Add at least one field.";
    const names = nonEmpty.map((f) => f.name.trim().toLowerCase());
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length > 0) return `Duplicate field name: ${dupes[0]}`;
    for (const f of nonEmpty) {
      if (!f.type.trim()) return `Field "${f.name}" needs a type.`;
    }
    return "";
  };

  const handleSave = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setSaving(true);
    setError("");
    try {
      const clean = fields
        .filter((f) => f.name.trim())
        .map((f) => ({
          name: f.name.trim(),
          type: f.type.trim(),
          required: f.required,
          description: f.description.trim() || undefined,
        }));
      await onSave(collectionId, clean as SchemaField[]);
      setSaved(true);
      router.refresh();
    } catch {
      setError("Failed to save schema.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="space-y-3">
        {fields.map((field, i) => (
          <div
            key={i}
            className="rounded-lg p-3"
            style={{ background: "var(--ws-surface)", border: "1px solid var(--ws-border)" }}
          >
            {/* Top row: name + required + delete */}
            <div className="mb-2 flex items-center gap-2">
              <input
                type="text"
                value={field.name}
                onChange={(e) => updateField(i, { name: e.target.value })}
                placeholder="field_name"
                className="flex-1 rounded px-2.5 py-1.5 text-xs font-mono outline-none"
                style={{
                  background: "var(--ws-bg)",
                  border: "1px solid var(--ws-border-subtle)",
                  color: "var(--ws-text)",
                  minWidth: 0,
                }}
              />

              <select
                value={field.required ? "required" : "optional"}
                onChange={(e) => updateField(i, { required: e.target.value === "required" })}
                className="rounded px-2 py-1.5 text-[0.6rem] outline-none cursor-pointer"
                style={{
                  background: "var(--ws-bg)",
                  border: "1px solid var(--ws-border-subtle)",
                  color: field.required ? "var(--ws-text)" : "var(--ws-text-dim)",
                }}
              >
                <option value="required">required</option>
                <option value="optional">optional</option>
              </select>

              <button
                type="button"
                onClick={() => removeField(i)}
                className="shrink-0 rounded p-1 transition-colors hover:bg-[var(--ws-surface-hover)]"
                title="Remove field"
              >
                <TrashIcon className="size-3" style={{ color: "var(--ws-text-dim)" }} />
              </button>
            </div>

            {/* Type builder */}
            <div className="mb-2">
              <TypeBuilder
                value={field.type}
                onChange={(type) => updateField(i, { type })}
              />
            </div>

            {/* Description */}
            <input
              type="text"
              value={field.description}
              onChange={(e) => updateField(i, { description: e.target.value })}
              placeholder="Description (optional)"
              className="w-full rounded px-2.5 py-1 text-[0.6rem] outline-none"
              style={{
                background: "var(--ws-bg)",
                border: "1px solid var(--ws-border-subtle)",
                color: "var(--ws-text-dim)",
              }}
            />
          </div>
        ))}
      </div>

      {/* Add field */}
      <button
        type="button"
        onClick={addField}
        className="mt-3 flex items-center gap-1 text-[0.65rem] font-medium transition-colors hover:underline"
        style={{ color: "var(--ws-accent)" }}
      >
        <PlusIcon className="size-3" />
        Add field
      </button>

      {/* Error / Success */}
      {error && (
        <p className="mt-3 text-xs" style={{ color: "var(--ws-danger)" }}>{error}</p>
      )}
      {saved && !error && (
        <p className="mt-3 text-xs" style={{ color: "var(--ws-success)" }}>Schema saved.</p>
      )}

      {/* Save */}
      <div className="mt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-40"
          style={{ background: "var(--ws-accent)", color: "#fff" }}
        >
          <SaveIcon className="size-3" />
          {saving ? "Saving..." : "Save Schema"}
        </button>
      </div>
    </div>
  );
}
