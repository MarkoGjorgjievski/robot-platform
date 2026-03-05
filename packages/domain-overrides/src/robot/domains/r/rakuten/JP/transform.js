/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    reviewsUrl: (text) => {
      let url = text;
      const sortParameter = 'sort6';

      // Find the position of '1.1' in the URL
      const index = url.indexOf('1.1');

      if (index !== -1) {
        url = `${url.slice(0, index + 3)}/${sortParameter}${url.slice(index + 3)}`;
      }
      return url;
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
