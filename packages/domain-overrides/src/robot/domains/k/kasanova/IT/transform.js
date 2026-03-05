/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    original_price: text => text.replace(/€/g, '').trim(),
    offer_price: text => text.replace(/€/g, '').trim(),
    width: text => text.replace(/\D/g, ''),
    height: text => text.replace(/\D/g, ''),
    length: text => text.replace(/\D/g, ''),
    weight_unit: text => text.replace(/[0-9,]/g, ''),
    materials: text => text.replace('\n', ':'),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
