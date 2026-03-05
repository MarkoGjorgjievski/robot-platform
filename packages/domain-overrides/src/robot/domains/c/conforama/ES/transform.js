/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    product_variations: (text, row) => `${String(row.listing_url?.[0]?.text)}?item=${text}`,
    original_price: (text, row) => ((row.list_price?.[0]?.text === '0') ? String(Number(row.price?.[0]?.text)) : String(Number(row.list_price?.[0]?.text))),
    offer_price: (text, row) => ((row.list_price?.[0]?.text === '0') ? null : String(Number(row.price?.[0]?.text))),
    weight_raw: text => String(Number(text)),
    materials: (text, row) => {
      if (text === 'null') {
        if (row.materials_backup?.[0]?.text !== undefined) {
          let output = '';
          // eslint-disable-next-line no-return-assign
          row.materials_backup.forEach(x => output += `${x.text}, `);
          output = output.slice(0, -2);
          return output;
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
