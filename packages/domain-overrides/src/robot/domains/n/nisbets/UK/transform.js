/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const removeCommas = text => text?.replace(/,/g, '');
  const mapping = {
    price: text => removeCommas(text),
    old_price: text => removeCommas(text),
    old_price_2: text => removeCommas(text),
    product_url: (text, row) => {
      if (row.category?.[0]?.text) {
        const uniqueCategories = new Set();
        row.category.forEach((cat) => {
          uniqueCategories.add(cat.text);
        });
        row.category = [{ text: Array.from(uniqueCategories).join('/') }];
      }
      if (row.old_price_2?.[0]?.text) {
        row.old_price = [{ text: removeCommas(row.old_price_2?.[0]?.text) }];
        row.reduced_flag = [{ text: 'Reduced Price' }]; // in case of products with variants it doesn't display the flag
      }
      if (row.product_name?.[0]?.text) {
        row.product_name = [{ text: row.product_name?.[0]?.text.replace('\n', '') }];
      }

      if (row.hidden_product_name?.[0]?.text) {
        row.hidden_product_name = [{ text: row.hidden_product_name?.[0]?.text.replace('\n', '') }];
      }

      if (row.currency?.[0]?.text) {
        const currencyMap = {
          '£': 'GBP',
          // eslint-disable-next-line quote-props
          '$': 'USD',
          '€': 'EUR',
        };
        row.currency = [{ text: row.currency?.[0]?.text.replace(/[£$€]/g, match => currencyMap[match]) }];
      }

      // if (row.rating?.[0]?.text.includes('0.0')) {
      //   row.hidden_product_name = [{ text: '' }];
      // }

      // if (row.product_code?.[0]?.text) {
      //   const regex = /[\s+\W+]/g;
      //   row.product_code = [{ text: row.product_code?.[0]?.text.replace(regex, '').replace('Code', '') }];
      // }
      return text;
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
