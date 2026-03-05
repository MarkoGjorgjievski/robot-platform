/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    stock_availability: text => (text.includes('InStock') ? '1' : '0'),
    height: text => text.replace(/\D/g, ''),
    width: text => text.replace(/\D/g, ''),
    material: text => text.replace(/\D/g, ''),
    depth: text => text.replace(/\s?cm/, ''),
    pack_size: text => (text.match(/(\b\d+)\s+stuks\b/) || [null, '1'])[1],
    diameter: text => (text.match(/Diameter\s+(\d+)/i) || [])[1],
    original_price: text => (text.includes('-') ? text.match(/\d+/)[0] : text),
    offer_price: text => (text.includes('-') ? text.match(/\d+/)[0] : text),
    review_date: text => (text.includes('T') ? text.split('T')[0] : text),
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
