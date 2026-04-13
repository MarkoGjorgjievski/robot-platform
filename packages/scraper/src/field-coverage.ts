import type { SchemaField } from '@robot/agent';

export function calculateFieldCoverage(
  data: Record<string, unknown>[],
  fields: SchemaField[],
): number {
  if (data.length === 0 || fields.length === 0) return 0;

  let totalCoverage = 0;
  for (const row of data) {
    let filled = 0;
    for (const field of fields) {
      if (row[field.name] !== undefined && row[field.name] !== null) {
        filled++;
      }
    }
    totalCoverage += filled / fields.length;
  }

  return totalCoverage / data.length;
}

export function getMissingFields(
  data: Record<string, unknown>[],
  fields: SchemaField[],
): string[] {
  if (data.length === 0) return fields.map(f => f.name);

  return fields
    .filter(field => {
      const presentCount = data.filter(
        row => row[field.name] !== undefined && row[field.name] !== null,
      ).length;
      return presentCount <= data.length * 0.5;
    })
    .map(f => f.name);
}
