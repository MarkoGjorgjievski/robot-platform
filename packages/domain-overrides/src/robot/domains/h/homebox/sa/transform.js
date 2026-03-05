/* eslint-disable no-param-reassign
*/
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const extractDimension = (text, dimName) => text.match(RegExp(`${dimName}:\\s*([.\\d]+)`, 'i'))?.[1];
  const mapping = {
    offer_price: (text, row) => {
      if (!row.original_price?.[0]?.text) {
        row.original_price = [{ text: `${text}` }];
        text = '';
      }
      return text;
    },
    dimensions_raw: (text, row) => {
      if (!row.depth) row.depth = [{ text: extractDimension(text, 'Depth') }];
      if (!row.width) row.width = [{ text: extractDimension(text, 'Width') }];
      if (!row.height) row.height = [{ text: extractDimension(text, 'Height') }];
      if (!row.length) row.length = [{ text: extractDimension(text, 'Length') }];
      if (!row.weight_raw) row.weight_raw = [{ text: extractDimension(text, 'Weight') }];
    },
    average_rating: text => text.match(/\d(\.\d\d?)?/)?.[0],
    product_details: text => text.replace(/\n/g, ''),
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
