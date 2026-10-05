import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { toXlsx } from './xlsx.js';

async function readBack(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  // Two @types/node resolutions in this workspace disagree on the exact
  // `Buffer` generic shape; the value itself is a real Buffer at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  return workbook.getWorksheet('Data')!;
}

describe('toXlsx', () => {
  it('round-trips a header row and two data rows on a sheet named Data', async () => {
    const buffer = await toXlsx(
      ['title', 'price'],
      [
        { title: 'Kallax', price: 79 },
        { title: 'Billy', price: 49 },
      ],
      { price: 'money' },
    );
    const sheet = await readBack(buffer);

    expect(sheet.getRow(1).getCell(1).value).toBe('title');
    expect(sheet.getRow(1).getCell(2).value).toBe('price');
    expect(sheet.getRow(2).getCell(1).value).toBe('Kallax');
    expect(sheet.getRow(2).getCell(2).value).toBe(79);
    expect(sheet.getRow(3).getCell(1).value).toBe('Billy');
    expect(sheet.getRow(3).getCell(2).value).toBe(49);
  });

  it('stores a numeric-looking string as a real number when the column type is number or money', async () => {
    const buffer = await toXlsx(['price'], [{ price: '79.50' }], { price: 'money' });
    const sheet = await readBack(buffer);
    const value = sheet.getRow(2).getCell(1).value;
    expect(value).toBe(79.5);
    expect(typeof value).toBe('number');
  });

  it('keeps a text column as text even when the value looks numeric', async () => {
    const buffer = await toXlsx(['sku'], [{ sku: '0123' }], { sku: 'text' });
    const sheet = await readBack(buffer);
    expect(sheet.getRow(2).getCell(1).value).toBe('0123');
  });

  it('bolds the header row and freezes it', async () => {
    const buffer = await toXlsx(['title'], [{ title: 'Kallax' }]);
    const sheet = await readBack(buffer);
    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.views).toEqual([expect.objectContaining({ state: 'frozen', ySplit: 1 })]);
  });

  it('writes null for a missing or null cell', async () => {
    const buffer = await toXlsx(['title', 'rating'], [{ title: 'Kallax' }]);
    const sheet = await readBack(buffer);
    expect(sheet.getRow(2).getCell(2).value).toBeNull();
  });

  it('writes an array value as JSON text in one cell', async () => {
    const buffer = await toXlsx(['variants'], [{ variants: ['red', 'blue'] }]);
    const sheet = await readBack(buffer);
    expect(sheet.getRow(2).getCell(1).value).toBe('["red","blue"]');
  });

  it('writes a header-only sheet when there are no rows', async () => {
    const buffer = await toXlsx(['title'], []);
    const sheet = await readBack(buffer);
    expect(sheet.rowCount).toBe(1);
  });
});
