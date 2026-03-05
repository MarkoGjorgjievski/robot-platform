/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const dimensionRegex = /(\d+)\s*x?\s*(\d+)?\s*x?\s*(\d+)?/m;
  const dimensionRegexTitle = /(\d+)\s*x?\s*(\d+)?\s*x?\s*(\d+)?cm/m;
  const emptyDimensions = (row) => {
    if (row.width?.[0]?.text && row.width?.[0]?.text !== 'null') return false;
    if (row.length?.[0]?.text && row.length?.[0]?.text !== 'null') return false;
    return !(row.height?.[0]?.text && row.height?.[0]?.text !== 'null');
  };
  const resolveDimension = (text, row, index) => {
    if (text === 'null') {
      if (row.dimensions_raw?.[0]?.text !== undefined) {
        const match = row.dimensions_raw?.[0]?.text.match(dimensionRegex);
        if (match && match[index] !== undefined) { return match[index]; }
      } else if (emptyDimensions(row) && row.product_title?.[0]?.text !== undefined) {
        const match = row.product_title?.[0]?.text.match(dimensionRegexTitle);
        if (match && match[index] !== undefined) { return match[index]; }
      }
      return null;
    }
    return text;
  };
  const mapping = {
    width: (text, row) => resolveDimension(text, row, 1),
    length: (text, row) => resolveDimension(text, row, 2),
    height: (text, row) => resolveDimension(text, row, 3),
    materials: text => (text.match(/%.*%/) ? `material: ${text}` : text),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
