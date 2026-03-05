/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    height: (text) => {
      if (!text.includes('/')) return text;
      const newTextArr = text.split('/');
      return newTextArr[newTextArr.length - 1];
    },
    weight_raw: (text) => {
      if (!text.includes('/')) return text;
      const newTextArr = text.split('/');
      return newTextArr[newTextArr.length - 1];
    },
    width: (text) => {
      if (!text.includes('/')) return text;
      const newTextArr = text.split('/');
      return newTextArr[newTextArr.length - 1];
    },
    length: (text) => {
      const regex = /(\d+)\/(\d+)/;
      const match = text.match(regex);
      if (!match) return text;
      // Transform to decimal number and return
      const numerator = parseInt(match[1], 10);
      const denominator = parseInt(match[2], 10);
      return numerator / denominator;
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
