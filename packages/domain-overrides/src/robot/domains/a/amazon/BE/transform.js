/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    shippingCost: text => (!text.match(/\d/) ? '0' : +text.replace('&nbsp', '.').match(/\d+[.]?\d*/)),
    resellerReviewCount: text => (text.replace(',', '')),
    resellerLimit: (text) => {
      if (text.includes('müşteri başına')) { // TODO
        text = 'true';
        return text;
      }
      text = 'false';
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
