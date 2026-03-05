/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const getWithoutDuplicates = (values) => {
    if (values !== undefined) {
      const output = new Set();
      values.map(v => v.text?.split(',').forEach(s => output.add(s.trim())));
      return Array.from(output)?.join(', ');
    }
    return null;
  };

  const parseNumber = (text) => {
    if (text === undefined) return null;
    const number = Number(text
      .replace(',', '.')
      // take the last number value (in case of ranges)
      .match(/[\d.]+/)?.slice(-1));
    return !Number.isNaN(number) ? String(number) : null;
  };
  const resolveDimension = (text, pattern) => {
    if (text.includes('/')) {
      const parts = text?.split(': ');
      const titles = parts[0]?.split('/');
      const values = parts?.[1]?.split('/');
      const index = titles?.findIndex(title => title.includes(pattern));
      return parseNumber(values?.[index]);
    }
    return parseNumber(text);
  };

  const getDiemsionFromRaw = (row, index) => {
    const values = row.dimensions_raw?.[0]?.text?.split('/');
    return parseNumber(values?.[index]);
  };

  const mapping = {
    length: (text, row) => resolveDimension(text, 'dĺžka') || getDiemsionFromRaw(row, 0),
    width: (text, row) => resolveDimension(text, 'šírka') || getDiemsionFromRaw(row, 1),
    height: (text, row) => resolveDimension(text, 'výška') || getDiemsionFromRaw(row, 2),
    depth: text => resolveDimension(text, 'hĺbka'),
    diameter: text => resolveDimension(text, 'priemer'),
    offer_price: text => text.replace(/\./g, '').replace(',', '.'),
    original_price: text => text.replace(/\./g, '').replace(',', '.'),
    // encode spaces in URLs
    product_variations: text => text.replace(/ /g, '%20'),
    colour: (text, row) => getWithoutDuplicates(row.colour_raw) || ((row.colour_raw_backup?.[0].text) ? row.colour_raw_backup?.[0]?.text : null),
    materials: (text, row) => {
      if (text === 'empty') {
        return row.materials_backup?.map(m => m.text)?.join(', ') || null;
      }
      return text;
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({
    text: mapping[header](text, row),
    ...other,
  }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
