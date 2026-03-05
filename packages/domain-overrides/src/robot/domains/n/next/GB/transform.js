/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    original_price: (text => (text.replace(/[£,]/g, '')?.split(' - ')[0].match(/\d+/)[0])),
    offer_price: (text => (text.match(/\d+/)[0])),
    width: (text => (text.match(/\d+/)[0])),
    height: (text => (text.match(/\d+/)[0])),
    length: (text => (text.match(/\d+/)[0])),
    diameter: (text => (text.match(/\d+(\.\d+)?/)[0])),
    volume: (text => (text.match(/\d+(\.\d+)?/)[0])),
    depth: (text => (text.match(/\d+/)[0])),
    average_rating: (text => (text.match(/\d+/)[0])),
    pack_size: (text => (text.match(/\b\d+\s+Piece\b/)?.[0].match(/\d+/)?.[0] || '1')),
    product_variations: (text => (`https:${text}#${text.split('/').pop()}`)),
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
