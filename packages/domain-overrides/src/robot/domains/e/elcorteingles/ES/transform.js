/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    product_variations: (text, row) => {
      const url = `https://www.elcorteingles.es/hogar/${row.listing_id[0]?.text}/?color=`;
      return url + encodeURIComponent(text);
    },
    offer_price: (text, row) => {
      const oprice = row.original_price?.[0]?.text;
      // eslint-disable-next-line no-param-reassign
      row.original_price[0].text = text;
      return oprice;
    },
    product_details: (text, row) => {
      const extraDetails = row?.product_extra_details?.[0]?.text;
      if (extraDetails) return `${text}\n${extraDetails}`;
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
