/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const mapping = {
    offer_price: (text, row) => {
      const originalPrice = row.original_price?.[0]?.text;
      if (originalPrice === text) return null;
      return text;
    },
    stock_availability: (text, row) => {
      const soldOut = row.sold_out?.[0]?.text;
      const unavaliableInShippingWarehouse = row.unavailable_in_shipping_warehouse?.[0]?.text;
      if (soldOut || unavaliableInShippingWarehouse) return 'no';
      return text;
    },
  };

  const mappingFct = (header, arr, row) => [
    ...arr.map(({ text, ...other }) => ({
      text: mapping[header](text, row),
      ...other,
    })),
  ];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
