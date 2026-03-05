/**
 * Cleans up data by applying specific transformations.
 *
 * @param {ImportIO.Group[]} data - The data to be cleaned.
 * @returns {ImportIO.Group[]} The cleaned data.
 */
const cleanUp = (data) => {
  const stockPatterns = ['wysoka', 'niska', 'średnia', 'bardzo wysoka'];

  const mapping = {
    stock_availability: (text) => {
      if (stockPatterns.includes(text)) {
        return 'yes';
      }
      return 'no';
    },
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
