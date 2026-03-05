/* eslint-disable consistent-return */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    productURL: text => `https://www.siko.sk/${text}`,
    original_price: (text, row) => {
      if (text !== 'dummy' && (!row.offer_price || !row.offer_price[0]?.text)) {
        return row.original_price_fraction?.[0]?.text ? `${text.trim()},${row.original_price_fraction?.[0]?.text}` : text;
      }
      if (text === 'dummy') {
        return row.original_price_backup?.[0]?.text ? row.original_price_backup?.[0]?.text : null;
      }
    },
    offer_price: (text, row) => {
      if (!row.original_price_fraction || !row.original_price_fraction[0]?.text) {
        return text;
      }
      return `${text.trim()},${row.original_price_fraction[0].text}`;
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
