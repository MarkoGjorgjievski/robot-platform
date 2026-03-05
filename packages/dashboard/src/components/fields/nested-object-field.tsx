"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDownIcon } from "lucide-react";
import { FieldRenderer } from "./field-renderer";
import type { FieldDefinition } from "@robot/config";

interface NestedObjectFieldProps {
  name: string;
  label: string;
  description: string;
  value: Record<string, unknown> | undefined;
  defaultValue?: Record<string, unknown>;
  fields: FieldDefinition[];
  onChange: (value: Record<string, unknown> | undefined) => void;
}

export function NestedObjectField({ name, label, description, value, defaultValue, fields, onChange }: NestedObjectFieldProps) {
  const [open, setOpen] = useState(false);
  const obj = value ?? defaultValue ?? {};
  const isOverridden = value !== undefined;
  const defaults = defaultValue ?? {};

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon-xs">
            <ChevronDownIcon className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <Label>{label}</Label>
        {isOverridden ? (
          <Badge variant="default" className="text-[10px] px-1.5 py-0">overridden</Badge>
        ) : null}
      </div>
      <CollapsibleContent>
        <div className="ml-4 border-l pl-4 pt-2 space-y-3">
          {fields.map((field) => (
            <FieldRenderer
              key={field.name}
              definition={field}
              value={obj[field.name]}
              defaultValue={defaults[field.name]}
              onChange={(v) => {
                const next = Object.fromEntries(
                  Object.entries({ ...obj, [field.name]: v }).filter(([, val]) => val !== undefined)
                );
                onChange(Object.keys(next).length === 0 ? undefined : next);
              }}
            />
          ))}
        </div>
      </CollapsibleContent>
      {isOverridden && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="text-xs text-muted-foreground hover:text-foreground ml-7"
        >
          Reset to default
        </button>
      )}
      <p className="text-xs text-muted-foreground ml-7">{description}</p>
    </Collapsible>
  );
}
