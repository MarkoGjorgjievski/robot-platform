/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    length: (text => text.split(' x ')[0]),
    width: (text => text.split(' x ')[1]),
    height: (text => text.split(' x ')[2].split(' ')[0]),
    weight_raw: (text => text.replace(/\s*LB$/, '')),
    pack_size: (text => text.replace(/^Case of /, '')),
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
