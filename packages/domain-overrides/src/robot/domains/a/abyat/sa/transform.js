/* eslint-disable no-param-reassign
*/
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    // offer_price_int: (text, row) => {
    //   text = text.replace(',', '');
    //   if (!row.original_price?.[0]?.text) row.original_price = [{ text: `${text}${row.offer_price_dot[0].text}${row.offer_price_dec[0].text}` }];
    //   else row.offer_price = [{ text: `${text}${row.offer_price_dot[0].text}${row.offer_price_dec[0].text}` }];
    //   return text;
    // },
    offer_price: (text, row) => {
      text = text.replace(',', '');
      text = text.match(/(\d+\.\d{1,2})|(\d+)/g)?.[0];
      if (!row.original_price?.[0]?.text) {
        row.original_price = [{ text: `${text}` }];
        text = '';
      }
      return text;
    },
    product_details: (text) => {
      text = text.replace(/\s\n/g, '');
      text = text.replace(/\n/g, '');
      return text;
    },
    color_dimension: (text, row) => {
      const colour = text.match(/(((\w+\s\w+)|(\w+))(?= \|))/g)?.[0];
      const length = text.match(/(?<=| )(\d+\.\d{1,2})|(\d+)/g)?.[0];
      const width = text.match(/(?<=x )((\d+\.\d{1,2})|(\d+))(?= x)/g)?.[0];
      const height = text.match(/(?<=x )((\d+\.\d{1,2})|(\d+))(?=cm)/g)?.[0];
      const unitD = text.match(/([a-zA-Z]*)$/g)?.[0];

      if (colour !== undefined) row.colour = [{ text: `${colour}` }];
      if (height !== undefined) row.height = [{ text: `${height}` }];
      if (width !== undefined) row.width = [{ text: `${width}` }];
      if (length !== undefined) row.length = [{ text: `${length}` }];
      if (unitD !== undefined) row.dimensions_unit = [{ text: `${unitD}` }];
      return text;
    },
    product_variations: text => `https://www.abyat.com/en-US/products/${text}`,
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
