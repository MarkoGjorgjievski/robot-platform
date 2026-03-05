/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const toISODate = text => new Date(Date.parse(text.split('/').reverse().join('-'))).toISOString();
  const mapping = {
    startDate: text => toISODate(text),
    endDate: text => toISODate(text),
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({
    text: mapping[header](text, row),
    ...other,
  }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
