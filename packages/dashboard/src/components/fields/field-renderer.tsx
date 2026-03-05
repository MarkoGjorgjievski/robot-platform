"use client";

import type { FieldDefinition } from "@robot/config";
import { TextField } from "./text-field";
import { NumberField } from "./number-field";
import { CheckboxField } from "./checkbox-field";
import { SelectField } from "./select-field";
import { StringArrayField } from "./string-array-field";
import { ObjectArrayField } from "./object-array-field";
import { NestedObjectField } from "./nested-object-field";

interface FieldRendererProps {
  definition: FieldDefinition;
  value: unknown;
  defaultValue: unknown;
  onChange: (value: unknown) => void;
}

export function FieldRenderer({ definition, value, defaultValue, onChange }: FieldRendererProps) {
  const { name, type, description, records, enumOptions } = definition;
  const label = name;

  switch (type) {
    case 'string':
    case 'regex':
      return (
        <TextField
          name={name}
          label={label}
          description={description}
          value={value as string | undefined}
          defaultValue={defaultValue as string | undefined}
          onChange={onChange}
        />
      );

    case 'xpath':
    case 'css':
    case 'cssOrXpath':
      return (
        <TextField
          name={name}
          label={label}
          description={description}
          value={value as string | undefined}
          defaultValue={defaultValue as string | undefined}
          onChange={onChange}
          monospace
          multiline={type === 'xpath'}
        />
      );

    case 'number':
      return (
        <NumberField
          name={name}
          label={label}
          description={description}
          value={value as number | undefined}
          defaultValue={defaultValue as number | undefined}
          onChange={onChange}
        />
      );

    case 'time':
      return (
        <NumberField
          name={name}
          label={label}
          description={description}
          value={value as number | undefined}
          defaultValue={defaultValue as number | undefined}
          onChange={onChange}
          suffix="ms"
        />
      );

    case 'boolean':
      return (
        <CheckboxField
          name={name}
          label={label}
          description={description}
          value={value as boolean | undefined}
          defaultValue={defaultValue as boolean | undefined}
          onChange={onChange}
        />
      );

    case 'enum':
      return (
        <SelectField
          name={name}
          label={label}
          description={description}
          value={value as string | undefined}
          defaultValue={defaultValue as string | undefined}
          options={enumOptions ?? []}
          onChange={onChange}
        />
      );

    case 'array': {
      if (Array.isArray(records)) {
        return (
          <ObjectArrayField
            name={name}
            label={label}
            description={description}
            value={value as Record<string, unknown>[] | undefined}
            defaultValue={defaultValue as Record<string, unknown>[] | undefined}
            fields={records}
            onChange={onChange}
          />
        );
      }
      // Simple string/xpath/css array
      const isMonospace = records === 'css' || records === 'xpath' || records === 'cssOrXpath';
      return (
        <StringArrayField
          name={name}
          label={label}
          description={description}
          value={value as string[] | undefined}
          defaultValue={defaultValue as string[] | undefined}
          onChange={onChange}
          monospace={isMonospace}
        />
      );
    }

    case 'object':
    case 'paginate': {
      const fields = Array.isArray(records) ? records : [];
      return (
        <NestedObjectField
          name={name}
          label={label}
          description={description}
          value={value as Record<string, unknown> | undefined}
          defaultValue={defaultValue as Record<string, unknown> | undefined}
          fields={fields}
          onChange={onChange}
        />
      );
    }

    default:
      return (
        <TextField
          name={name}
          label={label}
          description={description}
          value={value != null ? String(value) : undefined}
          defaultValue={defaultValue != null ? String(defaultValue) : undefined}
          onChange={onChange}
        />
      );
  }
}
