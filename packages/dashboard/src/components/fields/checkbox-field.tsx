"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

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
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Checkbox
          id={name}
          checked={checked}
          onCheckedChange={(c) => {
            const boolVal = c === true;
            onChange(boolVal === defaultValue ? undefined : boolVal);
          }}
        />
        <Label htmlFor={name} className="cursor-pointer">{label}</Label>
        {isOverridden ? (
          <Badge variant="default" className="text-[10px] px-1.5 py-0">overridden</Badge>
        ) : value !== undefined ? (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">inherited</Badge>
        ) : null}
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
