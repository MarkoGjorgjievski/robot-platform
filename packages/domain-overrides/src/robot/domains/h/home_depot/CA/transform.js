/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    offer_price: (text, row) => {
      const offerPrice = row.original_price?.[0].text;
      row.original_price = [{ text }];
      return offerPrice;
    },
    depth: text => String(Number(text)),
    height: text => String(Number(text)),
    lenght: text => String(Number(text)),
    width: text => String(Number(text)),
    weight_raw: text => String(Number(text)),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
