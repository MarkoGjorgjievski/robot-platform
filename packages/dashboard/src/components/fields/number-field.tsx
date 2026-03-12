"use client";

import { RotateCcwIcon } from "lucide-react";

interface NumberFieldProps {
  name: string;
  label: string;
  description: string;
  value: number | undefined;
  defaultValue?: number;
  onChange: (value: number | undefined) => void;
  suffix?: string;
}

export function NumberField({ name, label, description, value, defaultValue, onChange, suffix }: NumberFieldProps) {
  const isOverridden = value !== undefined && value !== defaultValue;

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
      <div className="flex items-center gap-1.5">
        <input
          id={name}
          type="number"
          value={value ?? ""}
          placeholder={defaultValue !== undefined ? String(defaultValue) : ""}
          onChange={(e) => {
            const v = e.target.value;
            const num = Number(v);
            onChange(v === "" || Number.isNaN(num) ? undefined : num);
          }}
          className="w-full rounded px-2 py-1"
        />
        {suffix && (
          <span className="shrink-0 text-[0.6rem]" style={{ color: 'var(--ws-text-dim)' }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}
