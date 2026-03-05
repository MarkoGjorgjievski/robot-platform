/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    height: text => text.replace(/(\d+,\d+)\s*(m)(?!m)/, (_, num) => num.replace(',', '')).split(' ')?.[0],
    diameter: text => text.match(/\d+/)?.[0],
    width: text => text.replace(/(\d+,\d+)\s*(m)(?!m)/, (_, num) => num.replace(',', '')).split(' ')?.[0],
    depth: text => text.replace(/(\d+,\d+)\s*(m)(?!m)/, (_, num) => num.replace(',', '')).split(' ')?.[0],
    length: text => text.replace(/(\d+,\d+)\s*(m)(?!m)/, (_, num) => num.replace(',', '')).split(' ')?.[0],
    weight_unit: text => (text.includes('kg') ? 'kg' : 'g'),
    listing_id: text => text.split(': ')?.[1],
    product_variations: text => text.replace('#', ''),
    user_reviews: text => text.match(/\d+/)?.[0],
    pack_size: text => text.match(/\b\d+\s+szt\b/)?.[0].match(/\d+/)?.[0],
    volume: text => (text.includes('l') ? text.match(/\d+,\d+/)?.[0] : ''),
    materials: text => (text.split(':')[1] || text),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
