/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const regex = /^(?:\d+)?(?:px|em|%|rem|cm|mm|in|pt|pc|vh|vw|vmin|vmax)$/i;
  const mapping = {
    // productURL: text => `https://www.blomsterlandet.se/${text}`,
    stock_availability: text => (text === 'yes' ? 'yes' : 'no'),
    dimensions_unit: (text, row) => row.dimensions_unit.find(val => regex.test(val))?.[0]?.text || null,
    product_variations: text => (text ? `https://www.blomsterlandet.se/${text}` : null),
    height: text =>
      // const height = +text
      // return typeof height === 'number' ? height.toString().trim() : null
      // eslint-disable-next-line implicit-arrow-linebreak
      text,
    width: text =>
      // const width = +text
      // return typeof width === 'number' ? width.toString().trim() : null
      // eslint-disable-next-line implicit-arrow-linebreak
      text,
    length: text =>
      // const length = +text
      // return typeof length === 'number' ? length.toString().trim() : null
      // eslint-disable-next-line implicit-arrow-linebreak
      text,
    diameter: text => text,
  };
  const mappingFct = (header, arr, row) => [...arr.map(({
    text,
    ...other
  }) => ({ text: mapping[header](text, row), ...other }))];
  data.forEach(obj => obj.group.forEach(row => Object.keys(row)
    .forEach((header) => {
      // eslint-disable-next-line no-param-reassign
      if (mapping[header]) row[header] = mappingFct(header, row[header], row);
    })));

  return data;
};

module.exports = { cleanUp };
