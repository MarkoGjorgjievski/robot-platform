/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    user_reviews: (text) => {
      const regex = /\((\d+)\)/;
      return text.replace(regex, (match, group1) => group1);
    },
    dimensions_unit: text => text.replace(/[^a-zA-Z]/g, ''),
    weight_unit: text => text.split(' ').pop(),
    materials: text => text.replace(/\n/g, ''),
    colour: (text) => {
      const trimmedResult = text.trim();
      const words = trimmedResult.split(' ');
      return words[words.length - 1];
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
