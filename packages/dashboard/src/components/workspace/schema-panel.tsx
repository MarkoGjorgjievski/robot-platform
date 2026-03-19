"use client";

import { useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
  Trash2Icon,
  RotateCcwIcon,
  SearchIcon,
} from "lucide-react";
import { updateSchema } from "@/app/legacy/extractors/actions";
import { CodeEditor } from "./code-editor";

interface SchemaField {
  name: string;
  xpath?: string;
  css?: string;
  jq?: string;
  regExp?: string;
  regExpReplace?: string;
  defaultValue?: unknown;
  downloadContent?: string;
  singleValue?: boolean;
  type?: string;
  description?: string;
  manualSelector?: string;
  transform?: string;
}

interface SchemaData {
  singleRecord?: boolean;
  regionsSelector?: string | null;
  recordSelector?: string | null;
  recordXPath?: string | null;
  fields?: SchemaField[];
}

interface SchemaPanelProps {
  schemaName?: string;
  schema?: Record<string, unknown>;
  overrideId?: string;
  onHighlightSelector?: (selector: { type: "css" | "xpath"; value: string } | null) => void;
  sourceId?: string;
  onSaveSourceSchema?: (schema: Record<string, unknown>) => Promise<void>;
}

function validateXpath(xpath: string): boolean {
  if (!xpath || xpath.trim() === "") return true;
  let brackets = 0;
  let parens = 0;
  for (const ch of xpath) {
    if (ch === "[") brackets++;
    if (ch === "]") brackets--;
    if (ch === "(") parens++;
    if (ch === ")") parens--;
    if (brackets < 0 || parens < 0) return false;
  }
  return brackets === 0 && parens === 0;
}

