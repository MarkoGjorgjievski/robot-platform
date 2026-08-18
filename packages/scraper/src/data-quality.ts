import type { SchemaField } from '@robot/agent';

export type QualityIssue = {
  field: string;
  row?: number;
  type: 'warning' | 'error';
  message: string;
  autoFixed?: boolean;
  originalValue?: unknown;
};

export type QualityResult = {
  data: Record<string, unknown>[];
  issues: QualityIssue[];
};

export function validateExtractedData(
  data: Record<string, unknown>[],
  fields: SchemaField[],
): QualityResult {
  if (data.length === 0 || fields.length === 0) {
    return { data, issues: [] };
  }

  const issues: QualityIssue[] = [];
  const cleaned = data.map((row, rowIdx) => {
    const newRow = { ...row };
    for (const field of fields) {
      if (newRow[field.name] === undefined || newRow[field.name] === null) continue;
      const result = validateField(field, newRow[field.name], data.length > 1 ? rowIdx : undefined);
      newRow[field.name] = result.value;
      issues.push(...result.issues);
    }
    return newRow;
  });

  // Cross-row checks for listings
  if (cleaned.length > 1) {
    issues.push(...checkCrossRow(cleaned, fields));
  }

  return { data: cleaned, issues };
}

function validateField(
  field: SchemaField,
  value: unknown,
  row: number | undefined,
): { value: unknown; issues: QualityIssue[] } {
  switch (field.type) {
    case 'price': return validatePrice(field.name, value, row);
    case 'string': return validateString(field.name, value, row);
    case 'url':
    case 'image_url': return validateUrl(field.name, value, row);
    case 'number': return validateNumber(field.name, value, row);
    case 'boolean': return validateBoolean(field.name, value, row);
    case 'date': return validateDate(field.name, value, row);
    case 'array': return validateArray(field.name, value, row);
    default: return { value, issues: [] };
  }
}

/**
 * Clean each element of a list field.
 *
 * `array` used to fall through to the default no-op, so list values were never
 * cleaned at all — and list fields are exactly where markup shows up. Newegg
 * returns `specifications` and `bullet_points` as `<b>…</b>…<br/>` strings.
 */
function validateArray(
  name: string,
  value: unknown,
  row: number | undefined,
): { value: unknown; issues: QualityIssue[] } {
  if (!Array.isArray(value)) return { value, issues: [] };

  const issues: QualityIssue[] = [];
  const cleaned: unknown[] = [];

  for (const item of value) {
    if (typeof item !== 'string') {
      cleaned.push(item);
      continue;
    }
    const result = validateString(name, item, row);
    // An element that is empty once stripped carried only markup — drop it rather
    // than leave a blank entry in the list.
    if (typeof result.value === 'string' && result.value === '') continue;
    cleaned.push(result.value);
    issues.push(...result.issues.filter((i) => i.type !== 'error'));
  }

  return { value: cleaned, issues };
}

function validatePrice(
  name: string,
  value: unknown,
  row: number | undefined,
): { value: unknown; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];
  let parsed = value;

  // Auto-fix: strip currency symbols and parse
  if (typeof value === 'string') {
    const stripped = value.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
    const num = parseFloat(stripped);
    if (isNaN(num)) {
      issues.push({ field: name, row, type: 'error', message: `Price is not a valid number: "${value}"` });
      return { value, issues };
    }
    parsed = num;
    issues.push({
      field: name,
      row,
      type: 'warning',
      message: `Price parsed from string "${value}" to ${num}`,
      autoFixed: true,
      originalValue: value,
    });
  }

  if (typeof parsed !== 'number' || isNaN(parsed)) {
    issues.push({ field: name, row, type: 'error', message: `Price is not a number` });
    return { value, issues };
  }

  if (parsed < 0) {
    issues.push({ field: name, row, type: 'error', message: `Price is negative: ${parsed}` });
  } else if (parsed === 0) {
    issues.push({ field: name, row, type: 'warning', message: `Price is zero (may be intentional)` });
  } else if (parsed > 1_000_000) {
    issues.push({ field: name, row, type: 'error', message: `Price is unreasonably high: ${parsed}` });
  }

  return { value: parsed, issues };
}

function validateString(
  name: string,
  value: unknown,
  row: number | undefined,
): { value: unknown; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];
  if (typeof value !== 'string') return { value, issues };

  // Auto-fix: strip HTML tags
  const stripped = value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (stripped !== value) {
    if (stripped === '') {
      issues.push({ field: name, row, type: 'error', message: 'String is empty after stripping HTML' });
      return { value: stripped, issues };
    }
    issues.push({
      field: name, row, type: 'warning',
      message: `Stripped HTML tags from value`,
      autoFixed: true, originalValue: value,
    });
    value = stripped;
  }

  if (typeof value === 'string' && value.length > 5000) {
    issues.push({ field: name, row, type: 'warning', message: `String is very long (${value.length} chars) — may be wrong element` });
  }

  return { value, issues };
}

