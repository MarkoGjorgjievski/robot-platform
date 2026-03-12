"use client";

import { RotateCcwIcon } from "lucide-react";

interface TextFieldProps {
  name: string;
  label: string;
  description: string;
  value: string | undefined;
  defaultValue?: string;
  onChange: (value: string | undefined) => void;
  multiline?: boolean;
  monospace?: boolean;
}

export function TextField({ name, label, description, value, defaultValue, onChange, multiline }: TextFieldProps) {
  const isOverridden = value !== undefined && value !== defaultValue;
  const displayValue = value ?? "";

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
      {multiline ? (
        <textarea
          id={name}
          value={displayValue}
          placeholder={defaultValue ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? undefined : v);
          }}
          rows={2}
          className="w-full resize-y rounded px-2 py-1"
        />
      ) : (
        <input
          id={name}
          value={displayValue}
          placeholder={defaultValue ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? undefined : v);
          }}
          className="w-full rounded px-2 py-1"
        />
      )}
    </div>
  );
}
