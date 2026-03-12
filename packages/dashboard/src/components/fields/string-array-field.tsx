"use client";

import { PlusIcon, XIcon, RotateCcwIcon } from "lucide-react";

interface StringArrayFieldProps {
  name: string;
  label: string;
  description: string;
  value: string[] | undefined;
  defaultValue?: string[];
  onChange: (value: string[] | undefined) => void;
  monospace?: boolean;
}

export function StringArrayField({ name, label, description, value, defaultValue, onChange, monospace }: StringArrayFieldProps) {
  const items = value ?? defaultValue ?? [];
  const isOverridden = value !== undefined;

  return (
    <div className="ws-field-row" data-overridden={isOverridden} style={{ alignItems: 'start' }}>
      {isOverridden && (
        <button
          type="button"
          className="ws-field-reset"
          onClick={() => onChange(undefined)}
          title="Reset to default"
        >
          <RotateCcwIcon className="size-2.5" />
        </button>
      )}
      <label className="ws-field-label" title={description}>
        {label}
        <span className="ml-1 text-[0.55rem]" style={{ color: 'var(--ws-text-dim)' }}>
          [{items.length}]
        </span>
      </label>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              value={item}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
              className="w-full rounded px-2 py-1"
            />
            <button
              type="button"
              onClick={() => {
                const next = items.filter((_, j) => j !== i);
                onChange(next.length === 0 && (!defaultValue || defaultValue.length === 0) ? undefined : next);
              }}
              className="shrink-0 rounded p-0.5 transition-colors"
              style={{ color: 'var(--ws-text-dim)' }}
            >
              <XIcon className="size-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...items, ""])}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6rem] transition-colors"
          style={{ color: 'var(--ws-text-muted)', background: 'var(--ws-surface-hover)' }}
        >
          <PlusIcon className="size-2.5" /> Add
        </button>
      </div>
    </div>
  );
}