export function SchemaPanel({ schemaName, schema, overrideId, onHighlightSelector, sourceId, onSaveSourceSchema }: SchemaPanelProps) {
  const initial = (schema ?? {}) as SchemaData;
  const [singleRecord, setSingleRecord] = useState(initial.singleRecord ?? false);
  const [regionsSelector, setRegionsSelector] = useState(initial.regionsSelector ?? "");
  const [recordSelector, setRecordSelector] = useState(initial.recordSelector ?? "");
  const [recordXPath, setRecordXPath] = useState(initial.recordXPath ?? "");
  const [fields, setFields] = useState<SchemaField[]>(initial.fields ?? []);
  const [saving, setSaving] = useState(false);
  const [expandedFields, setExpandedFields] = useState<Record<number, boolean>>({});
  const [search, setSearch] = useState("");

  const toggleExpanded = (idx: number) => {
    setExpandedFields((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const updateField = (idx: number, updates: Partial<SchemaField>) => {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...updates } : f)));
  };

  const removeField = (idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const addField = () => {
    setFields((prev) => [...prev, { name: "" }]);
    setExpandedFields((prev) => ({ ...prev, [fields.length]: true }));
  };

  const handleSave = async () => {
    if (!schemaName) return;
    setSaving(true);
    const schemaObj = {
      singleRecord,
      regionsSelector: regionsSelector || null,
      recordSelector: recordSelector || null,
      recordXPath: recordXPath || null,
      fields,
    };

    if (sourceId && onSaveSourceSchema) {
      // Save schema on the source (stored in parameters._schema)
      await onSaveSourceSchema(schemaObj);
    } else if (overrideId) {
      // Save to robot override
      const formData = new FormData();
      formData.set("overrideId", overrideId);
      formData.set("schemaName", schemaName);
      formData.set("schema", JSON.stringify(schemaObj));
      await updateSchema(formData);
    }
    setSaving(false);
  };

  const filteredFields = search
    ? fields
        .map((f, i) => ({ field: f, idx: i }))
        .filter(({ field }) => field.name.toLowerCase().includes(search.toLowerCase()))
    : fields.map((f, i) => ({ field: f, idx: i }));

  if (!schemaName) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <div className="text-ws-text-dim text-xs uppercase tracking-widest" style={{ color: 'var(--ws-text-dim)' }}>
          No Schema
        </div>
        <p className="text-center text-xs" style={{ color: 'var(--ws-text-muted)' }}>
          No extraction schema is configured for this domain/country combination.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ background: 'var(--ws-panel-header)', borderBottom: '1px solid var(--ws-border)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ws-text)' }}>
            Schema
          </span>
          <span className="ws-badge ws-badge-blue">{schemaName}</span>
          <span className="ws-badge ws-badge-gray">{fields.length} fields</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={addField}
            className="rounded p-1 transition-colors"
            style={{ color: 'var(--ws-text-muted)' }}
            title="Add field"
          >
            <PlusIcon className="size-3.5" />
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider transition-colors"
            style={{
              background: saving ? 'var(--ws-surface-hover)' : 'var(--ws-accent)',
              color: saving ? 'var(--ws-text-muted)' : '#fff',
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Record selectors section */}
      <div style={{ borderBottom: '1px solid var(--ws-border-subtle)' }}>
        <div className="ws-group-header">
          Record Selectors
        </div>
        <div className="space-y-0">
          <div className="ws-field-row">
            <label className="ws-field-label" title="CSS selector for record containers">
              recordSelector
            </label>
            <input
              value={recordSelector}
              onChange={(e) => {
                setRecordSelector(e.target.value);
                if (e.target.value && onHighlightSelector) onHighlightSelector({ type: "css", value: e.target.value });
              }}
              onFocus={() => recordSelector && onHighlightSelector?.({ type: "css", value: recordSelector })}
              onBlur={() => onHighlightSelector?.(null)}
              placeholder="div.product-card"
              className="w-full rounded px-2 py-1"
            />
          </div>
          <div className="ws-field-row">
            <label className="ws-field-label" title="XPath for record containers">
              recordXPath
            </label>
            <input
              value={recordXPath}
              onChange={(e) => {
                setRecordXPath(e.target.value);
                if (e.target.value && onHighlightSelector) onHighlightSelector({ type: "xpath", value: e.target.value });
              }}
              onFocus={() => recordXPath && onHighlightSelector?.({ type: "xpath", value: recordXPath })}
              onBlur={() => onHighlightSelector?.(null)}
              placeholder="//div[@class='product']"
              className="w-full rounded px-2 py-1"
              style={{
                borderColor: recordXPath && !validateXpath(recordXPath) ? 'var(--ws-danger)' : undefined,
              }}
            />
          </div>
          <div className="ws-field-row">
            <label className="ws-field-label" title="CSS selector for page regions">
              regionsSelector
            </label>
            <input
              value={regionsSelector}
              onChange={(e) => setRegionsSelector(e.target.value)}
              placeholder="section.region"
              className="w-full rounded px-2 py-1"
            />
          </div>
          <div className="ws-field-row">
            <label className="ws-field-label">singleRecord</label>
            <div className="flex items-center py-1">
              <button
                type="button"
                onClick={() => setSingleRecord(!singleRecord)}
                className="relative h-4 w-7 rounded-full transition-colors"
                style={{
                  background: singleRecord ? 'var(--ws-accent)' : 'var(--ws-surface-hover)',
                }}
              >
                <span
                  className="absolute top-0.5 left-0.5 h-3 w-3 rounded-full transition-transform"
                  style={{
                    background: '#fff',
                    transform: singleRecord ? 'translateX(12px)' : 'translateX(0)',
                  }}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--ws-border-subtle)' }}>
        <div className="relative">
          <SearchIcon className="absolute left-2 top-1/2 size-3 -translate-y-1/2" style={{ color: 'var(--ws-text-dim)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter fields..."
            className="w-full rounded py-1 pl-7 pr-2"
          />
        </div>
      </div>

      {/* Fields list */}
      <div className="flex-1 overflow-y-auto">
        {filteredFields.map(({ field, idx }) => (
          <div key={idx} style={{ borderBottom: '1px solid var(--ws-border-subtle)' }}>
            {/* Field header row */}
            <div
              className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors"
              style={{ background: expandedFields[idx] ? 'var(--ws-surface-raised)' : 'transparent' }}
              onClick={() => toggleExpanded(idx)}
            >
              {expandedFields[idx] ? (
                <ChevronDownIcon className="size-3 shrink-0" style={{ color: 'var(--ws-text-dim)' }} />
              ) : (
                <ChevronRightIcon className="size-3 shrink-0" style={{ color: 'var(--ws-text-dim)' }} />
              )}
              <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: field.name ? 'var(--ws-text)' : 'var(--ws-text-dim)' }}>
                {field.name || "(unnamed)"}
              </span>
              {field.type && (
                <span className="ws-badge ws-badge-blue">{field.type}</span>
              )}
              {field.xpath && (
                <span className="max-w-[120px] truncate text-[0.6rem]" style={{ color: 'var(--ws-text-dim)' }} title={field.xpath}>
                  {field.xpath}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); removeField(idx); }}
                className="rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100"
                style={{ color: 'var(--ws-danger)' }}
              >
                <Trash2Icon className="size-3" />
              </button>
            </div>

            {/* Expanded field details */}
            {expandedFields[idx] && (
              <div className="space-y-0 pb-1" style={{ background: 'var(--ws-surface-raised)' }}>
                <div className="ws-field-row">
                  <label className="ws-field-label">name</label>
                  <input
                    value={field.name}
                    onChange={(e) => updateField(idx, { name: e.target.value })}
                    placeholder="fieldName"
                    className="w-full rounded px-2 py-1"
                  />
                </div>
                <div className="ws-field-row">
                  <label className="ws-field-label">xpath</label>
                  <textarea
                    value={field.xpath ?? ""}
                    onChange={(e) => {
                      updateField(idx, { xpath: e.target.value || undefined });
                      if (e.target.value && onHighlightSelector) onHighlightSelector({ type: "xpath", value: e.target.value });
                    }}
                    onFocus={() => field.xpath && onHighlightSelector?.({ type: "xpath", value: field.xpath })}
                    onBlur={() => onHighlightSelector?.(null)}
                    placeholder="//span[@class='price']"
                    rows={1}
                    className="w-full resize-y rounded px-2 py-1"
                    style={{
                      borderColor: field.xpath && !validateXpath(field.xpath) ? 'var(--ws-danger)' : undefined,
                    }}
                  />
                </div>
                <div className="ws-field-row">
                  <label className="ws-field-label">css</label>
                  <input
                    value={field.css ?? ""}
                    onChange={(e) => {
                      updateField(idx, { css: e.target.value || undefined });
                      if (e.target.value && onHighlightSelector) onHighlightSelector({ type: "css", value: e.target.value });
                    }}
                    onFocus={() => field.css && onHighlightSelector?.({ type: "css", value: field.css })}
                    onBlur={() => onHighlightSelector?.(null)}
                    placeholder=".product .price"
                    className="w-full rounded px-2 py-1"
                  />
                </div>
                <div className="ws-field-row">
                  <label className="ws-field-label">jq</label>
                  <input
                    value={field.jq ?? ""}
                    onChange={(e) => updateField(idx, { jq: e.target.value || undefined })}
                    placeholder=".data.price"
                    className="w-full rounded px-2 py-1"
                  />
                </div>
                <div className="ws-field-row">
                  <label className="ws-field-label">regExp</label>
                  <input
                    value={field.regExp ?? ""}
                    onChange={(e) => updateField(idx, { regExp: e.target.value || undefined })}
                    placeholder="\\d+\\.\\d+"
                    className="w-full rounded px-2 py-1"
                  />
                </div>
                <div className="ws-field-row">
                  <label className="ws-field-label">regExpReplace</label>
                  <input
                    value={field.regExpReplace ?? ""}
                    onChange={(e) => updateField(idx, { regExpReplace: e.target.value || undefined })}
                    placeholder="$1"
                    className="w-full rounded px-2 py-1"
                  />
                </div>
                <div className="ws-field-row">
                  <label className="ws-field-label">type</label>
                  <select
                    value={field.type ?? ""}
                    onChange={(e) => updateField(idx, { type: e.target.value || undefined })}
                    className="w-full rounded px-2 py-1"
                  >
                    <option value="">None</option>
                    <option value="TEXT">TEXT</option>
                    <option value="NUMBER">NUMBER</option>
                    <option value="BOOLEAN">BOOLEAN</option>
                    <option value="STRING">STRING</option>
                    <option value="DATETIME">DATETIME</option>
                  </select>
                </div>
                <div className="ws-field-row">
                  <label className="ws-field-label">defaultValue</label>
                  <input
                    value={field.defaultValue != null ? String(field.defaultValue) : ""}
                    onChange={(e) => updateField(idx, { defaultValue: e.target.value || undefined })}
                    className="w-full rounded px-2 py-1"
                  />
                </div>
                <div className="ws-field-row">
                  <label className="ws-field-label">singleValue</label>
                  <div className="flex items-center py-1">
                    <button
                      type="button"
                      onClick={() => updateField(idx, { singleValue: field.singleValue ? undefined : true })}
                      className="relative h-4 w-7 rounded-full transition-colors"
                      style={{
                        background: field.singleValue ? 'var(--ws-accent)' : 'var(--ws-surface-hover)',
                      }}
                    >
                      <span
                        className="absolute top-0.5 left-0.5 h-3 w-3 rounded-full transition-transform"
                        style={{
                          background: '#fff',
                          transform: field.singleValue ? 'translateX(12px)' : 'translateX(0)',
                        }}
                      />
                    </button>
                  </div>
                </div>
                <div className="ws-field-row">
                  <label className="ws-field-label">description</label>
                  <input
                    value={field.description ?? ""}
                    onChange={(e) => updateField(idx, { description: e.target.value || undefined })}
                    className="w-full rounded px-2 py-1"
                  />
                </div>
                <div className="ws-field-row">
                  <label className="ws-field-label">downloadContent</label>
                  <input
                    value={field.downloadContent ?? ""}
                    onChange={(e) => updateField(idx, { downloadContent: e.target.value || undefined })}
                    placeholder="text"
                    className="w-full rounded px-2 py-1"
                  />
                </div>
                <div className="ws-field-row">
                  <label className="ws-field-label">manualSelector</label>
                  <input
                    value={field.manualSelector ?? ""}
                    onChange={(e) => updateField(idx, { manualSelector: e.target.value || undefined })}
                    className="w-full rounded px-2 py-1"
                  />
                </div>
                <FieldTransformEditor
                  value={field.transform}
                  onChange={(v) => updateField(idx, { transform: v || undefined })}
                />
              </div>
            )}
          </div>
        ))}

        {filteredFields.length === 0 && fields.length > 0 && (
          <div className="px-3 py-6 text-center text-xs" style={{ color: 'var(--ws-text-dim)' }}>
            No fields match &ldquo;{search}&rdquo;
          </div>
        )}

        {fields.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-3 py-8">
            <span className="text-xs" style={{ color: 'var(--ws-text-dim)' }}>No fields defined</span>
            <button
              onClick={addField}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors"
              style={{ background: 'var(--ws-surface-hover)', color: 'var(--ws-text-muted)' }}
            >
              <PlusIcon className="size-3" /> Add first field
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Per-field transform editor ──────────────────────────────────── */

const TRANSFORM_DEFAULT = `function transform(text, row) {
  return text;
}`;

function FieldTransformEditor({
  value,
  onChange,
}: {
  value?: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasTransform = value && value.trim() !== '' && value.trim() !== TRANSFORM_DEFAULT;

  return (
    <div style={{ borderTop: '1px solid var(--ws-border-subtle)' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[0.6rem] transition-colors hover:bg-[var(--ws-surface-hover)]"
        style={{ color: hasTransform ? 'var(--ws-accent)' : 'var(--ws-text-dim)' }}
      >
        {open ? (
          <ChevronDownIcon className="size-3" />
        ) : (
          <ChevronRightIcon className="size-3" />
        )}
        transform
        {hasTransform && <span className="ws-badge ws-badge-blue" style={{ fontSize: '0.5rem' }}>custom</span>}
      </button>
      {open && (
        <div className="px-1 pb-2" style={{ minHeight: 80 }}>
          <CodeEditor
            value={value || TRANSFORM_DEFAULT}
            onChange={onChange}
            maxHeight={160}
          />
        </div>
      )}
    </div>
  );
}
