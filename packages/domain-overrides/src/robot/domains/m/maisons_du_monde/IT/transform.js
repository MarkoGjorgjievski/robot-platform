/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    offer_price: (text, row) => {
      const originalPrice = row.original_price?.[0]?.text;
      row.original_price = [{ text }];
      return originalPrice;
    },
    product_variations: text => `https://www.maisonsdumonde.com${text}`,
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);

    if (row.eventName?.[0]?.text === 'Valle de la Luna') {
      // eslint-disable-next-line no-param-reassign
      row = null;
    }
  })));

  return data;
};

module.exports = { cleanUp };
