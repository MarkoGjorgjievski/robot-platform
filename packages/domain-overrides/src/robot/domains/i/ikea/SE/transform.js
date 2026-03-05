/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const replaceNonDigits = text => text.replace(/\D/g, '');

  const mapping = {
    totalProduct: text => Math.ceil(parseInt(text, 10) / 24),
    productURL: (text, row) => row.productURLs?.[1]?.text,
    dimensions_unit: text => text.replace(/[^a-zA-Z]/g, ''),
    weight_raw: (text, row) => {
      if (row.weight_raw_data.length <= 1) return row.weight_raw_data[0].text;
      const sum = row.weight_raw_data.reduce((acc, item) => {
        // eslint-disable-next-line no-param-reassign
        acc += parseFloat(item.text);
        return acc;
      }, 0);
      return sum.toString();
    },
    user_reviews: replaceNonDigits,
    pack_size: replaceNonDigits,
    diameter: replaceNonDigits,
    height: replaceNonDigits,
    width: replaceNonDigits,
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
