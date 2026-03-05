"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PlusIcon, XIcon } from "lucide-react";

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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        {isOverridden ? (
          <Badge variant="default" className="text-[10px] px-1.5 py-0">overridden</Badge>
        ) : null}
      </div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={item}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
              className={monospace ? "font-mono text-xs" : undefined}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                const next = items.filter((_, j) => j !== i);
                onChange(next.length === 0 && (!defaultValue || defaultValue.length === 0) ? undefined : next);
              }}
            >
              <XIcon /><span className="sr-only">Remove item</span>
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...items, ""])}
      >
        <PlusIcon /> Add item
      </Button>
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
