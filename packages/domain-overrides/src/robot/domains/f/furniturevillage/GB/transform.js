/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    product_variations: (text) => {
      if (!text.includes('https')) return null;
      return text;
    },
  };

  const mappingFct = (header, arr) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header]);
  })));
  return data;
};

module.exports = { cleanUp };
