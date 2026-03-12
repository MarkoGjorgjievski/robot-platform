"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, RotateCcwIcon } from "lucide-react";
import { FieldRenderer } from "./field-renderer";
import type { FieldDefinition } from "@robot/config/parameters";

interface NestedObjectFieldProps {
  name: string;
  label: string;
  description: string;
  value: Record<string, unknown> | undefined;
  defaultValue?: Record<string, unknown>;
  fields: FieldDefinition[];
  onChange: (value: Record<string, unknown> | undefined) => void;
}

export function NestedObjectField({ name, label, description, value, defaultValue, fields, onChange }: NestedObjectFieldProps) {
  const [open, setOpen] = useState(false);
  const obj = value ?? defaultValue ?? {};
  const isOverridden = value !== undefined;
  const defaults = defaultValue ?? {};

  return (
    <div style={{ borderBottom: '1px solid var(--ws-border-subtle)' }}>
      {/* Header row */}
      <div
        className="ws-field-row"
        data-overridden={isOverridden}
        style={{ cursor: 'pointer', borderBottom: open ? '1px solid var(--ws-border-subtle)' : undefined }}
        onClick={() => setOpen(!open)}
      >
        {isOverridden && (
          <button
            type="button"
            className="ws-field-reset"
            onClick={(e) => { e.stopPropagation(); onChange(undefined); }}
            title="Reset to default"
          >
            <RotateCcwIcon className="size-2.5" />
          </button>
        )}
        <label className="ws-field-label flex items-center gap-1" title={description}>
          {open ? <ChevronDownIcon className="size-3 shrink-0" /> : <ChevronRightIcon className="size-3 shrink-0" />}
          {label}
        </label>
        <span className="ws-badge ws-badge-gray" style={{ justifySelf: 'start', marginTop: 3 }}>
          object
        </span>
      </div>

      {/* Nested fields */}
      {open && (
        <div style={{ paddingLeft: 8, background: 'var(--ws-surface-raised)' }}>
          {fields.map((field) => (
            <FieldRenderer
              key={field.name}
              definition={field}
              value={obj[field.name]}
              defaultValue={defaults[field.name]}
              onChange={(v) => {
                const next = Object.fromEntries(
                  Object.entries({ ...obj, [field.name]: v }).filter(([, val]) => val !== undefined)
                );
                onChange(Object.keys(next).length === 0 ? undefined : next);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
