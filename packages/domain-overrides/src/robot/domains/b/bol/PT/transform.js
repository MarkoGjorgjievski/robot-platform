/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    isPublicPurchase: (text => ['comprar', 'inscrever', 'assistir'].includes(text.toLowerCase())),
    eventTime: (text, row) => {
      if (text !== '0') return text;

      // eslint-disable-next-line no-param-reassign
      row.isTBA = [{ text: 1 }];

      return '15:00';
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
