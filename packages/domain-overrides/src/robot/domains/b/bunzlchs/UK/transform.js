/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  function getCurrencyCode(str) {
    const currencyMap = {
      // eslint-disable-next-line quote-props
      '$': 'USD',
      '€': 'EUR',
      '£': 'GBP',
    };
    const currencySymbols = Object.keys(currencyMap).map(symbol => `\\${symbol}`).join('|');
    const regexPattern = new RegExp(`(${currencySymbols})`);
    const match = str.match(regexPattern);
    return match ? currencyMap[match[0]] : null;
  }
  const mapping = {
    category: text => text.split('\n').map(str => str.trim()).filter(Boolean).join('/'),
    manufacturer: text => (text.includes('-') ? null : text),
    currency: text => getCurrencyCode(text),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
