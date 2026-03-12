"use client";

import { RotateCcwIcon } from "lucide-react";

interface SelectFieldProps {
  name: string;
  label: string;
  description: string;
  value: string | undefined;
  defaultValue?: string;
  options: string[];
  onChange: (value: string | undefined) => void;
}

export function SelectField({ name, label, description, value, defaultValue, options, onChange }: SelectFieldProps) {
  const isOverridden = value !== undefined && value !== defaultValue;
  const displayValue = value ?? defaultValue ?? "";

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
      <select
        id={name}
        value={displayValue}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === defaultValue ? undefined : v);
        }}
        className="w-full rounded px-2 py-1"
      >
        <option value="">{defaultValue ? `${defaultValue} (default)` : "Select..."}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}
