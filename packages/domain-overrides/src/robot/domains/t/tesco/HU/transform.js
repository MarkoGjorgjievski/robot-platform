/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    pack_size: text => (text === '/db' ? 1 : text),
    weight_unit: (text) => {
      if (text === '/kg') return 'kg';
      if (text === '/g') return 'g';
      return text;
    },

    weight_raw: (text) => {
      if (text === '/kg' || text === '/g') return '1';
      return text;
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({
    text: mapping[header](text, row),
    ...other,
  }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);

    if (row.eventName?.[0]?.text === 'Valle de la Luna') {
      // eslint-disable-next-line no-param-reassign
      row = null;
    }
  })));

  return data;
};

module.exports = { cleanUp };
