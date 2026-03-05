/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const validPrice = (str) => {
    // eslint-disable-next-line no-param-reassign
    str = str.replace(/[€-]/g, '');
    if (str.endsWith(',')) {
      // eslint-disable-next-line no-param-reassign
      str = str.slice(0, -1);
    }
    return str;
  };
  const mapping = {
    product_variations: text => `https://www.sconto.de/artikel/${text}`,
    materialRaw: (text, row) => {
      // leave uniques in the array
      // eslint-disable-next-line no-param-reassign
      row.materials = row?.materials?.filter((value, index, self) => self.findIndex(item => item.text === value.text) === index) || null;
    },

    stock_availability: text => (text === 'yes' ? text : 'no'),
    // eslint-disable-next-line consistent-return
    original_price: (text) => {
      if (text) {
        return validPrice(text);
      }
    },
    // eslint-disable-next-line consistent-return
    offer_price: (text) => {
      if (text) {
        return validPrice(text);
      }
    },
  };
  // const anwer = []
  // const textArr = []
  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];
  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
//
