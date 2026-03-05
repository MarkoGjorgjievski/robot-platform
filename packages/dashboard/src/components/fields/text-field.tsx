"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

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

export function TextField({ name, label, description, value, defaultValue, onChange, multiline, monospace }: TextFieldProps) {
  const isOverridden = value !== undefined && value !== defaultValue;
  const displayValue = value ?? "";
  const Comp = multiline ? Textarea : Input;

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
      <Comp
        id={name}
        value={displayValue}
        placeholder={defaultValue ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? undefined : v);
        }}
        className={monospace ? "font-mono text-xs" : undefined}
      />
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
