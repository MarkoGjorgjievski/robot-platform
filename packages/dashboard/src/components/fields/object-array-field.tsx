"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, XIcon, RotateCcwIcon } from "lucide-react";
import { FieldRenderer } from "./field-renderer";
import type { FieldDefinition } from "@robot/config/parameters";

interface ObjectArrayFieldProps {
  name: string;
  label: string;
  description: string;
  value: Record<string, unknown>[] | undefined;
  defaultValue?: Record<string, unknown>[];
  fields: FieldDefinition[];
  onChange: (value: Record<string, unknown>[] | undefined) => void;
}

export function ObjectArrayField({ name, label, description, value, defaultValue, fields, onChange }: ObjectArrayFieldProps) {
  const items = value ?? defaultValue ?? [];
  const isOverridden = value !== undefined;
  const [openItems, setOpenItems] = useState<Record<number, boolean>>({});
  const [open, setOpen] = useState(false);

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
        <div className="flex items-center gap-1.5" style={{ marginTop: 3 }}>
          <span className="ws-badge ws-badge-gray">
            {items.length} items
          </span>
        </div>
      </div>

      {/* Items */}
      {open && (
        <div style={{ background: 'var(--ws-surface-raised)' }}>
          {items.map((item, i) => {
            const itemOpen = openItems[i] ?? false;
            const preview = item.selectorOrXpath
              ? String(item.selectorOrXpath).slice(0, 30)
              : item.inputName
              ? String(item.inputName)
              : `Item ${i + 1}`;

            return (
              <div key={i} style={{ borderBottom: '1px solid var(--ws-border-subtle)' }}>
                {/* Item header */}
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5 cursor-pointer"
                  style={{ paddingLeft: 20 }}
                  onClick={() => setOpenItems({ ...openItems, [i]: !itemOpen })}
                >
                  {itemOpen ? (
                    <ChevronDownIcon className="size-3 shrink-0" style={{ color: 'var(--ws-text-dim)' }} />
                  ) : (
                    <ChevronRightIcon className="size-3 shrink-0" style={{ color: 'var(--ws-text-dim)' }} />
                  )}
                  <span className="flex-1 truncate text-xs" style={{ color: 'var(--ws-text-muted)' }}>
                    {preview}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = items.filter((_, j) => j !== i);
                      onChange(next.length === 0 ? undefined : next);
                    }}
                    className="rounded p-0.5 transition-opacity opacity-0 hover:opacity-100"
                    style={{ color: 'var(--ws-danger)' }}
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>

                {/* Item fields */}
                {itemOpen && (
                  <div style={{ paddingLeft: 16 }}>
                    {fields.map((field) => (
                      <FieldRenderer
                        key={field.name}
                        definition={field}
                        value={item[field.name]}
                        defaultValue={undefined}
                        onChange={(v) => {
                          const next = [...items];
                          next[i] = { ...next[i], [field.name]: v };
                          onChange(next);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Add button */}
          <div className="px-3 py-2" style={{ paddingLeft: 20 }}>
            <button
              type="button"
              onClick={() => onChange([...items, {}])}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6rem] transition-colors"
              style={{ color: 'var(--ws-text-muted)', background: 'var(--ws-surface-hover)' }}
            >
              <PlusIcon className="size-2.5" /> Add item
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
