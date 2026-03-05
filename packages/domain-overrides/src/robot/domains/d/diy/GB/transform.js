/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    main_image: text => (`${text}.jpg`),
    offer_price: (text, row) => (row.was_price?.[0]?.text ? row.primary_price?.[0]?.text : null),
    original_price: (text, row) => {
      if (row.was_price?.[0]?.text) {
        return row.was_price?.[0]?.text;
      }
      return row.primary_price?.[0]?.text ? row.primary_price?.[0]?.text : '0';
    },
    product_variations: (text, row) => {
      const id = row.listing_id?.[0]?.text;
      const url = row.listing_url?.[0]?.text;
      if (id !== undefined && url !== undefined) {
        if (url.includes(id)) { // in this case we may just replace the id in url
          return url.replace(/\/\d+_BQ\.prd/, `/${text}_BQ.prd`);
        } // alternative: use 'similar products' as a source for links
        const productIndex = row.variant_ids?.map(x => (x.text)).indexOf(id);
        let thisVariantIndex = row.variant_ids?.map(x => (x.text)).indexOf(text);
        if (thisVariantIndex === productIndex) { return null; } // skip this to prevent a duplicate value
        if (thisVariantIndex > productIndex) { thisVariantIndex -= 1; } // skip the product as it's not listed in similar products
        const output = row.variant_urls?.[thisVariantIndex]?.text;
        return (output !== undefined) ? output : null;
      }
      return null;
    },
    materials: (text, row) => {
      if (text === 'null') {
        if (row.materials_backup?.[0]?.text !== undefined) {
          return row.materials_backup?.[0]?.text;
        }
        return null;
      }
      return text;
    },
    colour: (text, row) => {
      if (text === 'null') {
        if (row.colour_backup?.[0]?.text !== undefined) {
          return row.colour_backup?.[0]?.text;
        }
        return null;
      }
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
