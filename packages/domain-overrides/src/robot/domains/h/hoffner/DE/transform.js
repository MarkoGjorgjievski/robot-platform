/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    weight_raw: (text, row) => {
      const totalWeight = row.weight_raw.reduce(
        (acc, weight) => acc + parseInt(weight.text, 10),
        0,
      );
      return `${totalWeight}`;
    },
    product_variations: text => (text ? `https://www.hoeffner.de/artikel/${text}` : null),
    offer_price: (text, row) => {
      if (!text) {
        return row.original_price;
      }
      return row.offer_price[0].text + row.offer_price[1].text;
    },
    original_price: (text, row) => row.original_price[0].text + row.original_price[1].text,
    stock_availability: text => !!(+text > 0 || text === 'true'),
  };
  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({
    text: mapping[header](text, row),
    ...other,
  }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};
module.exports = { cleanUp };
