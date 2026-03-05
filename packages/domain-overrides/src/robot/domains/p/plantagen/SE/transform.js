/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const replaceNonDigits = text => text.replace(/[^\d.,]|([.,](?![\d.,]))/g, '');

  const mapping = {
    productURL: (text, row) => `https://www.plantagen.se/${row.productURLs?.[1]?.text}`,
    // productURL: (text, row) => row.productURLs?.[1]?.text,
    user_reviews: replaceNonDigits,
    height: replaceNonDigits,
    width: replaceNonDigits,
    depth: replaceNonDigits,
    diameter: replaceNonDigits,
    weight_raw: replaceNonDigits,
    original_price: (text, row) => {
      if (text === 'dummy') {
        if (row.original_price_text?.length > 1) {
          const text1 = row.original_price_text[0]?.text;
          const text2 = row.original_price_text[1]?.text;
          return `${text1}.${text2}`;
        }
        return replaceNonDigits(row.original_price_text[0]?.text);
      }
      return text;
    },
    offer_price: (text, row) => {
      if (!row.offer_price_text) return null;
      if (row.offer_price_text?.length > 1) {
        console.log('offer price is', row.offer_price_text);
        const text1 = row.offer_price_text[0]?.text;
        const text2 = row.offer_price_text[1]?.text;
        return `${text1}.${text2}`;
      }
      if (row.offer_price_text[0]?.text) return replaceNonDigits(row.offer_price_text[0]?.text);
      return null;
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
