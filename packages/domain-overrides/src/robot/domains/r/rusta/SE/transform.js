/* eslint-disable no-param-reassign */
/* eslint-disable linebreak-style */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    discount_amount: (text, row) => {
      if (text !== null) {
        let price = Number(row.offer_price[0].text);
        if (Number.isNaN(price)) {
          price = Number(row.price_json[0].text);
          row.offer_price = [{ text: price.toString() }];
        }
        row.original_price = [{ text: (price + Number(text)).toString() }];
      }

      return text;
    },

    price_json: (text, row) => {
      if (text !== null && row.discount_amount !== undefined) {
        const price = Number(text);
        row.offer_price = [{ text: price.toString() }];
      } else if (text !== null) {
        const price = Number(text);
        row.original_price = [{ text: price.toString() }];
        row.offer_price = [{ text: null }];
      }

      return text;
    },

    weight_raw: text => text.replace(/\s/g, '').split('/')[0].replace(/\.$/, ''),
    width: text => text.replace(/\s/g, '').split('/')[0].replace(/\.$/, ''),
    height: text => text.replace(/\s/g, '').split('/')[0].replace(/\.$/, ''),
    length: text => text.replace(/\s/g, '').split('/')[0].replace(/\.$/, ''),
    diameter: text => text.replace(/\s/g, '').split('/')[0].replace(/\.$/, ''),
    depth: text => text.replace(/\s/g, '').split('/')[0].replace(/\.$/, ''),
    volume: text => text.replace(/\s/g, '').split('/')[0].replace(/\.$/, ''),

    product_details: text => text.split('$%').filter(x => x !== '').join('\n'),
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
