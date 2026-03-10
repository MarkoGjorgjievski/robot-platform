"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";
import { FieldRenderer } from "./field-renderer";
import type { FieldDefinition } from "@robot/config/parameters";

interface ObjectArrayFieldProps {
  name: string;
  label: string;
  description: string;
  value: Record<string, unknown>[] | undefined;
  defaultValue?: Record<string, unknown>[];
  fields: FieldDefinition[];
  onChange: (value: Record<string, unknown>[] | undefined) => void;
}

export function ObjectArrayField({ name, label, description, value, defaultValue, fields, onChange }: ObjectArrayFieldProps) {
  const items = value ?? defaultValue ?? [];
  const isOverridden = value !== undefined;
  const [openItems, setOpenItems] = useState<Record<number, boolean>>({});

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        {isOverridden ? (
          <Badge variant="default" className="text-[10px] px-1.5 py-0">overridden</Badge>
        ) : null}
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{items.length}</Badge>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <Collapsible
            key={i}
            open={openItems[i] ?? false}
            onOpenChange={(open) => setOpenItems({ ...openItems, [i]: open })}
          >
            <div className="flex items-center gap-2 rounded-md border px-3 py-2">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon-xs">
                  <ChevronDownIcon className={`transition-transform ${openItems[i] ? "rotate-180" : ""}`} />
                </Button>
              </CollapsibleTrigger>
              <span className="text-sm font-medium flex-1">
                Item {i + 1}{item.selectorOrXpath ? `: ${String(item.selectorOrXpath).slice(0, 40)}` : item.inputName ? `: ${String(item.inputName)}` : ""}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => {
                  const next = items.filter((_, j) => j !== i);
                  onChange(next.length === 0 ? undefined : next);
                }}
              >
                <XIcon /><span className="sr-only">Remove item</span>
              </Button>
            </div>
            <CollapsibleContent>
              <div className="ml-4 border-l pl-4 pt-2 space-y-3">
                {fields.map((field) => (
                  <FieldRenderer
                    key={field.name}
                    definition={field}
                    value={item[field.name]}
                    defaultValue={undefined}
                    onChange={(v) => {
                      const next = [...items];
                      next[i] = { ...next[i], [field.name]: v };
                      onChange(next);
                    }}
                  />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...items, {}])}
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
