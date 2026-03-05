/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    original_price: (text, row) => {
      if (row.price) {
        return row.on_sale ? null : row.price[0]?.text;
      } return null;
    },
    offer_price: (text, row) => {
      if (row.price) {
        return row.on_sale ? row.price?.[0]?.text : null;
      } return null;
    },
    variants: (text, row) => {
      if (row.product_variations) {
        row.product_variations.splice(0, row.product_variations.length);
        let obj = null;
        try {
          obj = JSON.parse(text);
        } catch (e) {
          return null;
        }
        Object.entries(obj).map((x) => {
          if (x[1].handle !== undefined) {
            const url = `https://www.thebrick.com/products/${x[1].handle}`;
            // condition commented out for now, will use if client requests
            // to remove listing_url from product_variations
            // if (url !== row.listing_url?.[0]?.text) { // don't save the current url
            row.product_variations.push({ text: url });
            // }
          }
          return x;
        });
      }
      return null;
    },
    product_details: text => (String(text).replace(/(\n )+/gm, '\n')),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
