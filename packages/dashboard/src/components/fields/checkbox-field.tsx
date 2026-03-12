"use client";

import { RotateCcwIcon } from "lucide-react";

interface CheckboxFieldProps {
  name: string;
  label: string;
  description: string;
  value: boolean | undefined;
  defaultValue?: boolean;
  onChange: (value: boolean | undefined) => void;
}

export function CheckboxField({ name, label, description, value, defaultValue, onChange }: CheckboxFieldProps) {
  const isOverridden = value !== undefined && value !== defaultValue;
  const checked = value ?? defaultValue ?? false;

  return (
    <div className="ws-field-row" data-overridden={isOverridden}>
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
      <label className="ws-field-label" title={description} htmlFor={name}>
        {label}
      </label>
      <div className="flex items-center py-1">
        <button
          id={name}
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => {
            const next = !checked;
            onChange(next === defaultValue ? undefined : next);
          }}
          className="relative h-4 w-7 rounded-full transition-colors"
          style={{
            background: checked ? 'var(--ws-accent)' : 'var(--ws-surface-hover)',
          }}
        >
          <span
            className="absolute top-0.5 left-0.5 h-3 w-3 rounded-full transition-transform"
            style={{
              background: '#fff',
              transform: checked ? 'translateX(12px)' : 'translateX(0)',
            }}
          />
        </button>
      </div>
    </div>
  );
}
