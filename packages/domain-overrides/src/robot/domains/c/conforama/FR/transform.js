/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    offer_price: (text, row) => {
      if (row?.offer_price_decimal?.[0]?.text) {
        return `${text}.${row.offer_price_decimal[0].text}`;
      }
      return text;
    },
    original_price: (text, row) => {
      if (text !== 'dummy' && row?.original_price_decimal?.[0]?.text) {
        return `${text}.${row.original_price_decimal[0].text}`;
      }
      if (text !== 'dummy') return text;
      if (text === 'dummy' && row?.original_price_backup_decimal?.[0]?.text) return `${row?.original_price_backup?.[0]?.text}.${row?.original_price_backup_decimal?.[0]?.text}`;
      return row?.original_price_backup?.[0]?.text;
    },
    length: (text, row) => {
      if (text !== 'dummy') return text;
      if (row.dimensions_backup) {
        const dimensionsArr = row?.dimensions_backup[0]?.text.match(/\d+(\.\d+)?/g);
        return dimensionsArr && dimensionsArr[1] ? dimensionsArr[1] : null;
      }
      return null;
    },
    width: (text, row) => {
      if (text !== 'dummy') return text;
      if (row.dimensions_backup) {
        const dimensionsArr = row?.dimensions_backup[0]?.text.match(/\d+(\.\d+)?/g);
        return dimensionsArr && dimensionsArr[0] ? dimensionsArr[0] : null;
      }
      return null;
    },
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach((obj) => {
    obj.group.forEach(row => Object.keys(row).forEach((header) => {
      // eslint-disable-next-line no-param-reassign
      if (mapping[header]) row[header] = mappingFct(header, row[header], row);
    }));
  });
  return data;
};

module.exports = { cleanUp };
