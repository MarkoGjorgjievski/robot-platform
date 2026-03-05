"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor={name}>{label}</Label>
        {isOverridden ? (
          <Badge variant="default" className="text-[10px] px-1.5 py-0">overridden</Badge>
        ) : value !== undefined ? (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">inherited</Badge>
        ) : null}
      </div>
      <Select
        value={displayValue}
        onValueChange={(v) => {
          onChange(v === defaultValue ? undefined : v);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={defaultValue ?? "Select..."} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
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
