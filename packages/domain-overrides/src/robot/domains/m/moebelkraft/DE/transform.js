/* eslint-disable no-param-reassign
*/
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    properties_tmp: (text, row) => {
      if (!row.product_details) {
        row.product_details = [];
      }

      row.product_details.push({ text: `${text.replace(/\r?\n|\r/g, ' ')}` });

      return text;
    },
    stock_availability_tmp: (text, row) => {
      row.stock_availability = [{ text: `${text.toLowerCase().includes('instock')}` }];
    },
    original_price_tmp: (text, row) => {
      row.original_price = [{ text: `${text.replace(',', '.').replace('-', '00')}` }];
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
