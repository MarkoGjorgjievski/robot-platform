/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const mapping = {
    listing_id: text => (text ? text.split('.').join('') : null),
    original_price: (text, row) => {
      if (text === '-1' && row.offer_price[0]) {
        const price = row.offer_price[0].text;
        row.offer_price[0].text = null;
        return price;
      }
      return text;
    },
    colour: (text) => {
      const colour = text ? text.split(', ') : null;
      return colour.length > 1 ? colour[1].replace(',', '') : null;
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
