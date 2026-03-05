"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor={name}>{label}</Label>
        {isOverridden ? (
          <Badge variant="default" className="text-[10px] px-1.5 py-0">overridden</Badge>
        ) : value !== undefined ? (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">inherited</Badge>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Input
          id={name}
          type="number"
          value={value ?? ""}
          placeholder={defaultValue !== undefined ? String(defaultValue) : ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? undefined : Number(v));
          }}
        />
        {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
      </div>
      {isOverridden && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Reset to default
        </button>
      )}
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