function validateUrl(
  name: string,
  value: unknown,
  row: number | undefined,
): { value: unknown; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];
  if (typeof value !== 'string') {
    issues.push({ field: name, row, type: 'error', message: 'URL is not a string' });
    return { value, issues };
  }

  // Auto-fix: trim whitespace
  const trimmed = value.trim();
  if (trimmed !== value) {
    issues.push({
      field: name, row, type: 'warning',
      message: 'Trimmed whitespace from URL',
      autoFixed: true, originalValue: value,
    });
    value = trimmed;
  }

  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    issues.push({ field: name, row, type: 'error', message: `URL does not start with http(s): "${trimmed.slice(0, 60)}"` });
    return { value, issues };
  }

  try {
    new URL(trimmed);
  } catch {
    issues.push({ field: name, row, type: 'error', message: `URL is not parseable: "${trimmed.slice(0, 60)}"` });
  }

  return { value, issues };
}

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function validateNumber(
  name: string,
  value: unknown,
  row: number | undefined,
): { value: unknown; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];
  let parsed = value;

  if (typeof value === 'string') {
    // Try word-to-number first (e.g. "star-rating Three" → 3)
    const wordMatch = value.toLowerCase().match(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
    if (wordMatch && WORD_NUMBERS[wordMatch[1]] !== undefined) {
      const num = WORD_NUMBERS[wordMatch[1]];
      issues.push({
        field: name, row, type: 'warning',
        message: `Parsed word number from "${value}" to ${num}`,
        autoFixed: true, originalValue: value,
      });
      return { value: num, issues };
    }

    const stripped = value.replace(/,/g, '');
    const num = parseFloat(stripped);
    if (isNaN(num)) {
      issues.push({ field: name, row, type: 'error', message: `Not a valid number: "${value}"` });
      return { value, issues };
    }
    parsed = num;
    issues.push({
      field: name, row, type: 'warning',
      message: `Parsed number from string "${value}" to ${num}`,
      autoFixed: true, originalValue: value,
    });
  }

  if (typeof parsed !== 'number' || isNaN(parsed)) {
    issues.push({ field: name, row, type: 'error', message: 'Not a number' });
    return { value, issues };
  }

  if (Math.abs(parsed) > 1e9) {
    issues.push({ field: name, row, type: 'error', message: `Number is unreasonably large: ${parsed}` });
  }

  return { value: parsed, issues };
}

const TRUTHY = new Set(['yes', 'true', '1']);
const FALSY = new Set(['no', 'false', '0']);

function validateBoolean(
  name: string,
  value: unknown,
  row: number | undefined,
): { value: unknown; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];

  if (typeof value === 'boolean') return { value, issues };

  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (TRUTHY.has(lower)) {
      issues.push({
        field: name, row, type: 'warning',
        message: `Converted "${value}" to true`,
        autoFixed: true, originalValue: value,
      });
      return { value: true, issues };
    }
    if (FALSY.has(lower)) {
      issues.push({
        field: name, row, type: 'warning',
        message: `Converted "${value}" to false`,
        autoFixed: true, originalValue: value,
      });
      return { value: false, issues };
    }
  }

  issues.push({ field: name, row, type: 'error', message: `Cannot convert to boolean: "${value}"` });
  return { value, issues };
}

function validateDate(
  name: string,
  value: unknown,
  row: number | undefined,
): { value: unknown; issues: QualityIssue[] } {
  const issues: QualityIssue[] = [];
  if (typeof value !== 'string') {
    issues.push({ field: name, row, type: 'error', message: 'Date is not a string' });
    return { value, issues };
  }

  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    issues.push({ field: name, row, type: 'error', message: `Cannot parse date: "${value}"` });
    return { value, issues };
  }

  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
  if (parsed > oneYearFromNow) {
    issues.push({ field: name, row, type: 'warning', message: `Date is far in the future: ${value}` });
  }

  return { value, issues };
}

function checkCrossRow(
  data: Record<string, unknown>[],
  fields: SchemaField[],
): QualityIssue[] {
  const issues: QualityIssue[] = [];

  for (const field of fields) {
    const values = data.map(row => row[field.name]);
    const nonNull = values.filter(v => v !== undefined && v !== null);

    // All rows identical
    if (nonNull.length > 1 && nonNull.every(v => JSON.stringify(v) === JSON.stringify(nonNull[0]))) {
      issues.push({
        field: field.name,
        type: 'warning',
        message: `All ${nonNull.length} rows have identical value — likely wrong selector`,
      });
    }

    // Required field missing in > 50% of rows
    if (field.required && nonNull.length < data.length * 0.5) {
      issues.push({
        field: field.name,
        type: 'warning',
        message: `Required field missing in ${data.length - nonNull.length}/${data.length} rows`,
      });
    }
  }

  return issues;
}
