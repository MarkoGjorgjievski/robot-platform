/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const replaceNonDigits = text => text.replace(/\D/g, '');

  const mapping = {
    offer_price: text => replaceNonDigits(text).replace(/,/g, '.'),
    original_price: text => replaceNonDigits(text).replace(',', '.'),
    weight_raw: text => text.replace(',', '.'),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
